# Shareable Trade Cards

## Problem

After closing a profitable trade, there is no easy way to share it on Twitter/CT.
Users screenshot whatever is on screen — often the raw log — which looks terrible.
A styled trade card image with clear numbers and FDV branding would be a natural
marketing touchpoint and is trivially generated via `<canvas>`.

## Goal

A "Share" button on closed positions in the Overview, Hold, and Trader panels.
Clicking it renders a styled card to `<canvas>` (green for profit, red for loss),
copies the PNG to clipboard or triggers a download. The card shows: token name/symbol,
buy price, sell price, PnL %, time held, and FDV branding.

## Files to Touch

- `src/lib/tradeCard.js` — new file, canvas renderer
- `src/vista/addons/auto/overview.js` — wire Share button on closed position rows
- `src/vista/addons/auto/hold/index.js` — wire Share button on close
- `src/assets/styles/default/global.css` — share button styles

## Data Shape

```js
// Input to the renderer:
{
  symbol:     'PEPE',
  mint:       'AbC123...',
  entryPrice: 0.0000420,
  exitPrice:  0.0000588,
  pnlPct:     40.0,
  pnlSol:     0.020,
  holdSecs:   1800,
  exitReason: 'takeProfit',   // optional label
  logoUrl:    null,           // optional: token logo URI
}
```

## Implementation Plan

### 1. Create `src/lib/tradeCard.js`

```js
const CARD_W = 540;
const CARD_H = 280;

export async function renderTradeCard(trade) {
  const canvas = document.createElement('canvas');
  canvas.width  = CARD_W * 2;   // 2x for retina
  canvas.height = CARD_H * 2;
  const ctx = canvas.getContext('2d');
  ctx.scale(2, 2);

  const isProfit = trade.pnlPct >= 0;
  const bg      = isProfit ? '#0a1a0f' : '#1a0a0a';
  const accent  = isProfit ? '#22c55e' : '#ef4444';
  const pnlStr  = `${isProfit ? '+' : ''}${trade.pnlPct.toFixed(1)}%`;

  // Background
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, CARD_W, CARD_H);

  // Accent left bar
  ctx.fillStyle = accent;
  ctx.fillRect(0, 0, 4, CARD_H);

  // Token logo (if available)
  if (trade.logoUrl) {
    try {
      const img = await _loadImage(trade.logoUrl);
      ctx.save();
      ctx.beginPath();
      ctx.arc(48, 52, 28, 0, Math.PI * 2);
      ctx.clip();
      ctx.drawImage(img, 20, 24, 56, 56);
      ctx.restore();
    } catch {}
  }

  const logoOffset = trade.logoUrl ? 90 : 24;

  // Symbol
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 28px system-ui, sans-serif';
  ctx.fillText(`$${trade.symbol}`, logoOffset, 56);

  // PnL % — large, colored
  ctx.fillStyle = accent;
  ctx.font = 'bold 52px system-ui, sans-serif';
  ctx.fillText(pnlStr, 24, 140);

  // Secondary stats
  ctx.fillStyle = 'rgba(255,255,255,0.6)';
  ctx.font = '14px system-ui, sans-serif';
  ctx.fillText(`Bought: $${_fmtPrice(trade.entryPrice)}`, 24, 175);
  ctx.fillText(`Sold:   $${_fmtPrice(trade.exitPrice)}`,  24, 197);
  ctx.fillText(`+${(trade.pnlSol ?? 0).toFixed(3)} SOL`,  24, 219);
  ctx.fillText(`Held: ${_fmtHold(trade.holdSecs)}`,       24, 241);

  // FDV branding
  ctx.fillStyle = 'rgba(255,255,255,0.25)';
  ctx.font = '13px system-ui, sans-serif';
  ctx.fillText('fdv.lol', CARD_W - 70, CARD_H - 16);

  // Optional exit reason badge
  if (trade.exitReason) {
    const badge = _exitBadge(trade.exitReason);
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    ctx.beginPath();
    ctx.roundRect(CARD_W - 130, 20, 110, 26, 4);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.font = '12px system-ui, sans-serif';
    ctx.fillText(badge, CARD_W - 122, 38);
  }

  return canvas;
}

function _fmtPrice(p) {
  if (!p) return '—';
  if (p < 0.0001) return p.toExponential(2);
  return p.toPrecision(4);
}

function _fmtHold(secs) {
  if (!secs) return '—';
  if (secs < 60)   return `${secs}s`;
  if (secs < 3600) return `${Math.round(secs / 60)}m`;
  return `${(secs / 3600).toFixed(1)}h`;
}

function _exitBadge(reason) {
  const map = { takeProfit: '✓ Take Profit', stopLoss: '✗ Stop Loss',
    trailing: '↘ Trailing', rug: '☠ Rug', observer: '⚠ Observer',
    maxHold: '⏱ Max Hold' };
  return map[reason] ?? reason;
}

function _loadImage(url) {
  return new Promise((res, rej) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => res(img);
    img.onerror = rej;
    img.src = url;
  });
}

export async function copyTradeCard(trade) {
  const canvas = await renderTradeCard(trade);
  const blob = await new Promise(r => canvas.toBlob(r, 'image/png'));
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
}

export async function downloadTradeCard(trade) {
  const canvas = await renderTradeCard(trade);
  const url = canvas.toDataURL('image/png');
  const a = Object.assign(document.createElement('a'), {
    href: url, download: `fdv-${trade.symbol}-${trade.pnlPct > 0 ? 'win' : 'loss'}.png`
  });
  a.click();
}
```

### 2. Wire Share button in `overview.js`

In `_refresh(el)`, for each closed position row in the positions table:

```js
const shareBtn = document.createElement('button');
shareBtn.className = 'fdv-share-btn';
shareBtn.title = 'Share trade';
shareBtn.textContent = '↗';
shareBtn.addEventListener('click', async () => {
  shareBtn.disabled = true;
  try {
    await copyTradeCard(tradeData);
    shareBtn.textContent = '✓';
  } catch {
    // Clipboard API not available — fallback to download
    await downloadTradeCard(tradeData);
    shareBtn.textContent = '↓';
  } finally {
    setTimeout(() => { shareBtn.textContent = '↗'; shareBtn.disabled = false; }, 2000);
  }
});
row.append(shareBtn);
```

### 3. Wire Share button in `hold/index.js`

Same pattern — add a Share button to each completed Hold bot position display.

### 4. Styles

```css
.fdv-share-btn { background: none; border: 1px solid var(--border);
  border-radius: 4px; cursor: pointer; padding: 2px 7px;
  font-size: 0.78rem; color: var(--muted); transition: border-color 0.15s; }
.fdv-share-btn:hover { border-color: var(--accent); color: var(--fg); }
.fdv-share-btn:disabled { opacity: 0.5; cursor: default; }
```

## Acceptance Criteria

- [ ] Share button appears on closed position rows in Overview and Hold panels
- [ ] Clicking Share renders a 540×280 card to canvas (2x for retina)
- [ ] Green card for profit, red card for loss
- [ ] Card shows: symbol, PnL %, entry/exit price, SOL PnL, hold time, FDV branding
- [ ] Token logo is rendered if `logoUrl` is available (crossOrigin fetch; failure is silent)
- [ ] Primary action: copy PNG to clipboard (`ClipboardItem` API)
- [ ] Fallback: download as PNG if clipboard API is unavailable
- [ ] Button shows ✓ (copy) or ↓ (download) feedback for 2s, then resets
- [ ] Canvas rendering has no external library dependency
