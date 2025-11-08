// Custom hook for managing game state with Firestore
import { useState, useEffect } from 'react';
import { db } from '../firebase/config';
import { 
  collection, 
  doc, 
  getDoc, 
  setDoc, 
  updateDoc, 
  onSnapshot,
  arrayUnion,
  increment 
} from 'firebase/firestore';
import { 
  generateDeck, 
  shuffleDeck, 
  dealInitialHands, 
  findMatchingCards,
  generateRoomCode 
} from '../utils/cardLogic';

export const useGameState = (gameId) => {
  const [game, setGame] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!gameId) {
      setLoading(false);
      return;
    }

    const gameRef = doc(db, 'games', gameId);
    
    // Subscribe to real-time updates
    const unsubscribe = onSnapshot(
      gameRef,
      (snapshot) => {
        if (snapshot.exists()) {
          setGame({ id: snapshot.id, ...snapshot.data() });
          setLoading(false);
        } else {
          setError('Game not found');
          setLoading(false);
        }
      },
      (err) => {
        setError(err.message);
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [gameId]);

  return { game, loading, error };
};

// Create a new game room
export const createGame = async (playerName, userId) => {
  try {
    const roomCode = generateRoomCode();
    const gameRef = doc(db, 'games', roomCode);
    
    // Check if room code already exists
    const existingGame = await getDoc(gameRef);
    if (existingGame.exists()) {
      // Rare collision, try again
      return createGame(playerName, userId);
    }

    const newGame = {
      roomCode,
      status: 'waiting',
      currentPlayerIndex: 0,
      players: [
        {
          id: userId,
          name: playerName,
          tank: [],
          scoreCount: 0,
          isActive: true
        }
      ],
      drawPile: [],
      topCardBack: null,
      lastAction: null,
      createdAt: new Date().toISOString()
    };

    await setDoc(gameRef, newGame);
    return roomCode;
  } catch (error) {
    console.error('Error creating game:', error);
    throw error;
  }
};

// Join an existing game
export const joinGame = async (roomCode, playerName, userId) => {
  try {
    const gameRef = doc(db, 'games', roomCode.toUpperCase());
    const gameSnap = await getDoc(gameRef);

    if (!gameSnap.exists()) {
      throw new Error('Game not found');
    }

    const gameData = gameSnap.data();

    if (gameData.status !== 'waiting') {
      throw new Error('Game already started');
    }

    if (gameData.players.length >= 6) {
      throw new Error('Game is full');
    }

    // Check if user already in game
    if (gameData.players.some(p => p.id === userId)) {
      return roomCode.toUpperCase();
    }

    await updateDoc(gameRef, {
      players: arrayUnion({
        id: userId,
        name: playerName,
        tank: [],
        scoreCount: 0,
        isActive: true
      })
    });

    return roomCode.toUpperCase();
  } catch (error) {
    console.error('Error joining game:', error);
    throw error;
  }
};

// Start the game (deal cards)
export const startGame = async (gameId, game) => {
  try {
    const gameRef = doc(db, 'games', gameId);
    
    // Generate and shuffle deck
    const deck = shuffleDeck(generateDeck());
    
    // Deal initial hands
    const { hands, remainingDeck } = dealInitialHands(deck, game.players.length);
    
    // Update players with their initial hands
    const updatedPlayers = game.players.map((player, index) => ({
      ...player,
      tank: hands[index]
    }));

    // Get top card back for display
    const topCardBack = remainingDeck.length > 0 
      ? { backColors: remainingDeck[remainingDeck.length - 1].backColors }
      : null;

    await updateDoc(gameRef, {
      status: 'playing',
      players: updatedPlayers,
      drawPile: remainingDeck,
      topCardBack: topCardBack,
      currentPlayerIndex: 0
    });
  } catch (error) {
    console.error('Error starting game:', error);
    throw error;
  }
};

