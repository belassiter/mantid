const functions = require('firebase-functions');
const admin = require('firebase-admin');
const { findMatchingCards } = require('./cardLogic');
const { getNextPlayerIndex, checkWinCondition } = require('./gameRules');

const db = admin.firestore();

// Bot difficulty levels
const BOT_DIFFICULTIES = {
  EASY: 'easy',
  MEDIUM: 'medium',
  HARD: 'hard'
};

/**
 * Firestore trigger - executes when game state updates
 * Automatically handles bot turns
 */
exports.processBotTurn = functions.firestore
  .document('games/{gameId}')
  .onUpdate(async (change, context) => {
    const gameAfter = change.after.data();
    const gameBefore = change.before.data();
    
    // Only process if turn changed
    if (gameAfter.currentPlayerIndex === gameBefore.currentPlayerIndex) {
      return null;
    }
    
    // Check if current player is a bot
    const currentPlayer = gameAfter.players[gameAfter.currentPlayerIndex];
    if (!currentPlayer || !currentPlayer.isBot) {
      return null;
    }
    
    // Check if game is finished
    if (gameAfter.gameStatus === 'finished') {
      return null;
    }
    
    // Wait for bot "thinking time"
    const thinkingTime = getBotThinkingTime(currentPlayer.botDifficulty || 'medium');
    await sleep(thinkingTime);
    
    // Make bot decision
    const decision = makeBotDecision(gameAfter, gameAfter.currentPlayerIndex, currentPlayer.botDifficulty);
    
    // Execute bot action
    try {
      const result = await executeBotAction(change.after.ref, gameAfter, gameAfter.currentPlayerIndex, decision);
      console.log(`Bot ${currentPlayer.name} performed ${decision.action}`);
      return result;
    } catch (error) {
      console.error('Bot action error:', error);
      return null;
    }
  });

/**
 * Execute bot's decided action
 */
async function executeBotAction(gameRef, game, botIndex, decision) {
  return db.runTransaction(async (transaction) => {
    // Re-read game state to prevent race conditions
    const freshDoc = await transaction.get(gameRef);
    const freshGame = freshDoc.data();
    
    // Verify still bot's turn
    if (freshGame.currentPlayerIndex !== botIndex) {
      return null;
    }
    
    // Execute based on action type
    let actionResult;
    if (decision.action === 'score') {
      actionResult = executeScoreAction(freshGame, botIndex);
    } else if (decision.action === 'steal') {
      actionResult = executeStealAction(freshGame, botIndex, decision.targetPlayer);
    } else {
      throw new Error('Invalid bot decision action');
    }
    
    // Update game state
    transaction.update(gameRef, actionResult.updates);
    return actionResult;
  });
}

/**
 * Execute score action (same logic as gameActions.js)
 */
