import { getRpcConfigFromStorage } from './rpc.js';
import { fetchParsedTransactions, parseSwapEvents } from './walletHistory.js';

const KEY           = 'fdv_multi_wallets_v1';
const MAX_WALLETS   = 10;
const POLL_INTERVAL_MS = 15_000;

// ─── Wallet list (persisted) ─────────────────────────────────────────────────

export function getWallets() {
  try { return JSON.parse(localStorage.getItem(KEY) ?? '[]'); } catch { return []; }
}

export function addWallet({ address, label }) {
  const addr = String(address || '').trim();
  if (!addr) throw new Error('Enter a wallet address.');
  const list = getWallets();
  if (list.length >= MAX_WALLETS) throw new Error(`Max ${MAX_WALLETS} wallets reached.`);
  if (list.some(w => w.address === addr)) throw new Error('Wallet already in list.');
  list.push({
    id:       crypto.randomUUID(),
    address:  addr,
    label:    String(label || '').trim() || addr.slice(0, 8),
    enabled:  true,
    addedAt:  Date.now(),
  });
  _save(list);
  return list;
}

export function removeWallet(id) {
  _save(getWallets().filter(w => w.id !== id));
}

export function toggleWallet(id) {
  const list = getWallets().map(w => w.id === id ? { ...w, enabled: !w.enabled } : w);
  _save(list);
  return list;
}

export function updateWalletLabel(id, label) {
  const list = getWallets().map(w =>
    w.id === id ? { ...w, label: String(label || '').trim() || w.address.slice(0, 8) } : w
  );
  _save(list);
  return list;
}

function _save(list) {
  try { localStorage.setItem(KEY, JSON.stringify(list)); } catch {}
  try { window.dispatchEvent(new CustomEvent('fdv:wallets-changed')); } catch {}
}

// ─── Poll engine ─────────────────────────────────────────────────────────────

/**
 * Start staggered polling across all enabled wallets.
 * @param {(activity: object) => void} onActivity  Called on each new swap
 * @returns {() => void}  Cleanup / stop function
 */
export function startPolling(onActivity) {
  // handles: walletId → { timerId: number|null, lastSig: string|null }
  const handles = new Map();
  let _stopped = false;

  function _getRpcUrl() {
    return getRpcConfigFromStorage().rpcUrl || '';
  }

  async function _pollWallet(wallet) {
    if (_stopped || !wallet.enabled) return;
    const rpcUrl = _getRpcUrl();
    if (!rpcUrl) return;

    const entry = handles.get(wallet.id) ?? { timerId: null, lastSig: null };

    try {
      const body = {
        jsonrpc: '2.0', id: 1,
        method: 'getSignaturesForAddress',
        params: [wallet.address, { limit: 10, ...(entry.lastSig ? { until: entry.lastSig } : {}) }],
      };
      const res  = await fetch(rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      const sigRecords = ((json.result ?? []).filter(r => !r.err))
        .map(r => ({ signature: r.signature, blockTime: r.blockTime ?? null }));

      if (!sigRecords.length) return;

      // First poll — establish baseline, do not replay history
      if (!entry.lastSig) {
        handles.set(wallet.id, { ...entry, lastSig: sigRecords[0].signature });
        return;
      }

      // New signatures since last check — parse oldest-first
      const txRecords = await fetchParsedTransactions(sigRecords.slice().reverse(), rpcUrl, { batchSize: 5 });

      for (const txRecord of txRecords) {
        const swaps = parseSwapEvents(txRecord, wallet.address);
        for (const swap of swaps) {
          try {
            onActivity({
              walletId:  wallet.id,
              label:     wallet.label,
              address:   wallet.address,
              ts:        (txRecord.blockTime ?? 0) * 1000 || Date.now(),
              type:      swap.type,
              mint:      swap.mint,
              symbol:    swap.symbol || '',
              solAmount: swap.solAmount,
              signature: swap.signature,
            });
          } catch {}
        }
      }

      // Advance lastSig to newest
      handles.set(wallet.id, { ...entry, lastSig: sigRecords[0].signature });
    } catch {}
  }

  function _scheduleWallet(wallet, initialDelayMs) {
    const timer = setTimeout(() => {
      _pollWallet(wallet);
      const id = setInterval(() => _pollWallet(wallet), POLL_INTERVAL_MS);
      handles.set(wallet.id, { timerId: id, lastSig: handles.get(wallet.id)?.lastSig ?? null });
    }, initialDelayMs);
    handles.set(wallet.id, { timerId: timer, lastSig: null });
  }

  function _restartAll() {
    for (const { timerId } of handles.values()) {
      try { clearTimeout(timerId); clearInterval(timerId); } catch {}
    }
    handles.clear();
    getWallets()
      .filter(w => w.enabled)
      .forEach((w, i) => _scheduleWallet(w, i * 300));
  }

  // Initial start — stagger by 1500ms per wallet
  getWallets()
    .filter(w => w.enabled)
    .forEach((w, i) => _scheduleWallet(w, i * 1500));

  // Restart on wallet list changes (add/remove/toggle)
  const _onChanged = () => _restartAll();
  try { window.addEventListener('fdv:wallets-changed', _onChanged); } catch {}

  return function stop() {
    _stopped = true;
    for (const { timerId } of handles.values()) {
      try { clearTimeout(timerId); clearInterval(timerId); } catch {}
    }
    handles.clear();
    try { window.removeEventListener('fdv:wallets-changed', _onChanged); } catch {}
  };
}
