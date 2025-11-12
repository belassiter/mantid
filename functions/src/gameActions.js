const functions = require('firebase-functions');
const admin = require('firebase-admin');
const { findMatchingCards } = require('./cardLogic');
const { canPerformAction, getNextPlayerIndex, checkWinCondition } = require('./gameRules');

const db = admin.firestore();

/**
 * Callable function to perform game actions (score or steal)
 * Called by clients when they click Score or Steal button
 */
exports.performAction = functions.https.onCall(async (data, context) => {
  // Authentication check
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'User must be authenticated');
  }

  const { gameId, action, targetPlayerId } = data;
  const userId = context.auth.uid;

  // Validation
  if (!gameId || !action) {
    throw new functions.https.HttpsError('invalid-argument', 'Missing required fields');
  }

  if (action !== 'score' && action !== 'steal') {
    throw new functions.https.HttpsError('invalid-argument', 'Invalid action type');
  }

  if (action === 'steal' && !targetPlayerId) {
    throw new functions.https.HttpsError('invalid-argument', 'Target player required for steal');
  }

  try {
    // Run transaction to prevent race conditions
    const result = await db.runTransaction(async (transaction) => {
      const gameRef = db.collection('games').doc(gameId);
      const gameDoc = await transaction.get(gameRef);

      if (!gameDoc.exists) {
        throw new functions.https.HttpsError('not-found', 'Game not found');
      }

      const game = gameDoc.data();

      // Find player
      const playerIndex = game.players.findIndex(p => p.id === userId);
      if (playerIndex === -1) {
        throw new functions.https.HttpsError('permission-denied', 'Player not in game');
      }

      // Validate it's player's turn
      if (game.currentPlayerIndex !== playerIndex) {
        throw new functions.https.HttpsError('permission-denied', 'Not your turn');
      }

      // Validate deck has cards
      if (game.drawPile.length === 0) {
        throw new functions.https.HttpsError('failed-precondition', 'Deck is empty');
      }

      // Execute action
      let actionResult;
      if (action === 'score') {
        actionResult = executeScoreAction(game, playerIndex);
      } else {
        const targetIndex = game.players.findIndex(p => p.id === targetPlayerId);
        if (targetIndex === -1 || targetIndex === playerIndex) {
          throw new functions.https.HttpsError('invalid-argument', 'Invalid target player');
        }
        actionResult = executeStealAction(game, playerIndex, targetIndex);
      }

      // Update game state
      transaction.update(gameRef, actionResult.updates);

      return actionResult;
    });

    return { success: true, animationHint: result.animationHint };

  } catch (error) {
    console.error('Error performing action:', error);
    if (error instanceof functions.https.HttpsError) {
      throw error;
    }
    throw new functions.https.HttpsError('internal', 'Failed to perform action');
  }
});

/**
 * Execute a score action
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

  // Update players
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

  // Get new top card back
  const topCardBack = drawPile.length > 0 
    ? { backColors: drawPile[drawPile.length - 1].backColors }
    : null;

  // Move to next player
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

  return {
    updates: {
      players: updatedPlayers,
      drawPile,
      topCardBack,
      currentPlayerIndex: nextPlayerIndex,
      animationHint,
      lastAction: {
        player: player.name,
        action: 'score',
        result: isSuccess ? 'success' : 'no match',
        color: drawnCard.color,
        timestamp: new Date().toISOString()
      },
      ...(hasWinner && { gameStatus: 'finished' })
    },
    animationHint
  };
}

/**
 * Execute a steal action
 */
function executeStealAction(game, playerIndex, targetIndex) {
  const drawPile = [...game.drawPile];
  const drawnCard = drawPile.pop();
  const player = game.players[playerIndex];
  const targetPlayer = game.players[targetIndex];
  const updatedTargetTank = [...targetPlayer.tank, drawnCard];

  // Check for matches in target's tank
  const matchingCards = findMatchingCards(updatedTargetTank, drawnCard.color);
  
  const isSuccess = matchingCards.length >= 2;
  let newPlayerTank = [...player.tank];
  let newTargetTank = updatedTargetTank;
  let affectedCardIds = [drawnCard.id];

  if (isSuccess) {
    // Steal all matching cards to current player's tank
    newPlayerTank = [...player.tank, ...matchingCards];
    newTargetTank = updatedTargetTank.filter(card => !matchingCards.some(m => m.id === card.id));
    affectedCardIds = matchingCards.map(c => c.id);
  }

  // Update players
  const updatedPlayers = game.players.map((p, idx) => {
    if (idx === playerIndex) {
      return { ...p, tank: newPlayerTank };
    }
    if (idx === targetIndex) {
      return { ...p, tank: newTargetTank };
    }
    return p;
  });

  // Get new top card back
  const topCardBack = drawPile.length > 0 
    ? { backColors: drawPile[drawPile.length - 1].backColors }
    : null;

  // Move to next player
  const nextPlayerIndex = getNextPlayerIndex(playerIndex, game.players.length);

  // Build animation hint
  const animationHint = {
    sequence: isSuccess ? 'STEAL_SUCCESS' : 'STEAL_FAIL',
    playerId: player.id,
    targetPlayerId: targetPlayer.id,
    affectedCardIds,
    color: drawnCard.color,
    timestamp: Date.now()
  };

  return {
    updates: {
      players: updatedPlayers,
      drawPile,
      topCardBack,
      currentPlayerIndex: nextPlayerIndex,
      animationHint,
      lastAction: {
        player: player.name,
        action: 'steal',
        target: targetPlayer.name,
        result: isSuccess ? 'success' : 'no match',
        color: drawnCard.color,
        timestamp: new Date().toISOString()
      }
    },
    animationHint
  };
}
