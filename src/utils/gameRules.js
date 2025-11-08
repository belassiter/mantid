// Game rules and validation logic

// Win conditions
export const WIN_CONDITION_STANDARD = 10;
export const WIN_CONDITION_TWO_PLAYER = 15;

// Check if a player has won
export const checkWinCondition = (scoreCount, numPlayers) => {
  const target = numPlayers === 2 ? WIN_CONDITION_TWO_PLAYER : WIN_CONDITION_STANDARD;
  return scoreCount >= target;
};

// Check if it's a specific player's turn
export const isPlayerTurn = (currentPlayerIndex, playerIndex) => {
  return currentPlayerIndex === playerIndex;
};

// Get next player index
export const getNextPlayerIndex = (currentPlayerIndex, numPlayers) => {
  return (currentPlayerIndex + 1) % numPlayers;
};

// Validate if a player can perform an action
export const canPerformAction = (game, playerId) => {
  const player = game.players.find(p => p.id === playerId);
  if (!player) return false;
  
  const playerIndex = game.players.indexOf(player);
  return isPlayerTurn(game.currentPlayerIndex, playerIndex);
};

// Handle tiebreaker when deck runs out
export const determineTiebreaker = (players) => {
  // First check score pile
  const maxScore = Math.max(...players.map(p => p.scoreCount));
  const winnersWithScore = players.filter(p => p.scoreCount === maxScore);
  
  if (winnersWithScore.length === 1) {
    return winnersWithScore[0];
  }
  
  // Tiebreaker: most cards in tank
  const maxTank = Math.max(...winnersWithScore.map(p => p.tank.length));
  const finalWinner = winnersWithScore.find(p => p.tank.length === maxTank);
  
  return finalWinner;
};
