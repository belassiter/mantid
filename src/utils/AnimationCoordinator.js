// Lightweight AnimationCoordinator
// Runs declarative sequences of animation commands serially. Commands are
// promise-based and the coordinator blocks new sequences until the current
// one finishes. VERIFY commands are read-only (they call the provided
// applyPendingUpdate and log diffs). SHOW_NEXT_CARD calls a callback supplied
// by the caller to perform a client-only visual append beneath the top card.

export class AnimationCoordinator {
  constructor({ animationPlayer, applyPendingUpdate, compareFn, showNextCardFn, getClientState, defaultTimeout = 1500 }) {
    this.animationPlayer = animationPlayer; // instance of AnimationPlayer
    this.applyPendingUpdate = applyPendingUpdate; // function(compareFn) -> void
    this.compareFn = compareFn; // compareGameState
    this.showNextCardFn = showNextCardFn; // (card) => void
    this.getClientState = getClientState; // () => client state snapshot
    this.defaultTimeout = defaultTimeout;

    this.queue = [];
    this.isRunning = false;
    this.currentAbort = null;
  }

  enqueue(commands = []) {
    return new Promise((resolve, reject) => {
      this.queue.push({ commands, resolve, reject });
      this._runNext();
    });
  }

  cancelCurrent() {
    if (this.currentAbort) {
      this.currentAbort.cancelled = true;
    }
  }

  async _runNext() {
    if (this.isRunning) return;
    const item = this.queue.shift();
    if (!item) return;
    this.isRunning = true;
    const abort = { cancelled: false };
    this.currentAbort = abort;
    try {
      for (const cmd of item.commands) {
        if (abort.cancelled) throw new Error('sequence-cancelled');
        await this._runCommand(cmd, abort);
      }
      item.resolve();
    } catch (err) {
      item.reject(err);
    } finally {
      this.isRunning = false;
      this.currentAbort = null;
      // run next queued sequence
      this._runNext();
    }
  }

  _withTimeout(promise, ms, abort) {
    if (!ms) return promise;
    return Promise.race([
      promise,
      new Promise((resolve, reject) => {
        const id = setTimeout(() => {
          if (abort.cancelled) return reject(new Error('cancelled'));
          resolve('__timeout__');
        }, ms);
      })
    ]);
  }

  async _runCommand(cmd, abort) {
    const { type, payload } = cmd;
    switch (type) {
      case 'START_OPTIMISTIC_FLIP': {
        if (!this.animationPlayer) return;
        // animationPlayer.playOptimisticFlip now returns a Promise that resolves
        // when the optimistic flip fade timeline completes. Await it, but use
        // a timeout fallback is not used here: we want to wait for the
        // player's optimistic flip timeline (flip+hold+fade) to complete so
        // the hold duration actually takes effect. If the animation player
        // fails to resolve (bug), we catch and continue to avoid blocking
        // forever.
        if (typeof this.animationPlayer.awaitOptimisticFlip === 'function') {
          try {
            // If the optimistic flip was already started (e.g., immediate start),
            // await the existing flip promise. Otherwise, fall back to starting
            // the flip via playOptimisticFlip and await it.
            if (this.animationPlayer._optimisticFlipPromise) {
              await this.animationPlayer.awaitOptimisticFlip();
            } else if (typeof this.animationPlayer.playOptimisticFlip === 'function') {
              const p = this.animationPlayer.playOptimisticFlip(payload.cardBack, payload.playerIndex);
              await p;
            }
          } catch (err) {
            console.warn('START_OPTIMISTIC_FLIP: optimistic flip promise rejected or errored', err);
          }
        } else {
          // Older API: try to call playOptimisticFlip directly
          if (typeof this.animationPlayer.playOptimisticFlip === 'function') {
            try {
              const p = this.animationPlayer.playOptimisticFlip(payload.cardBack, payload.playerIndex);
              await p;
            } catch (err) {
              console.warn('START_OPTIMISTIC_FLIP fallback: optimistic flip errored', err);
            }
          }
        }
        break;
      }
      case 'PLAY_SERVER_HINT': {
        if (!this.animationPlayer) return;
        try {
          if (typeof this.animationPlayer.playHint === 'function') {
            const p = this.animationPlayer.playHint(payload.hint, payload.previousPlayerIndex);
            // Await the player's promise fully; server hints should be serialized
            // with optimistic flips and we don't want a short coordinator timeout
            // to prematurely advance the sequence.
            await p;
          }
        } catch {
          // ignore and continue
        }
        break;
      }
      case 'VERIFY_EXPECTED_STATE': {
        if (!this.applyPendingUpdate) break;
        // Call applyPendingUpdate with a compare function that returns diffs array
        try {
          this.applyPendingUpdate((clientState, serverState) => {
            try {
              const diffs = (this.compareFn && this.compareFn(clientState, serverState)) || [];
              if (diffs.length > 0) {
                // console-only per policy
                console.error('VERIFY_EXPECTED_STATE mismatch:', { diffs, actionId: payload?.actionId });
              } else {
                console.log('VERIFY_EXPECTED_STATE: no diffs');
              }
              return diffs;
            } catch (err) {
              console.error('Error during VERIFY_EXPECTED_STATE compare:', err);
              return [{ kind: 'compareError', message: String(err) }];
            }
          });
        } catch (err) {
          console.error('applyPendingUpdate failed in VERIFY_EXPECTED_STATE:', err);
        }
        break;
      }
      case 'SHOW_NEXT_CARD': {
        if (typeof this.showNextCardFn === 'function') {
          try {
            this.showNextCardFn(payload?.nextCard || null);
          } catch (err) {
            console.error('SHOW_NEXT_CARD callback failed:', err);
          }
        }
        break;
      }
      case 'WAIT': {
        const ms = payload && payload.ms ? payload.ms : this.defaultTimeout;
        await new Promise((r) => setTimeout(r, ms));
        break;
      }
      case 'COMPLETE': {
        // Finalize animations: if the animationPlayer exposes `complete`, call it
        if (this.animationPlayer && typeof this.animationPlayer.complete === 'function') {
          try {
            const p = this.animationPlayer.complete();
            // Await completion but don't let coordinator hang forever
            await this._withTimeout(Promise.resolve(p), this.defaultTimeout, abort);
          } catch {
            // ignore errors from complete
          }
        }
        break;
      }
      default: {
        console.warn('Unknown AnimationCoordinator command:', type);
      }
    }
  }
}

export default AnimationCoordinator;
