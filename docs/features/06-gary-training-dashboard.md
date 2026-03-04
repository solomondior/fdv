# Agent Gary Training Dashboard

## Problem

`src/agents/training.js` already silently captures every Agent Gary buy/sell decision
into IndexedDB (`fdv_training_v1` store, `captures` object store). These captures contain
the full signals payload, the agent's decision, and the outcome. However there is no UI
to see, label, or export this data. The captures accumulate invisibly and can only be
accessed by opening DevTools.

## Goal

A dedicated Training Dashboard addon panel that reads all captures from IndexedDB,
lets users label each decision as Good / Bad / Skip, filters by date/type/labeled status,
and exports labeled rows as JSONL in the OpenAI fine-tuning format. Shows aggregate stats:
total captures, labeled %, good/bad ratio.

## Files to Touch

- `src/agents/training.js` — add `getAllCaptures()` and `saveLabel()` exports
- `src/vista/addons/training/page.js` — new file, dashboard UI
- `src/vista/addons/loader.js` — register training addon
- `src/assets/styles/default/global.css` — dashboard styles

## Data Shape

```js
// Existing IndexedDB record shape (from training.js):
{
  id:         1,                // auto-increment IDB key
  storageKey: 'fdv_gary_train', // discriminator per bot type
  ts:         1700000000000,
  decision:   'buy' | 'skip' | 'sell_all' | 'hold' | ...,
  signals:    { /* rich KPI/context object Gary received */ },
  outcome:    { /* populated later with realized PnL, hold time, etc. */ },
  label:      null,             // null | 'good' | 'bad' | 'skip'
  labeledAt:  null,
}
```

## Implementation Plan

### 1. Add read + label exports to `src/agents/training.js`

The IndexedDB schema already has a `by_storageKey` index. Add two async exports:

```js
export async function getAllCaptures({ storageKey } = {}) {
  // If storageKey provided, use by_storageKey index; else scan all.
  // Returns array of records sorted by ts descending.
}

export async function saveLabel(id, label) {
  // Open IDB, update record by id, set label + labeledAt = Date.now().
  // label: 'good' | 'bad' | 'skip' | null (to clear)
}

export async function deleteCapture(id) {
  // Remove a single record by id.
}
```

Implementation pattern mirrors `_openDb()` and `_idbAddCapture()` already in the file.

### 2. Create `src/vista/addons/training/page.js`

**Layout:**
```
Stats bar: [Total: 142] [Labeled: 38 (27%)] [Good: 29] [Bad: 9] [Unlabeled: 104]
Filters:   [All types ▾] [All labels ▾] [Date from ___] [Date to ___]
[Export JSONL]

Table:
Timestamp | Bot | Decision | Outcome PnL | Label     | Actions
...       | GA  | buy      | +0.012 SOL  | [G][B][S] | [×]
```

**JSONL export** — OpenAI fine-tuning format:
```js
function _toFineTuneRecord(capture) {
  return JSON.stringify({
    messages: [
      { role: 'system', content: _systemPrompt(capture) },
      { role: 'user',   content: JSON.stringify(capture.signals) },
      { role: 'assistant', content: JSON.stringify({ action: capture.decision, label: capture.label }) },
    ]
  });
}
```

Only export records where `label === 'good' || label === 'bad'` (skip "skip"-labeled rows).

On "Export JSONL":
```js
const labeled = captures.filter(c => c.label === 'good' || c.label === 'bad');
const blob = new Blob(labeled.map(_toFineTuneRecord).map(l => l + '\n'), { type: 'application/jsonl' });
const a = Object.assign(document.createElement('a'), {
  href: URL.createObjectURL(blob), download: 'gary-finetune.jsonl'
});
a.click(); URL.revokeObjectURL(a.href);
```

**Pagination:** Show 50 records at a time with Previous / Next controls.
Loading all IndexedDB records into memory is acceptable (max cap is a few thousand).

### 3. Register in `loader.js`

Add `training` tab with a 🧠 icon. Only render if `TRAINING_CAPTURE` flag is truthy
(from `src/config/env.js`) to avoid showing an empty panel when training is disabled.

### 4. Styles

```css
.fdv-train-stats { display: flex; gap: 12px; margin-bottom: 12px;
  font-size: 0.78rem; flex-wrap: wrap; }
.fdv-train-stat  { background: var(--card-bg); padding: 4px 10px;
  border-radius: 4px; border: 1px solid var(--border); }
.fdv-train-table { width: 100%; border-collapse: collapse; font-size: 0.78rem; }
.fdv-train-table th { text-align: left; padding: 4px 8px;
  border-bottom: 2px solid var(--border); color: var(--muted); }
.fdv-train-table td { padding: 4px 8px; border-bottom: 1px solid var(--border); }
.fdv-label-btns  { display: flex; gap: 4px; }
.fdv-label-btn   { padding: 2px 6px; border-radius: 3px; border: 1px solid var(--border);
  cursor: pointer; font-size: 0.72rem; }
.fdv-label-btn.good   { background: rgba(34,197,94,0.15); color: #22c55e; }
.fdv-label-btn.bad    { background: rgba(239,68,68,0.15);  color: #ef4444; }
.fdv-label-btn.skip   { background: rgba(255,255,255,0.05); color: var(--muted); }
.fdv-label-btn.active { border-color: currentColor; }
```

## Acceptance Criteria

- [ ] Dashboard loads all captures from IndexedDB on open
- [ ] Stats bar shows total / labeled % / good / bad / unlabeled counts
- [ ] User can label each row Good / Bad / Skip; label persists in IndexedDB immediately
- [ ] Filters by: bot type (storageKey), label status, date range
- [ ] "Export JSONL" downloads only good+bad labeled rows in OpenAI fine-tune format
- [ ] Pagination works for large capture sets (50 per page)
- [ ] Panel only renders when `TRAINING_CAPTURE` is enabled
- [ ] Delete button removes a capture from IndexedDB and re-renders the table
