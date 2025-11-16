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
      isFlipComplete: false,
      flipPhase: 'none' // 'none' | 'half1' | 'half2' | 'held'
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
    if (!hint || !hint.sequence) return Promise.resolve();

    // Compute remaining optimistic flip timeline using configured durations
    const now = performance.now();
    const totalFlipTime = this.durations.flipMs + this.durations.holdMs + this.durations.fadeMs;
    const elapsed = this.flipStartTime ? (now - this.flipStartTime) : 0;
    const remaining = Math.max(0, totalFlipTime - elapsed);

    // If optimistic flip timeline still has time left, queue the server hint
    // to play after the optimistic flip finishes. This is more robust than
    // relying solely on flag values which may race with rendering.
    if (this.flipStartTime && remaining > 20) {
      console.log('🔗 Server match result arrived during optimistic flip, queueing...');
      console.log(`    flipStart=${this.flipStartTime.toFixed(1)} now=${now.toFixed(1)} elapsed=${elapsed.toFixed(0)} totalFlip=${totalFlipTime} remaining=${remaining.toFixed(0)}`);
      this.queueMatchResultAfterFlip(hint, currentPlayerIndex);
      // Return a promise that resolves when the queued hint finishes
      return new Promise((resolve) => { this._hintResolve = resolve; });
    }

    // No optimistic flip active (or flip already finished) - play immediately
    this.cleanup();
    this.isAnimating = true;
    this.updateState({ isAnimating: true });
    // Ensure the UI shows the player who performed the action during the
    // server-driven animation. Coordinator passes `previousPlayerIndex` as
    // currentPlayerIndex so we display the acting player until animation
    // completes.
    if (typeof currentPlayerIndex === 'number') {
      this.updateState({ displayPlayerIndex: currentPlayerIndex });
    }
    console.log('▶️ Playing server hint immediately:', hint.sequence);
    this.playMatchResult(hint);
    return new Promise((resolve) => { this._hintResolve = resolve; });
  }

  /**
   * Queue match result to play after optimistic flip completes
   */
  queueMatchResultAfterFlip(hint, currentPlayerIndex) {
    // Calculate remaining time in optimistic flip sequence
    const now = performance.now();
    const elapsed = this.flipStartTime ? (now - this.flipStartTime) : 0;
    // Timeline: flipMs flip, holdMs hold, fadeMs fade
    const totalFlipTime = this.durations.flipMs + this.durations.holdMs + this.durations.fadeMs;
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
    try {
      console.log('🔔 playMatchResult invoked with sequence:', hint.sequence, 'hint:', hint);
    } catch (e) {
      // ignore logging failures
    }
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
        this.complete();
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
    // Freeze display to the acting player so turn highlight does not jump
    // while the optimistic flip is active.
    this.updateState({
      isFlipping: true,
      flippingCard: card,
      isAnimating: true
    });
    // Indicate we're in the first-half of the flip. The DOM will start the
    // first-half animation; GameBoard will listen for animationend and call
    // `notifyFlipHalf1()` which will progress the timeline. We also set a
    // fallback timeout in case the animationend isn't fired (e.g., devtools pause).
    this.updateState({ flipPhase: 'half1', isFlipComplete: false });

    if (typeof currentPlayerIndex === 'number') {
      this.updateState({ displayPlayerIndex: currentPlayerIndex });
    }

    // Fallback in case animationend does not fire. This will call
    // notifyFlipHalf1 which advances the state to the hold/fade timeline.
    const fallback = setTimeout(() => {
      try {
        console.warn('Fallback: animationend not received, forcing half1 completion');
        this.notifyFlipHalf1();
      } catch (e) { /* ignore */ }
    }, this.durations.flipMs + 100); // small buffer
    this.timeouts.push(fallback);

    // Create and store the optimistic flip promise so other callers (e.g.,
    // the coordinator) can await the same timeline even if the flip was
    // started outside the coordinator.
    this._optimisticFlipPromise = new Promise((resolve) => {
      this._optimisticFlipResolve = resolve;
    });
    return this._optimisticFlipPromise;
  }

  /**
   * Called by the UI when the first-half animation completes (90deg).
   * Advances the player state into the hold -> fade timeline and resolves
   * the optimistic flip promise after fade completes. This method is
   * idempotent (safe to call multiple times).
   */
  notifyFlipHalf1() {
    if (!this.currentAnimationState || this.currentAnimationState.flipPhase !== 'half1') {
      // Already processed or not in half1; ignore
      return;
    }
    console.log('⚡ Flip half1 reached (90deg) - swapping to front and starting hold');
    // Clear any pending fallback
    this.cleanup();

    // Show front and mark phase half2
    this.updateState({ isFlipping: false, isFlipComplete: true, flipPhase: 'half2' });

    // Start hold timer, then fade
    const tHold = setTimeout(() => {
      console.log('⚡ Hold finished; starting fade');
      this.updateState({ isFlipComplete: false, isFadingFlippedCard: true, flipPhase: 'held' });
    }, this.durations.holdMs);
    this.timeouts.push(tHold);

    // After fade completes, resolve optimistic flip promise (but keep overlay until complete())
    const tFade = setTimeout(() => {
      console.log('⚡ Optimistic flip fade finished; optimistic promise resolving, overlay remains until server animations complete');
      this.updateState({ isFadingFlippedCard: true });
      if (this._optimisticFlipResolve) {
        try { this._optimisticFlipResolve(); } catch { /* ignore */ }
        this._optimisticFlipResolve = null;
      }
    }, this.durations.holdMs + this.durations.fadeMs);
    this.timeouts.push(tFade);
  }

  /**
   * Start the optimistic flip immediately and return a small acknowledgement
   * promise that resolves once the flip state has been set. This is useful
   * for callers that need to synchronously start the visual flip and then
   * immediately call the server without waiting for the full flip timeline.
   */
  startOptimisticFlipImmediate(card, currentPlayerIndex = null) {
    // Call the full playOptimisticFlip which sets up timeouts and state
    try {
      // Ensure we capture the optimistic flip promise when starting immediately
      // so coordinator can await it later if needed.
      const p = this.playOptimisticFlip(card, currentPlayerIndex);
      // Return an ACK promise that resolves immediately to let callers proceed
      // while the optimistic flip promise continues in the background.
      return Promise.resolve(p);
    } catch (err) {
      return Promise.reject(err);
    }
  }

  /**
   * Return a promise that resolves when the current optimistic flip timeline
   * completes, or a resolved promise if no optimistic flip is active.
   */
  awaitOptimisticFlip() {
    if (this._optimisticFlipPromise) return this._optimisticFlipPromise;
    return Promise.resolve();
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

    // Notify the hook that animations are finished so buffered updates apply
    if (this.setIsAnimating) {
      try {
        this.setIsAnimating(false);
        console.log('📦 Animation complete (complete()) - releasing buffer');
      } catch (err) {
        console.error('Error calling setIsAnimating(false) in complete():', err);
      }
    }
    
    // Signal to the server that the client is ready for the next turn.
    // This will trigger the next bot action if applicable.
    if (this.gameId) {
      try {
        const { signalClientReady } = await import('../services/gameService');
        await signalClientReady(this.gameId);
      } catch (error) {
        console.error('Error signaling client ready:', error);
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
