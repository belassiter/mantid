import { useEffect } from 'react';
import './WaitingRoom.css';

const WaitingRoom = ({ game, onStartGame, currentUserId }) => {
  const isHost = game.players[0]?.id === currentUserId;
  const canStart = game.players.length >= 2;
  const isLocalMode = game.isLocalMode || false;

  // Auto-start local games
  useEffect(() => {
    if (isLocalMode && canStart) {
      onStartGame();
    }
  }, [isLocalMode, canStart, onStartGame]);

  // Don't show waiting room for local games - just show loading
  if (isLocalMode) {
    return (
      <div className="waiting-room">
        <div className="waiting-message">
          <p>Starting game...</p>
          <div className="loading-dots">
            <span>.</span><span>.</span><span>.</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="waiting-room">
      <div className="room-header">
        <h2>Room Code: <span className="room-code">{game.roomCode}</span></h2>
        <p className="share-instruction">Share this code with friends to join!</p>
      </div>

      <div className="players-list">
        <h3>Players ({game.players.length}/6)</h3>
        <ul>
          {game.players.map((player, index) => (
            <li key={player.id} className="player-item">
              <span className="player-number">{index + 1}</span>
              <span className="player-name">{player.name}</span>
              {index === 0 && <span className="host-badge">Host</span>}
            </li>
          ))}
        </ul>
      </div>

      {isHost ? (
        <div className="start-section">
          <button
            onClick={onStartGame}
            disabled={!canStart}
            className="btn btn-primary btn-large"
          >
            {canStart ? 'Start Game' : 'Waiting for players...'}
          </button>
          {!canStart && (
            <p className="min-players-note">Need at least 2 players to start</p>
          )}
        </div>
      ) : (
        <div className="waiting-message">
          <p>Waiting for host to start the game...</p>
          <div className="loading-dots">
            <span>.</span><span>.</span><span>.</span>
          </div>
        </div>
      )}
    </div>
  );
};

export default WaitingRoom;
