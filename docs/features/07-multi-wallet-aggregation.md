# Multi-Wallet Aggregation

## Problem

The Follow Bot tracks exactly one target wallet. Serious traders watch a basket of
wallets — alpha wallets, known whales, their own sub-wallets, team wallets.
Currently this requires opening multiple tabs with different Follow Bot configurations,
which is unwieldy and misses cross-wallet patterns.

## Goal

A "Wallets" settings list where users can add/remove/label up to 10 wallet addresses.
Each wallet is polled on a staggered interval for new swap transactions. A unified
activity feed shows recent trades across all wallets. Optional one-click "Copy to Follow"
pastes a wallet address into the Follow Bot.

## Files to Touch

- `src/data/multiWallet.js` — new file, wallet list store + poll engine
- `src/vista/addons/auto/follow/index.js` — expose a `setTargetWallet(addr)` API
- `src/vista/addons/multi-wallet/page.js` — new file, wallet list UI + activity feed
- `src/vista/addons/loader.js` — register multi-wallet addon
- `src/assets/styles/default/global.css` — feed and wallet list styles

## Data Shape

```js
// localStorage key: 'fdv_multi_wallets_v1'
[
  { id: 'uuid', address: 'AbC123...', label: 'Whale 1', enabled: true, addedAt: 1700000000000 }
]

// In-memory activity feed entry (not persisted — rebuilt on each poll):
{
  walletId:  'uuid',
  label:     'Whale 1',
  address:   'AbC123...',
  ts:        1700000000000,
  type:      'buy' | 'sell',
  mint:      'DefG...',
  symbol:    'BONK',
  solAmount: 0.05,
  signature: 'txSig...',
}
```

## Implementation Plan

### 1. Create `src/data/multiWallet.js`

```js
const KEY = 'fdv_multi_wallets_v1';
const MAX_WALLETS = 10;
const POLL_INTERVAL_MS = 15_000;   // stagger: wallet_i polls at i * 1500ms offset

export function getWallets() {
  try { return JSON.parse(localStorage.getItem(KEY) ?? '[]'); } catch { return []; }
}

export function addWallet({ address, label }) {
  const list = getWallets();
  if (list.length >= MAX_WALLETS) throw new Error('Max 10 wallets');
  if (list.some(w => w.address === address)) throw new Error('Already added');
  list.push({ id: crypto.randomUUID(), address, label: label || address.slice(0, 8),
    enabled: true, addedAt: Date.now() });
  _save(list);
  return list;
}

export function removeWallet(id) {
  _save(getWallets().filter(w => w.id !== id));
}

export function toggleWallet(id) {
  const list = getWallets().map(w => w.id === id ? { ...w, enabled: !w.enabled } : w);
  _save(list); return list;
}

function _save(list) {
  try { localStorage.setItem(KEY, JSON.stringify(list)); } catch {}
  window.dispatchEvent(new CustomEvent('fdv:wallets-changed'));
}

// Poll engine — call startPolling(rpcUrl, onActivity)
export function startPolling(rpcUrl, onActivity) {
  const handles = new Map(); // walletId → { timerId, lastSig }

  function _scheduleWallet(wallet, offsetMs) {
    setTimeout(() => {
      if (!wallet.enabled) return;
      _pollWallet(wallet, rpcUrl, onActivity, handles);
      const id = setInterval(() => _pollWallet(wallet, rpcUrl, onActivity, handles),
        POLL_INTERVAL_MS);
      handles.set(wallet.id, { timerId: id, lastSig: null });
    }, offsetMs);
  }

  getWallets().forEach((w, i) => _scheduleWallet(w, i * 1500));

  window.addEventListener('fdv:wallets-changed', () => {
    // Stop existing intervals; restart with new list
    for (const { timerId } of handles.values()) clearInterval(timerId);
    handles.clear();
    getWallets().forEach((w, i) => _scheduleWallet(w, i * 300));
  });

  return () => { for (const { timerId } of handles.values()) clearInterval(timerId); };
}

async function _pollWallet(wallet, rpcUrl, onActivity, handles) {
  try {
    const entry = handles.get(wallet.id) ?? {};
    const params = { limit: 10 };
    if (entry.lastSig) params.until = entry.lastSig;
    const res = await fetch(rpcUrl, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1,
        method: 'getSignaturesForAddress', params: [wallet.address, params] }),
    });
    const json = await res.json();
    const sigs = (json.result ?? []).map(r => r.signature);
    if (!sigs.length) return;
    if (!entry.lastSig) { handles.set(wallet.id, { ...entry, lastSig: sigs[0] }); return; }
    // New signatures since last check — parse them
    for (const sig of sigs.reverse()) {
      const activity = await _parseSwap(sig, wallet, rpcUrl);
      if (activity) onActivity(activity);
    }
    handles.set(wallet.id, { ...entry, lastSig: sigs[sigs.length - 1] });
  } catch {}
}

async function _parseSwap(sig, wallet, rpcUrl) {
  // Same parsing logic as walletHistory.js Phase 2
  // Returns activity object or null if not a relevant swap
}
```

