/**
 * Bot AI Logic with Strategy Pattern
 * Supports multiple difficulty levels/algorithms
 */

// Bot difficulty levels - can be extended later
export const BOT_DIFFICULTIES = {
  EASY: 'easy',
  MEDIUM: 'medium',
  HARD: 'hard'
};

// Bot name pool
const BOT_NAMES = [
  'C-3PO',
  'Data',
  'HAL 9000',
  'R2-D2',
  'T-800',
  'Johnny 5',
  'Wall-E',
  'Bender',
  'KITT',
  'Marvin',
  'Lore',
  'GLaDOS',
  'Cortana',
  'Claptrap',
  'EDI',
  'HK-47',
  'R. Daneel',
  'Skynet',
  'J.A.R.V.I.S.',
  'Agent Smith'
];

let usedBotNames = [];

/**
 * Generate a unique bot name
 */
export const generateBotName = () => {
  const availableNames = BOT_NAMES.filter(name => !usedBotNames.includes(name));
  if (availableNames.length === 0) {
    // Reset if all names used
    usedBotNames = [];
    return BOT_NAMES[0];
  }
  const name = availableNames[Math.floor(Math.random() * availableNames.length)];
  usedBotNames.push(name);
  return name;
};

/**
 * Reset bot names (useful for new games)
 */
export const resetBotNames = () => {
  usedBotNames = [];
};

/**
 * Check if a color appears in the back colors
 */
const colorInBackColors = (color, backColors) => {
  return backColors.includes(color);
};

/**
 * Calculate match probability for a tank
 */
const calculateMatchProbability = (tank, topCardBackColors) => {
  if (tank.length === 0) return 0;
  
  const tankColors = [...new Set(tank.map(c => c.color))];
  const matchingColors = tankColors.filter(color => 
    colorInBackColors(color, topCardBackColors)
  );
  
  // Probability = matching colors / possible colors (3)
  return matchingColors.length / 3;
};

/**
 * Find player with highest score (excluding bot)
 */
const findLeadingOpponent = (game, botIndex) => {
  let maxScore = -1;
  let leadingPlayerIndex = null;
  
  game.players.forEach((player, index) => {
    if (index !== botIndex && player.scoreCount > maxScore) {
      maxScore = player.scoreCount;
      leadingPlayerIndex = index;
    }
  });
  
  return leadingPlayerIndex;
};

/**
 * Find player with most cards in tank (excluding bot)
 */
const findPlayerWithMostCards = (game, botIndex) => {
  let maxCards = -1;
  let targetPlayerIndex = null;
  
  game.players.forEach((player, index) => {
    if (index !== botIndex && player.tank.length > maxCards) {
      maxCards = player.tank.length;
      targetPlayerIndex = index;
    }
  });
  
  return targetPlayerIndex;
};

/**
 * EASY Strategy: Random decisions, no analysis
 */
const easyStrategy = (game, botIndex) => {
  const bot = game.players[botIndex];
  
  // 60% chance to score, 40% to steal
  if (Math.random() < 0.6 || game.players.length === 1) {
    return { action: 'score' };
  }
  
  // Random target - get random opponent index
  const opponentIndices = game.players
    .map((_, idx) => idx)
    .filter(idx => idx !== botIndex);
  const targetIndex = opponentIndices[Math.floor(Math.random() * opponentIndices.length)];
  
  return {
    action: 'steal',
    targetPlayer: targetIndex
  };
};

/**
 * MEDIUM Strategy: Basic probability matching
 * - Score if tank colors match draw pile back colors
 * - Steal from player with most cards otherwise
 */
const mediumStrategy = (game, botIndex) => {
  const bot = game.players[botIndex];
  const topCard = game.drawPile[game.drawPile.length - 1];
  
  if (!topCard) return { action: 'score' };
  
  // Calculate match probability for bot's tank
  const scoreProb = calculateMatchProbability(bot.tank, topCard.backColors);
  
  // If decent chance (>= 33%), try to score
  if (scoreProb >= 0.33) {
    return { action: 'score' };
  }
  
  // Otherwise, steal from player with most cards
  const targetIndex = findPlayerWithMostCards(game, botIndex);
  
  if (targetIndex === null) {
    return { action: 'score' }; // Fallback
  }
  
  return {
    action: 'steal',
    targetPlayer: targetIndex
  };
};

