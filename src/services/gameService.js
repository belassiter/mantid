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
export const performAction = async (gameId, action, targetPlayerId = null) => {
  const performActionFn = httpsCallable(functions, 'performAction');
  
  try {
    const result = await performActionFn({
      gameId,
      action,
      ...(targetPlayerId && { targetPlayerId })
    });
    
    return result.data;
  } catch (error) {
    console.error('Action failed:', error);
    throw new Error(error.message || 'Failed to perform action');
  }
};

/**
 * Perform score action
 */
export const performScore = async (gameId) => {
  return performAction(gameId, 'score');
};

/**
 * Perform steal action
 */
export const performSteal = async (gameId, targetPlayerId) => {
  return performAction(gameId, 'steal', targetPlayerId);
};
