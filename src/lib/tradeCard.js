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

  // Optional exit reason badge — wrapped in try/catch for roundRect browser compat
  if (trade.exitReason) {
    try {
      const badge = _exitBadge(trade.exitReason);
      ctx.fillStyle = 'rgba(255,255,255,0.08)';
      ctx.beginPath();
      ctx.roundRect(CARD_W - 130, 20, 110, 26, 4);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      ctx.font = '12px system-ui, sans-serif';
      ctx.fillText(badge, CARD_W - 122, 38);
    } catch {}
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
  if (!navigator.clipboard?.write) throw new Error('Clipboard API unavailable');
  const canvas = await renderTradeCard(trade);
  const blob = await new Promise((resolve, reject) => {
    canvas.toBlob(b => b ? resolve(b) : reject(new Error('Canvas export failed')), 'image/png');
  });
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
}

export async function downloadTradeCard(trade) {
  const canvas = await renderTradeCard(trade);
  const url = canvas.toDataURL('image/png');
  const safeSym = String(trade.symbol || 'token').replace(/[^a-zA-Z0-9_-]/g, '');
  const a = Object.assign(document.createElement('a'), {
    href: url, download: `fdv-${safeSym}-${trade.pnlPct > 0 ? 'win' : 'loss'}.png`
  });
  a.click();
}

/**
 * Try copying the trade card to clipboard; fall back to download on failure.
 * Manages button state (disabled + feedback text) for 2 seconds.
 * @param {object} trade
 * @param {HTMLElement} btn
 */
export async function shareTradeCard(trade, btn) {
  const orig = btn.textContent;
  btn.disabled = true;
  try {
    await copyTradeCard(trade);
    btn.textContent = '✓';
  } catch {
    try {
      await downloadTradeCard(trade);
      btn.textContent = '↓';
    } catch { btn.textContent = '!'; }
  } finally {
    setTimeout(() => { if (btn) { btn.textContent = orig; btn.disabled = false; } }, 2000);
  }
}
