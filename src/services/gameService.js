/**
 * Game Service - Client wrapper for Cloud Functions
 * All game actions go through server now
 */

import { getFunctions, httpsCallable } from 'firebase/functions';
import { app } from '../firebase/config';

const functions = getFunctions(app);

/**
 * Perform a game action (score or steal)
 */
export const performAction = async (gameId, action, targetPlayerId = null, botPlayerId = null, actionId = null) => {
  const performActionFn = httpsCallable(functions, 'performAction');
  
  try {
    const payload = {
      gameId,
      action,
      ...(targetPlayerId && { targetPlayerId }),
      ...(botPlayerId && { botPlayerId }),
      ...(actionId && { actionId })
    };

    const result = await performActionFn(payload);
    return result.data;
  } catch (error) {
    console.error('Action failed:', error);
    throw new Error(error.message || 'Failed to perform action');
  }
};

/**
 * Perform score action
 */
export const performScore = async (gameId, botPlayerId = null, actionId = null) => {
  return performAction(gameId, 'score', null, botPlayerId, actionId);
};

/**
 * Perform steal action
 */
export const performSteal = async (gameId, targetPlayerId, botPlayerId = null, actionId = null) => {
  return performAction(gameId, 'steal', targetPlayerId, botPlayerId, actionId);
};
