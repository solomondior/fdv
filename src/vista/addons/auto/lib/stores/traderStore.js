const KEY = 'fdv_pnl_log_v1';
const CAP = 500;

export function appendPnlEvent({ ts, mint, symbol, pnlSol, costSol, sizeFrac, reason }) {
  const log = getPnlLog();
  log.push({
    ts:       ts ?? Date.now(),
    mint:     String(mint || ''),
    symbol:   String(symbol || ''),
    pnlSol:   Number(pnlSol)   || 0,
    costSol:  Number(costSol)  || 0,
    sizeFrac: Number(sizeFrac) || 1,
    reason:   String(reason    || ''),
  });
  if (log.length > CAP) log.splice(0, log.length - CAP);
  try { localStorage.setItem(KEY, JSON.stringify(log)); } catch {}
}

export function getPnlLog() {
  try { return JSON.parse(localStorage.getItem(KEY) ?? '[]'); } catch { return []; }
}

export function clearPnlLog() {
  try { localStorage.removeItem(KEY); } catch {}
}
