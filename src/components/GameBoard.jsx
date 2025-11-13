import { useState, useEffect, useRef } from 'react';
import Tank from './Tank';
import Card from './Card';
import { checkWinCondition } from '../utils/gameRules';
import { AnimationPlayer } from '../utils/AnimationPlayer';
import { performScore, performSteal } from '../services/gameService';
import './GameBoard.css';

const COLOR_MAP = {
  red: '#dc2626',
  blue: '#2563eb',
  green: '#16a34a',
  yellow: '#eab308',
  purple: '#9333ea',
  orange: '#ea580c',
  pink: '#ec4899'
};

const GameBoard = ({ game, currentUserId, onEmojiSend, isLocalMode = false }) => {
  const [showActionModal, setShowActionModal] = useState(false);
  const [animationState, setAnimationState] = useState({
    highlightedCardIds: new Set(),
    animatingCardIds: new Set()
  });
  const [lastSeenHintTimestamp, setLastSeenHintTimestamp] = useState(0);
  
  const animationPlayerRef = useRef(null);

  // Initialize animation player
  useEffect(() => {
    const player = new AnimationPlayer();
    player.setUpdateCallback((newState) => {
      setAnimationState(newState);
    });
    animationPlayerRef.current = player;

    return () => {
      player.cleanup();
    };
  }, []);

  // Watch for animation hints from server
  useEffect(() => {
    if (!game || !game.animationHint || !animationPlayerRef.current) return;

    const hint = game.animationHint;
    
    // Only play new animations (check timestamp)
    if (hint.timestamp && hint.timestamp > lastSeenHintTimestamp) {
      setLastSeenHintTimestamp(hint.timestamp);
      animationPlayerRef.current.playHint(hint);
    }
  }, [game?.animationHint, lastSeenHintTimestamp]);

  const currentPlayer = game?.players.find(p => p.id === currentUserId);
  const currentPlayerIndex = game?.players.findIndex(p => p.id === currentUserId);
  
  const isMyTurn = isLocalMode 
    ? !game?.players[game.currentPlayerIndex]?.isBot  // In local mode, your turn if current player is not a bot
    : (game?.currentPlayerIndex === currentPlayerIndex);

  const handleScoreClick = async () => {
    if (!currentPlayer || animationPlayerRef.current?.isAnimating) return;
    
    try {
      await performScore(game.roomCode);
    } catch (error) {
      console.error('Score error:', error);
      alert('Failed to score: ' + error.message);
    }
  };

  const handleStealClick = () => {
    if (!currentPlayer || animationPlayerRef.current?.isAnimating) return;
    setShowActionModal(true);
  };

  const handleTargetSelect = async (targetPlayer) => {
    setShowActionModal(false);
    
    try {
      await performSteal(game.roomCode, targetPlayer.id);
    } catch (error) {
      console.error('Steal error:', error);
      alert('Failed to steal: ' + error.message);
    }
  };

  const handleEmojiClick = (emoji) => {
    if (onEmojiSend) {
      onEmojiSend(emoji);
    }
  };

  if (!game) {
    return <div className="game-board loading">Loading game...</div>;
  }

  const currentTurnPlayer = game.players[game.currentPlayerIndex];
  const winner = game.players.find(p => checkWinCondition(p.scoreCount, game.players.length));

  return (
    <div className="game-board">
      {/* Draw Pile */}
      <div className="draw-pile-info">
        <div className="pile-visual">
          {game.drawPile.length > 0 ? (
            <>
              <Card
                card={game.drawPile[game.drawPile.length - 1]}
                showBack={true}
                size="large"
              />
              <div className="pile-count">{game.drawPile.length} cards</div>
            </>
          ) : (
            <div className="empty-deck">Deck Empty!</div>
          )}
        </div>
      </div>

      {/* Player Tanks */}
      <div className="players-area">
        {game.players.map((player, index) => (
          <Tank
            key={player.id}
            id={`tank-${index}`}
            cards={player.tank}
            playerName={player.name}
            scoreCount={player.scoreCount}
            isCurrentTurn={index === game.currentPlayerIndex}
            isCurrentPlayer={isLocalMode ? (index === game.currentPlayerIndex) : (player.id === currentUserId)}
            isWinning={checkWinCondition(player.scoreCount, game.players.length)}
            isBot={player.isBot || false}
            botDifficulty={player.botDifficulty}
            emojiQueue={isLocalMode ? [] : (player.emojiQueue || [])}
            onEmojiClick={isLocalMode ? null : (player.id === currentUserId ? handleEmojiClick : null)}
            highlightedCardIds={animationState.highlightedCardIds}
            animatingCardIds={animationState.animatingCardIds}
          />
        ))}
      </div>

      {/* Turn Info and Action Buttons */}
      <div className="turn-info">
        {winner ? (
          <div className="winner-announcement">
            ≡ƒÄë <strong>{winner.name}</strong> wins! ≡ƒÄë
          </div>
        ) : (
          <>
            <div className="current-turn">
              <strong>{currentTurnPlayer.name}'s</strong> turn
              {currentTurnPlayer.isBot && <span className="bot-indicator"> (Bot)</span>}
            </div>

            {isMyTurn && !animationPlayerRef.current?.isAnimating && (
              <div className="action-buttons">
                <button
                  className="btn btn-primary"
                  onClick={handleScoreClick}
                  disabled={game.drawPile.length === 0}
                >
                  Score
                </button>
                <button
                  className="btn btn-secondary"
                  onClick={handleStealClick}
                  disabled={game.drawPile.length === 0 || game.players.length < 2}
                >
                  Steal
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {/* Last Action Display */}
      {game.lastAction && (
        <div className="last-action">
          <strong>{game.lastAction.player}</strong> tried to {game.lastAction.action}
          {game.lastAction.target && ` from ${game.lastAction.target}`}
          {' - '}
          <span className={game.lastAction.result === 'success' ? 'success' : 'failure'}>
            {game.lastAction.result === 'success'
              ? `Γ£ô Match! (${game.lastAction.color})`
              : `Γ£ù No match (${game.lastAction.color})`
            }
          </span>
        </div>
      )}

      {/* Steal Target Selection Modal */}
      {showActionModal && (
        <div className="modal-overlay" onClick={() => setShowActionModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Select a player to steal from:</h3>
            <div className="target-selection">
              {game.players.map((player) => (
                player.id !== currentUserId && (
                  <button
                    key={player.id}
                    className="target-button"
                    onClick={() => handleTargetSelect(player)}
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