### 2. Expose `setTargetWallet` in follow bot

In `src/vista/addons/auto/follow/index.js`, export or expose a setter:

```js
export function setTargetWallet(address) {
  // Update the target wallet input field and trigger the same save flow
  // as if the user typed it manually
}
```

This avoids deep coupling — the multi-wallet panel just calls this function.

### 3. Create `src/vista/addons/multi-wallet/page.js`

Two sections:

**Wallet List** (top):
```
[+ Add Wallet]
● Whale 1    AbC123…  [enabled toggle]  [Copy to Follow]  [×]
● My wallet  XyZ789…  [enabled toggle]  [Copy to Follow]  [×]
```

**Activity Feed** (scrollable, newest first):
```
2s ago  Whale 1   bought BONK   0.05 SOL  [↗ DexScreener]
14s ago My wallet sold  PEPE   0.12 SOL  [↗ DexScreener]
```

Feed is capped at the last 200 activity events in memory (not persisted).

Add Wallet modal/inline form:
```html
<input placeholder="Wallet address (base58)">
<input placeholder="Label (optional)">
<button>Add</button>
```

### 4. Register in `loader.js`

Add `multi-wallet` tab with a 👥 icon.

### 5. Styles

```css
.fdv-mw-wallet-row { display: flex; align-items: center; gap: 8px;
  padding: 6px 0; border-bottom: 1px solid var(--border); font-size: 0.82rem; }
.fdv-mw-wallet-row .label { font-weight: 500; min-width: 80px; }
.fdv-mw-wallet-row .addr  { color: var(--muted); font-size: 0.74rem; font-family: monospace; }
.fdv-mw-feed { max-height: 300px; overflow-y: auto; margin-top: 12px; }
.fdv-mw-feed-row { display: flex; gap: 8px; align-items: center;
  padding: 4px 0; font-size: 0.78rem; border-bottom: 1px solid var(--border); }
.fdv-mw-feed-row .type-buy  { color: #22c55e; }
.fdv-mw-feed-row .type-sell { color: #ef4444; }
```

## Acceptance Criteria

- [ ] User can add up to 10 wallets with optional labels
- [ ] Each wallet can be individually enabled/disabled
- [ ] Activity feed shows new swaps from all enabled wallets, newest first
- [ ] Polling is staggered so all wallets don't fire at the same RPC second
- [ ] "Copy to Follow" sets the Follow Bot's target wallet
- [ ] Feed is capped at 200 entries in memory
- [ ] Wallet list persists in `fdv_multi_wallets_v1` across refreshes
- [ ] Adding a duplicate wallet address shows a clear error
- [ ] Polling stops cleanly on component unmount / tab change
