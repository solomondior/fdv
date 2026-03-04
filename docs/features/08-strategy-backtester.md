# Strategy Backtester

## Problem

The sell policy pipeline has 17 policies with many tuneable parameters. There is no way
to know offline which policy combination would have worked best on historical data without
actually running the bot live and losing money. The `tools/snapshots/` directory already
contains saved position snapshots. This data can be replayed.

## Goal

A browser-based backtester that loads snapshot data, lets the user select which sell policies
to activate, simulates the exit pipeline against each snapshot tick-by-tick, and reports
PnL, win rate, avg hold time, and max drawdown. Compare up to 3 strategy combos side by side.

## Files to Touch

- `src/vista/addons/backtester/sim.js` — new file, replay engine
- `src/vista/addons/backtester/page.js` — new file, backtester UI
- `src/vista/addons/auto/lib/sell/policies/registry.js` — already exists, used by sim
- `src/vista/addons/loader.js` — register backtester addon
- `src/assets/styles/default/global.css` — backtester styles

## Data Shape

```js
// Snapshot file format (from tools/snapshots/):
// Each snapshot is a JSON array of position ticks:
[
  {
    ts:        1700000000000,
    mint:      'AbC123...',
    symbol:    'PEPE',
    costSol:   0.05,
    sizeUi:    1_200_000,
    priceUsd:  0.000042,
    hwmPx:     0.000048,
    pnlPct:    -12.5,
    // ... other position fields
  }
]

// Backtest result per strategy combo:
{
  policies:    ['preflight', 'urgentSell', 'fastExit', 'execute'],
  trades:      [{ mint, pnlSol, holdMs, exitReason }],
  totalPnlSol: 0.034,
  winRate:     0.62,
  avgHoldMs:   45_000,
  maxDrawdown: -0.018,
}
```

## Implementation Plan

### 1. Create `src/vista/addons/backtester/sim.js`

The replay engine receives a snapshot array and a policy list, then simulates the
pipeline against each tick:

```js
import { getRegisteredPolicies } from '../auto/lib/sell/policies/registry.js';

export function runBacktest(ticks, { activePolicies, params = {} }) {
  // Each "tick" is one price update for a position.
  // We simulate holding from tick[0] until a policy says sell.

  const results = [];
  let position = null;

  for (const tick of ticks) {
    if (!position) {
      // Entry: first tick = buy
      position = { ...tick, entryTs: tick.ts, entryCost: tick.costSol };
      continue;
    }

    // Build a minimal context object that policies can read
    const ctx = {
      position: { ...position, ...tick },
      decision: null,     // policies set this
      forceFlags: {},
    };

    // Run active policies in priority order
    const policies = getRegisteredPolicies()
      .filter(p => activePolicies.includes(p.name));

    // Policies are factories in real code; for backtesting we call a simplified
    // stateless evaluate(ctx, params) that each policy exports.
    for (const p of policies) {
      if (p.simulateFn) p.simulateFn(ctx, params);
      if (ctx.decision) break;
    }

    if (ctx.decision) {
      const pnlSol = (tick.priceUsd / position.entryPx - 1) * position.entryCost;
      results.push({
        mint:       position.mint,
        symbol:     position.symbol,
        pnlSol,
        holdMs:     tick.ts - position.entryTs,
        exitReason: ctx.decision,
      });
      position = null; // closed
    }
  }

  return _summarize(results);
}

function _summarize(trades) {
  if (!trades.length) return { trades, totalPnlSol: 0, winRate: 0, avgHoldMs: 0, maxDrawdown: 0 };
  const totalPnlSol = trades.reduce((s, t) => s + t.pnlSol, 0);
  const winners = trades.filter(t => t.pnlSol > 0).length;
  const winRate = winners / trades.length;
  const avgHoldMs = trades.reduce((s, t) => s + t.holdMs, 0) / trades.length;
  let peak = 0, maxDrawdown = 0, cum = 0;
  for (const t of trades) {
    cum += t.pnlSol;
    if (cum > peak) peak = cum;
    maxDrawdown = Math.min(maxDrawdown, cum - peak);
  }
  return { trades, totalPnlSol, winRate, avgHoldMs, maxDrawdown };
}
```

**Note on policy compatibility:** Real sell policies are stateful factories (`createXxxPolicy(deps)`).
For backtesting, each policy that wants to support simulation should export a stateless
`simulateFn(ctx, params)` alongside its factory. Policies without `simulateFn` are skipped
during backtesting (not applied). This avoids rewriting the live pipeline.

### 2. Snapshot loading

Snapshots live in `tools/snapshots/` as static JSON files. In the browser, fetch them
relative to the origin:

```js
export async function loadSnapshot(filename) {
  const res = await fetch(`/tools/snapshots/${filename}`);
  if (!res.ok) throw new Error(`Snapshot not found: ${filename}`);
  return res.json();
}

export async function listSnapshots() {
  // Fetch a manifest file: /tools/snapshots/manifest.json
  // [ "snapshot-2024-01-01.json", ... ]
  const res = await fetch('/tools/snapshots/manifest.json');
  return res.ok ? res.json() : [];
}
```

A `tools/snapshots/manifest.json` file must be maintained (or generated by a build script).

### 3. Create `src/vista/addons/backtester/page.js`

**Layout:**

```
[Snapshot: snapshot-2024-01-01.json ▾]   [+ Add Combo]

Combo 1                          Combo 2
Policies:                        Policies:
[x] preflight  [ ] leaderMode   [x] preflight  [x] urgentSell
[x] fastExit   [x] execute      [x] fastExit   [x] execute
                                 [x] observer

[Run Backtest]

Results:
          Combo 1    Combo 2
Total PnL  +0.034     +0.041
Win Rate   62%        70%
Avg Hold   45s        38s
Max DD     -0.018     -0.009
Trades     18         22
```

Policy checkboxes are populated from `getRegisteredPolicies()`.
`execute` is always forced on (the terminal policy must be present).

### 4. Register in `loader.js`

Add `backtester` tab with a 📊 icon.

### 5. Styles

```css
.fdv-bt-combos { display: flex; gap: 16px; flex-wrap: wrap; margin: 12px 0; }
.fdv-bt-combo  { flex: 1; min-width: 200px; border: 1px solid var(--border);
  border-radius: 6px; padding: 10px; }
.fdv-bt-policy-list { display: flex; flex-direction: column; gap: 4px;
  font-size: 0.78rem; max-height: 200px; overflow-y: auto; }
.fdv-bt-results { margin-top: 16px; }
.fdv-bt-results table { width: 100%; border-collapse: collapse; font-size: 0.82rem; }
.fdv-bt-results th, .fdv-bt-results td { padding: 6px 10px;
  border-bottom: 1px solid var(--border); }
.fdv-bt-results .pos { color: #22c55e; }
.fdv-bt-results .neg { color: #ef4444; }
```

## Acceptance Criteria

- [ ] User can select a snapshot file from the manifest
- [ ] User can configure up to 3 policy combos by checking/unchecking policies
- [ ] "Run Backtest" replays the snapshot through each combo and shows results side by side
- [ ] Results show: total PnL, win rate, avg hold time, max drawdown, trade count
- [ ] `execute` policy is always included and cannot be unchecked
- [ ] Policies without a `simulateFn` are shown greyed out with "(live only)" label
- [ ] Backtest runs synchronously in the main thread (snapshots are small JSON); no worker needed
- [ ] Results update immediately when the user changes combo policies and re-runs
