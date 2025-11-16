import { useState, useEffect, useRef } from 'react';
import Tank from './Tank';
import Card from './Card';
import { checkWinCondition } from '../utils/gameRules';
import { AnimationPlayer } from '../utils/AnimationPlayer';
import AnimationCoordinator from '../utils/AnimationCoordinator';
import { compareGameState } from '../utils/compareGameState';
import { performScore, performSteal, signalClientReady } from '../services/gameService';
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

const GameBoard = ({ game, currentUserId, onEmojiSend, isLocalMode = false, setIsAnimating, applyPendingUpdate, usingPolling = false }) => {
  const [showActionModal, setShowActionModal] = useState(false);
  const [animationState, setAnimationState] = useState({
    highlightedCardIds: new Set(),
    animatingCardIds: new Set(),
    isFlipping: false,
    flippingCard: null,
    isFadingFlippedCard: false,
    displayPlayerIndex: null,
    isAnimating: false, // Track overall animation state
    isFlipComplete: false, // Track when flip animation completes but card still showing
    flipPhase: 'none' // 'none'|'half1'|'half2'|'held'
  });
  // Keep a ref of animationState for reliable polling inside async helpers
  const animationStateRef = useRef(animationState);
  useEffect(() => { animationStateRef.current = animationState; }, [animationState]);
  const [lastSeenHintTimestamp, setLastSeenHintTimestamp] = useState(0);
  const [clientUnderCards, setClientUnderCards] = useState([]);
  
  const animationPlayerRef = useRef(null);
  const coordinatorRef = useRef(null);
  const scoreButtonRef = useRef(null);
  const stealButtonRef = useRef(null);
  // Keep a latest reference to the game so callbacks created once can
  // consult the up-to-date authoritative game state (drawPile/top card).
  const latestGameRef = useRef(game);
  useEffect(() => { latestGameRef.current = game; }, [game]);

  // Use a ref for lastSeenHintTimestamp to avoid stale-closure races when
  // comparing incoming hints in effects; keep state and ref in sync.
  const lastSeenHintRef = useRef(lastSeenHintTimestamp);
  const updateLastSeenHintTimestamp = (ts) => {
    try { setLastSeenHintTimestamp(ts); } catch (e) { /* ignore */ }
    try { lastSeenHintRef.current = ts; } catch (e) { /* ignore */ }
  };
  // Temporary visual debug: show both top and next card stacked exactly on
  // top of each other (100% overlap). Keep enabled for debugging — render
  // both top and next cards (right slot sits directly underneath left).
  const showDualCompare = true;
  // Helper to start an optimistic flip via the coordinator. If the
  // coordinator isn't ready yet, retry for a short time instead of
  // calling AnimationPlayer directly. This ensures the coordinator is
  // the single source of truth for animation lifecycles.
  const startOptimisticFlip = (cardBack, playerIndex) => {
    if (!cardBack) return;
    const attempt = (retriesLeft = 20) => {
      if (coordinatorRef.current) {
        try { console.log('UI: enqueue START_OPTIMISTIC_FLIP', { cardId: cardBack.id, playerIndex }); } catch (e) {}
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
      // Timings set per design: first half 400ms, second half 400ms => flipMs = 800
      // Hold = 1000ms, Fade = 400ms
      flipMs: 800,
      holdMs: 1000,
      fadeMs: 400
    });
    player.setUpdateCallback((newState) => {
      setAnimationState(newState);
    });
    animationPlayerRef.current = player;

    // Create coordinator once we have an animation player
    const showNextCardFn = (card) => {
      if (!card) return;
      try {
        console.log('SHOW_NEXT_CARD callback - requested next card', { cardId: card.id, color: card.color, backColors: card.backColors });
      } catch (e) { /* ignore logging errors */ }

      // Avoid applying a SHOW_NEXT_CARD that would be a no-op or visually
      // stale: if the authoritative top card already equals the card we're
      // being asked to show underneath, skip setting clientUnderCards. Use
      // latestGameRef so we consult up-to-date server snapshot instead of a
      // possibly-stale closure value.
      try {
        const latestGame = latestGameRef.current;
        const topIndex = latestGame?.drawPile?.length ? latestGame.drawPile.length - 1 : -1;
        const currentTopId = topIndex >= 0 ? latestGame.drawPile[topIndex]?.id : null;
        if (currentTopId && card.id === currentTopId) {
          try { console.log('SHOW_NEXT_CARD skipped because nextCard id equals current top card id', { cardId: card.id }); } catch (e) {}
          return;
        }
      } catch (e) {
        // If any error occurs, fall back to applying the under-card so we
        // don't break the visual flow.
        console.warn('Error checking latestGameRef in showNextCardFn, applying under-card as fallback', e);
      }

      // Keep only a single client-under card (most-recent). This prevents
      // stacked under-cards which can cause confusing visuals.
      // Dedupe: if the card is already present, skip to avoid rendering
      // duplicate next cards during flip.
      setClientUnderCards((prev) => {
        try {
          if (prev && prev.length > 0 && prev[prev.length - 1]?.id === card.id) {
            console.log('SHOW_NEXT_CARD skipped because clientUnderCards already contains this card', { cardId: card.id });
            return prev;
          }
        } catch (e) { /* fallthrough */ }
        return [card];
      });
    };

    coordinatorRef.current = new AnimationCoordinator({
      animationPlayer: player,
      applyPendingUpdate,
      compareFn: compareGameState,
      showNextCardFn,
      getClientState: () => ({ game, animationState })
    });

    // Overlay ref for listening to flip animation events
    overlayRef.current = null;

    return () => {
      player.cleanup();
    };
  }, [game?.roomCode, setIsAnimating]);

  const overlayRef = useRef(null);

  const handleFlipAnimationEnd = (e) => {
    // Only handle the first-half animation end; ignore other animationend
    // events. If we're in flipPhase 'half1', notify the player to advance.
    try {
      if (!animationPlayerRef.current) return;
      if (animationState.flipPhase === 'half1') {
        // Notify the animation player that the 90deg point was reached.
        try { animationPlayerRef.current.notifyFlipHalf1(); } catch (err) { console.warn('notifyFlipHalf1 failed', err); }
        // Diagnostic: log DOM state for the under/top/front/back elements so we
        // can inspect transforms/visibility when mirrored text appears.
        try {
          const flippingId = animationState.flippingCard?.id;
          const underId = clientUnderCards.length > 0 ? clientUnderCards[clientUnderCards.length - 1]?.id : null;
          console.log('🎯 DIAG: DOM snapshot at half1', { flippingId, underId });
          if (flippingId) {
            const elFront = document.querySelector(`[data-card-id="${flippingId}"][data-card-face="front"]`);
            const elBack = document.querySelector(`[data-card-id="${flippingId}"][data-card-face="back"]`);
            if (elFront) console.log('  front el rect/transform/vis:', elFront.getBoundingClientRect(), window.getComputedStyle(elFront).transform, window.getComputedStyle(elFront).visibility);
            if (elBack) console.log('  back el rect/transform/vis:', elBack.getBoundingClientRect(), window.getComputedStyle(elBack).transform, window.getComputedStyle(elBack).visibility);
          }
          if (underId) {
            const underEl = document.querySelector(`[data-card-id="${underId}"]`);
            if (underEl) console.log('  under el rect/transform/vis:', underEl.getBoundingClientRect(), window.getComputedStyle(underEl).transform, window.getComputedStyle(underEl).visibility);
          }
        } catch (e) { console.warn('DOM diag failed', e); }
      }
    } catch (err) {
      console.error('Error in handleFlipAnimationEnd:', err);
    }
  };

  // Log top and next card data anytime the client-side draw pile or
  // animation/under-card state changes so we can debug front/back mismatches.
  useEffect(() => {
    try {
      const topIndex = game?.drawPile?.length ? game.drawPile.length - 1 : -1;
      const topCard = topIndex >= 0 ? game.drawPile[topIndex] : null;
      const nextCard = topIndex - 1 >= 0 ? game.drawPile[topIndex - 1] : null;
      console.log('🧭 draw-pile / overlay state update', {
        timestamp: Date.now(),
        topCard: topCard ? { id: topCard.id, color: topCard.color, backColors: topCard.backColors } : null,
        nextCard: nextCard ? { id: nextCard.id, color: nextCard.color, backColors: nextCard.backColors } : null,
        clientUnderCards,
        flippingCard: animationState.flippingCard ? { id: animationState.flippingCard.id, color: animationState.flippingCard.color, backColors: animationState.flippingCard.backColors } : null,
        isFlipping: animationState.isFlipping,
        isFlipComplete: animationState.isFlipComplete
      });
    } catch (err) {
      console.error('Error logging draw-pile state:', err);
    }
  }, [game?.drawPile?.length, clientUnderCards, animationState.isFlipping, animationState.isFlipComplete, animationState.flippingCard]);

  // Log when React will render or clear the overlay (so we can see whether
  // the overlay mount is happening as expected). This prints the flipping
  // card id when set and notes when the overlay is cleared.
  useEffect(() => {
    try {
      if (animationState.flippingCard) {
        console.log('UI: overlay WILL render for card', { id: animationState.flippingCard.id, color: animationState.flippingCard.color });
      } else {
        console.log('UI: overlay is not active / was cleared');
      }
    } catch (e) {
      console.warn('UI overlay log failed', e);
    }
  }, [animationState.flippingCard]);

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
      try {
        console.log('Enqueue initial SHOW_NEXT_CARD', { nextCardId: nextCard?.id, nextCardColor: nextCard?.color });
      } catch (e) {}
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

    // Only play new animations (check timestamp) — use ref to avoid closure staleness
    if (hint.timestamp && hint.timestamp > lastSeenHintRef.current) {
      console.log('Playing animation hint:', hint);
      updateLastSeenHintTimestamp(hint.timestamp);
      // Pass the previous player index (before the server advanced it)
      const previousPlayerIndex = hint.playerId ? game.players.findIndex(p => p.id === hint.playerId) : game.currentPlayerIndex;
      // Enqueue server hint via coordinator so server-driven hints are serialized
      // with any optimistic sequences. Fall back to direct playHint if coordinator
      // isn't available (defensive).
      if (coordinatorRef.current) {
        coordinatorRef.current.enqueue([
          { type: 'PLAY_SERVER_HINT', payload: { hint, previousPlayerIndex } }
        ]).catch(err => console.error('PLAY_SERVER_HINT enqueue failed:', err));
      } else {
        animationPlayerRef.current.playHint(hint, previousPlayerIndex);
      }
    }
  }, [game?.animationHint, lastSeenHintTimestamp, game?.players]);

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
  
  // Always use server-provided currentPlayerIndex to compute turn. Local
  // mode is not supported; client should not assume offline authority.
  const isMyTurn = isLocalMode 
    ? !game?.players[game.currentPlayerIndex]?.isBot  // In local mode, your turn if current player is not a bot
    : (game?.currentPlayerIndex === currentPlayerIndex);

  const handleScoreClick = async () => {
    if (!currentPlayer || animationState.isAnimating) return;
    
    const clickTime = performance.now();
    console.log('🔘 Score button clicked at', clickTime);
    // Start optimistic flip immediately to reduce enqueue/start races and
    // enqueue a START so the coordinator knows about the flip.
    // Use the actual top-of-pile card for the optimistic flip (not game.topCardBack)
    const currentTopIndex = game.drawPile.length - 1;
    const currentTopCard = currentTopIndex >= 0 ? game.drawPile[currentTopIndex] : null;
    if (currentTopCard) {
      // Pre-place the next card so the flip's first-half reveals it.
      try {
        const nextCardIndex = currentTopIndex - 1;
        const nextCard = nextCardIndex >= 0 ? game.drawPile[nextCardIndex] : null;
        if (nextCard) setClientUnderCards(() => [nextCard]);
      } catch (e) {
        console.warn('unable to set clientUnderCards before optimistic flip', e);
      }

      if (animationPlayerRef.current && typeof animationPlayerRef.current.startOptimisticFlipImmediate === 'function') {
        await animationPlayerRef.current.startOptimisticFlipImmediate(currentTopCard, game.currentPlayerIndex);
        startOptimisticFlip(currentTopCard, game.currentPlayerIndex);
      } else {
        startOptimisticFlip(currentTopCard, game.currentPlayerIndex);
      }
    }

    try {
      const result = await performScore(game.roomCode);
      console.log('performScore server response:', result);

      // If server returned an animationHint, serialize it into the same
      // coordinator sequence so the server hint cannot race ahead of the
      // post-action COMPLETE command. Also mark the hint as seen so the
      // `game.animationHint` listener doesn't double-enqueue it.
      const topIndex = game.drawPile.length - 1;
      const nextCard = (topIndex - 1 >= 0) ? game.drawPile[topIndex - 1] : null; // card to append beneath
      if (result && result.animationHint) {
        try { updateLastSeenHintTimestamp(result.animationHint.timestamp || Date.now()); } catch {}
        const previousPlayerIndex = result.animationHint.playerId ? game.players.findIndex(p => p.id === result.animationHint.playerId) : game.currentPlayerIndex;
        if (coordinatorRef.current) {
          try { console.log('Enqueue post-score SHOW_NEXT_CARD (with server hint)', { nextCardId: nextCard?.id, nextCardColor: nextCard?.color, hintSeq: result.animationHint.sequence }); } catch (e) {}
          coordinatorRef.current.enqueue([
            { type: 'PLAY_SERVER_HINT', payload: { hint: result.animationHint, previousPlayerIndex } },
            { type: 'VERIFY_EXPECTED_STATE', payload: { actionId: null } },
            { type: 'SHOW_NEXT_CARD', payload: { nextCard } },
            { type: 'COMPLETE' }
          ]).catch(err => console.error('Post-score sequence failed:', err));
        }
      } else {
        if (coordinatorRef.current) {
          try { console.log('Enqueue post-score SHOW_NEXT_CARD (no server hint)', { nextCardId: nextCard?.id, nextCardColor: nextCard?.color }); } catch (e) {}
          coordinatorRef.current.enqueue([
            { type: 'VERIFY_EXPECTED_STATE', payload: { actionId: null } },
            { type: 'SHOW_NEXT_CARD', payload: { nextCard } },
            { type: 'COMPLETE' }
          ]).catch(err => console.error('Post-score sequence failed:', err));
        }
      }
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
    // Start optimistic flip immediately to reduce enqueue/start races and
    // enqueue a START so the coordinator knows about the flip.
    // Use the actual top-of-pile card for the optimistic flip (not game.topCardBack)
    const currentTopIndex = game.drawPile.length - 1;
    const currentTopCard = currentTopIndex >= 0 ? game.drawPile[currentTopIndex] : null;
    if (currentTopCard) {
      // Pre-place the next card so the flip's first-half reveals it (match Score behavior)
      try {
        const nextCardIndex = currentTopIndex - 1;
        const nextCard = nextCardIndex >= 0 ? game.drawPile[nextCardIndex] : null;
        if (nextCard) setClientUnderCards(() => [nextCard]);
      } catch (e) {
        console.warn('unable to set clientUnderCards before optimistic flip (steal)', e);
      }

      if (animationPlayerRef.current && typeof animationPlayerRef.current.startOptimisticFlipImmediate === 'function') {
        await animationPlayerRef.current.startOptimisticFlipImmediate(currentTopCard, game.currentPlayerIndex);
        startOptimisticFlip(currentTopCard, game.currentPlayerIndex);
      } else {
        startOptimisticFlip(currentTopCard, game.currentPlayerIndex);
      }
    }

    try {
      console.log('Initiating STEAL request', { room: game.roomCode, targetPlayerId: targetPlayer.id, topCardBackId: game.topCardBack?.id });
      const result = await performSteal(game.roomCode, targetPlayer.id);
      console.log('performSteal server response:', result);

      // Use server-provided animationHint if available and serialize it with
      // VERIFY/SHOW_NEXT_CARD/COMPLETE to avoid races where a COMPLETE could
      // run before the hint is played.
      const topIndex = game.drawPile.length - 1;
      const nextCard = (topIndex - 1 >= 0) ? game.drawPile[topIndex - 1] : null;
      if (result && result.animationHint) {
        try { updateLastSeenHintTimestamp(result.animationHint.timestamp || Date.now()); } catch {}
        const previousPlayerIndex = result.animationHint.playerId ? game.players.findIndex(p => p.id === result.animationHint.playerId) : game.currentPlayerIndex;
        if (coordinatorRef.current) {
          try { console.log('Enqueue post-steal SHOW_NEXT_CARD (with server hint)', { nextCardId: nextCard?.id, nextCardColor: nextCard?.color, hintSeq: result.animationHint.sequence }); } catch (e) {}
          coordinatorRef.current.enqueue([
            { type: 'PLAY_SERVER_HINT', payload: { hint: result.animationHint, previousPlayerIndex } },
            { type: 'VERIFY_EXPECTED_STATE', payload: { actionId: null } },
            { type: 'SHOW_NEXT_CARD', payload: { nextCard } },
            { type: 'COMPLETE' }
          ]).catch(err => console.error('Post-steal sequence failed:', err));
        }
      } else {
        if (coordinatorRef.current) {
          try { console.log('Enqueue post-steal SHOW_NEXT_CARD (no server hint)', { nextCardId: nextCard?.id, nextCardColor: nextCard?.color }); } catch (e) {}
          coordinatorRef.current.enqueue([
            { type: 'VERIFY_EXPECTED_STATE', payload: { actionId: null } },
            { type: 'SHOW_NEXT_CARD', payload: { nextCard } },
            { type: 'COMPLETE' }
          ]).catch(err => console.error('Post-steal sequence failed:', err));
        }
      }
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
      {usingPolling && (
        <div className="realtime-warning" role="status" aria-live="polite">
          Realtime connection degraded — falling back to polling. Gameplay will continue but updates may be slightly delayed.
        </div>
      )}

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
                  const topCard = topIndex >= 0 ? game.drawPile[topIndex] : null;
                  const nextCard = topIndex - 1 >= 0 ? game.drawPile[topIndex - 1] : null;
                  // If debug compare is enabled and we have two cards, show both
                  if (showDualCompare && topCard && nextCard) {
                    // When showing dual-compare for debugging, keep the visual
                    // semantics identical to the real base-card logic used when
                    // a flip is active: if a flip overlay is present render the
                    // left (top) compare slot as the `baseCard` (which will be
                    // the clientUnderCards or the next card) so the first-half
                    // of the flip displays the same underlying card as the
                    // production view. Otherwise render the actual top card.
                    const underFromClient = clientUnderCards.length > 0 ? clientUnderCards[clientUnderCards.length - 1] : null;
                    const leftCard = animationState.flippingCard
                      ? (underFromClient || game.drawPile[topIndex - 1])
                      : topCard;
                    // If the left compare slot is showing the same next card
                    // that is also rendered in the right slot, hide the right
                    // visual to avoid showing two copies at once. This makes
                    // the debug view visually identical to the production
                    // behavior where the single next card is visible under
                    // the top card during a flip.
                    const hideRight = !!(leftCard && nextCard && leftCard.id === nextCard.id && animationState.flippingCard);
                    return (
                      <div className="dual-draw-compare" aria-hidden="true">
                        <div className="compare-card left">
                          <Card card={leftCard} showBack={true} size="large" />
                        </div>
                        <div className="compare-card right" style={{ visibility: hideRight ? 'hidden' : 'visible' }}>
                          <Card card={nextCard} showBack={true} size="large" />
                        </div>
                      </div>
                    );
                  }

                  // Fallback: existing single base-card behavior
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
                  (() => {
                    // compute half-duration for CSS (fallback if player not ready)
                    const flipHalfMs = animationPlayerRef.current ? Math.round((animationPlayerRef.current.durations.flipMs || 2600) / 2) : 1300;
                    const phaseClass = animationState.flipPhase === 'half1' ? 'flipping-half1' : (animationState.flipPhase === 'half2' ? 'flipping-half2' : (animationState.flipPhase === 'held' ? 'flip-held' : ''));
                    return (
                      <div
                        ref={overlayRef}
                        className={`card-flip-inner ${phaseClass}`}
                        onAnimationEnd={handleFlipAnimationEnd}
                        style={{
                          '--flip-half-ms': `${flipHalfMs}ms`,
                          opacity: animationState.isFadingFlippedCard ? 0 : 1,
                          transition: animationState.isFadingFlippedCard ? `opacity ${animationPlayerRef.current?.durations?.fadeMs || 400}ms ease-out` : 'none'
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
                    );
                  })()
                )}
              </div>
              
              {/* Action Buttons - always visible but disabled when not player's turn */}
              <div className="action-buttons">
                <button
                  ref={scoreButtonRef}
                  className="btn btn-score"
                  onClick={() => handleScoreClick()}
                  disabled={!isMyTurn || animationState.isAnimating || game.drawPile.length === 0}
                >
                  Score
                </button>
                <button
                  ref={stealButtonRef}
                  className="btn btn-steal"
                  onClick={() => handleStealClick()}
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
