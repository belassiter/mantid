const functions = require('firebase-functions');
const admin = require('firebase-admin');

const db = admin.firestore();

// Bot difficulty levels
const BOT_DIFFICULTIES = {
  EASY: 'easy',
  MEDIUM: 'medium',
  HARD: 'hard'
};

/**
 * DISABLED: Bot turns now handled client-side in GameBoard.jsx
 * Bots literally click the same buttons as human players
 */
exports.processBotTurn = functions.firestore
  .document('games/{gameId}')
  .onUpdate(async (change, context) => {
    // Disabled - bots now act client-side
    return null;
  });

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
