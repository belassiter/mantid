import { useState, useEffect, useRef } from 'react';
import Tank from './Tank';
import Card from './Card';
import { checkWinCondition } from '../utils/gameRules';
import { AnimationPlayer } from '../utils/AnimationPlayer';
import AnimationCoordinator from '../utils/AnimationCoordinator';
import { compareGameState } from '../utils/compareGameState';
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

const GameBoard = ({ game, currentUserId, onEmojiSend, isLocalMode = false, setIsAnimating, applyPendingUpdate }) => {
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
  const [modalCallerId, setModalCallerId] = useState(null);
  const [clientUnderCards, setClientUnderCards] = useState([]);
  
  const animationPlayerRef = useRef(null);
  const coordinatorRef = useRef(null);
  const scoreButtonRef = useRef(null);
  const stealButtonRef = useRef(null);
  // Helper to start an optimistic flip via the coordinator. If the
  // coordinator isn't ready yet, retry for a short time instead of
  // calling AnimationPlayer directly. This ensures the coordinator is
  // the single source of truth for animation lifecycles.
  const startOptimisticFlip = (cardBack, playerIndex) => {
    if (!cardBack) return;
    const attempt = (retriesLeft = 20) => {
      if (coordinatorRef.current) {
        try {
          coordinatorRef.current.enqueue([
            { type: 'START_OPTIMISTIC_FLIP', payload: { cardBack, playerIndex } }
          ]).catch(err => console.warn('START_OPTIMISTIC_FLIP enqueue failed:', err));
        } catch (err) {
          console.warn('Coordinator START_OPTIMISTIC_FLIP failed:', err);
        }
        return;
      }
      if (retriesLeft <= 0) {
        // Give up silently; coordinator should normally be ready very early.
        return;
      }
      // Retry after a short delay
      setTimeout(() => attempt(retriesLeft - 1), 50);
    };
    attempt();
  };

  // Initialize animation player
  useEffect(() => {
    // Create AnimationPlayer with configurable durations if needed (defaults used here).
    const player = new AnimationPlayer(game?.roomCode, setIsAnimating, {
      // flipMs: 2600, // flip animation duration
      // holdMs: 2000, // how long the card stays face-up after flip
      // fadeMs: 500   // fade duration
    });
    player.setUpdateCallback((newState) => {
      setAnimationState(newState);
    });
    animationPlayerRef.current = player;

    // Create coordinator once we have an animation player
    const showNextCardFn = (card) => {
      if (!card) return;
      // Avoid duplicates
      setClientUnderCards(prev => {
        const already = prev.find(c => c.cardId === card.cardId);
        if (already) return prev;
        return [...prev, card];
      });
    };

    coordinatorRef.current = new AnimationCoordinator({
      animationPlayer: player,
      applyPendingUpdate,
      compareFn: compareGameState,
      showNextCardFn,
      getClientState: () => ({ game, animationState })
    });

    return () => {
      player.cleanup();
    };
  }, [game?.roomCode, setIsAnimating]);

  // Ensure initial SHOW_NEXT_CARD runs when the game first loads so there are
  // at least two cards visible (client-side visual only). If coordinator is
  // available and the draw pile has a second card, enqueue SHOW_NEXT_CARD.
  useEffect(() => {
    if (!coordinatorRef.current || !game) return;
    // If we already have a client-under card, do nothing
    if (clientUnderCards.length > 0) return;
    const topIndex = game.drawPile.length - 1;
    if (topIndex - 1 >= 0) {
      const nextCard = game.drawPile[topIndex - 1];
      coordinatorRef.current.enqueue([
        { type: 'SHOW_NEXT_CARD', payload: { nextCard } },
        { type: 'COMPLETE' }
      ]).catch(err => {
        console.error('Initial SHOW_NEXT_CARD failed:', err);
      });
    }
  }, [game?.roomCode, game?.drawPile?.length, coordinatorRef.current]);

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

  // Bot decisions are executed on the server and delivered to clients via
  // `game.botPendingAction`. Clients should only consume pending actions and
  // must not compute bot decisions locally (except in `isLocalMode` if you
  // still want a local-only experience). The pending-action consumer below
  // handles executing server-provided bot actions when UI is ready.

  // When server precomputes a bot action (botPendingAction) we should execute it when UI is ready.
  useEffect(() => {
    if (!game || !game.botPendingAction) return;
    const pending = game.botPendingAction;
    if (pending.consumed) return;
    if (pending.expiresAt && pending.expiresAt < Date.now()) return; // expired

    // Only execute if no animation in progress (client controls presentation timing)
    if (animationState.isAnimating) {
      console.log('⏳ Waiting for animations to finish before executing pending bot action');
      return;
    }

    // Before executing the pending action, apply any buffered server snapshot
    // so the client UI is authoritative. We allow an optional compare function to
    // log differences between client visual state and server snapshot.
    if (applyPendingUpdate) {
      applyPendingUpdate((clientState, serverState) => {
        try {
          const diffs = compareGameState(clientState, serverState) || [];
          if (diffs.length > 0) {
            console.error('UI/Server state mismatch on applyPendingUpdate (will NOT apply server state):', { room: game.roomCode, diffs });
          }
          return diffs;
        } catch (err) {
          console.error('Error comparing game states:', err);
          return [{ kind: 'compareError', message: String(err) }];
        }
      });
    }

    // Play optimistic flip and then call server to consume the precomputed action
    const executePending = async () => {
      try {
        // Start optimistic flip via coordinator (coordinator is the single source for animation lifecycles)
        if (game.topCardBack) startOptimisticFlip(game.topCardBack, game.currentPlayerIndex);

        // Fire the action with actionId so server validates and consumes it
        if (pending.action === 'score') {
          await performScore(game.roomCode, pending.botPlayerId, pending.actionId);
        } else if (pending.action === 'steal') {
          await performSteal(game.roomCode, pending.targetPlayerId, pending.botPlayerId, pending.actionId);
        }

        // After server call, enqueue VERIFY + SHOW_NEXT_CARD
        const topIndex = game.drawPile.length - 1;
        const nextCard = (topIndex - 1 >= 0) ? game.drawPile[topIndex - 1] : null;
        if (coordinatorRef.current) {
          coordinatorRef.current.enqueue([
            { type: 'VERIFY_EXPECTED_STATE', payload: { actionId: pending.actionId } },
            { type: 'SHOW_NEXT_CARD', payload: { nextCard } },
            { type: 'COMPLETE' }
          ]).catch(err => console.error('Post-pending action sequence failed:', err));
        }
      } catch (err) {
        console.error('Failed to execute pending bot action:', err);
        // Let failures be visible but don't block the UI — server will remain authoritative
      }
    };

    executePending();
  }, [game?.botPendingAction, animationState.isAnimating, game?.topCardBack]);

  // Log when flip animation actually starts rendering
  useEffect(() => {
    if (animationState.isFlipping) {
      const flipRenderTime = performance.now();
      console.log('🎬 Flip animation RENDERED at', flipRenderTime);
    }
  }, [animationState.isFlipping]);

  // Detect transition of animationState.isAnimating from true -> false and
  // apply any buffered server snapshot. This allows us to compare client vs
  // server state right before authoritative application.
  const prevAnimatingRef = useRef(animationState.isAnimating);
  useEffect(() => {
    const prev = prevAnimatingRef.current;
    const now = animationState.isAnimating;
    if (prev && !now) {
      // animation finished
      if (applyPendingUpdate) {
          applyPendingUpdate((clientState, serverState) => {
            try {
              const diffs = compareGameState(clientState, serverState) || [];
              if (diffs.length > 0) {
                console.error('UI/Server state mismatch on applyPendingUpdate (will NOT apply server state):', { room: game.roomCode, diffs });
              }
              return diffs;
            } catch (err) {
              console.error('Error comparing game states:', err);
              return [{ kind: 'compareError', message: String(err) }];
            }
          });
        }
    }
    prevAnimatingRef.current = now;
  }, [animationState.isAnimating, applyPendingUpdate, game?.roomCode]);
  

  const currentPlayer = game?.players.find(p => p.id === currentUserId);
  const currentPlayerIndex = game?.players.findIndex(p => p.id === currentUserId);
  
  const isMyTurn = isLocalMode 
    ? !game?.players[game.currentPlayerIndex]?.isBot  // In local mode, your turn if current player is not a bot
    : (game?.currentPlayerIndex === currentPlayerIndex);

  const handleScoreClick = async (callerId = null) => {
    if (!currentPlayer || animationState.isAnimating) return;
    
    const clickTime = performance.now();
    console.log('🔘 Score button clicked at', clickTime);
    // Start optimistic flip via coordinator (prefer coordinator, helper will retry)
    if (game.topCardBack) startOptimisticFlip(game.topCardBack, game.currentPlayerIndex);

    try {
      // In local-mode the client drives all players (including bots). In
      // that case we should NOT pass a botPlayerId to the server because
      // the server treats bot calls specially (it validates bot turn by
      // matching botPlayerId against game.currentPlayerIndex). For local
      // games we call performScore without botPlayerId so the server will
      // use `game.isLocalMode` branch and trust the client-provided turn.
      const serverBotId = isLocalMode ? null : callerId;
      await performScore(game.roomCode, serverBotId);

      // After server call, enqueue VERIFY and SHOW_NEXT_CARD (client-only)
      const topIndex = game.drawPile.length - 1;
      const nextCard = (topIndex - 1 >= 0) ? game.drawPile[topIndex - 1] : null; // card to append beneath
      if (coordinatorRef.current) {
        coordinatorRef.current.enqueue([
          { type: 'VERIFY_EXPECTED_STATE', payload: { actionId: null } },
          { type: 'SHOW_NEXT_CARD', payload: { nextCard } },
          { type: 'COMPLETE' }
        ]).catch(err => console.error('Post-score sequence failed:', err));
      }
    } catch (error) {
      console.error('Score error:', error);
      alert('Failed to score: ' + error.message);
    }
  };

  const handleStealClick = (callerId = null) => {
    if (!currentPlayer || animationState.isAnimating) return;
    setModalCallerId(callerId);
    setShowActionModal(true);
  };

  const handleTargetSelect = async (targetPlayer, callerId = null) => {
    setShowActionModal(false);
    // Start optimistic flip via coordinator (prefer coordinator, helper will retry)
    if (game.topCardBack) startOptimisticFlip(game.topCardBack, game.currentPlayerIndex);

    try {
  const serverBotId = isLocalMode ? null : callerId;
  await performSteal(game.roomCode, targetPlayer.id, serverBotId);

      // Enqueue VERIFY + SHOW_NEXT_CARD after server call
      const topIndex = game.drawPile.length - 1;
      const nextCard = (topIndex - 1 >= 0) ? game.drawPile[topIndex - 1] : null;
      if (coordinatorRef.current) {
        coordinatorRef.current.enqueue([
          { type: 'VERIFY_EXPECTED_STATE', payload: { actionId: null } },
          { type: 'SHOW_NEXT_CARD', payload: { nextCard } },
          { type: 'COMPLETE' }
        ]).catch(err => console.error('Post-steal sequence failed:', err));
      }
    } catch (error) {
      console.error('Steal error:', error);
      alert('Failed to steal: ' + error.message);
    }
    // Clear modal caller id after action completes
    setModalCallerId(null);
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
                {/**
                 * Always render the base draw-pile card so layout and DOM identity
                 * remain stable. When a flip is active we render an overlay on top
                 * (absolutely positioned) which performs the flip animation. This
                 * avoids mounting/unmounting the base card (no placeholder needed)
                 * and prevents flicker/layout jumps.
                 */}
                {/*
                 * When a flip overlay is active we want the base card shown
                 * beneath it to be the next card in the pile (so the flipped
                 * card appears to be removed revealing the next card). Compute
                 * the appropriate card to render here without unmounting the
                 * Card component.
                 */}
                {(() => {
                  const topIndex = game.drawPile.length - 1;
                  // If we're actively flipping, show the next card back under the overlay
                  const underFromClient = clientUnderCards.length > 0 ? clientUnderCards[clientUnderCards.length - 1] : null;
                  const baseCard = animationState.flippingCard
                    ? (underFromClient || game.drawPile[topIndex - 1])
                    : (underFromClient || game.drawPile[topIndex]);
                  return (
                    <Card
                      card={baseCard}
                      showBack={true}
                      size="large"
                    />
                  );
                })()}

                {animationState.flippingCard && (
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
                )}
              </div>
              
              {/* Action Buttons - always visible but disabled when not player's turn */}
              <div className="action-buttons">
                <button
                  ref={scoreButtonRef}
                  className="btn btn-score"
                  onClick={() => handleScoreClick(currentPlayer?.isBot ? currentPlayer?.id : null)}
                  disabled={!isMyTurn || animationState.isAnimating || game.drawPile.length === 0}
                >
                  Score
                </button>
                <button
                  ref={stealButtonRef}
                  className="btn btn-steal"
                  onClick={() => handleStealClick(currentPlayer?.isBot ? currentPlayer?.id : null)}
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
            flippingCard={animationState.flippingCard}
            isFlipping={animationState.isFlipping}
            isFlipComplete={animationState.isFlipComplete}
            isFadingFlippedCard={animationState.isFadingFlippedCard}
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
                    onClick={() => handleTargetSelect(player, modalCallerId)}
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
