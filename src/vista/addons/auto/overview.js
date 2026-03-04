import { getAutoTraderState } from './trader/index.js';
import { getPnlLog } from './lib/stores/traderStore.js';
import { shareTradeCard } from '../../../lib/tradeCard.js';
import { esc as _esc } from '../../../lib/escapeHtml.js';

function _safeJson(key) {
  try { return JSON.parse(localStorage.getItem(key) ?? 'null') ?? {}; } catch { return {}; }
}

function _shortMint(mint) {
  return mint ? mint.slice(0, 4) + '…' + mint.slice(-4) : '—';
}

function _fmtSol(n) {
  const v = Number(n || 0);
  return v === 0 ? '0 SOL' : v.toFixed(4) + ' SOL';
}

function _getTraderSnapshot() {
  try {
    const st = getAutoTraderState() || {};
    const positions = st.positions || {};
    const open = Object.entries(positions)
      .filter(([, p]) => Number(p?.sizeUi || 0) > 0)
      .map(([mint, p]) => ({
        mint,
        sizeUi: Number(p.sizeUi || 0),
        costSol: Number(p.costSol || 0),
      }));
    return {
      running: !!st.enabled,
      positions: open,
      totalCostSol: open.reduce((s, p) => s + p.costSol, 0),
      moneyMadeSol: Number(st.moneyMadeSol || 0),
    };
  } catch { return { running: false, positions: [], totalCostSol: 0, moneyMadeSol: 0 }; }
}

function _getHoldSnapshot() {
  try {
    const raw = _safeJson('fdv_hold_tabs_v1');
    const bots = Array.isArray(raw.bots) ? raw.bots : [];
    const active = bots.filter(b => b?.state?.enabled && b?.state?.mint);
    return {
      running: active.length > 0,
      slots: active.map(b => ({
        mint: b.state.mint,
        profitPct: Number(b.state.profitPct || 5),
      })),
    };
  } catch { return { running: false, slots: [] }; }
}

function _getFollowSnapshot() {
  try {
    const st = _safeJson('fdv_follow_bot_v1');
    return {
      running: !!st.enabled,
      targetWallet: st.targetWallet || '',
      activeMint: st.activeMint || '',
    };
  } catch { return { running: false, targetWallet: '', activeMint: '' }; }
}

function _getSentrySnapshot() {
  try {
    const st = _safeJson('fdv_sniper_bot_v1');
    return {
      running: !!st.enabled,
      mode: st.sentryEnabled ? 'Gary' : st.flameEnabled ? 'Flame' : '',
    };
  } catch { return { running: false, mode: '' }; }
}

function _fmtPnl(n) {
  const v = Number(n || 0);
  const sign = v >= 0 ? '+' : '';
  return sign + v.toFixed(4) + ' SOL';
}

function _drawChart(canvas, log) {
  const W = canvas.width;
  const H = canvas.height;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, W, H);

  if (log.length < 2) return; // need at least 2 points to draw a line

  // Build cumulative series
  let cum = 0;
  const points = log.map(e => { cum += e.pnlSol; return cum; });
  const minY = Math.min(0, ...points);
  const maxY = Math.max(0, ...points);
  const range = maxY - minY || 0.0001;

  const pad = 4;
  const toX = i => pad + (i / (points.length - 1)) * (W - pad * 2);
  const toY = v => (H - pad) - ((v - minY) / range) * (H - pad * 2);

  // Zero line
  ctx.strokeStyle = 'rgba(255,255,255,0.10)';
  ctx.lineWidth = 1;
  ctx.setLineDash([3, 4]);
  ctx.beginPath();
  const zy = toY(0);
  ctx.moveTo(0, zy);
  ctx.lineTo(W, zy);
  ctx.stroke();
  ctx.setLineDash([]);

  // PnL line
  const lastVal = points[points.length - 1];
  ctx.strokeStyle = lastVal >= 0 ? '#22c55e' : '#ef4444';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  points.forEach((v, i) => i === 0 ? ctx.moveTo(toX(i), toY(v)) : ctx.lineTo(toX(i), toY(v)));
  ctx.stroke();

  // End dot
  ctx.fillStyle = lastVal >= 0 ? '#22c55e' : '#ef4444';
  ctx.beginPath();
  ctx.arc(toX(points.length - 1), toY(lastVal), 3, 0, Math.PI * 2);
  ctx.fill();
}

function _renderBotPill(label, running, detail) {
  const cls = running ? 'running' : 'idle';
  const suffix = detail ? ` <span class="fdv-ov-bot-detail">${_esc(detail)}</span>` : '';
  return `<div class="fdv-ov-bot-pill ${cls}"><span class="fdv-ov-dot"></span>${_esc(label)}${suffix}</div>`;
}

function _renderRows(trader, hold) {
  const rows = [
    ...trader.positions.map(p => `
      <div class="fdv-ov-row" data-overview-nav="auto">
        <span class="fdv-ov-cell">${_esc(_shortMint(p.mint))}</span>
        <span class="fdv-ov-cell fdv-ov-muted">Trader</span>
        <span class="fdv-ov-cell">${_esc(p.sizeUi.toFixed(2))}</span>
        <span class="fdv-ov-cell">${_esc(_fmtSol(p.costSol))}</span>
      </div>`),
    ...hold.slots.map(s => `
      <div class="fdv-ov-row" data-overview-nav="hold">
        <span class="fdv-ov-cell">${_esc(_shortMint(s.mint))}</span>
        <span class="fdv-ov-cell fdv-ov-muted">Hold</span>
        <span class="fdv-ov-cell">—</span>
        <span class="fdv-ov-cell">tgt +${_esc(s.profitPct)}%</span>
      </div>`),
  ];

  if (!rows.length) {
    return '<p class="fdv-ov-empty">No open positions</p>';
  }

  return `
    <div class="fdv-ov-row fdv-ov-row-hdr">
      <span class="fdv-ov-cell">Token</span>
      <span class="fdv-ov-cell">Bot</span>
      <span class="fdv-ov-cell">Size</span>
      <span class="fdv-ov-cell">Cost</span>
    </div>
    ${rows.join('')}
  `;
}

