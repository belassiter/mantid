// Card generation and logic utilities for Mantis game

// 7 colors in the game, 15 cards each
const COLORS = ['red', 'blue', 'green', 'yellow', 'purple', 'orange', 'pink'];

// Generate a unique card ID
const generateCardId = (color, index) => `${color}-${index}`;

// Generate all possible combinations of 3 colors from the 7 available
const generateBackColorCombinations = () => {
  const combinations = [];
  for (let i = 0; i < COLORS.length; i++) {
    for (let j = i + 1; j < COLORS.length; j++) {
      for (let k = j + 1; k < COLORS.length; k++) {
        combinations.push([COLORS[i], COLORS[j], COLORS[k]]);
      }
    }
  }
  return combinations;
};

// Generate the full deck of 105 cards (7 colors × 15 cards)
const generateDeck = () => {
  const deck = [];
  const backCombinations = generateBackColorCombinations();
  
  COLORS.forEach(color => {
    for (let i = 0; i < 15; i++) {
      // Find combinations that include this color for the back
      const validBacks = backCombinations.filter(combo => combo.includes(color));
      // Cycle through valid back combinations
      const backColors = validBacks[i % validBacks.length];
      
      deck.push({
        id: generateCardId(color, i),
        color: color,
        backColors: backColors
      });
    }
  });
  
  return deck;
};

// Shuffle array using Fisher-Yates algorithm
const shuffleDeck = (deck) => {
  const shuffled = [...deck];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
};

// Check if a card color matches any cards in a tank
const findMatchingCards = (tank, color) => {
  return tank.filter(card => card.color === color);
};

// Check if there are any matching cards in the tank
const hasMatch = (tank, color) => {
  return tank.some(card => card.color === color);
};

// Deal initial cards to players
const dealInitialHands = (deck, numPlayers) => {
  const hands = Array(numPlayers).fill(null).map(() => []);
  const remainingDeck = [...deck];
  
  // Deal 4 cards to each player
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < numPlayers; j++) {
      if (remainingDeck.length > 0) {
        hands[j].push(remainingDeck.pop());
      }
    }
  }
  
  return { hands, remainingDeck };
};

// Generate a random 4-character room code
const generateRoomCode = () => {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Exclude similar looking chars
  let code = '';
  for (let i = 0; i < 4; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
};

module.exports = {
  COLORS,
  generateDeck,
  shuffleDeck,
  findMatchingCards,
  hasMatch,
  dealInitialHands,
  generateRoomCode
};
