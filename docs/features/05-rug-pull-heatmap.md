# Rug Pull Heatmap

## Problem

Rug pulls on Solana memecoins are not uniformly distributed across time.
There are known hot windows (e.g. weekends, off-hours UTC) where low-liquidity tokens
get dumped. The existing pipeline detects rugs per-token but has no memory across sessions.
Traders have no data to answer "when should I be most careful?"

## Goal

Track every token that drops >80% within 1 hour of first appearing in the pipeline and
classify it as a rug event. Persist rug events in localStorage with time metadata.
Render a 7×24 heatmap grid (day-of-week × hour-of-day UTC) in a new Heatmap addon panel.
Each cell is colored by rug frequency. Hover shows "X rugs this slot."

## Files to Touch

- `src/core/rugTracker.js` — new file, rug event store + classification hook
- `src/router/main/home.js` — call rugTracker on each pipeline update
- `src/vista/addons/heatmap/page.js` — new file, heatmap UI
- `src/vista/addons/loader.js` — register heatmap addon
- `src/assets/styles/default/global.css` — heatmap styles

## Data Shape

```js
// localStorage key: 'fdv_rug_events_v1'
// append-only, capped at 1000 entries
[
  {
    mint:      'AbC123...',
    symbol:    'PEPE',
    hour:      2,           // UTC hour 0–23
    dayOfWeek: 0,           // 0 = Sunday … 6 = Saturday
    ts:        1700000000000,
    dropPct:   -92.5,       // price drop % within the detection window
  }
]
```

## Implementation Plan

### 1. Create `src/core/rugTracker.js`

```js
const KEY = 'fdv_rug_events_v1';
const CAP = 1000;
const RUG_DROP_PCT = -80;    // threshold: drop of 80%+ = rug
const WINDOW_MS = 60 * 60_000; // 1 hour detection window

// Track first-seen price per mint: { mint: { firstSeenAt, firstPrice } }
const _firstSeen = new Map();

export function trackPrices(items) {
  const now = Date.now();
  for (const t of items) {
    if (!t.mint || t.priceUsd == null) continue;
    const price = +t.priceUsd;
    if (!_firstSeen.has(t.mint)) {
      _firstSeen.set(t.mint, { firstSeenAt: now, firstPrice: price, symbol: t.symbol || '' });
      continue;
    }
    const entry = _firstSeen.get(t.mint);
    if (now - entry.firstSeenAt > WINDOW_MS) continue; // outside window, stop watching
    if (entry.firstPrice <= 0) continue;
    const dropPct = ((price - entry.firstPrice) / entry.firstPrice) * 100;
    if (dropPct <= RUG_DROP_PCT) {
      _recordRug({ mint: t.mint, symbol: entry.symbol, ts: now, dropPct });
      _firstSeen.delete(t.mint); // don't double-record
    }
  }
  // Prune entries past the window to keep the map bounded
  for (const [mint, entry] of _firstSeen) {
    if (now - entry.firstSeenAt > WINDOW_MS * 2) _firstSeen.delete(mint);
  }
}

function _recordRug({ mint, symbol, ts, dropPct }) {
  const d = new Date(ts);
  const event = {
    mint, symbol,
    hour: d.getUTCHours(),
    dayOfWeek: d.getUTCDay(),
    ts, dropPct: Math.round(dropPct * 10) / 10,
  };
  const log = getRugEvents();
  log.push(event);
  if (log.length > CAP) log.splice(0, log.length - CAP);
  try { localStorage.setItem(KEY, JSON.stringify(log)); } catch {}
}

export function getRugEvents() {
  try { return JSON.parse(localStorage.getItem(KEY) ?? '[]'); } catch { return []; }
}

export function clearRugEvents() {
  try { localStorage.removeItem(KEY); } catch {}
}
```

### 2. Hook into `home.js`

```js
import { trackPrices } from '../../core/rugTracker.js';

// Inside onUpdate(items):
try { trackPrices(items); } catch {}
```

Runs on every pipeline tick. `trackPrices` is fast (Map lookups, no async).

### 3. Create `src/vista/addons/heatmap/page.js`

Build a 7 (days) × 24 (hours) grid using CSS grid:

```js
const DAYS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

function _buildGrid(events) {
  // counts[day][hour] = number of rug events
  const counts = Array.from({ length: 7 }, () => new Array(24).fill(0));
  for (const e of events) counts[e.dayOfWeek][e.hour]++;
  return counts;
}

function _render(container, events) {
  const counts = _buildGrid(events);
  const maxCount = Math.max(1, ...counts.flat());

  container.innerHTML = '';
  // Header row: hours 0–23
  // Left column: day labels
  // Cells: colored by count/maxCount intensity
  for (let d = 0; d < 7; d++) {
    for (let h = 0; h < 24; h++) {
      const c = counts[d][h];
      const intensity = c / maxCount;
      const cell = document.createElement('div');
      cell.className = 'fdv-hm-cell';
      cell.style.setProperty('--intensity', intensity.toFixed(3));
      cell.title = `${DAYS[d]} ${String(h).padStart(2,'0')}:00 UTC — ${c} rug${c !== 1 ? 's' : ''}`;
      cell.dataset.count = c;
      container.append(cell);
    }
  }
}
```

Above the grid: summary stats — "Total rugs tracked: X | Most dangerous: {day} {hour}:00 UTC"

Below the grid: a small color legend (0 → max intensity).

### 4. Register in `loader.js`

Add `heatmap` tab to the addon registry.

### 5. Styles

```css
.fdv-hm-grid {
  display: grid;
  grid-template-columns: repeat(24, 1fr);
  gap: 2px;
  margin-top: 8px;
}
.fdv-hm-cell {
  aspect-ratio: 1;
  border-radius: 2px;
  background: color-mix(in srgb, #ef4444 calc(var(--intensity) * 100%), #1a1a2e);
  cursor: default;
  min-width: 10px;
}
.fdv-hm-cell:hover { outline: 1px solid var(--accent); }
.fdv-hm-legend { display: flex; gap: 4px; align-items: center;
  font-size: 0.72rem; color: var(--muted); margin-top: 8px; }
```

## Acceptance Criteria

- [ ] Every token dropping >80% within 1h of first appearance is recorded as a rug event
- [ ] Rug events persist in `fdv_rug_events_v1` across page refreshes (capped at 1000)
- [ ] Heatmap panel shows a 7×24 grid with color intensity proportional to rug frequency
- [ ] Tooltip on each cell shows day, hour, and rug count
- [ ] Summary shows total rugs tracked and the most dangerous time slot
- [ ] `trackPrices` does not double-record the same mint in the same window
- [ ] `trackPrices` is O(n) in the number of tokens, adds negligible overhead per tick