function _renderRecentTrades(pnlLog) {
  const recent = pnlLog.slice(-5).reverse();
  if (!recent.length) return '';
  const rows = recent.map(e => {
    const pnlPct = e.costSol > 0 ? (e.pnlSol / e.costSol) * 100 : 0;
    const trade = JSON.stringify({
      symbol: e.symbol || e.mint.slice(0, 8),
      mint: e.mint,
      pnlPct,
      pnlSol: e.pnlSol,
      exitReason: e.reason || '',
      entryPrice: null,
      exitPrice: null,
      holdSecs: 0,
    });
    const pnlStr = `${pnlPct >= 0 ? '+' : ''}${pnlPct.toFixed(1)}%`;
    const cls = pnlPct >= 0 ? 'fdv-ov-green' : 'fdv-ov-red';
    return `<div class="fdv-ov-recent-row">
      <span class="fdv-ov-recent-sym">${_esc(e.symbol || _shortMint(e.mint))}</span>
      <span class="fdv-ov-recent-pnl ${cls}">${pnlStr}</span>
      <button class="fdv-share-btn" data-share-trade="${_esc(trade)}">↗</button>
    </div>`;
  }).join('');
  return `<div class="fdv-ov-recent"><div class="fdv-ov-recent-title">Recent Trades</div>${rows}</div>`;
}

function _refresh(el) {
  try {
    const trader  = _getTraderSnapshot();
    const hold    = _getHoldSnapshot();
    const follow  = _getFollowSnapshot();
    const sentry  = _getSentrySnapshot();
    const pnlLog  = getPnlLog();

    const openCount  = trader.positions.length + hold.slots.length;
    const activeBots = [trader, hold, follow, sentry].filter(b => b.running).length;
    const sessionPnl = trader.moneyMadeSol;
    const pnlColor   = sessionPnl > 0 ? 'fdv-ov-green' : sessionPnl < 0 ? 'fdv-ov-red' : '';

    el.innerHTML = `
      <div class="fdv-ov-summary">
        <div class="fdv-ov-kpi">
          <span class="fdv-ov-label">Open Positions</span>
          <span class="fdv-ov-value">${openCount}</span>
        </div>
        <div class="fdv-ov-kpi">
          <span class="fdv-ov-label">Deployed</span>
          <span class="fdv-ov-value">${_esc(_fmtSol(trader.totalCostSol))}</span>
        </div>
        <div class="fdv-ov-kpi">
          <span class="fdv-ov-label">Bots Active</span>
          <span class="fdv-ov-value ${activeBots > 0 ? 'fdv-ov-green' : ''}">${activeBots} / 4</span>
        </div>
        <div class="fdv-ov-kpi">
          <span class="fdv-ov-label">Session PnL</span>
          <span class="fdv-ov-value ${pnlColor}">${_esc(_fmtPnl(sessionPnl))}</span>
        </div>
      </div>

      <div class="fdv-pnl-chart-wrap">
        ${pnlLog.length >= 2
          ? `<canvas class="fdv-pnl-canvas" width="600" height="80"></canvas>`
          : `<p class="fdv-pnl-empty">No closed trades yet</p>`
        }
      </div>

      <div class="fdv-ov-positions">
        ${_renderRows(trader, hold)}
      </div>

      ${_renderRecentTrades(pnlLog)}

      <div class="fdv-ov-bots">
        ${_renderBotPill('Trader', trader.running)}
        ${_renderBotPill('Hold',   hold.running,   hold.slots.length ? `${hold.slots.length} slot${hold.slots.length > 1 ? 's' : ''}` : '')}
        ${_renderBotPill('Follow', follow.running,  follow.targetWallet ? follow.targetWallet.slice(0, 6) + '…' : '')}
        ${_renderBotPill('Sentry', sentry.running,  sentry.mode)}
      </div>
    `;

    const canvas = el.querySelector('.fdv-pnl-canvas');
    if (canvas) _drawChart(canvas, pnlLog);

    el.querySelectorAll('[data-share-trade]').forEach(btn => {
      btn.addEventListener('click', async () => {
        let trade;
        try { trade = JSON.parse(btn.dataset.shareTrade); } catch { return; }
        await shareTradeCard(trade, btn);
      });
    });
  } catch {}
}

export function initOverviewWidget(container) {
  if (!container) return;
  const el = document.createElement('div');
  el.className = 'fdv-ov-panel';
  container.replaceChildren(el);
  _refresh(el);

  const interval = setInterval(() => _refresh(el), 5000);
  const ac = new AbortController();

  // Clicking a position row navigates to the owning bot tab.
  el.addEventListener('click', (e) => {
    const row = e.target.closest('[data-overview-nav]');
    if (!row) return;
    try {
      document.querySelector(`[data-main-tab="${row.dataset.overviewNav}"]`)?.click();
    } catch {}
  }, { signal: ac.signal });

  return () => { clearInterval(interval); ac.abort(); };
}
