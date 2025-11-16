// Lightweight comparator for game state. Returns an array of diffs (empty if none).
export function compareGameState(client, server) {
  const diffs = [];
  if (!client || !server) {
    diffs.push({ kind: 'missingState', client: !!client, server: !!server });
    return diffs;
  }

  // Draw pile length
  const clientDrawLen = Array.isArray(client.drawPile) ? client.drawPile.length : 0;
  const serverDrawLen = Array.isArray(server.drawPile) ? server.drawPile.length : 0;
  if (clientDrawLen !== serverDrawLen) {
    diffs.push({ kind: 'drawPileLength', client: clientDrawLen, server: serverDrawLen });
  }

  // Top card id (compare by id if present)
  const clientTop = client.drawPile && client.drawPile.length > 0 ? client.drawPile[client.drawPile.length - 1].id : null;
  const serverTop = server.drawPile && server.drawPile.length > 0 ? server.drawPile[server.drawPile.length - 1].id : null;
  if (clientTop !== serverTop) {
    diffs.push({ kind: 'topCardDifferent', client: clientTop, server: serverTop });
  }

  // Current player index
  if (client.currentPlayerIndex !== server.currentPlayerIndex) {
    diffs.push({ kind: 'turnMismatch', client: client.currentPlayerIndex, server: server.currentPlayerIndex });
  }

  // Players: check tank card ids and scoreCount
  const clientPlayers = client.players || [];
  const serverPlayers = server.players || [];
  const len = Math.max(clientPlayers.length, serverPlayers.length);
  for (let i = 0; i < len; i++) {
    const cp = clientPlayers[i];
    const sp = serverPlayers[i];
    if (!cp || !sp) {
      diffs.push({ kind: 'playerCountMismatch', index: i, client: !!cp, server: !!sp });
      continue;
    }

    // Score count
    if ((cp.scoreCount || 0) !== (sp.scoreCount || 0)) {
      diffs.push({ kind: 'scoreMismatch', playerIndex: i, playerId: cp.id, client: cp.scoreCount, server: sp.scoreCount });
    }

    const clientTankIds = (cp.tank || []).map(c => c.id).join(',');
    const serverTankIds = (sp.tank || []).map(c => c.id).join(',');
    if (clientTankIds !== serverTankIds) {
      diffs.push({ kind: 'tankMismatch', playerIndex: i, playerId: cp.id, client: clientTankIds, server: serverTankIds });
    }
  }

  return diffs;
}
