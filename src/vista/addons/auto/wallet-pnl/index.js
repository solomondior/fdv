import { fetchWalletTrades, tradesToCsv } from '../../../../data/walletHistory.js';
import { getRpcConfigFromStorage } from '../../../../data/rpc.js';

function _fmtSol(n) {
  if (n == null) return '—';
  return (n >= 0 ? '+' : '') + n.toFixed(4);
}

function _fmtPct(n) {
  if (n == null) return '—';
  return (n >= 0 ? '+' : '') + n.toFixed(1) + '%';
}

function _fmtDuration(secs) {
  if (secs == null) return '—';
  if (secs < 60)   return `${secs}s`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m`;
  return `${Math.floor(secs / 3600)}h ${Math.floor((secs % 3600) / 60)}m`;
}

function _escHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] || c));
}

function _renderTable(container, trades) {
  const closed = trades.filter(t => t.pnlSol != null);
  const realizedPnl = closed.reduce((s, t) => s + t.pnlSol, 0);
  const wins = closed.filter(t => t.pnlSol > 0).length;
  const winRate = closed.length ? (wins / closed.length * 100).toFixed(0) : '—';

  const summaryHtml = `
    <div class="fdv-wpnl-summary">
      <span>Trades: <strong>${trades.length}</strong></span>
      <span>Realized PnL: <strong class="${realizedPnl >= 0 ? 'pos' : 'neg'}">${_fmtSol(realizedPnl)} SOL</strong></span>
      <span>Win rate: <strong>${closed.length ? winRate + '%' : '—'}</strong></span>
      <button class="btn fdv-wpnl-csv" type="button">Export CSV</button>
    </div>`;

  const rowsHtml = trades.map(t => {
    const isOpen = t.pnlSol == null;
    const cls = isOpen ? '' : t.pnlSol >= 0 ? 'pos' : 'neg';
    const sym = _escHtml(t.symbol || t.mint.slice(0, 8));
    return `
      <tr>
        <td>${sym}</td>
        <td>${t.entrySol != null ? t.entrySol.toFixed(4) : '—'}</td>
        <td>${t.exitSol  != null ? t.exitSol.toFixed(4)  : isOpen ? '<em>open</em>' : '—'}</td>
        <td class="${cls}">${_fmtSol(t.pnlSol)}</td>
        <td class="${cls}">${_fmtPct(t.pnlPct)}</td>
        <td>${_fmtDuration(t.holdSecs)}</td>
      </tr>`;
  }).join('');

  container.innerHTML = `
    ${summaryHtml}
    <div class="fdv-wpnl-scroll">
      <table class="fdv-wpnl-table">
        <thead>
          <tr><th>Symbol</th><th>Entry SOL</th><th>Exit SOL</th><th>PnL SOL</th><th>PnL %</th><th>Hold</th></tr>
        </thead>
        <tbody>${rowsHtml || '<tr><td colspan="6">No swap trades found</td></tr>'}</tbody>
      </table>
    </div>`;

  container.querySelector('.fdv-wpnl-csv')?.addEventListener('click', () => {
    try {
      const csv = tradesToCsv(trades);
      const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = 'fdv-wallet-trades.csv';
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch {}
  });
}

export function initWalletPnl(container) {
  if (!container) return;

  const { rpcUrl } = getRpcConfigFromStorage();

  container.innerHTML = `
    <div class="fdv-wpnl-panel">
      <div class="fdv-wpnl-input-row">
        <input class="fdv-wpnl-addr" type="text" placeholder="Wallet address (base58)" spellcheck="false" autocomplete="off">
        <button class="btn fdv-wpnl-fetch" type="button">Fetch</button>
      </div>
      <div class="fdv-wpnl-rpc-row">
        <label class="fdv-wpnl-rpc-label">RPC
          <input class="fdv-wpnl-rpc" type="text" placeholder="https://api.mainnet-beta.solana.com" spellcheck="false" value="${_escHtml(rpcUrl)}">
        </label>
      </div>
      <div class="fdv-wpnl-status"></div>
      <div class="fdv-wpnl-results"></div>
    </div>`;

  const addrInput   = container.querySelector('.fdv-wpnl-addr');
  const rpcInput    = container.querySelector('.fdv-wpnl-rpc');
  const fetchBtn    = container.querySelector('.fdv-wpnl-fetch');
  const statusEl    = container.querySelector('.fdv-wpnl-status');
  const resultsEl   = container.querySelector('.fdv-wpnl-results');

  let _busy = false;

  fetchBtn.addEventListener('click', async () => {
    if (_busy) return;
    const wallet = addrInput.value.trim();
    const rpc    = rpcInput.value.trim();

    if (!wallet || wallet.length < 32) {
      statusEl.textContent = 'Enter a valid Solana wallet address.';
      return;
    }
    if (!rpc) {
      statusEl.textContent = 'Enter an RPC URL (configure one in Auto → Settings).';
      return;
    }

    _busy = true;
    fetchBtn.disabled = true;
    resultsEl.innerHTML = '';

    try {
      // Override rpcUrl for this call — user may have edited the field
      const trades = await fetchWalletTrades(wallet, {
        limit: 100,
        onProgress: msg => { statusEl.textContent = msg; },
        _rpcOverride: rpc,
      });
      statusEl.textContent = trades.length
        ? `Found ${trades.length} trade(s).`
        : 'No memecoin swap trades found in last 100 transactions.';
      _renderTable(resultsEl, trades);
    } catch (err) {
      statusEl.textContent = `Error: ${err?.message || String(err)}`;
    } finally {
      _busy = false;
      fetchBtn.disabled = false;
    }
  });
}
