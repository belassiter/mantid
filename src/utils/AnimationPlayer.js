/**
 * Simple Animation Player - reads server hints and plays animations
 * No state diffing, no complex logic - just visual effects
 */

export class AnimationPlayer {
  constructor(gameId, setIsAnimating, options = {}) {
    this.gameId = gameId;
    this.isAnimating = false;
    this.setIsAnimating = setIsAnimating; // Control function from useGameState
    this.onUpdate = null; // Callback to trigger React re-render
    this.currentAnimationState = {
      highlightedCardIds: new Set(),
      animatingCardIds: new Set(),
      isFlipping: false,
      flippingCard: null,
      isFadingFlippedCard: false,
      displayPlayerIndex: null,
      isFlipComplete: false
    };
    this.timeouts = [];
    this.hintQueue = []; // Queue for pending animation hints
    this.serverHintQueued = false;
    this.flipStartTime = null; // Track when flip animation started
    this._optimisticFlipResolve = null;
    this._hintResolve = null;
    // Duration options (ms) for flip timeline - configurable for tuning
    // Defaults: flip 2600ms, hold 2000ms, fade 500ms (total 5100ms)
    this.durations = {
      flipMs: typeof options.flipMs === 'number' ? options.flipMs : 2600,
      holdMs: typeof options.holdMs === 'number' ? options.holdMs : 2000,
      fadeMs: typeof options.fadeMs === 'number' ? options.fadeMs : 500
    };
  }

  /**
   * Set callback for when animation state updates
   */
  setUpdateCallback(callback) {
    this.onUpdate = callback;
  }

  /**
   * Play animation based on server hint
   */
  playHint(hint, currentPlayerIndex) {
    if (!hint || !hint.sequence) return;

    // Check if optimistic flip is in progress
    const isOptimisticFlipActive = this.isAnimating && (
      this.currentAnimationState.isFlipping || 
      this.currentAnimationState.isFlipComplete || 
      this.currentAnimationState.isFadingFlippedCard
    );
    
    if (isOptimisticFlipActive) {
      console.log('🔗 Server match result arrived during optimistic flip, queueing...');
      // Queue the match result to play after flip completes
      this.queueMatchResultAfterFlip(hint, currentPlayerIndex);
      return;
    }

    // No optimistic flip active - play normally
    this.cleanup();
    this.isAnimating = true;

    // Indicate animation in progress; the game state buffer will keep the
    // authoritative game doc from applying mid-animation so we don't need to
    // override the displayed player index here.
    this.updateState({ isAnimating: true });

    this.playMatchResult(hint);
  }

  /**
   * Queue match result to play after optimistic flip completes
   */
  queueMatchResultAfterFlip(hint, currentPlayerIndex) {
    // Calculate remaining time in optimistic flip sequence
    const now = performance.now();
    const elapsed = this.flipStartTime ? (now - this.flipStartTime) : 0;
    
    // Timeline: 0-2600ms flip, 2600-4600ms hold, 4600-5100ms fade
    const totalFlipTime = 5100;
    const remainingTime = Math.max(0, totalFlipTime - elapsed);
    
    console.log(`⏱️ Animation will complete in ${remainingTime.toFixed(0)}ms (after flip)`);

    // Queue the server hint so the optimistic flip doesn't get cleared early.
    // When the flip finishes we'll play the match result which will call
    // complete() as part of its normal lifecycle.
    this.serverHintQueued = true;
    this.hintQueue.push({ hint, currentPlayerIndex });

    const t = setTimeout(() => {
      // Play the queued match result now that the optimistic flip timeline has passed
      const item = this.hintQueue.shift();
      if (item) {
        this.playMatchResult(item.hint);
      } else {
        // No queued hint (shouldn't happen) — ensure we complete to clear
        this.complete();
      }
    }, remainingTime);

    this.timeouts.push(t);
  }

