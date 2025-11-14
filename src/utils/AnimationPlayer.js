/**
 * Simple Animation Player - reads server hints and plays animations
 * No state diffing, no complex logic - just visual effects
 */

export class AnimationPlayer {
  constructor(gameId) {
    this.gameId = gameId;
    this.isAnimating = false;
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
    this.flipStartTime = null; // Track when flip animation started
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

    // Freeze the current player index during animations
    this.updateState({
      displayPlayerIndex: currentPlayerIndex,
      isAnimating: true
    });

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
    
    // After flip completes, just clean up - no additional animations needed
    // The flip is the main visual feedback, and cards have already moved to final positions
    const t = setTimeout(() => {
      this.complete();
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
  playOptimisticFlip(card) {
    this.flipStartTime = performance.now();
    console.log('⚡ OPTIMISTIC flip starting at', this.flipStartTime);
    
    // Clear any existing animations
    this.cleanup();
    this.isAnimating = true;
    
    // Start flip immediately
    this.updateState({
      isFlipping: true,
      flippingCard: card,
      isAnimating: true
    });
    
    // After flip CSS animation completes (2600ms), hold card visible
    const t0a = setTimeout(() => {
      this.updateState({
        isFlipping: false,
        isFlipComplete: true
      });
    }, 2600);
    this.timeouts.push(t0a);
    
    // After holding for 2 seconds (4600ms total), start fade (500ms)
    const t0b = setTimeout(() => {
      this.updateState({
        isFlipComplete: false,
        isFadingFlippedCard: true
      });
    }, 4600); // 2600 + 2000
    this.timeouts.push(t0b);
    
    // After fade completes (5100ms total), clear flipping card
    const t0c = setTimeout(() => {
      console.log('⚡ Optimistic flip complete, ready for server hint');
      // Clear the flipping card so draw pile shows next card
      this.updateState({
        isFadingFlippedCard: false,
        flippingCard: null
      });
    }, 5100); // 4600 + 500
    this.timeouts.push(t0c);
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
    
    // Clear the animation flag in Firestore to allow bot turns
    if (this.gameId) {
      await this.clearAnimationFlag();
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
