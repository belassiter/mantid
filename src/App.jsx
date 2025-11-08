import { useState, useEffect } from 'react';
import { auth, signInAnonymous } from './firebase/config';
import { createGame, joinGame, startGame, useGameState, performScore, performSteal, sendEmoji } from './hooks/useGameState';
import Lobby from './components/Lobby';
import WaitingRoom from './components/WaitingRoom';
import GameBoard from './components/GameBoard';
import './App.css';

function App() {
  const [userId, setUserId] = useState(null);
  const [playerName, setPlayerName] = useState('');
  const [gameId, setGameId] = useState(null);
  const { game, loading, error } = useGameState(gameId);

  // Sign in anonymously on mount
  useEffect(() => {
    const initAuth = async () => {
      try {
        const user = await signInAnonymous();
        setUserId(user.uid);
      } catch (error) {
        console.error('Authentication failed:', error);
      }
    };
    initAuth();
  }, []);

  const handleCreateGame = async (name) => {
    try {
      const roomCode = await createGame(name, userId);
      setGameId(roomCode);
    } catch (error) {
      throw new Error('Failed to create game: ' + error.message);
    }
  };

  const handleJoinGame = async (roomCode, name) => {
    try {
      const gameCode = await joinGame(roomCode, name, userId);
      setGameId(gameCode);
    } catch (error) {
      throw new Error(error.message);
    }
  };

  const handleStartGame = async () => {
    try {
      await startGame(gameId, game);
    } catch (error) {
      console.error('Failed to start game:', error);
    }
  };

  const handleScore = async () => {
    const playerIndex = game.players.findIndex(p => p.id === userId);
    try {
      await performScore(gameId, game, playerIndex);
    } catch (error) {
      console.error('Failed to score:', error);
    }
  };

  const handleSteal = async (targetIndex) => {
    const playerIndex = game.players.findIndex(p => p.id === userId);
    try {
      await performSteal(gameId, game, playerIndex, targetIndex);
    } catch (error) {
      console.error('Failed to steal:', error);
    }
  };

  const handleEmojiSend = async (playerIndex, emoji) => {
    try {
      await sendEmoji(gameId, playerIndex, emoji);
    } catch (error) {
      console.error('Failed to send emoji:', error);
    }
  };

  // Show loading state while authenticating
  if (!userId) {
    return (
      <div className="loading-screen">
        <h2>Connecting...</h2>
      </div>
    );
  }

  // Show error if game failed to load
  if (error) {
    return (
      <div className="error-screen">
        <h2>Error</h2>
        <p>{error}</p>
        <button onClick={() => setGameId(null)} className="btn btn-primary">
          Return to Lobby
        </button>
      </div>
    );
  }

  // Show lobby if no game joined
  if (!gameId) {
    return (
      <Lobby
        onCreateGame={handleCreateGame}
        onJoinGame={handleJoinGame}
        playerName={playerName}
        setPlayerName={setPlayerName}
      />
    );
  }

  // Show loading while game data loads
  if (loading || !game) {
    return (
      <div className="loading-screen">
        <h2>Loading game...</h2>
      </div>
    );
  }

  // Show waiting room if game hasn't started
  if (game.status === 'waiting') {
    return (
      <WaitingRoom
        game={game}
        onStartGame={handleStartGame}
        currentUserId={userId}
      />
    );
  }

  // Show game board when playing
  return (
    <GameBoard
      game={game}
      currentUserId={userId}
      onScore={handleScore}
      onSteal={handleSteal}
      onEmojiSend={handleEmojiSend}
    />
  );
}

export default App;
