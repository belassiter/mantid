const functions = require('firebase-functions');
const admin = require('firebase-admin');

admin.initializeApp();

const gameActions = require('./src/gameActions');

const allowedOrigins = ['http://localhost:5173', 'https://mantid-game.web.app', 'https://mantid-game.firebaseapp.com'];

// Export all functions from gameActions via a callable function named `mantid`.
// Using onCall keeps the trigger type consistent with previous deployments.
exports.mantid = functions.region('us-central1').https.onCall(async (data, context) => {
  const { action, payload } = data || {};
  if (!action) {
    throw new functions.https.HttpsError('invalid-argument', 'Missing action');
  }

  if (gameActions[action]) {
    try {
      const result = await gameActions[action](payload, context);
      return result;
    } catch (error) {
      console.error(`Error executing action '${action}':`, error);
      throw new functions.https.HttpsError('internal', error.message || 'An internal error occurred');
    }
  }

  throw new functions.https.HttpsError('not-found', `Function ${action} not found`);
});

// The following is kept for reference, but the single entry point above is preferred
// exports.performAction = functions.region('us-central1').https.onCall(gameActions.performAction);
// exports.signalClientReady = functions.region('us-central1').https.onCall(gameActions.signalClientReady);
