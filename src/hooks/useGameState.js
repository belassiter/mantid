// Custom hook for managing game state with Firestore
import { useState, useEffect } from 'react';
import { db, auth } from '../firebase/config';
import { 
  collection, 
  doc, 
  getDoc, 
  setDoc, 
  updateDoc, 
  onSnapshot,
  arrayUnion,
  arrayRemove,
  increment 
} from 'firebase/firestore';
import { compareGameState } from '../utils/compareGameState';
import { ALLOW_SERVER_OVERWRITE, LOG_SERVER_DIFFS } from '../config';
import { 
  generateDeck, 
  shuffleDeck, 
  dealInitialHands, 
  findMatchingCards,
  generateRoomCode 
} from '../utils/cardLogic';
import { performScore as serverPerformScore, performSteal as serverPerformSteal } from '../services/gameService';
import { generateBotName, BOT_DIFFICULTIES } from '../utils/botLogic';

export const useGameState = (gameId) => {
  const [game, setGame] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [isAnimating, setIsAnimating] = useState(false);
  const [pendingUpdate, setPendingUpdate] = useState(null);
  const [pendingDiffs, setPendingDiffs] = useState(null);

  // Apply pending update when animation completes
  // NOTE: We no longer auto-apply pending updates when isAnimating flips to
  // false. The application of buffered updates is controlled explicitly by
  // the caller (GameBoard / AnimationCoordinator) via `applyPendingUpdate` so
  // it can perform any comparison/logging before the authoritative state is
  // applied to the UI.

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
          const newGameState = { id: snapshot.id, ...snapshot.data() };

          // Initial load: accept server snapshot so UI has something to render.
          if (!game) {
            console.log('Initial load: accepting server snapshot');
            setGame(newGameState);
            setLoading(false);
            return;
          }

          // Compare server snapshot to current client-visible state
          const diffs = compareGameState(game, newGameState) || [];

          if (diffs.length > 0) {
            // Always buffer the incoming server snapshot so it can be inspected.
            // IMPORTANT: If diffs are present, we DO NOT change the client-visible
            // `game` state under any circumstances. The client must explicitly
            // accept or merge pending updates via the exposed APIs.
            setPendingUpdate(newGameState);
            setPendingDiffs(diffs);

            if (LOG_SERVER_DIFFS) {
              console.error('Server snapshot differs from client state — buffering and logging diffs', diffs);
              // For debugging, include both states (avoid dumping huge objects in prod)
              console.debug('Client state (short):', {
                drawPileLen: (game.drawPile || []).length,
                topCard: (game.drawPile || []).length ? game.drawPile[game.drawPile.length - 1].id : null,
                currentPlayerIndex: game.currentPlayerIndex
              });
              console.debug('Server state (short):', {
                drawPileLen: (newGameState.drawPile || []).length,
                topCard: (newGameState.drawPile || []).length ? newGameState.drawPile[newGameState.drawPile.length - 1].id : null,
                currentPlayerIndex: newGameState.currentPlayerIndex
              });
            }

            console.log('Server snapshot buffered; not overwriting client state (diffs present)');
          } else {
            // No diffs — mirror server snapshot so client stays consistent
            // (still respect ALLOW_SERVER_OVERWRITE in case the policy changes)
            if (ALLOW_SERVER_OVERWRITE) {
              setGame(newGameState);
            } else {
              // No functional changes detected; nothing to do
              // But keep client state in sync for derived values if necessary
              // (we intentionally avoid a setGame here to prevent accidental overwrites)
              console.debug('Server snapshot identical to client state; skipping overwrite per policy');
              setPendingDiffs([]);
            }
          }

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

  /**
   * Apply any buffered pending update. Optionally pass a compareFn that will
   * be called with the current client-visible game and the pending server
   * snapshot before applying; compareFn can be used for logging/debugging.
   */
  const applyPendingUpdate = (compareFn = null) => {
    if (!pendingUpdate) return false;
    try {
      // If a compare function is provided, use it to detect diffs. If the
      // compare function returns a non-empty array (diffs), we log and do
      // NOT apply the server snapshot (per requested behavior).
      if (typeof compareFn === 'function') {
        try {
          const diffs = compareFn(game, pendingUpdate);
          if (diffs && Array.isArray(diffs) && diffs.length > 0) {
            console.error('applyPendingUpdate: detected diffs between client and server state; not applying server state', diffs);
            return false;
          }
        } catch (err) {
          console.error('Error in compareFn:', err);
          // On compare errors, be conservative and do not apply
          return false;
        }
      }

      console.log('📦 Applying buffered game state update (applyPendingUpdate)');
      setGame(pendingUpdate);
      setPendingUpdate(null);
      setPendingDiffs(null);
      return true;
    } catch (error) {
      console.error('Error applying pending update:', error);
      return false;
    }
  };

  /**
   * Apply a selective patch produced by patchFn(client, server).
   * patchFn should return a new game object to be made visible to the UI.
   * This allows the client to merge only the fields it wants to accept from
   * the server snapshot, preserving locally controlled presentation state.
   */
  const applyPendingUpdateSelective = (patchFn) => {
    if (!pendingUpdate) return false;
    if (typeof patchFn !== 'function') return false;
    try {
      const merged = patchFn(game, pendingUpdate);
      if (!merged) return false;
      setGame(merged);
      setPendingUpdate(null);
      setPendingDiffs(null);
      return true;
    } catch (err) {
      console.error('Error in applyPendingUpdateSelective:', err);
      return false;
    }
  };

  /**
   * Convenience helper: accept a named list of top-level fields from the
   * buffered server snapshot and merge them into the client-visible state.
   * Example: acceptServerFields(['players','drawPile'])
   */
  const acceptServerFields = (fields = []) => {
    if (!pendingUpdate) return false;
    if (!Array.isArray(fields) || fields.length === 0) return false;
    try {
      const merged = { ...game };
      fields.forEach((f) => {
        if (pendingUpdate.hasOwnProperty(f)) {
          merged[f] = pendingUpdate[f];
        }
      });
      setGame(merged);
      setPendingUpdate(null);
      setPendingDiffs(null);
      return true;
    } catch (err) {
      console.error('Error in acceptServerFields:', err);
      return false;
    }
  };

  return {
    game,
    loading,
    error,
    setIsAnimating, // Expose animation control to components
    applyPendingUpdate,
    // Expose pending buffer and helpers so UI/coordinator can inspect and
    // selectively merge server changes into the client-visible state.
    pendingUpdate,
    pendingDiffs,
    applyPendingUpdateSelective,
    acceptServerFields
  };
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

// Create a local game (all players on one device)
export const createLocalGame = async (playerConfigs, userId) => {
  try {
    const roomCode = generateRoomCode();
    const gameRef = doc(db, 'games', roomCode);
    
    // Check if room code already exists
    const existingGame = await getDoc(gameRef);
    if (existingGame.exists()) {
      // Rare collision, try again
      return createLocalGame(playerConfigs, userId);
    }

    // Create players array with all local players
    const players = playerConfigs.map((config, index) => {
      const basePlayer = {
        id: config.isBot ? `bot-local-${Date.now()}-${index}` : `${userId}-local-${index}`,
        name: config.name,
        tank: [],
        scoreCount: 0,
        isActive: true
      };
      
      // Add bot properties if this is a bot
      if (config.isBot) {
        basePlayer.isBot = true;
        basePlayer.botDifficulty = config.botDifficulty || 'medium';
      }
      
      return basePlayer;
    });

    const newGame = {
      roomCode,
      status: 'waiting',
      currentPlayerIndex: 0,
      players,
      drawPile: [],
      topCardBack: null,
      lastAction: null,
      isLocalMode: true, // Mark this as a local game
      createdAt: new Date().toISOString()
    };

    await setDoc(gameRef, newGame);
    return roomCode;
  } catch (error) {
    console.error('Error creating local game:', error);
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

// Add a bot player to the game
export const addBotPlayer = async (gameId, difficulty = BOT_DIFFICULTIES.MEDIUM) => {
  try {
    const gameRef = doc(db, 'games', gameId);
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

    // Generate unique bot ID and name
    const botId = `bot-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const botName = generateBotName();

    await updateDoc(gameRef, {
      players: arrayUnion({
        id: botId,
        name: botName,
        tank: [],
        scoreCount: 0,
        isActive: true,
        isBot: true,
        botDifficulty: difficulty
      })
    });

    return botId;
  } catch (error) {
    console.error('Error adding bot:', error);
    throw error;
  }
};

// Remove a bot player from the game
export const removeBotPlayer = async (gameId, botId) => {
  try {
    const gameRef = doc(db, 'games', gameId);
    const gameSnap = await getDoc(gameRef);

    if (!gameSnap.exists()) {
      throw new Error('Game not found');
    }

    const gameData = gameSnap.data();

    if (gameData.status !== 'waiting') {
      throw new Error('Cannot remove bot after game has started');
    }

    // Find the bot to remove
    const botToRemove = gameData.players.find(p => p.id === botId && p.isBot);
    
    if (!botToRemove) {
      throw new Error('Bot not found');
    }

    // Remove the bot from players array
    await updateDoc(gameRef, {
      players: arrayRemove(botToRemove)
    });

    return true;
  } catch (error) {
    console.error('Error removing bot:', error);
    throw error;
  }
};

// Change bot difficulty
export const changeBotDifficulty = async (gameId, botId, newDifficulty) => {
  try {
    const gameRef = doc(db, 'games', gameId);
    const gameSnap = await getDoc(gameRef);

    if (!gameSnap.exists()) {
      throw new Error('Game not found');
    }

    const gameData = gameSnap.data();

    if (gameData.status !== 'waiting') {
      throw new Error('Cannot change bot difficulty after game has started');
    }

    // Find and update the bot
    const updatedPlayers = gameData.players.map(p => 
      p.id === botId && p.isBot 
        ? { ...p, botDifficulty: newDifficulty }
        : p
    );

    await updateDoc(gameRef, {
      players: updatedPlayers
    });

    return true;
  } catch (error) {
    console.error('Error changing bot difficulty:', error);
    throw error;
  }
};

// Start the game (deal cards)
export const startGame = async (gameId, game) => {
  try {
    const gameRef = doc(db, 'games', gameId);
    
    // Check auth status
    const currentUser = auth.currentUser;
    console.log('Current auth user:', currentUser ? currentUser.uid : 'NO USER');
    
    if (!currentUser) {
      throw new Error('Not authenticated - cannot start game');
    }
    
    // Generate and shuffle deck
    const deck = shuffleDeck(generateDeck());
    
    // Deal initial hands
    const { hands, remainingDeck } = dealInitialHands(deck, game.players.length);
    
    // Update players with their initial hands
    const updatedPlayers = game.players.map((player, index) => ({
      ...player,
      tank: hands[index]
    }));

    // Get top card back for display (send full card, client keeps front secret until flip)
    const topCardBack = remainingDeck.length > 0 
      ? remainingDeck[remainingDeck.length - 1]
      : null;

    const updateData = {
      status: 'playing',
      players: updatedPlayers,
      drawPile: remainingDeck,
      topCardBack: topCardBack,
      currentPlayerIndex: 0,
      gameStarted: Date.now() // Add timestamp to help trigger initial bot turn
    };

    console.log('Starting game with fields:', Object.keys(updateData));
    console.log('Current game status:', game.status);

    await updateDoc(gameRef, updateData);
  } catch (error) {
    console.error('Error starting game:', error);
    throw error;
  }
};

// Perform a Score action
// Server-authoritative performScore: forward to cloud function so server is
// the single source of truth for game rules and state changes. The client
// remains responsible for presentation only.
export const performScore = async (gameId, botPlayerId = null, actionId = null) => {
  try {
    return await serverPerformScore(gameId, botPlayerId, actionId);
  } catch (err) {
    console.error('Error delegating performScore to server:', err);
    throw err;
  }
};

// Perform a Steal action
// Server-authoritative performSteal: delegate to cloud function. Accepts
// targetPlayerId and optional botPlayerId/actionId for bot executions.
export const performSteal = async (gameId, targetPlayerId, botPlayerId = null, actionId = null) => {
  try {
    return await serverPerformSteal(gameId, targetPlayerId, botPlayerId, actionId);
  } catch (err) {
    console.error('Error delegating performSteal to server:', err);
    throw err;
  }
};

// Send emoji from player
export const sendEmoji = async (gameId, playerId, emoji) => {
  try {
    const gameRef = doc(db, 'games', gameId);
    const gameSnap = await getDoc(gameRef);
    
    if (!gameSnap.exists()) {
      throw new Error('Game not found');
    }

    const game = gameSnap.data();
    const currentEmojiState = game.emojiState || {};
    const playerQueue = currentEmojiState[playerId] || [];
    
    // Add new emoji with timestamp and unique ID
    const newEmoji = {
      emoji,
      timestamp: Date.now(),
      id: `${Date.now()}-${Math.random()}`
    };
    
    // Keep only the last 5 emojis (including the new one)
    const updatedQueue = [...playerQueue, newEmoji].slice(-5);
    
    // Update only the emojiState field
    await updateDoc(gameRef, {
      emojiState: {
        ...currentEmojiState,
        [playerId]: updatedQueue
      }
    });
  } catch (error) {
    console.error('Error sending emoji:', error);
    throw error;
  }
};
