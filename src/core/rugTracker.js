const KEY = 'fdv_rug_events_v1';
const CAP = 1000;
const RUG_DROP_PCT = -80;     // ≤ -80% within window = rug
const WINDOW_MS = 60 * 60_000; // 1-hour detection window

// In-memory first-seen registry — cleared on page load (intentional)
const _firstSeen = new Map(); // mint → { firstSeenAt, firstPrice, symbol }

export function trackPrices(items) {
  const now = Date.now();
  for (const t of items) {
    if (!t.mint || t.priceUsd == null) continue;
    const price = +t.priceUsd;
    if (!Number.isFinite(price) || price <= 0) continue;

    if (!_firstSeen.has(t.mint)) {
      _firstSeen.set(t.mint, {
        firstSeenAt: now,
        firstPrice: price,
        symbol: t.symbol || '',
      });
      continue;
    }

    const entry = _firstSeen.get(t.mint);
    if (now - entry.firstSeenAt > WINDOW_MS) continue; // outside window
    if (entry.firstPrice <= 0) continue;

    const dropPct = ((price - entry.firstPrice) / entry.firstPrice) * 100;
    if (dropPct <= RUG_DROP_PCT) {
      _recordRug({ mint: t.mint, symbol: entry.symbol, ts: now, dropPct });
      _firstSeen.delete(t.mint); // prevent double-recording
    }
  }

  // Prune stale entries so the map stays bounded
  for (const [mint, entry] of _firstSeen) {
    if (now - entry.firstSeenAt > WINDOW_MS * 2) _firstSeen.delete(mint);
  }
}

function _recordRug({ mint, symbol, ts, dropPct }) {
  const d = new Date(ts);
  const event = {
    mint,
    symbol,
    hour:      d.getUTCHours(),
    dayOfWeek: d.getUTCDay(),
    ts,
    dropPct: Math.round(dropPct * 10) / 10,
  };
  const log = getRugEvents();
  log.push(event);
  if (log.length > CAP) log.splice(0, log.length - CAP);
  try { localStorage.setItem(KEY, JSON.stringify(log)); } catch {}
  try {
    window.dispatchEvent(new CustomEvent('fdv:rug-recorded', { detail: event }));
  } catch {}
}

export function getRugEvents() {
  try { return JSON.parse(localStorage.getItem(KEY) ?? '[]'); } catch { return []; }
}

export function clearRugEvents() {
  try { localStorage.removeItem(KEY); } catch {}
}
