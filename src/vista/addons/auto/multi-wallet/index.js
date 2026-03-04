import {
  getWallets,
  addWallet,
  removeWallet,
  toggleWallet,
  startPolling,
} from '../../../../data/multiWallet.js';
import { setTargetWallet } from '../follow/index.js';
import { esc as _esc } from '../../../../lib/escapeHtml.js';

const FEED_CAP = 200;
const MAX_WALLETS = 10;

function _truncAddr(addr, chars = 6) {
  const s = String(addr || '');
  return s.length > chars * 2 + 3 ? `${s.slice(0, chars)}…${s.slice(-chars)}` : s;
}

function _timeAgo(ts) {
  const secs = Math.floor((Date.now() - ts) / 1000);
  if (secs < 5)    return 'just now';
  if (secs < 60)   return `${secs}s ago`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  return `${Math.floor(secs / 3600)}h ago`;
}

function _dexUrl(mint) {
  return `https://dexscreener.com/solana/${mint}`;
}

// ── Wallet list section ──────────────────────────────────────────────────────

function _renderWalletList(container, onAddFormToggle) {
  const wallets = getWallets();

  const rowsHtml = wallets.length
    ? wallets.map(w => `
        <div class="fdv-mw-wallet-row" data-wallet-id="${_esc(w.id)}">
          <span class="fdv-mw-led ${w.enabled ? 'on' : 'off'}"></span>
          <span class="fdv-mw-label" title="${_esc(w.address)}">${_esc(w.label)}</span>
          <span class="fdv-mw-addr">${_truncAddr(w.address)}</span>
          <div class="fdv-mw-row-actions">
            <button class="fdv-mw-toggle btn" data-id="${_esc(w.id)}" title="${w.enabled ? 'Disable' : 'Enable'}">
              ${w.enabled ? 'On' : 'Off'}
            </button>
            <button class="fdv-mw-copy-follow btn" data-addr="${_esc(w.address)}" title="Copy to Follow Bot">
              Follow
            </button>
            <button class="fdv-mw-remove" data-id="${_esc(w.id)}" aria-label="Remove wallet">×</button>
          </div>
        </div>`).join('')
    : '<p class="fdv-mw-empty">No wallets added yet.</p>';

  container.innerHTML = `
    <div class="fdv-mw-list-header">
      <strong>Wallets (${wallets.length}/${MAX_WALLETS})</strong>
      <button class="btn fdv-mw-add-btn" type="button">+ Add</button>
    </div>
    <div class="fdv-mw-add-form" hidden>
      <input class="fdv-mw-addr-input" type="text" placeholder="Wallet address (base58)" spellcheck="false" autocomplete="off">
      <input class="fdv-mw-label-input" type="text" placeholder="Label (optional)" maxlength="24">
      <div class="fdv-mw-form-row">
        <button class="btn fdv-mw-add-confirm" type="button">Add</button>
        <span class="fdv-mw-add-error"></span>
      </div>
    </div>
    <div class="fdv-mw-list">${rowsHtml}</div>`;

  // Add button toggles inline form
  const addBtn  = container.querySelector('.fdv-mw-add-btn');
  const addForm = container.querySelector('.fdv-mw-add-form');
  addBtn.addEventListener('click', () => {
    addForm.hidden = !addForm.hidden;
    if (!addForm.hidden) addForm.querySelector('.fdv-mw-addr-input').focus();
  });

  // Confirm add
  container.querySelector('.fdv-mw-add-confirm').addEventListener('click', () => {
    const addr  = container.querySelector('.fdv-mw-addr-input').value.trim();
    const label = container.querySelector('.fdv-mw-label-input').value.trim();
    const errEl = container.querySelector('.fdv-mw-add-error');
    try {
      addWallet({ address: addr, label });
      errEl.textContent = '';
      addForm.hidden = true;
      container.querySelector('.fdv-mw-addr-input').value  = '';
      container.querySelector('.fdv-mw-label-input').value = '';
      onAddFormToggle(); // triggers full re-render
    } catch (e) {
      errEl.textContent = e.message;
    }
  });

  // Allow Enter key in address input
  container.querySelector('.fdv-mw-addr-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') container.querySelector('.fdv-mw-add-confirm').click();
  });

  // Toggle / remove / copy-to-follow via delegation
  container.querySelector('.fdv-mw-list').addEventListener('click', e => {
    const toggle = e.target.closest('.fdv-mw-toggle');
    if (toggle) { toggleWallet(toggle.dataset.id); onAddFormToggle(); return; }

    const remove = e.target.closest('.fdv-mw-remove');
    if (remove) { removeWallet(remove.dataset.id); onAddFormToggle(); return; }

    const copy = e.target.closest('.fdv-mw-copy-follow');
    if (copy) {
      const addr = copy.dataset.addr;
      const prev = copy.textContent;
      try {
        setTargetWallet(addr);
        copy.textContent = 'Copied!';
      } catch {
        copy.textContent = 'Error';
      }
      setTimeout(() => { copy.textContent = prev; }, 1500);
    }
  });
}