function executeScoreAction(game, playerIndex) {
  const drawPile = [...game.drawPile];
  const drawnCard = drawPile.pop();
  const player = game.players[playerIndex];
  const updatedTank = [...player.tank, drawnCard];

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
    ? { backColors: drawPile[drawPile.length - 1].backColors }
    : null;

  const nextPlayerIndex = getNextPlayerIndex(playerIndex, game.players.length);

  const hasWinner = updatedPlayers.some(p => 
    checkWinCondition(p.scoreCount, game.players.length)
  );

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
 * Execute steal action (same logic as gameActions.js)
 */
function executeStealAction(game, playerIndex, targetIndex) {
  const drawPile = [...game.drawPile];
  const drawnCard = drawPile.pop();
  const player = game.players[playerIndex];
  const targetPlayer = game.players[targetIndex];
  const updatedTargetTank = [...targetPlayer.tank, drawnCard];

  const matchingCards = findMatchingCards(updatedTargetTank, drawnCard.color);
  const isSuccess = matchingCards.length >= 2;
  
  let newPlayerTank = [...player.tank];
  let newTargetTank = updatedTargetTank;
  let affectedCardIds = [drawnCard.id];

  if (isSuccess) {
    newPlayerTank = [...player.tank, ...matchingCards];
    newTargetTank = updatedTargetTank.filter(card => !matchingCards.some(m => m.id === card.id));
    affectedCardIds = matchingCards.map(c => c.id);
  }

  const updatedPlayers = game.players.map((p, idx) => {
    if (idx === playerIndex) {
      return { ...p, tank: newPlayerTank };
    }
    if (idx === targetIndex) {
      return { ...p, tank: newTargetTank };
    }
    return p;
  });

  const topCardBack = drawPile.length > 0 
    ? { backColors: drawPile[drawPile.length - 1].backColors }
    : null;

  const nextPlayerIndex = getNextPlayerIndex(playerIndex, game.players.length);

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

/**
 * Bot decision logic (copied from botLogic.js)
 */
function makeBotDecision(game, botIndex, difficulty = 'medium') {
  const bot = game.players[botIndex];
  const topCard = game.drawPile[game.drawPile.length - 1];
  
  if (!topCard) return { action: 'score' };
  
  if (difficulty === 'easy') {
    return easyStrategy(game, botIndex);
  } else if (difficulty === 'hard') {
    return hardStrategy(game, botIndex);
  } else {
    return mediumStrategy(game, botIndex);
  }
}

function easyStrategy(game, botIndex) {
  if (Math.random() < 0.6 || game.players.length === 1) {
    return { action: 'score' };
  }
  const opponentIndices = game.players
    .map((_, idx) => idx)
    .filter(idx => idx !== botIndex);
  const targetIndex = opponentIndices[Math.floor(Math.random() * opponentIndices.length)];
  return { action: 'steal', targetPlayer: targetIndex };
}

function mediumStrategy(game, botIndex) {
  const bot = game.players[botIndex];
  const topCard = game.drawPile[game.drawPile.length - 1];
  
  const scoreProb = calculateMatchProbability(bot.tank, topCard.backColors);
  
  if (scoreProb >= 0.33) {
    return { action: 'score' };
  }
  
  const targetIndex = findPlayerWithMostCards(game, botIndex);
  if (targetIndex === null) {
    return { action: 'score' };
  }
  
  return { action: 'steal', targetPlayer: targetIndex };
}

function hardStrategy(game, botIndex) {
  const bot = game.players[botIndex];
  const topCard = game.drawPile[game.drawPile.length - 1];
  
  const scoreProb = calculateMatchProbability(bot.tank, topCard.backColors);
  
  let bestStealTargetIndex = null;
  let bestStealProb = 0;
  
  game.players.forEach((player, index) => {
    if (index !== botIndex) {
      const stealProb = calculateMatchProbability(player.tank, topCard.backColors);
      if (stealProb > bestStealProb) {
        bestStealProb = stealProb;
        bestStealTargetIndex = index;
      }
    }
  });
  
  if (scoreProb >= 0.5) {
    return { action: 'score' };
  }
  
  const leadingOpponentIndex = findLeadingOpponent(game, botIndex);
  if (bestStealTargetIndex === leadingOpponentIndex && bestStealProb >= 0.66) {
    return { action: 'steal', targetPlayer: bestStealTargetIndex };
  }
  
  if (bestStealProb >= 0.5 && bestStealTargetIndex !== null) {
    return { action: 'steal', targetPlayer: bestStealTargetIndex };
  }
  
  if (scoreProb > 0) {
    return { action: 'score' };
  }
  
  const targetIndex = findPlayerWithMostCards(game, botIndex);
  if (targetIndex === null) {
    return { action: 'score' };
  }
  
  return { action: 'steal', targetPlayer: targetIndex };
}

// Helper functions
function calculateMatchProbability(tank, backColors) {
  if (tank.length === 0) return 0;
  const tankColors = [...new Set(tank.map(c => c.color))];
  const matchingColors = tankColors.filter(color => backColors.includes(color));
  return matchingColors.length / 3;
}

function findLeadingOpponent(game, botIndex) {
  let maxScore = -1;
  let leadingPlayerIndex = null;
  game.players.forEach((player, index) => {
    if (index !== botIndex && player.scoreCount > maxScore) {
      maxScore = player.scoreCount;
      leadingPlayerIndex = index;
    }
  });
  return leadingPlayerIndex;
}

function findPlayerWithMostCards(game, botIndex) {
  let maxCards = -1;
  let targetPlayerIndex = null;
  game.players.forEach((player, index) => {
    if (index !== botIndex && player.tank.length > maxCards) {
      maxCards = player.tank.length;
      targetPlayerIndex = index;
    }
  });
  return targetPlayerIndex;
}

function getBotThinkingTime(difficulty) {
  switch (difficulty) {
    case 'easy':
      return 1500;
    case 'hard':
      return 3000;
    default:
      return 2000;
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