/**
 * HARD Strategy: Advanced analysis
 * - Analyzes both own tank and opponents' tanks
 * - Considers score counts and game state
 * - Makes strategic blocking moves
 */
const hardStrategy = (game, botIndex) => {
  const bot = game.players[botIndex];
  const topCard = game.drawPile[game.drawPile.length - 1];
  
  if (!topCard) return { action: 'score' };
  
  // Calculate match probabilities
  const scoreProb = calculateMatchProbability(bot.tank, topCard.backColors);
  
  // Analyze opponents' tanks
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
  
  // Decision logic:
  // 1. If own tank has high probability (>= 50%), score
  if (scoreProb >= 0.5) {
    return { action: 'score' };
  }
  
  // 2. If opponent has very high probability (>= 66%) and leading, block them
  const leadingOpponentIndex = findLeadingOpponent(game, botIndex);
  if (bestStealTargetIndex === leadingOpponentIndex && bestStealProb >= 0.66) {
    return {
      action: 'steal',
      targetPlayer: bestStealTargetIndex
    };
  }
  
  // 3. If opponent has good probability (>= 50%), steal from them
  if (bestStealProb >= 0.5 && bestStealTargetIndex !== null) {
    return {
      action: 'steal',
      targetPlayer: bestStealTargetIndex
    };
  }
  
  // 4. If own tank has any chance (> 0), score
  if (scoreProb > 0) {
    return { action: 'score' };
  }
  
  // 5. Otherwise, steal from player with most cards
  const targetIndex = findPlayerWithMostCards(game, botIndex);
  
  if (targetIndex === null) {
    return { action: 'score' }; // Fallback
  }
  
  return {
    action: 'steal',
    targetPlayer: targetIndex
  };
};

/**
 * Strategy map - easily extensible
 */
const STRATEGIES = {
  [BOT_DIFFICULTIES.EASY]: easyStrategy,
  [BOT_DIFFICULTIES.MEDIUM]: mediumStrategy,
  [BOT_DIFFICULTIES.HARD]: hardStrategy
};

/**
 * Main bot decision function
 * @param {Object} game - Current game state
 * @param {number} botIndex - Index of bot player
 * @param {string} difficulty - Bot difficulty level (default: medium)
 * @returns {Object} - Decision object { action: 'score' | 'steal', targetPlayer?: string }
 */
export const makeBotDecision = (game, botIndex, difficulty = BOT_DIFFICULTIES.MEDIUM) => {
  // Validate inputs
  if (!game || !game.players || botIndex < 0 || botIndex >= game.players.length) {
    console.error('Invalid game state or bot index');
    return { action: 'score' }; // Safe fallback
  }
  
  if (!game.drawPile || game.drawPile.length === 0) {
    console.error('No cards in draw pile');
    return { action: 'score' }; // Safe fallback
  }
  
  // Get strategy function
  const strategy = STRATEGIES[difficulty] || mediumStrategy;
  
  // Execute strategy
  try {
    return strategy(game, botIndex);
  } catch (error) {
    console.error('Bot decision error:', error);
    return { action: 'score' }; // Safe fallback
  }
};

/**
 * Get thinking time for bot (in ms) - varies by difficulty
 */
export const getBotThinkingTime = (difficulty = BOT_DIFFICULTIES.MEDIUM) => {
  switch (difficulty) {
    case BOT_DIFFICULTIES.EASY:
      return 1500; // Fast decisions
    case BOT_DIFFICULTIES.HARD:
      return 3000; // Slower, more "thoughtful"
    case BOT_DIFFICULTIES.MEDIUM:
    default:
      return 2000; // Medium pace
  }
};
