const functions = require('firebase-functions');
const admin = require('firebase-admin');
const { findMatchingCards } = require('./cardLogic');
const { getNextPlayerIndex, checkWinCondition } = require('./gameRules');

const db = admin.firestore();
const { makeBotDecision } = require('./botTrigger');

/**
 * Core action processing logic - can be called directly by bot trigger
 */
async function processAction({ gameId, action, targetPlayerId, userId, isBot = false, actionId = null }) {
  // Validation
  if (!gameId || !action) {
    throw new Error('Missing required fields');
  }

  if (action !== 'score' && action !== 'steal') {
    throw new Error('Invalid action type');
  }

  if (action === 'steal' && !targetPlayerId) {
    throw new Error('Target player required for steal');
  }

  // Run transaction to prevent race conditions
  const result = await db.runTransaction(async (transaction) => {
    const gameRef = db.collection('games').doc(gameId);
    const gameDoc = await transaction.get(gameRef);

    if (!gameDoc.exists) {
      throw new Error('Game not found');
    }

    const game = gameDoc.data();

    // If this is a bot-execution request that references a pending bot action, validate it
    if (isBot && actionId) {
      const pending = game.botPendingAction;
      if (!pending) {
        console.error('Bot action validation failed - no pending bot action', { gameId, userId, action, targetPlayerId, actionId });
        throw new Error('No pending bot action');
      }
      if (pending.actionId !== actionId) {
        // Allow a tolerant match if the pending action semantics match (same bot, same action, same target)
        const tolerantMatch = (
          pending.botPlayerId === userId &&
          pending.action === action &&
          ((pending.targetPlayerId || null) === (targetPlayerId || null)) &&
          !pending.consumed &&
          !(pending.expiresAt && pending.expiresAt < Date.now())
        );
        if (tolerantMatch) {
          console.warn('Bot action id mismatch tolerated - using server pending.actionId', { gameId, userId, providedActionId: actionId, pendingActionId: pending.actionId, pending });
          // Use server's authoritative actionId for consumption
          actionId = pending.actionId;
        } else {
          console.error('Bot action validation failed - action id mismatch', { gameId, userId, providedActionId: actionId, pendingActionId: pending.actionId, pending });
          throw new Error('Invalid bot action id');
        }
      }
      if (pending.consumed) {
        console.error('Bot action validation failed - already consumed', { gameId, userId, actionId, pending });
        throw new Error('Bot action already consumed');
      }
      if (pending.expiresAt && pending.expiresAt < Date.now()) {
        console.error('Bot action validation failed - expired', { gameId, userId, actionId, pending });
        throw new Error('Bot action expired');
      }
      if (pending.botPlayerId !== userId) {
        console.error('Bot action validation failed - botPlayerId mismatch', { gameId, userId, actionId, pending });
        throw new Error('Bot action not for this bot');
      }
      // Ensure requested action matches pending intent
      if (pending.action !== action) {
        console.error('Bot action validation failed - action mismatch', { gameId, userId, action, pending });
        throw new Error('Requested action does not match pending bot action');
      }
      if ((pending.targetPlayerId || null) !== (targetPlayerId || null)) {
        console.error('Bot action validation failed - target mismatch', { gameId, userId, targetPlayerId, pending });
        throw new Error('Requested target does not match pending bot action');
      }
    }

    // Find player - handle bots, local mode, and regular multiplayer
    let playerIndex;
    
    if (isBot) {
      // Bot call - find by bot player ID
      playerIndex = game.players.findIndex(p => p.id === userId);
      if (playerIndex === -1) {
        throw new Error('Bot not in game');
      }
      // Verify it's actually a bot
      if (!game.players[playerIndex].isBot) {
        throw new Error('Player is not a bot');
      }
      // Verify it's the bot's turn
      if (game.currentPlayerIndex !== playerIndex) {
        throw new Error('Not bot\'s turn');
      }
    } else if (game.isLocalMode) {
      // Local-mode: multiple players share one browser/session but the game
      // is still server-authoritative. Only allow an authenticated "local
      // controller" (the creator) to perform actions for local games. We
      // detect the controller by the player id naming convention used by the
      // client: human player ids for local games are prefixed with the
      // creator's uid, e.g. `<uid>-local-0`.
      if (!userId) {
        throw new Error('Unauthenticated - cannot perform action in local mode');
      }
      const isLocalController = game.players.some(p => typeof p.id === 'string' && p.id.startsWith(`${userId}-local-`));
      if (!isLocalController) {
        throw new Error('Not authorized to perform actions in this local game');
      }
      // Use server currentPlayerIndex (client drives which local player is active)
      playerIndex = game.currentPlayerIndex;
    } else {
      // Regular multiplayer mode - player must match their own ID
      playerIndex = game.players.findIndex(p => p.id === userId);
      if (playerIndex === -1) {
        throw new Error('Player not in game');
      }

      // Validate it's player's turn
      if (game.currentPlayerIndex !== playerIndex) {
        throw new Error('Not your turn');
      }
    }

    // Validate deck has cards
    if (game.drawPile.length === 0) {
      throw new Error('Deck is empty');
    }

    // Execute action
    let actionResult;
    if (action === 'score') {
      actionResult = executeScoreAction(game, playerIndex);
    } else {
      const targetIndex = game.players.findIndex(p => p.id === targetPlayerId);
      if (targetIndex === -1 || targetIndex === playerIndex) {
        throw new Error('Invalid target player');
      }
      actionResult = executeStealAction(game, playerIndex, targetIndex);
    }

    // If this was a bot execution (actionId present), mark the pending action consumed
    if (isBot && actionId) {
      actionResult.updates = actionResult.updates || {};
      actionResult.updates.botPendingAction = {
        ...(game.botPendingAction || {}),
        consumed: true
      };
    }

    // Update game state
    transaction.update(gameRef, actionResult.updates);

    return actionResult;
  });

  return { success: true, animationHint: result.animationHint };
}

