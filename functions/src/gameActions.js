const functions = require('firebase-functions');
const admin = require('firebase-admin');
const { findMatchingCards } = require('./cardLogic');
const { getNextPlayerIndex, checkWinCondition } = require('./gameRules');

const db = admin.firestore();
const { makeBotDecision } = require('./botTrigger');

/**
 * Core action processing logic for human players.
 */
async function processAction({ gameId, action, targetPlayerId, userId }) {
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

    // Find player - handle local mode and regular multiplayer
    let playerIndex;
    
    if (game.isLocalMode) {
      // Local-mode: multiple players share one browser/session but the game
      // is still server-authoritative. Only allow an authenticated "local
      // controller" (the creator) to perform actions for local games.
      if (!userId) {
        throw new Error('Unauthenticated - cannot perform action in local mode');
      }
      const isLocalController = game.players.some(p => typeof p.id === 'string' && p.id.startsWith(`${userId}-local-`));
      if (!isLocalController) {
        throw new Error('Not authorized to perform actions in this local game');
      }
      // Use server currentPlayerIndex
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
 * Callable function to perform game actions (score or steal) for human players.
 */
exports.performAction = functions.https.onCall(async (data, context) => {
  const { gameId, action, targetPlayerId } = data;
  
  const userId = context.auth?.uid;
  
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'User must be authenticated');
  }

  try {
    const result = await processAction({
      gameId,
      action,
      targetPlayerId,
      userId,
    });
    console.log('performAction result', { gameId, action, userId }, 'animationHint=', result.animationHint);
    return result;
  } catch (error) {
    console.error('Error performing action:', error);
    throw new functions.https.HttpsError('internal', error.message || 'Failed to perform action');
  }
});

// Export the core processing function for use by other modules if needed
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

  // Build animation hint
  const animationHint = {
    sequence: isSuccess ? 'SCORE_SUCCESS' : 'SCORE_FAIL',
    playerId: player.id,
    affectedCardIds,
    color: drawnCard.color,
    timestamp: Date.now()
  };

  const updates = {
    players: updatedPlayers,
    drawPile,
    topCardBack,
    currentPlayerIndex: nextPlayerIndex,
    animationHint,
    animationInProgress: true,
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
    ? drawPile[drawPile.length - 1]
    : null;

  let nextPlayerIndex = getNextPlayerIndex(playerIndex, game.players.length);
  if (game.players.length === 2 && isSuccess) {
    nextPlayerIndex = playerIndex;
  }

  const animationHint = {
    sequence: isSuccess ? 'STEAL_SUCCESS' : 'STEAL_FAIL',
    playerId: player.id,
    targetPlayerId: targetPlayer.id,
    affectedCardIds,
    color: drawnCard.color,
    timestamp: Date.now()
  };

  console.log('executeStealAction', {
    playerId: player.id,
    targetPlayerId: targetPlayer.id,
    sequence: animationHint.sequence,
    isSuccess,
    affectedCardIds,
    color: drawnCard.color,
    nextPlayerIndex
  });

  const updates = {
    players: updatedPlayers,
    drawPile,
    topCardBack,
    currentPlayerIndex: nextPlayerIndex,
    animationHint,
    animationInProgress: true,
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
  return { updates, animationHint };
}

exports.signalClientReady = functions.https.onCall(async (data, context) => {
  const { gameId } = data;
  if (!gameId) {
    throw new functions.https.HttpsError('invalid-argument', 'gameId is required');
  }

  const gameRef = db.collection('games').doc(gameId);

  try {
    await db.runTransaction(async (transaction) => {
      const gameDoc = await transaction.get(gameRef);
      if (!gameDoc.exists) {
        throw new functions.https.HttpsError('not-found', 'Game not found');
      }
      const game = gameDoc.data();

      // If an animation was in progress, it's now finished.
      // Check if it's a bot's turn to play.
      const currentPlayer = game.players[game.currentPlayerIndex];
      if (currentPlayer?.isBot && game.animationInProgress) {
        console.log(`Bot turn for ${currentPlayer.name} in game ${gameId}`);

        // Make bot decision
        const botDecision = makeBotDecision(game, game.currentPlayerIndex, currentPlayer.botDifficulty || 'medium');
        
        let actionResult;
        if (botDecision.action === 'score') {
          actionResult = executeScoreAction(game, game.currentPlayerIndex);
        } else {
          const targetPlayer = game.players[botDecision.targetPlayer];
          if (!targetPlayer) {
            console.error(`Bot ${currentPlayer.name} chose invalid target index ${botDecision.targetPlayer}. Defaulting to score.`);
            actionResult = executeScoreAction(game, game.currentPlayerIndex);
          } else {
            actionResult = executeStealAction(game, game.currentPlayerIndex, botDecision.targetPlayer);
          }
        }
        
        // The action result already sets animationInProgress: true, which is correct for the new animation.
        transaction.update(gameRef, actionResult.updates);
        console.log(`Bot ${currentPlayer.name} performed ${botDecision.action}.`);

      } else {
        // If it's not a bot's turn or no animation was in progress, just mark animation as done.
        transaction.update(gameRef, { animationInProgress: false });
      }
    });

    return { success: true };
  } catch (error) {
    console.error('Error in signalClientReady:', error);
    if (error instanceof functions.https.HttpsError) {
      throw error;
    }
    throw new functions.https.HttpsError('internal', 'Failed to process client ready signal');
  }
});
