# Active Positions Overview Dashboard

## Problem

The Auto tools panel has 6 tabs (Trader, Sentry, Hold, Follow, Volume, Swap) and each tab
manages its own state in isolation. When multiple bots are running simultaneously, there is
no single place to see all active positions, their P&L, and which bots are live.
Users have to click through every tab to get the full picture.

## Goal

Add an "Overview" tab (or a persistent header strip) that aggregates all active bot state:
open positions, unrealized P&L, active bot status, and a total portfolio value.

## Files to Touch

- `src/vista/addons/auto/panel.js` — add Overview tab
- `src/vista/addons/auto/lib/stores/` — expose read-only getters from each bot's store
- `src/assets/css/auto.css` — overview panel styles

## Data to Aggregate

From each bot's store, read:

| Source | Data |
|--------|------|
| Trader | Open positions, entry price, current price, unrealized PnL |
| Hold   | Up to 3 hold slots — mint, entry, current, target, stop |
| Follow | Active mirror target wallet, last copied trade |
| Sentry | Scan status (running/idle), last entry signal |

## Implementation Plan

### 1. Expose read-only store getters

Each bot's store module should export a `getSnapshot()` function:

```js
// lib/stores/traderStore.js
export function getSnapshot() {
  return {
    positions: [...openPositions],
    totalValue: calcTotalValue(),
  }
}
```

### 2. Build `overview.js` component

```js
// src/vista/addons/auto/overview.js
import { getSnapshot as traderSnap  } from './lib/stores/traderStore.js'
import { getSnapshot as holdSnap    } from './lib/stores/holdStore.js'
import { getSnapshot as followSnap  } from './lib/stores/followStore.js'
import { getSnapshot as sentrySnap  } from './lib/stores/sentryStore.js'

export function renderOverview(container) {
  const el = document.createElement('div')
  el.className = 'overview-panel'
  container.replaceChildren(el)
  refreshOverview(el)

  // Refresh every 5s
  const interval = setInterval(() => refreshOverview(el), 5_000)
  return () => clearInterval(interval)   // cleanup fn
}

function refreshOverview(el) {
  const trader = traderSnap()
  const hold   = holdSnap()
  const follow = followSnap()
  const sentry = sentrySnap()

  el.innerHTML = `
    <div class="overview-summary">
      <div class="kpi">
        <span class="label">Open Positions</span>
        <span class="value">${trader.positions.length + hold.slots.filter(Boolean).length}</span>
      </div>
      <div class="kpi">
        <span class="label">Unrealized PnL</span>
        <span class="value ${trader.unrealizedPnl >= 0 ? 'green' : 'red'}">
          ${trader.unrealizedPnl >= 0 ? '+' : ''}${trader.unrealizedPnl.toFixed(2)} SOL
        </span>
      </div>
      <div class="kpi">
        <span class="label">Bots Active</span>
        <span class="value">${countActiveBots({ trader, hold, follow, sentry })}</span>
      </div>
    </div>

    <div class="overview-positions">
      ${renderPositionRows(trader.positions)}
      ${renderHoldRows(hold.slots)}
    </div>

    <div class="overview-bots">
      ${renderBotStatus('Sentry', sentry.running)}
      ${renderBotStatus('Follow', follow.active, follow.targetWallet)}
    </div>
  `
}
```

### 3. Add Overview as first tab

```html
<button class="tab-btn active" data-tab="overview">Overview</button>
<button class="tab-btn" data-tab="trader">Trader</button>
<!-- ... existing tabs ... -->
```

### 4. Styles

```css
.overview-summary    { display: flex; gap: 24px; padding: 16px 0; }
.overview-summary .kpi { flex: 1; }
.kpi .label          { font-size: 0.7rem; color: var(--muted); display: block; }
.kpi .value          { font-size: 1.4rem; font-weight: 600; }
.overview-positions  { margin-top: 16px; }
.overview-bots       { margin-top: 16px; display: flex; gap: 12px; }
.bot-status          { padding: 6px 12px; border-radius: 4px; font-size: 0.75rem; }
.bot-status.running  { background: var(--green-dim); color: var(--green); }
.bot-status.idle     { background: var(--muted-dim); color: var(--muted); }
```

## Acceptance Criteria

- [ ] Overview tab is the first/default tab in the Auto panel
- [ ] Shows count of all open positions across all bots
- [ ] Shows total unrealized PnL in SOL (color-coded)
- [ ] Shows which bots are currently running vs idle
- [ ] Refreshes every 5 seconds without full re-render flicker
- [ ] Clicking a position row navigates to the relevant bot tab