/**
 * Callable function to perform game actions (score or steal)
 * Called by clients when they click Score or Steal button
 */
exports.performAction = functions.https.onCall(async (data, context) => {
  const { gameId, action, targetPlayerId, botPlayerId, actionId } = data;
  
  // Determine if this is a bot call or player call
  const isBotCall = !!botPlayerId;
  const userId = isBotCall ? botPlayerId : context.auth?.uid;
  
  // Authentication check (only for non-bot calls)
  if (!isBotCall && !context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'User must be authenticated');
  }

  try {
    const result = await processAction({
      gameId,
      action,
      targetPlayerId,
      userId,
      isBot: isBotCall,
      actionId: actionId || null
    });
    // Log the action result and animation hint for debugging steal/score mismatches
    try {
      console.log('performAction result', { gameId, action, userId, isBotCall }, 'animationHint=', result.animationHint);
    } catch (logErr) {
      console.warn('Failed to log performAction result', logErr);
    }
    return result;
  } catch (error) {
    console.error('Error performing action:', error);
    // Try to log the current botPendingAction in the game doc for debugging
    try {
      if (data && data.gameId) {
        const gameDoc = await db.collection('games').doc(data.gameId).get();
        if (gameDoc.exists) {
          console.error('Current game.botPendingAction for debugging:', gameDoc.data().botPendingAction);
        } else {
          console.error('Game doc not found when logging debug info', { gameId: data.gameId });
        }
      }
    } catch (logErr) {
      console.error('Failed to read game doc for debug logging', logErr);
    }
    // Convert regular errors to HttpsError for clients
    throw new functions.https.HttpsError('internal', error.message || 'Failed to perform action');
  }
});

// Export the core processing function for use by bot trigger
exports.processAction = processAction;

/**
 * Execute a score action - draw card and try to match in own tank
 */
function executeScoreAction(game, playerIndex) {
  const drawPile = [...game.drawPile];
  const drawnCard = drawPile.pop();
  const player = game.players[playerIndex];
  const updatedTank = [...player.tank, drawnCard];

  // Check for matches
  const matchingCards = findMatchingCards(updatedTank, drawnCard.color);
  
  const isSuccess = matchingCards.length >= 2;
  let newTank = updatedTank;
  let scoreIncrement = 0;
  let affectedCardIds = [drawnCard.id];

  if (isSuccess) {
    scoreIncrement = matchingCards.length;
    newTank = updatedTank.filter(card => !matchingCards.some(m => m.id === card.id));
    affectedCardIds = matchingCards.map(c => c.id);
  }

  const updatedPlayers = game.players.map((p, idx) => {
    if (idx === playerIndex) {
      return {
        ...p,
        tank: newTank,
        scoreCount: p.scoreCount + scoreIncrement
      };
    }
    return p;
  });

  const topCardBack = drawPile.length > 0 
    ? drawPile[drawPile.length - 1] // Send full card (client keeps front secret until flip)
    : null;

  const nextPlayerIndex = getNextPlayerIndex(playerIndex, game.players.length);

  // Check for winner
  const hasWinner = updatedPlayers.some(p => 
    checkWinCondition(p.scoreCount, game.players.length)
  );

  // Build animation hint - only match results, client handles flip
  const animationHint = {
    sequence: isSuccess ? 'SCORE_SUCCESS' : 'SCORE_FAIL',
    playerId: player.id,
    affectedCardIds, // Cards to highlight in tank
    color: drawnCard.color, // Color for match checking
    timestamp: Date.now()
    // Note: drawnCard flip is handled client-side optimistically
  };

  const updates = {
    players: updatedPlayers,
    drawPile,
    topCardBack,
    currentPlayerIndex: nextPlayerIndex,
    animationHint,
    animationInProgress: true, // Block bot turns during animation
    lastAction: {
      player: player.name,
      action: 'score',
      result: isSuccess ? 'success' : 'no match',
      resultSymbol: isSuccess ? 'MATCH' : 'NO_MATCH',
      color: drawnCard.color,
      timestamp: new Date().toISOString()
    },
    ...(hasWinner && { status: 'finished' })
  };

  // If the next player is a bot, compute its intended action now and include a pending action
  const nextPlayer = updatedPlayers[nextPlayerIndex];
  if (nextPlayer?.isBot) {
    const newGame = {
      ...game,
      players: updatedPlayers,
      drawPile,
      topCardBack,
      currentPlayerIndex: nextPlayerIndex
    };
    const botDecision = makeBotDecision(newGame, nextPlayerIndex, nextPlayer.botDifficulty || 'medium');
    const actionId = `bot-${Date.now()}-${Math.random().toString(36).substr(2,9)}`;
    const expiresAt = Date.now() + 30000; // 30s
    updates.botPendingAction = {
      action: botDecision.action,
      targetPlayerId: botDecision.targetPlayer != null ? newGame.players[botDecision.targetPlayer].id : null,
      actionId,
      computedAt: Date.now(),
      expiresAt,
      consumed: false,
      botPlayerId: nextPlayer.id
    };
  }

  return { updates, animationHint };
}

