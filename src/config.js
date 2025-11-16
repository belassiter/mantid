// Runtime feature flags and configuration for client behavior
// Toggle these during debugging. Default is conservative: never let server
// snapshots overwrite client-visible UI automatically.
export const ALLOW_SERVER_OVERWRITE = false; // If true, server snapshots may overwrite client state immediately
export const LOG_SERVER_DIFFS = true; // If true, diffs between client and server are logged for troubleshooting

// Future flags could include finer-grained controls (initialLoadAccept, allowWhileNotAnimating, etc.)
