import { useState, useEffect } from 'react';
import { auth, signInAnonymous } from './firebase/config';
import { createGame, createLocalGame, joinGame, startGame, addBotPlayer, removeBotPlayer, changeBotDifficulty, useGameState, sendEmoji } from './hooks/useGameState';
import Lobby from './components/Lobby';
import WaitingRoom from './components/WaitingRoom';
import GameBoard from './components/GameBoard';
import Footer from './components/Footer';
import './App.css';

function App() {
  const [userId, setUserId] = useState(null);
  const [playerName, setPlayerName] = useState('');
  const [gameId, setGameId] = useState(null);
  const { game, loading, error, setIsAnimating, applyPendingUpdate } = useGameState(gameId);

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

  const handleCreateLocalGame = async (playerNames) => {
    try {
      const roomCode = await createLocalGame(playerNames, userId);
      setGameId(roomCode);
    } catch (error) {
      throw new Error('Failed to create local game: ' + error.message);
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

  const handleAddBot = async (difficulty) => {
    try {
      await addBotPlayer(gameId, difficulty);
    } catch (error) {
      console.error('Failed to add bot:', error);
      throw error; // Re-throw so WaitingRoom can handle
    }
  };

  const handleRemoveBot = async (botId) => {
    try {
      await removeBotPlayer(gameId, botId);
    } catch (error) {
      console.error('Failed to remove bot:', error);
      throw error;
    }
  };

  const handleChangeBotDifficulty = async (botId, difficulty) => {
    try {
      await changeBotDifficulty(gameId, botId, difficulty);
    } catch (error) {
      console.error('Failed to change bot difficulty:', error);
      throw error;
    }
  };

  // Score and Steal are now handled directly by GameBoard via Cloud Functions

  const handleEmojiSend = async (emoji) => {
    try {
      // Find current player's ID
      const currentPlayer = game?.players.find(p => p.id === userId);
      if (currentPlayer) {
        await sendEmoji(gameId, currentPlayer.id, emoji);
      }
    } catch (error) {
      console.error('Failed to send emoji:', error);
    }
  };

  // Show loading state while authenticating
  if (!userId) {
    return (
      <>
        <div className="loading-screen">
          <h2>Connecting...</h2>
        </div>
        <Footer />
      </>
    );
  }

  // Show error if game failed to load
  if (error) {
    return (
      <>
        <div className="error-screen">
          <h2>Error</h2>
          <p>{error}</p>
          <button onClick={() => setGameId(null)} className="btn btn-primary">
            Return to Lobby
          </button>
        </div>
        <Footer />
      </>
    );
  }

  // Show lobby if no game joined
  if (!gameId) {
    return (
      <>
        <Lobby
          onCreateGame={handleCreateGame}
          onCreateLocalGame={handleCreateLocalGame}
          onJoinGame={handleJoinGame}
          playerName={playerName}
          setPlayerName={setPlayerName}
        />
        <Footer />
      </>
    );
  }

  // Show loading while game data loads
  if (loading || !game) {
    return (
      <>
        <div className="loading-screen">
          <h2>Loading game...</h2>
        </div>
        <Footer />
      </>
    );
  }

  // Show waiting room if game hasn't started
  if (game.status === 'waiting') {
    return (
      <>
        <WaitingRoom
          game={game}
          onStartGame={handleStartGame}
          onAddBot={handleAddBot}
          onRemoveBot={handleRemoveBot}
          onChangeBotDifficulty={handleChangeBotDifficulty}
          currentUserId={userId}
        />
        <Footer />
      </>
    );
  }

  // Show game board when playing
  return (
    <>
      <GameBoard
        game={game}
        currentUserId={game.isLocalMode ? game.players[0].id : userId}
        onEmojiSend={handleEmojiSend}
        isLocalMode={game.isLocalMode || false}
        setIsAnimating={setIsAnimating}
        applyPendingUpdate={applyPendingUpdate}
      />
      <Footer />
    </>
  );
}

export default App;