// ── Activity feed section ────────────────────────────────────────────────────

function _feedEntryHtml(entry) {
  const typeClass = entry.type === 'buy' ? 'type-buy' : 'type-sell';
  const verb      = entry.type === 'buy' ? 'bought' : 'sold';
  const sym       = _esc(entry.symbol || entry.mint.slice(0, 8));
  const sol       = entry.solAmount != null ? `${entry.solAmount.toFixed(4)} SOL` : '';
  return `
    <div class="fdv-mw-feed-row">
      <span class="fdv-mw-feed-time">${_timeAgo(entry.ts)}</span>
      <span class="fdv-mw-feed-who">${_esc(entry.label)}</span>
      <span class="fdv-mw-feed-type ${typeClass}">${verb}</span>
      <span class="fdv-mw-feed-sym">${sym}</span>
      ${sol ? `<span class="fdv-mw-feed-sol">${_esc(sol)}</span>` : ''}
      <a class="fdv-mw-feed-link" href="${_esc(_dexUrl(entry.mint))}" target="_blank" rel="noopener" title="Open on DexScreener">↗</a>
    </div>`;
}

function _renderFeed(feedEl, feedEntries) {
  if (!feedEntries.length) {
    feedEl.innerHTML = '<p class="fdv-mw-feed-empty">No activity yet — polling enabled wallets\u2026</p>';
    return;
  }
  feedEl.innerHTML = feedEntries.map(_feedEntryHtml).join('');
}

// ── Main init ────────────────────────────────────────────────────────────────

export function initMultiWallet(container) {
  if (!container) return;

  let _feedEntries = [];
  let _stopPolling = null;
  let _clockTimer  = null;

  container.innerHTML = `
    <div class="fdv-mw-panel">
      <div class="fdv-mw-wallet-section"></div>
      <div class="fdv-mw-feed-section">
        <div class="fdv-mw-feed-header">
          <strong>Activity Feed</strong>
          <button class="btn fdv-mw-clear-feed" type="button" title="Clear feed">Clear</button>
        </div>
        <div class="fdv-mw-feed"></div>
      </div>
    </div>`;

  const walletSection = container.querySelector('.fdv-mw-wallet-section');
  const feedEl        = container.querySelector('.fdv-mw-feed');

  function _rerenderWallets() {
    _renderWalletList(walletSection, _rerenderWallets);
  }

  function _addActivity(entry) {
    _feedEntries.unshift(entry);
    if (_feedEntries.length > FEED_CAP) _feedEntries.length = FEED_CAP;
    _renderFeed(feedEl, _feedEntries);
  }

  // Clear feed button
  container.querySelector('.fdv-mw-clear-feed').addEventListener('click', () => {
    _feedEntries = [];
    _renderFeed(feedEl, _feedEntries);
  });

  // Initial render
  _rerenderWallets();
  _renderFeed(feedEl, _feedEntries);

  // Start polling
  _stopPolling = startPolling(_addActivity);

  // Refresh time-ago labels every 30s
  _clockTimer = setInterval(() => {
    if (_feedEntries.length) _renderFeed(feedEl, _feedEntries);
  }, 30_000);

  // Expose cleanup for panel teardown
  container._stopMultiWallet = () => {
    try { if (_stopPolling) _stopPolling(); } catch {}
    try { clearInterval(_clockTimer); } catch {}
  };
}
