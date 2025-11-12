const functions = require('firebase-functions');
const admin = require('firebase-admin');

admin.initializeApp();

const db = admin.firestore();

// Export game functions
const { performAction } = require('./src/gameActions');
const { processBotTurn } = require('./src/botTrigger');

exports.performAction = performAction;
exports.processBotTurn = processBotTurn;
