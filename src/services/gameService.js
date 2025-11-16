/**
 * Game Service - Client wrapper for Cloud Functions
 * All game actions go through server now
 */

import { getFunctions, httpsCallable } from 'firebase/functions';
import { app } from '../firebase/config';

const functions = getFunctions(app, 'us-central1');
const mantidFn = httpsCallable(functions, 'mantid');

const callMantid = async (action, payload) => {
  try {
    const result = await mantidFn({ action, payload });
    return result.data;
  } catch (error) {
    console.error(`Action '${action}' failed:`, error);
    throw new Error(error.message || `Failed to perform action '${action}'`);
  }
};

/**
 * Perform a game action (score or steal)
 */
export const performAction = async (gameId, action, targetPlayerId = null, botPlayerId = null, actionId = null) => {
  const payload = {
    gameId,
    action,
    ...(targetPlayerId && { targetPlayerId }),
    ...(botPlayerId && { botPlayerId }),
    ...(actionId && { actionId })
  };
  return callMantid('performAction', payload);
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

/**
 * Signal to the server that the client has finished its turn and is ready for the next action.
 * This is used to trigger the next bot turn.
 */
export const signalClientReady = async (gameId) => {
  try {
    await callMantid('signalClientReady', { gameId });
  } catch (error) {
    // Don't re-throw, as this is not a critical user-facing error.
    // The server will eventually recover or the user can refresh.
  }
};
