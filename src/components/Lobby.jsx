import { useState } from 'react';
import './Lobby.css';

const Lobby = ({ onCreateGame, onJoinGame, playerName, setPlayerName }) => {
  const [roomCode, setRoomCode] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [isJoining, setIsJoining] = useState(false);
  const [error, setError] = useState('');

  const handleCreate = async () => {
    if (!playerName.trim()) {
      setError('Please enter your name');
      return;
    }

    setIsCreating(true);
    setError('');
    
    try {
      await onCreateGame(playerName);
    } catch (err) {
      setError('Failed to create game: ' + err.message);
    } finally {
      setIsCreating(false);
    }
  };

  const handleJoin = async () => {
    if (!playerName.trim()) {
      setError('Please enter your name');
      return;
    }
    
    if (!roomCode.trim()) {
      setError('Please enter a room code');
      return;
    }

    setIsJoining(true);
    setError('');
    
    try {
      await onJoinGame(roomCode, playerName);
    } catch (err) {
      setError('Failed to join game: ' + err.message);
    } finally {
      setIsJoining(false);
    }
  };

  return (
    <div className="lobby">
      <h1>Mantid</h1>
      <p className="subtitle">A colorfully cutthroat card game</p>

      <div className="lobby-form">
        <div className="input-group">
          <label htmlFor="playerName">Your Name</label>
          <input
            id="playerName"
            type="text"
            value={playerName}
            onChange={(e) => setPlayerName(e.target.value)}
            placeholder="Enter your name"
            maxLength={20}
          />
        </div>

        <div className="actions">
          <button
            onClick={handleCreate}
            disabled={isCreating}
            className="btn btn-primary"
          >
            {isCreating ? 'Creating...' : 'Create Game'}
          </button>

          <div className="divider">OR</div>

          <div className="input-group">
            <label htmlFor="roomCode">Room Code</label>
            <input
              id="roomCode"
              type="text"
              value={roomCode}
              onChange={(e) => setRoomCode(e.target.value.toUpperCase())}
              placeholder="Enter 4-letter code"
              maxLength={4}
            />
          </div>

          <button
            onClick={handleJoin}
            disabled={isJoining}
            className="btn btn-secondary"
          >
            {isJoining ? 'Joining...' : 'Join Game'}
          </button>
        </div>

        {error && <div className="error">{error}</div>}
      </div>

      <div className="rules-link">
        <details>
          <summary>How to Play</summary>
          <div className="rules">
            <h3>Goal</h3>
            <p>Be the first player to have 10 or more cards in your Score Pile (15 for 2 players).</p>
            
            <h3>On Your Turn</h3>
            <p><strong>Score:</strong> Draw a card into YOUR tank. If it matches any cards there, move all matching cards to your Score Pile.</p>
            <p><strong>Steal:</strong> Draw a card into ANOTHER player's tank. If it matches, steal all matching cards to YOUR tank.</p>
            
            <h3>Strategy</h3>
            <p>The back of each card shows 3 possible colors. Use this info to make smart decisions!</p>
          </div>
        </details>
      </div>
    </div>
  );
};

export default Lobby;
