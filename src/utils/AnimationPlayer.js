/**
 * Simple Animation Player - reads server hints and plays animations
 * No state diffing, no complex logic - just visual effects
 */

export class AnimationPlayer {
  constructor() {
    this.isAnimating = false;
    this.onUpdate = null; // Callback to trigger React re-render
    this.currentAnimationState = {
      highlightedCardIds: new Set(),
      animatingCardIds: new Set()
    };
    this.timeouts = [];
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
  playHint(hint) {
    if (!hint || !hint.sequence) return;

    // Clear any existing animations
    this.cleanup();
    this.isAnimating = true;

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
    }
  }

  /**
   * Score Success: highlight matching cards → move to score pile
   */
  playScoreSuccess(hint) {
    // Step 1: Highlight matching cards (400ms)
    this.updateState({
      highlightedCardIds: new Set(hint.affectedCardIds)
    });

    // Step 2: Clear highlights and mark as animating (move to score)
    const t1 = setTimeout(() => {
      this.updateState({
        highlightedCardIds: new Set(),
        animatingCardIds: new Set(hint.affectedCardIds)
      });
    }, 400);
    this.timeouts.push(t1);

    // Step 3: Complete animation
    const t2 = setTimeout(() => {
      this.complete();
    }, 1400); // 400ms highlight + 1000ms move
    this.timeouts.push(t2);
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
    // Step 1: Highlight cards being stolen (400ms)
    this.updateState({
      highlightedCardIds: new Set(hint.affectedCardIds),
      stealFromPlayerId: hint.targetPlayerId // Which tank to highlight
    });

    // Step 2: Animate cards moving
    const t1 = setTimeout(() => {
      this.updateState({
        highlightedCardIds: new Set(),
        animatingCardIds: new Set(hint.affectedCardIds),
        stealToPlayerId: hint.playerId // Which tank they're moving to
      });
    }, 400);
    this.timeouts.push(t1);

    // Step 3: Complete
    const t2 = setTimeout(() => {
      this.complete();
    }, 1400);
    this.timeouts.push(t2);
  }

  /**
   * Steal Fail: card just arrives in target's tank
   */
  playStealFail(hint) {
    // Brief pulse on new card in target's tank
    this.updateState({
      animatingCardIds: new Set(hint.affectedCardIds),
      targetPlayerId: hint.targetPlayerId
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
  complete() {
    this.isAnimating = false;
    this.currentAnimationState = {
      highlightedCardIds: new Set(),
      animatingCardIds: new Set()
    };

    if (this.onUpdate) {
      this.onUpdate(this.currentAnimationState);
    }

    this.cleanup();
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