  /**
   * Play match result animation (highlights, scores)
   */
  playMatchResult(hint) {
    switch (hint.sequence) {
      case 'SCORE_SUCCESS':
        this.playScoreSuccess(hint);
        break;
      case 'SCORE_FAIL':
        this.playScoreFail(hint);
        break;
      case 'STEAL_SUCCESS':
        this.playStealSuccess(hint);
        break;
      case 'STEAL_FAIL':
        this.playStealFail(hint);
        break;
      default:
        console.warn('Unknown animation sequence:', hint.sequence);
        this.isAnimating = false;
        this.updateState({ isAnimating: false });
    }
  }

  /**
   * Score Success: highlight matching cards → move to score pile
   */
  playScoreSuccess(hint) {
    // Show highlights on matching cards
    this.updateState({
      highlightedCardIds: new Set(hint.affectedCardIds)
    });

    // Animate cards moving to score pile
    const t1 = setTimeout(() => {
      this.updateState({
        highlightedCardIds: new Set(),
        animatingCardIds: new Set(hint.affectedCardIds)
      });
    }, 400);
    this.timeouts.push(t1);

    // Complete animation
    const t2 = setTimeout(() => {
      this.complete();
    }, 1400);
    this.timeouts.push(t2);
  }

  /**
   * Optimistic flip - immediately flip the top card before server response
   * Server hint will be queued and played after flip completes
   */
  playOptimisticFlip(card, currentPlayerIndex = null) {
    this.flipStartTime = performance.now();
    console.log('⚡ OPTIMISTIC flip starting at', this.flipStartTime);

    // Clear any existing animations
    this.cleanup();
    this.isAnimating = true;

    // Signal to useGameState that animation is starting
    if (this.setIsAnimating) {
      this.setIsAnimating(true);
      console.log('🔒 Animation starting - state updates will be buffered');
    }

    // Signal flip state; do not mutate displayPlayerIndex here. The
    // `useGameState` hook buffers incoming game updates while `isAnimating`
    // is true so the UI will not apply turn changes until the animation ends.
    this.updateState({
      isFlipping: true,
      flippingCard: card,
      isAnimating: true
    });

    // After flip CSS animation completes (flipMs), hold card visible
    const t0a = setTimeout(() => {
      this.updateState({
        isFlipping: false,
        isFlipComplete: true
      });
    }, 2600);
    this.timeouts.push(t0a);

    // After holding for configured holdMs (flipMs + holdMs total), start fade (fadeMs)
    const t0b = setTimeout(() => {
      this.updateState({
        isFlipComplete: false,
        isFadingFlippedCard: true
      });
    }, this.durations.flipMs + this.durations.holdMs);
    this.timeouts.push(t0b);

    // After fade completes (flipMs + holdMs + fadeMs total) mark that the optimistic flip's
    // fade timeline has finished. Do NOT remove the overlay (flippingCard)
    // here. Keeping the overlay in the DOM (with opacity 0) prevents a
    // single-frame flash if the authoritative game state or piled cards
    // update while the server-side match animation still runs. The overlay
    // will be cleared by complete() after the server hint animations finish.
    const t0c = setTimeout(() => {
      console.log('⚡ Optimistic flip fade finished; holding overlay until server animations complete');
      // Ensure the overlay is faded out visually
      this.updateState({ isFadingFlippedCard: true });
      // Do not clear flippingCard here; complete() will clear it once
      // server-side animations (if any) are done.
      // Resolve optimistic flip promise here so coordinator can continue
      if (this._optimisticFlipResolve) {
        try { this._optimisticFlipResolve(); } catch { /* ignore */ }
        this._optimisticFlipResolve = null;
      }
    }, this.durations.flipMs + this.durations.holdMs + this.durations.fadeMs);
    this.timeouts.push(t0c);

    // Return a promise that resolves when the optimistic flip fade timeline ends
    return new Promise((resolve) => {
      this._optimisticFlipResolve = resolve;
    });
  }

  /**
   * Score Fail: just show card arriving in tank
   */
  playScoreFail(hint) {
    // Brief pulse on new card
    this.updateState({
      animatingCardIds: new Set(hint.affectedCardIds)
    });

    const t = setTimeout(() => {
      this.complete();
    }, 500);
    this.timeouts.push(t);
  }

