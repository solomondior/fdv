# Portfolio P&L Timeline

## Problem

The Overview tab shows a single "Money Made" KPI number but gives no historical context.
There is no way to see whether profits are trending up or down, which sessions were profitable,
or whether a recent strategy change is helping. Users have to keep mental notes.

## Goal

A candlestick-free, minimal line chart in the Overview tab that shows cumulative realized SOL
PnL over wall-clock time. One KPI chip above the chart shows total realized PnL for the
current session. No third-party charting library — pure `<canvas>`.

## Files to Touch

- `src/vista/addons/auto/lib/stores/traderStore.js` — new file, persist closed trade events
- `src/vista/addons/auto/overview.js` — add chart panel, read from traderStore
- `src/assets/styles/default/global.css` — chart container styles

## Data Shape

```js
// localStorage key: 'fdv_pnl_log_v1'
// append-only array, capped at 500 entries
[
  {
    ts:        1700000000000,  // wall-clock ms
    mint:      'AbC123...',
    symbol:    'PEPE',
    pnlSol:    0.012,          // realized SOL for this close (negative = loss)
    costSol:   0.05,
    sizeFrac:  1.0,            // 1.0 = full close, 0.5 = partial
    reason:    'takeProfit',   // sell reason string from executeSellDecision
  }
]
```

## Implementation Plan

### 1. Create `src/vista/addons/auto/lib/stores/traderStore.js`

```js
const KEY = 'fdv_pnl_log_v1';
const CAP = 500;

export function appendPnlEvent({ ts, mint, symbol, pnlSol, costSol, sizeFrac, reason }) {
  const log = getPnlLog();
  log.push({ ts: ts ?? Date.now(), mint, symbol,
    pnlSol: Number(pnlSol) || 0,
    costSol: Number(costSol) || 0,
    sizeFrac: Number(sizeFrac) || 1,
    reason: reason || '',
  });
  // keep newest CAP entries
  if (log.length > CAP) log.splice(0, log.length - CAP);
  try { localStorage.setItem(KEY, JSON.stringify(log)); } catch {}
}

export function getPnlLog() {
  try { return JSON.parse(localStorage.getItem(KEY) ?? '[]'); } catch { return []; }
}

export function clearPnlLog() {
  try { localStorage.removeItem(KEY); } catch {}
}
```

### 2. Hook into `executeSellDecisionPolicy`

In `src/vista/addons/auto/lib/sell/policies/executeSellDecision.js`, after a confirmed sell,
call `appendPnlEvent(...)`. Import from `traderStore.js`. Pass `reason` from the sell context.

This is a read-once at close, no tick overhead.

### 3. Add chart to `overview.js`

Add a `<canvas id="fdv-pnl-chart">` section below the KPI chips. In `_refresh(el)`:

```js
function _drawChart(canvas, log) {
  if (!log.length) { /* show "No trades yet" placeholder */ return; }
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);

  // Build cumulative series
  let cum = 0;
  const points = log.map(e => { cum += e.pnlSol; return cum; });
  const minY = Math.min(0, ...points);
  const maxY = Math.max(0, ...points);
  const range = maxY - minY || 1;

  const toX = i => (i / (points.length - 1 || 1)) * W;
  const toY = v => H - ((v - minY) / range) * H * 0.85 - H * 0.075;

  // Zero line
  ctx.strokeStyle = 'rgba(255,255,255,0.12)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  const zy = toY(0);
  ctx.moveTo(0, zy); ctx.lineTo(W, zy);
  ctx.stroke();

  // PnL line (green above zero, red below)
  const lastIsPos = points[points.length - 1] >= 0;
  ctx.strokeStyle = lastIsPos ? '#22c55e' : '#ef4444';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  points.forEach((v, i) => i === 0 ? ctx.moveTo(toX(i), toY(v)) : ctx.lineTo(toX(i), toY(v)));
  ctx.stroke();
}
```

### 4. KPI chip — total session PnL

Above the chart, compute session PnL from the log filtered to `ts >= sessionStartTs`.
`sessionStartTs` is read from the auto trader state (`state.startedAt` or similar).

```js
const sessionPnl = log
  .filter(e => e.ts >= sessionStart)
  .reduce((s, e) => s + e.pnlSol, 0);
```

Display as: `Session PnL: +0.031 SOL` in a green/red KPI chip.

### 5. Styles

```css
.fdv-pnl-chart-wrap { margin-top: 12px; }
.fdv-pnl-chart-wrap canvas { width: 100%; height: 80px; border-radius: 6px;
  background: rgba(255,255,255,0.03); display: block; }
.fdv-pnl-chart-empty { text-align: center; padding: 24px 0;
  font-size: 0.78rem; color: var(--muted); }
```

## Acceptance Criteria

- [ ] Closed position events are persisted to `fdv_pnl_log_v1` on every confirmed sell
- [ ] Overview tab displays a cumulative PnL line chart
- [ ] Chart updates within 5s of a close (next overview refresh tick)
- [ ] Zero-trade state shows "No trades yet" placeholder
- [ ] Session PnL KPI chip above chart shows +/- SOL for current session only
- [ ] Log is capped at 500 entries; oldest are pruned automatically
- [ ] Chart works without any external library (pure canvas)
