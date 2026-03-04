# Manual Reconcile Trigger

## Problem

The pending credits reconciliation in `src/vista/addons/auto/lib/pendingCredits.js` runs
automatically but users have no way to force a sync without doing a full page refresh.
After an RPC hiccup or a failed swap, positions can show stale balances until the next
auto-reconcile cycle fires. Users are left guessing whether their trade actually landed.

## Goal

Add a "Reconcile Now" button to the Auto tools panel that immediately triggers the
reconciliation flow and shows a brief status message (success / what changed).

## Files to Touch

- `src/vista/addons/auto/lib/pendingCredits.js` — expose a `reconcileNow()` export
- `src/vista/addons/auto/panel.js` (or the relevant tab UI file) — add button + handler
- `src/assets/css/auto.css` — button styles

## Implementation Plan

### 1. Export `reconcileNow` from `pendingCredits.js`

The existing auto-reconcile logic should already do the heavy lifting.
Wrap it in a named export:

```js
// pendingCredits.js
export async function reconcileNow() {
  const before = snapshot()         // capture state before
  await runReconciliation()         // existing internal fn
  const after  = snapshot()
  return diff(before, after)        // return what changed
}

function snapshot() {
  // return current pending credits state as plain object
}

function diff(before, after) {
  // return { settled: [...], adjusted: [...], unchanged: number }
}
```

### 2. Add button to the panel UI

In the relevant auto-panel tab (Trader or Hold), add:

```html
<button id="reconcile-btn" class="btn-ghost btn-sm">
  Reconcile
</button>
<span id="reconcile-status" class="reconcile-status"></span>
```

### 3. Wire up the handler

```js
import { reconcileNow } from '../lib/pendingCredits.js'

document.getElementById('reconcile-btn').addEventListener('click', async () => {
  const btn    = document.getElementById('reconcile-btn')
  const status = document.getElementById('reconcile-status')

  btn.disabled = true
  btn.textContent = 'Reconciling…'

  try {
    const result = await reconcileNow()
    const msg = result.settled.length
      ? `Settled ${result.settled.length} pending credit(s)`
      : 'All credits up to date'
    status.textContent = msg
    status.className = 'reconcile-status ok'
  } catch (err) {
    status.textContent = `Error: ${err.message}`
    status.className = 'reconcile-status err'
  } finally {
    btn.disabled = false
    btn.textContent = 'Reconcile'
    setTimeout(() => { status.textContent = '' }, 4000)
  }
})
```

### 4. Styles

```css
.reconcile-status        { font-size: 0.75rem; margin-left: 8px; opacity: 0.8; }
.reconcile-status.ok     { color: var(--green); }
.reconcile-status.err    { color: var(--red);   }
```

## Acceptance Criteria

- [ ] Button appears in the Auto panel (Trader tab)
- [ ] Clicking triggers reconciliation immediately
- [ ] Button is disabled and shows "Reconciling…" while running
- [ ] Success shows a plain-english summary of what changed
- [ ] Errors show a readable message (not a raw exception)
- [ ] Status message auto-clears after 4 seconds
- [ ] No regression to the existing auto-reconcile cycle
