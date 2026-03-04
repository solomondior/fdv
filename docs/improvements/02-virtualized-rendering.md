# Virtualized Token Grid Rendering

## Problem

The home radar hard-caps at 21 tokens and renders all of them as real DOM nodes at once.
As the pipeline grows or users want to see more tokens, this becomes a DOM bloat problem.
Scrolling through 50–100 tokens with live-updating stats will cause noticeable jank.

## Goal

Render only the visible rows in the token grid. Allow the cap to be raised (e.g. 50–100 tokens)
without degrading scroll performance.

## Files to Touch

- `src/vista/meme/page.js` — token grid rendering logic
- `src/config/env.js` — raise `MAX_TOKENS` constant
- `src/assets/css/meme.css` (or equivalent) — fixed row heights required for virtualization

## Implementation Plan

### 1. Raise the token cap

```js
// env.js
export const MAX_TOKENS = 100  // was 21
```

### 2. Measure row height

All token rows must be fixed height for virtualization math to work.
Pick a constant (e.g. `72px`) and enforce it in CSS:

```css
.token-row {
  height: 72px;
  overflow: hidden;
  contain: strict;
}
```

### 3. Implement a lightweight virtualizer

No library needed — ~60 lines of vanilla JS:

```js
class VirtualList {
  constructor({ container, rowHeight, renderRow }) {
    this.container = container
    this.rowHeight = rowHeight
    this.renderRow = renderRow
    this.items = []
    this.scrollTop = 0

    // Outer: clips, scrollable
    this.outer = Object.assign(document.createElement('div'), {
      style: 'overflow-y:auto; height:100%; position:relative;'
    })
    // Inner: full virtual height (spacer)
    this.inner = Object.assign(document.createElement('div'), { style: 'position:relative;' })
    this.outer.appendChild(this.inner)
    container.appendChild(this.outer)

    this.outer.addEventListener('scroll', () => this._onScroll(), { passive: true })
  }

  setItems(items) {
    this.items = items
    this.inner.style.height = `${items.length * this.rowHeight}px`
    this._render()
  }

  _onScroll() {
    this.scrollTop = this.outer.scrollTop
    this._render()
  }

  _render() {
    const viewportH = this.outer.clientHeight
    const start = Math.max(0, Math.floor(this.scrollTop / this.rowHeight) - 2)
    const end   = Math.min(this.items.length, Math.ceil((this.scrollTop + viewportH) / this.rowHeight) + 2)

    this.inner.innerHTML = ''
    for (let i = start; i < end; i++) {
      const el = this.renderRow(this.items[i], i)
      el.style.position = 'absolute'
      el.style.top = `${i * this.rowHeight}px`
      el.style.width = '100%'
      this.inner.appendChild(el)
    }
  }
}
```

### 4. Plug into `page.js`

Replace the existing `tokens.forEach(renderRow)` loop with `virtualList.setItems(tokens)`.
On each pipeline update, call `setItems` again with the new sorted array — the virtualizer
only re-renders the visible window.

## Acceptance Criteria

- [ ] 100 tokens can be loaded without measurable scroll lag
- [ ] Only the visible rows (+2 buffer above/below) exist in the DOM at any time
- [ ] Live stat updates (price, score) still work for visible rows
- [ ] Mobile scroll feels native (no janky repaints)
