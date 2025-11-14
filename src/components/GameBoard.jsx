import { useState, useEffect, useRef } from 'react';
import Tank from './Tank';
import Card from './Card';
import { checkWinCondition } from '../utils/gameRules';
import { AnimationPlayer } from '../utils/AnimationPlayer';
import { performScore, performSteal } from '../services/gameService';
import { makeBotDecision, getBotThinkingTime } from '../utils/botLogic';
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
    animatingCardIds: new Set(),
    isFlipping: false,
    flippingCard: null,
    isFadingFlippedCard: false,
    displayPlayerIndex: null,
    isAnimating: false, // Track overall animation state
    isFlipComplete: false // Track when flip animation completes but card still showing
  });
  const [lastSeenHintTimestamp, setLastSeenHintTimestamp] = useState(0);
  
  const animationPlayerRef = useRef(null);

  // Initialize animation player
  useEffect(() => {
    const player = new AnimationPlayer(game?.roomCode);
    player.setUpdateCallback((newState) => {
      setAnimationState(newState);
    });
    animationPlayerRef.current = player;

    return () => {
      player.cleanup();
    };
  }, [game?.roomCode]);

  // Watch for animation hints from server
  useEffect(() => {
    if (!game || !game.animationHint || !animationPlayerRef.current) return;

    const hint = game.animationHint;
    
    // Only play new animations (check timestamp)
    if (hint.timestamp && hint.timestamp > lastSeenHintTimestamp) {
      console.log('Playing animation hint:', hint);
      setLastSeenHintTimestamp(hint.timestamp);
      // Pass the previous player index (before the server advanced it)
      const previousPlayerIndex = hint.playerId ? game.players.findIndex(p => p.id === hint.playerId) : game.currentPlayerIndex;
      animationPlayerRef.current.playHint(hint, previousPlayerIndex);
    }
  }, [game?.animationHint, lastSeenHintTimestamp, game?.players]);

  // Bot turn handler - clicks buttons when it's a bot's turn and buttons are available
  useEffect(() => {
    if (!game || game.status !== 'playing') return;
    
    const currentTurnPlayer = game.players[game.currentPlayerIndex];
    if (!currentTurnPlayer?.isBot) return;
    
    // Wait for animations to complete (buttons to be available)
    if (animationState.isAnimating) {
      console.log('⏳ Bot waiting for animation to complete...');
      return;
    }
    
    console.log('🤖 Bot turn detected, executing decision...');
    
    // Make bot decision and execute after thinking time
    const executeBotTurn = async () => {
      const thinkingTime = getBotThinkingTime(currentTurnPlayer.botDifficulty || 'medium');
      console.log(`🤖 Bot ${currentTurnPlayer.name} thinking for ${thinkingTime}ms...`);
      await new Promise(resolve => setTimeout(resolve, thinkingTime));
      
      // Double-check still bot's turn and no animation
      if (game.currentPlayerIndex !== game.players.findIndex(p => p.id === currentTurnPlayer.id)) return;
      if (animationState.isAnimating) return;
      
      const decision = makeBotDecision(game, game.currentPlayerIndex, currentTurnPlayer.botDifficulty);
      console.log(`🤖 Bot ${currentTurnPlayer.name} decided to ${decision.action}`);
      
      // Call the same button handlers that humans use
      if (decision.action === 'score') {
        await handleScoreClick();
      } else if (decision.action === 'steal') {
        // Click the Steal button (opens modal)
        handleStealClick();
        
        // After a brief delay, select target from modal
        await new Promise(resolve => setTimeout(resolve, 300));
        
        const targetPlayer = game.players[decision.targetPlayer];
        if (!targetPlayer) {
          console.error('Invalid target player index:', decision.targetPlayer);
          setShowActionModal(false);
          return;
        }
        
        // Click the target player button in modal
        await handleTargetSelect(targetPlayer);
      }
    };
    
    executeBotTurn().catch(error => {
      console.error('Bot turn error:', error);
    });
  }, [game?.currentPlayerIndex, game?.status, animationState.isAnimating, game]);

  // Log when flip animation actually starts rendering
  useEffect(() => {
    if (animationState.isFlipping) {
      const flipRenderTime = performance.now();
      console.log('🎬 Flip animation RENDERED at', flipRenderTime);
    }
  }, [animationState.isFlipping]);

  const currentPlayer = game?.players.find(p => p.id === currentUserId);
  const currentPlayerIndex = game?.players.findIndex(p => p.id === currentUserId);
  
  const isMyTurn = isLocalMode 
    ? !game?.players[game.currentPlayerIndex]?.isBot  // In local mode, your turn if current player is not a bot
    : (game?.currentPlayerIndex === currentPlayerIndex);

  const handleScoreClick = async () => {
    if (!currentPlayer || animationState.isAnimating) return;
    
    const clickTime = performance.now();
    console.log('🔘 Score button clicked at', clickTime);
    
    // Optimistic flip - immediately flip the top card
    if (game.topCardBack && animationPlayerRef.current) {
      animationPlayerRef.current.playOptimisticFlip(game.topCardBack);
    }
    
    try {
      await performScore(game.roomCode);
    } catch (error) {
      console.error('Score error:', error);
      alert('Failed to score: ' + error.message);
    }
  };

  const handleStealClick = () => {
    if (!currentPlayer || animationState.isAnimating) return;
    setShowActionModal(true);
  };

  const handleTargetSelect = async (targetPlayer) => {
    setShowActionModal(false);
    
    // Optimistic flip - immediately flip the top card
    if (game.topCardBack && animationPlayerRef.current) {
      animationPlayerRef.current.playOptimisticFlip(game.topCardBack);
    }
    
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

  // Use frozen player index during animations, otherwise use current
  const displayPlayerIndex = animationState.displayPlayerIndex !== null 
    ? animationState.displayPlayerIndex 
    : game.currentPlayerIndex;

  // Handle -1 index during game initialization
  const currentTurnPlayer = displayPlayerIndex >= 0 ? game.players[displayPlayerIndex] : null;
  const winner = game.players.find(p => checkWinCondition(p.scoreCount, game.players.length));

  // Show full winner screen when game is complete
  if (winner) {
    const sortedPlayers = [...game.players].sort((a, b) => b.scoreCount - a.scoreCount);
    
    return (
      <div className="game-over">
        <div className="winner-announcement">
          <h1>
            🎉 <span className={winner.isBot ? `bot-name-${winner.botDifficulty || 'medium'}` : ''}>
              {winner.isBot && '🤖 '}{winner.name}
            </span> Wins! 🎉
          </h1>
          <p className="winning-score">Final Score: {winner.scoreCount} cards</p>

          <div className="final-scores">
            <h3>Final Standings</h3>
            <div className="scores-list">
              {sortedPlayers.map((player, index) => (
                <div key={player.id} className={`score-item ${player.id === winner.id ? 'winner' : ''}`}>
                  <span className="rank">#{index + 1}</span>
                  <span className={`player-name ${player.isBot ? `bot-name-${player.botDifficulty || 'medium'}` : ''}`}>
                    {player.isBot && '🤖 '}{player.name}
                  </span>
                  <span className="score">{player.scoreCount} cards</span>
                </div>
              ))}
            </div>
          </div>

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
      {/* Game Header */}
      <div className="game-header">
        <h2>Mantid</h2>
        
        {/* Turn Info - Centered */}
        <div className="turn-display">
          {currentTurnPlayer ? (
            <span>
              <strong className={currentTurnPlayer.isBot ? `bot-name-${currentTurnPlayer.botDifficulty || 'medium'}` : ''}>
                {currentTurnPlayer.isBot && '🤖 '}{currentTurnPlayer.name}'s
              </strong> turn
            </span>
          ) : (
            <span>Starting game...</span>
          )}
        </div>
        
        <div className="game-info">
          <span>Room: {game.roomCode}</span>
        </div>
      </div>

      {/* Draw Pile with Action Buttons */}
      <div className="draw-pile-section">
        <div className="draw-pile">
          {game.drawPile.length > 0 ? (
            <>
              <p className="cards-left-counter">Cards Left: {game.drawPile.length}</p>
              <div className="card-flip-container">
                {animationState.flippingCard ? (
                  /* During flip animation - show only the flip structure */
                  <div 
                    className={`card-flip-inner ${animationState.isFlipping ? 'flipping' : ''} ${animationState.isFlipComplete ? 'flip-complete' : ''}`}
                    style={{
                      opacity: animationState.isFadingFlippedCard ? 0 : 1,
                      transition: animationState.isFadingFlippedCard ? 'opacity 0.5s ease-out' : 'none'
                    }}
                  >
                    {/* Back face = what's currently on top of draw pile */}
                    <div className="card-flip-back">
                      <Card 
                        card={game.drawPile[game.drawPile.length - 1]}
                        showBack={true}
                        size="large"
                      />
                    </div>
                    {/* Front face = the card being flipped */}
                    <div className="card-flip-front">
                      <Card 
                        card={animationState.flippingCard}
                        showBack={false}
                        size="large"
                      />
                    </div>
                  </div>
                ) : (
                  /* No flip - show normal draw pile */
                  <Card
                    card={game.drawPile[game.drawPile.length - 1]}
                    showBack={true}
                    size="large"
                  />
                )}
              </div>
              
              {/* Action Buttons - always visible but disabled when not player's turn */}
              <div className="action-buttons">
                <button
                  className="btn btn-score"
                  onClick={handleScoreClick}
                  disabled={!isMyTurn || animationState.isAnimating || game.drawPile.length === 0}
                >
                  Score
                </button>
                <button
                  className="btn btn-steal"
                  onClick={handleStealClick}
                  disabled={!isMyTurn || animationState.isAnimating || game.drawPile.length === 0 || game.players.length < 2}
                >
                  Steal
                </button>
              </div>
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
            isCurrentTurn={index === displayPlayerIndex}
            isCurrentPlayer={isLocalMode ? (index === game.currentPlayerIndex) : (player.id === currentUserId)}
            isWinning={checkWinCondition(player.scoreCount, game.players.length)}
            isBot={player.isBot || false}
            botDifficulty={player.botDifficulty}
            emojiQueue={isLocalMode ? [] : (game.emojiState?.[player.id] || [])}
            onEmojiClick={isLocalMode ? null : (player.id === currentUserId ? handleEmojiClick : null)}
            highlightedCardIds={animationState.highlightedCardIds}
            animatingCardIds={animationState.animatingCardIds}
            isLocalMode={isLocalMode}
          />
        ))}
      </div>

      {/* Last Action Display */}
      {game.lastAction && (
        <div className="last-action">
          <strong>{game.lastAction.player}</strong> tried to {game.lastAction.action}
          {game.lastAction.target && ` from ${game.lastAction.target}`}
          {' - '}
          <span className={game.lastAction.result === 'success' ? 'success' : 'failure'}>
            {game.lastAction.resultSymbol === 'MATCH'
              ? `MATCH! (${game.lastAction.color})`
              : `NO MATCH (${game.lastAction.color})`
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
              {game.players.map((player, idx) => {
                // Can't steal from yourself (current turn player)
                const isCurrentTurnPlayer = idx === game.currentPlayerIndex;
                if (isCurrentTurnPlayer) return null;
                
                return (
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
                );
              })}
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