/**
 * Execute a steal action - draw card and try to match in target's tank
 */
function executeStealAction(game, playerIndex, targetIndex) {
  const drawPile = [...game.drawPile];
  const drawnCard = drawPile.pop();
  
  if (!drawnCard) {
    throw new Error('No cards left in deck');
  }
  
  const player = game.players[playerIndex];
  const targetPlayer = game.players[targetIndex];

  const updatedTargetTank = [...targetPlayer.tank, drawnCard];

  const matchingCards = findMatchingCards(updatedTargetTank, drawnCard.color);
  const isSuccess = matchingCards.length >= 2;
  
  let affectedCardIds = [drawnCard.id];

  // Update both tanks: on successful steal, move matching cards into the
  // acting player's tank and remove them from the target's tank. This
  // preserves the original Mantis rule: successful steals transfer cards
  // to the stealer's tank (NOT to the score pile).
  let newPlayerTank = [...player.tank];
  let newTargetTank = updatedTargetTank;

  if (isSuccess) {
    newPlayerTank = [...player.tank, ...matchingCards];
    newTargetTank = updatedTargetTank.filter(card => !matchingCards.some(m => m.id === card.id));
    affectedCardIds = matchingCards.map(c => c.id);
  }

  const updatedPlayers = game.players.map((p, idx) => {
    if (idx === targetIndex) {
      return { ...p, tank: newTargetTank };
    }
    if (idx === playerIndex) {
      return { ...p, tank: newPlayerTank };
    }
    return p;
  });

  const topCardBack = drawPile.length > 0 
    ? drawPile[drawPile.length - 1] // Send full card (client keeps front secret until flip)
    : null;

  // Move to next player. Special case: in 2-player games a successful
  // steal grants the acting player another turn (chain steal rule).
  let nextPlayerIndex = getNextPlayerIndex(playerIndex, game.players.length);
  if (game.players.length === 2 && isSuccess) {
    nextPlayerIndex = playerIndex; // stay on current player
  }

  const animationHint = {
    sequence: isSuccess ? 'STEAL_SUCCESS' : 'STEAL_FAIL',
    playerId: player.id,
    targetPlayerId: targetPlayer.id,
    affectedCardIds, // Cards to highlight in target tank
    color: drawnCard.color, // Color for match checking
    timestamp: Date.now()
    // Note: drawnCard flip is handled client-side optimistically
  };

  // Debug log for steal action outcome to help diagnose client-side "steal looked like a score" reports
  try {
    console.log('executeStealAction', {
      playerId: player.id,
      targetPlayerId: targetPlayer.id,
      sequence: animationHint.sequence,
      isSuccess,
      affectedCardIds,
      color: drawnCard.color,
      nextPlayerIndex
    });
  } catch (e) {
    console.warn('Failed to log executeStealAction debug info', e);
  }

  const updates = {
    players: updatedPlayers,
    drawPile,
    topCardBack,
    currentPlayerIndex: nextPlayerIndex,
    animationHint,
    animationInProgress: true, // Block bot turns during animation
    lastAction: {
      player: player.name,
      action: 'steal',
      target: targetPlayer.name,
      result: isSuccess ? 'success' : 'no match',
      resultSymbol: isSuccess ? 'MATCH' : 'NO_MATCH',
      color: drawnCard.color,
      timestamp: new Date().toISOString()
    }
  };

  // If the next player is a bot, compute its intended action now and include a pending action
  const nextPlayer = updatedPlayers[nextPlayerIndex];
  if (nextPlayer?.isBot) {
    const newGame = {
      ...game,
      players: updatedPlayers,
      drawPile,
      topCardBack,
      currentPlayerIndex: nextPlayerIndex
    };
    const botDecision = makeBotDecision(newGame, nextPlayerIndex, nextPlayer.botDifficulty || 'medium');
    const actionId = `bot-${Date.now()}-${Math.random().toString(36).substr(2,9)}`;
    const expiresAt = Date.now() + 30000; // 30s
    updates.botPendingAction = {
      action: botDecision.action,
      targetPlayerId: botDecision.targetPlayer != null ? newGame.players[botDecision.targetPlayer].id : null,
      actionId,
      computedAt: Date.now(),
      expiresAt,
      consumed: false,
      botPlayerId: nextPlayer.id
    };
  }

  return { updates, animationHint };
}