// Perform a Score action
export const performScore = async (gameId, game, playerIndex) => {
  try {
    const gameRef = doc(db, 'games', gameId);
    const drawPile = [...game.drawPile];
    
    if (drawPile.length === 0) {
      throw new Error('Draw pile is empty');
    }

    const drawnCard = drawPile.pop();
    const player = game.players[playerIndex];
    const updatedTank = [...player.tank, drawnCard];
    
    // Check for matches
    const matchingCards = findMatchingCards(updatedTank, drawnCard.color);
    
    let newTank = updatedTank;
    let scoreIncrement = 0;
    
    if (matchingCards.length > 1) {
      // Match found! Move to score pile
      scoreIncrement = matchingCards.length;
      newTank = updatedTank.filter(card => !matchingCards.includes(card));
    }

    // Update player
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
    const nextPlayerIndex = (playerIndex + 1) % game.players.length;

    await updateDoc(gameRef, {
      players: updatedPlayers,
      drawPile: drawPile,
      topCardBack: topCardBack,
      currentPlayerIndex: nextPlayerIndex,
      lastAction: {
        player: player.name,
        action: 'score',
        result: matchingCards.length > 1 ? 'success' : 'no match',
        color: drawnCard.color,
        timestamp: new Date().toISOString()
      }
    });
  } catch (error) {
    console.error('Error performing score:', error);
    throw error;
  }
};

// Perform a Steal action
export const performSteal = async (gameId, game, playerIndex, targetIndex) => {
  try {
    const gameRef = doc(db, 'games', gameId);
    const drawPile = [...game.drawPile];
    
    if (drawPile.length === 0) {
      throw new Error('Draw pile is empty');
    }

    const drawnCard = drawPile.pop();
    const targetPlayer = game.players[targetIndex];
    const updatedTargetTank = [...targetPlayer.tank, drawnCard];
    
    // Check for matches in target's tank
    const matchingCards = findMatchingCards(updatedTargetTank, drawnCard.color);
    
    const currentPlayer = game.players[playerIndex];
    let newCurrentTank = [...currentPlayer.tank];
    let newTargetTank = updatedTargetTank;
    let stealSuccess = false;
    
    if (matchingCards.length > 1) {
      // Match found! Steal to current player's tank
      stealSuccess = true;
      newCurrentTank = [...newCurrentTank, ...matchingCards];
      newTargetTank = updatedTargetTank.filter(card => !matchingCards.includes(card));
    }

    // Update players
    const updatedPlayers = game.players.map((p, idx) => {
      if (idx === playerIndex) {
        return { ...p, tank: newCurrentTank };
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

    // Move to next player (or stay if 2-player and successful steal)
    let nextPlayerIndex = (playerIndex + 1) % game.players.length;
    if (game.players.length === 2 && stealSuccess) {
      nextPlayerIndex = playerIndex; // Chain steal in 2-player
    }

    await updateDoc(gameRef, {
      players: updatedPlayers,
      drawPile: drawPile,
      topCardBack: topCardBack,
      currentPlayerIndex: nextPlayerIndex,
      lastAction: {
        player: currentPlayer.name,
        action: 'steal',
        target: targetPlayer.name,
        result: stealSuccess ? 'success' : 'no match',
        color: drawnCard.color,
        timestamp: new Date().toISOString()
      }
    });
  } catch (error) {
    console.error('Error performing steal:', error);
    throw error;
  }
};

// Send emoji from player
export const sendEmoji = async (gameId, playerIndex, emoji) => {
  try {
    const gameRef = doc(db, 'games', gameId);
    const gameSnap = await getDoc(gameRef);
    
    if (!gameSnap.exists()) {
      throw new Error('Game not found');
    }

    const game = gameSnap.data();
    const updatedPlayers = [...game.players];
    const player = updatedPlayers[playerIndex];
    
    // Get existing emoji queue or initialize empty array
    const currentQueue = player.emojiQueue || [];
    
    // Add new emoji with timestamp and unique ID
    const newEmoji = {
      emoji,
      timestamp: Date.now(),
      id: `${Date.now()}-${Math.random()}`
    };
    
    // Keep only the last 5 emojis (including the new one)
    const updatedQueue = [...currentQueue, newEmoji].slice(-5);
    
    updatedPlayers[playerIndex] = {
      ...player,
      emojiQueue: updatedQueue
    };

    await updateDoc(gameRef, {
      players: updatedPlayers
    });
  } catch (error) {
    console.error('Error sending emoji:', error);
    throw error;
  }
};
