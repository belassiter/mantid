const functions = require('firebase-functions');
const admin = require('firebase-admin');
const { findMatchingCards } = require('./cardLogic');
const { getNextPlayerIndex, checkWinCondition } = require('./gameRules');

const db = admin.firestore();

/**
 * Core action processing logic - can be called directly by bot trigger
 */
async function processAction({ gameId, action, targetPlayerId, userId, isBot = false }) {
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
      // In local mode, trust the client - no auth validation needed
      // The client controls all players (humans and bots)
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
  const { gameId, action, targetPlayerId, botPlayerId } = data;
  
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
      isBot: isBotCall
    });
    return result;
  } catch (error) {
    console.error('Error performing action:', error);
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

  return {
    updates: {
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
    },
    animationHint
  };
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

  // Update both tanks
  const updatedPlayers = game.players.map((p, idx) => {
    if (idx === targetIndex) {
      // Target player loses matching cards or gains the drawn card
      const newTank = isSuccess
        ? p.tank.filter(card => !matchingCards.some(m => m.id === card.id))
        : updatedTargetTank;
      return { ...p, tank: newTank };
    }
    if (idx === playerIndex && isSuccess) {
      // Acting player gains score
      return {
        ...p,
        scoreCount: p.scoreCount + matchingCards.length
      };
    }
    return p;
  });

  if (isSuccess) {
    affectedCardIds = matchingCards.map(c => c.id);
  }

  const topCardBack = drawPile.length > 0 
    ? drawPile[drawPile.length - 1] // Send full card (client keeps front secret until flip)
    : null;

  const nextPlayerIndex = getNextPlayerIndex(playerIndex, game.players.length);

  const animationHint = {
    sequence: isSuccess ? 'STEAL_SUCCESS' : 'STEAL_FAIL',
    playerId: player.id,
    targetPlayerId: targetPlayer.id,
    affectedCardIds, // Cards to highlight in target tank
    color: drawnCard.color, // Color for match checking
    timestamp: Date.now()
    // Note: drawnCard flip is handled client-side optimistically
  };

  return {
    updates: {
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
    },
    animationHint
  };
}
