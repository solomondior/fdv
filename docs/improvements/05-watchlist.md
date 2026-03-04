# Persistent Watchlist

## Problem

Users currently have no way to bookmark tokens for monitoring across sessions.
The Hold bot tracks up to 3 active positions but is for live trading, not casual observation.
If a user spots an interesting token and navigates away, they lose it.

## Goal

A lightweight watchlist (star icon on each token row) that persists in localStorage.
A dedicated "Watchlist" filter/view on the home radar shows only starred tokens,
with their live stats still updating from the pipeline.

## Files to Touch

- `src/core/watchlist.js` — new file, CRUD over localStorage
- `src/vista/meme/page.js` — add star icon to each token row
- `src/vista/meme/page.js` — add Watchlist filter tab
- `src/assets/css/meme.css` — star icon + watchlist tab styles

## Data Shape

```js
// localStorage key: 'fdv_watchlist'
// value: JSON array of mint strings
["mint1abc...", "mint2def...", ...]
```

## Implementation Plan

### 1. Create `src/core/watchlist.js`

```js
const KEY = 'fdv_watchlist'

function load() {
  try { return JSON.parse(localStorage.getItem(KEY)) ?? [] }
  catch { return [] }
}

function save(list) {
  localStorage.setItem(KEY, JSON.stringify(list))
}

export function getWatchlist() { return load() }

export function isWatched(mint) { return load().includes(mint) }

export function toggleWatch(mint) {
  const list = load()
  const next = list.includes(mint)
    ? list.filter(m => m !== mint)
    : [...list, mint]
  save(next)
  return next.includes(mint)   // returns new watched state
}

export function clearWatchlist() { save([]) }
```

### 2. Add star button to each token row

```js
// Inside renderRow(token)
const star = document.createElement('button')
star.className = `watch-star ${isWatched(token.mint) ? 'active' : ''}`
star.innerHTML = '★'
star.title = 'Add to watchlist'
star.addEventListener('click', (e) => {
  e.stopPropagation()
  const watched = toggleWatch(token.mint)
  star.classList.toggle('active', watched)
})
row.prepend(star)
```

### 3. Add Watchlist filter tab

Next to the existing sort tabs (Score / Launches / Volume / etc.), add:

```html
<button class="filter-tab" data-filter="watchlist">★ Watchlist</button>
```

When active, filter the displayed tokens to only those in the watchlist:

```js
if (activeFilter === 'watchlist') {
  const wl = getWatchlist()
  tokens = tokens.filter(t => wl.includes(t.mint))
  if (!tokens.length) showEmptyWatchlistState()
}
```

### 4. Empty state

When the watchlist filter is active but empty:

```html
<div class="empty-watchlist">
  Star any token with ★ to track it here
</div>
```

### 5. Styles

```css
.watch-star          { background: none; border: none; cursor: pointer; color: var(--muted); font-size: 1rem; }
.watch-star.active   { color: #f5c518; }
.watch-star:hover    { color: #f5c518; opacity: 0.7; }
.empty-watchlist     { text-align: center; padding: 48px; color: var(--muted); }
```

## Acceptance Criteria

- [ ] Star icon appears on every token row
- [ ] Clicking star toggles watched state with visual feedback
- [ ] Watchlist persists across page refreshes
- [ ] Watchlist filter tab shows only starred tokens
- [ ] Watchlist tokens still receive live stat updates from the pipeline
- [ ] Empty watchlist shows a helpful hint
- [ ] Stars sync if the same mint appears in multiple views