  /**
   * Steal Success: highlight cards in victim's tank → move to stealer's tank
   */
  playStealSuccess(hint) {
    // Highlight cards being stolen
    this.updateState({
      highlightedCardIds: new Set(hint.affectedCardIds),
      stealFromPlayerId: hint.targetPlayerId
    });

    // Animate cards moving
    const t1 = setTimeout(() => {
      this.updateState({
        highlightedCardIds: new Set(),
        animatingCardIds: new Set(hint.affectedCardIds),
        stealToPlayerId: hint.playerId
      });
    }, 400);
    this.timeouts.push(t1);

    // Complete
    const t2 = setTimeout(() => {
      this.complete();
    }, 1400);
    this.timeouts.push(t2);
  }

  /**
   * Steal Fail: card just arrives in target's tank
   */
  /**
   * Steal Fail: card just arrives in target's tank
   */
  playStealFail(hint) {
    // Brief pulse on new card in target's tank
    this.updateState({
      animatingCardIds: new Set(hint.affectedCardIds),
      stealToPlayerId: hint.targetPlayerId
    });

    const t = setTimeout(() => {
      this.complete();
    }, 500);
    this.timeouts.push(t);
  }

  /**
   * Play a server-provided hint and return a promise that resolves when
   * the server-side hint animation completes (i.e., when complete() runs).
   */
  playHint(hint, previousPlayerIndex = null) {
    // If a match result is already queued, we'll let queueMatchResultAfterFlip
    // handle timing. Otherwise play immediately and return a promise that
    // resolves once complete() is called.
    if (!hint) return Promise.resolve();
    // Start playing the match result now
    this.playMatchResult(hint);
    return new Promise((resolve) => {
      this._hintResolve = resolve;
    });
  }

  /**
   * Update animation state and notify React
   */
  updateState(updates) {
    this.currentAnimationState = {
      ...this.currentAnimationState,
      ...updates
    };

    if (this.onUpdate) {
      this.onUpdate(this.currentAnimationState);
    }
  }

  /**
   * Complete animation and reset state
   */
  async complete() {
    this.isAnimating = false;
    this.currentAnimationState = {
      highlightedCardIds: new Set(),
      animatingCardIds: new Set(),
      isFlipping: false,
      flippingCard: null,
      isFadingFlippedCard: false,
      displayPlayerIndex: null,
      isAnimating: false
    };

    if (this.onUpdate) {
      this.onUpdate(this.currentAnimationState);
    }

    this.cleanup();
    
    // Clear the animation flag in Firestore to allow bot turns
    if (this.gameId) {
      await this.clearAnimationFlag();
    }

    // Notify the hook that animations are finished so buffered updates apply
    if (this.setIsAnimating) {
      try {
        this.setIsAnimating(false);
        console.log('📦 Animation complete (complete()) - releasing buffer');
      } catch (err) {
        console.error('Error calling setIsAnimating(false) in complete():', err);
      }
    }
    // Clear server hint flag
    this.serverHintQueued = false;
    // Resolve any pending hint promise
    if (this._hintResolve) {
      try { this._hintResolve(); } catch { /* ignore */ }
      this._hintResolve = null;
    }
  }
  
  /**
   * Clear animation in progress flag in Firestore
   */
  async clearAnimationFlag() {
    try {
      const { db } = await import('../firebase/config');
      const { doc, updateDoc } = await import('firebase/firestore');
      const gameRef = doc(db, 'games', this.gameId);
      await updateDoc(gameRef, { animationInProgress: false });
    } catch (error) {
      console.error('Error clearing animation flag:', error);
    }
  }

  /**
   * Clear all timeouts
   */
  cleanup() {
    this.timeouts.forEach(timeout => clearTimeout(timeout));
    this.timeouts = [];
  }

  /**
   * Get current animation state
   */
  getAnimationState() {
    return this.currentAnimationState;
  }
}
