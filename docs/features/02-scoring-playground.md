# Scoring Playground

## Problem

`RANK_WEIGHTS` in `src/config/env.js` is hardcoded at `{ volume: 0.35, liquidity: 0.25, momentum: 0.20, activity: 0.20 }`.
Different traders prioritize different signals: a momentum trader wants to weight momentum higher;
a liquidity-focused trader wants to up-weight liquidity. Currently the only way to change weights
is to edit source code.

## Goal

A collapsible drawer/panel on the home radar page with 4 sliders (Volume, Liquidity, Momentum,
Activity). Sliders auto-normalize so weights always sum to 100%. On any slider change the visible
card grid re-scores and re-sorts live. Weights persist in `localStorage`. A "Reset to defaults"
button restores the `env.js` defaults.

## Files to Touch

- `src/core/calculate.js` — accept optional `weights` override parameter
- `src/config/env.js` — export `RANK_WEIGHTS` (already exported), no change needed
- `src/vista/meme/page.js` — scoring playground drawer UI, slider change → re-sort
- `src/core/userWeights.js` — new file, localStorage persistence for custom weights
- `src/assets/styles/default/global.css` — drawer and slider styles

## Data Shape

```js
// localStorage key: 'fdv_rank_weights_v1'
{ volume: 0.40, liquidity: 0.20, momentum: 0.25, activity: 0.15 }
// null / missing = use RANK_WEIGHTS defaults
```

## Implementation Plan

### 1. Create `src/core/userWeights.js`

```js
import { RANK_WEIGHTS } from '../config/env.js';
const KEY = 'fdv_rank_weights_v1';

export function loadWeights() {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY));
    if (saved && typeof saved === 'object') return _normalize(saved);
  } catch {}
  return null; // null = use defaults
}

export function saveWeights(raw) {
  const w = _normalize(raw);
  try { localStorage.setItem(KEY, JSON.stringify(w)); } catch {}
  return w;
}

export function clearWeights() {
  try { localStorage.removeItem(KEY); } catch {}
}

function _normalize(raw) {
  const keys = ['volume', 'liquidity', 'momentum', 'activity'];
  const vals = keys.map(k => Math.max(0, Number(raw[k]) || 0));
  const sum = vals.reduce((a, b) => a + b, 0) || 1;
  return Object.fromEntries(keys.map((k, i) => [k, vals[i] / sum]));
}
```

### 2. Modify `calculate.js` — accept weight override

```js
// Before:
let score =
    RANK_WEIGHTS.volume    * nVol +
    RANK_WEIGHTS.liquidity * nLiq +
    RANK_WEIGHTS.momentum  * nMom +
    RANK_WEIGHTS.activity  * nAct;

// After: scoreAndRecommendOne(r, { weights } = {})
const W = weights ?? RANK_WEIGHTS;
let score =
    W.volume    * nVol +
    W.liquidity * nLiq +
    W.momentum  * nMom +
    W.activity  * nAct;
```

Signature change: `export function scoreAndRecommendOne(r, { weights } = {})`.
All existing call sites pass no second arg → `weights` is undefined → falls back to `RANK_WEIGHTS`.
No breaking change.

### 3. Pass custom weights through the scoring pipeline

In `src/vista/meme/page.js`, wherever `scoreAndRecommendOne` is called:

```js
import { loadWeights } from '../../core/userWeights.js';

// Lazily read once per paint cycle:
const _customWeights = loadWeights(); // null = defaults

items.map(t => scoreAndRecommendOne(t, { weights: _customWeights }))
```

### 4. Build the scoring playground drawer

Inject a `<details class="fdv-score-playground">` element in the home page header area,
below the sort controls. Closed by default, labelled "⚗ Scoring".

Inside, 4 slider rows:

```html
<div class="fdv-sp-row">
  <label>Volume <span data-sp-pct="volume">35%</span></label>
  <input type="range" min="0" max="100" step="1" data-sp-slider="volume" value="35">
</div>
<!-- repeat for liquidity, momentum, activity -->
<button data-sp-reset>Reset to defaults</button>
```

On `input` event on any slider:
1. Read all 4 slider raw values.
2. Normalize to sum = 100.
3. Update the `%` label for each slider to the normalized value.
4. `saveWeights(rawValues)`.
5. `schedulePaint()` (triggers immediate re-sort with new weights).

On page load, hydrate sliders from `loadWeights()` (or defaults if null).

On "Reset": call `clearWeights()`, reset all sliders to `RANK_WEIGHTS` defaults, `schedulePaint()`.

### 5. Styles

```css
.fdv-score-playground { margin: 8px 0; }
.fdv-score-playground summary { cursor: pointer; font-size: 0.82rem;
  color: var(--muted); user-select: none; }
.fdv-sp-row { display: flex; align-items: center; gap: 8px;
  font-size: 0.78rem; padding: 4px 0; }
.fdv-sp-row label { width: 110px; flex-shrink: 0; }
.fdv-sp-row input[type=range] { flex: 1; accent-color: var(--accent); }
```

## Acceptance Criteria

- [ ] Scoring Playground drawer is collapsed by default and opens on click
- [ ] 4 sliders auto-normalize: moving one slider redistributes the others' displays
- [ ] Grid re-sorts live (≤200ms) on any slider change
- [ ] Custom weights persist across page refreshes
- [ ] "Reset to defaults" restores `RANK_WEIGHTS` and live re-sorts
- [ ] All existing `scoreAndRecommendOne` call sites are unaffected (backwards compatible)
- [ ] No change to the actual `RANK_WEIGHTS` constant in `env.js`
