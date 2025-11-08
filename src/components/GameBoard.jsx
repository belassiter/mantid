import { useState } from 'react';
import Tank from './Tank';
import Card from './Card';
import { checkWinCondition } from '../utils/gameRules';
import './GameBoard.css';

const GameBoard = ({ game, currentUserId, onScore, onSteal }) => {
  const [selectedTarget, setSelectedTarget] = useState(null);
  const [showActionModal, setShowActionModal] = useState(false);

  const currentPlayer = game.players.find(p => p.id === currentUserId);
  const currentPlayerIndex = game.players.findIndex(p => p.id === currentUserId);
  const isMyTurn = game.currentPlayerIndex === currentPlayerIndex;
  
  // Check for winner
  const winner = game.players.find(p => 
    checkWinCondition(p.scoreCount, game.players.length)
  );

  const handleScoreClick = () => {
    onScore();
  };

  const handleStealClick = () => {
    setShowActionModal(true);
  };

  const handleTargetSelect = (targetIndex) => {
    setSelectedTarget(targetIndex);
    setShowActionModal(false);
    onSteal(targetIndex);
    setSelectedTarget(null);
  };

  if (winner) {
    return (
      <div className="game-over">
        <div className="winner-announcement">
          <h1>🎉 {winner.name} Wins! 🎉</h1>
          <p>Final Score: {winner.scoreCount} cards</p>
          <button 
            className="btn btn-primary"
            onClick={() => window.location.reload()}
          >
            Return to Lobby
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="game-board">
      <div className="game-header">
        <h2>Mantid</h2>
        <div className="game-info">
          <span>Room: {game.roomCode}</span>
          <span>Cards Left: {game.drawPile.length}</span>
        </div>
      </div>

      <div className="draw-pile-section">
        <div className="draw-pile">
          {game.topCardBack ? (
            <>
              <Card card={game.topCardBack} showBack={true} size="large" />
              <p className="draw-hint">Possible colors on front:</p>
              <div className="color-hints">
                {game.topCardBack.backColors.map((color, i) => (
                  <span 
                    key={i} 
                    className="color-hint"
                    style={{ 
                      backgroundColor: color,
                      color: 'white',
                      padding: '0.25rem 0.75rem',
                      borderRadius: '12px',
                      fontWeight: 'bold'
                    }}
                  >
                    {color}
                  </span>
                ))}
              </div>
            </>
          ) : (
            <div className="empty-deck">Deck Empty!</div>
          )}
        </div>

        {isMyTurn && game.drawPile.length > 0 && (
          <div className="action-buttons">
            <button 
              className="btn btn-score"
              onClick={handleScoreClick}
            >
              Score (Add to My Tank)
            </button>
            <button 
              className="btn btn-steal"
              onClick={handleStealClick}
            >
              Steal (Add to Opponent's Tank)
            </button>
          </div>
        )}
      </div>

      <div className="players-area">
        {game.players.map((player, index) => (
          <Tank
            key={player.id}
            cards={player.tank}
            playerName={player.name}
            scoreCount={player.scoreCount}
            isCurrentTurn={game.currentPlayerIndex === index}
          />
        ))}
      </div>

      {game.lastAction && (
        <div className="last-action">
          <strong>{game.lastAction.player}</strong> tried to {game.lastAction.action}
          {game.lastAction.target && ` from ${game.lastAction.target}`}
          {' - '}
          <span className={game.lastAction.result === 'success' ? 'success' : 'failure'}>
            {game.lastAction.result === 'success' 
              ? `✓ Match! (${game.lastAction.color})` 
              : `✗ No match (${game.lastAction.color})`
            }
          </span>
        </div>
      )}

      {showActionModal && (
        <div className="modal-overlay" onClick={() => setShowActionModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Select a player to steal from:</h3>
            <div className="target-selection">
              {game.players.map((player, index) => (
                index !== currentPlayerIndex && (
                  <button
                    key={player.id}
                    className="target-button"
                    onClick={() => handleTargetSelect(index)}
                  >
                    <div className="target-name">{player.name}</div>
                    <div className="target-info">
                      <span>{player.tank.length} cards in tank</span>
                      <span>{player.scoreCount} in score</span>
                    </div>
                  </button>
                )
              ))}
            </div>
            <button 
              className="btn btn-secondary"
              onClick={() => setShowActionModal(false)}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default GameBoard;
