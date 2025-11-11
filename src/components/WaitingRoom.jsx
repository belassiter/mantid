import { useEffect, useState } from 'react';
import './WaitingRoom.css';

const WaitingRoom = ({ game, onStartGame, currentUserId, onAddBot, onRemoveBot, onChangeBotDifficulty }) => {
  const isHost = game.players[0]?.id === currentUserId;
  const canStart = game.players.length >= 2;
  const isLocalMode = game.isLocalMode || false;
  const [addingBot, setAddingBot] = useState(false);

  const handleAddBot = async () => {
    if (addingBot || game.players.length >= 6) return;
    
    setAddingBot(true);
    try {
      await onAddBot('medium'); // Default to medium difficulty
    } catch (error) {
      console.error('Error adding bot:', error);
      alert('Failed to add bot player');
    } finally {
      setAddingBot(false);
    }
  };

  const handleRemoveBot = async (botId) => {
    try {
      await onRemoveBot(botId);
    } catch (error) {
      console.error('Error removing bot:', error);
      alert('Failed to remove bot player');
    }
  };

  const handleDifficultyChange = async (botId, newDifficulty) => {
    try {
      await onChangeBotDifficulty(botId, newDifficulty);
    } catch (error) {
      console.error('Error changing bot difficulty:', error);
      alert('Failed to change bot difficulty');
    }
  };

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
              <span className={`player-name ${player.isBot ? `bot-name-${player.botDifficulty || 'medium'}` : ''}`}>
                {player.isBot && '🤖 '}{player.name}
              </span>
              <div className="player-badges">
                {index === 0 && <span className="host-badge">Host</span>}
                {player.isBot && isHost ? (
                  <select
                    value={player.botDifficulty || 'medium'}
                    onChange={(e) => handleDifficultyChange(player.id, e.target.value)}
                    className="bot-difficulty-select"
                  >
                    <option value="easy">Easy</option>
                    <option value="medium">Medium</option>
                    <option value="hard">Hard</option>
                  </select>
                ) : player.isBot ? (
                  <span className="bot-badge">{player.botDifficulty || 'medium'}</span>
                ) : null}
                {player.isBot && isHost && (
                  <button 
                    className="btn-remove-bot"
                    onClick={() => handleRemoveBot(player.id)}
                    title="Remove bot"
                  >
                    ✕
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      </div>

      {isHost ? (
        <div className="start-section">
          <button
            onClick={handleAddBot}
            disabled={addingBot || game.players.length >= 6}
            className="btn btn-secondary btn-add-bot"
          >
            {addingBot ? 'Adding Bot...' : '🤖 Add Bot Player'}
          </button>
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
