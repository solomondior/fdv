# Wallet PnL Import

## Problem

Users want to know how a wallet (their own or someone else's) performed on Solana memecoins
without leaving FDV. Currently you need a separate explorer or third-party analytics site.
The data is all on-chain; it just needs to be fetched and parsed.

## Goal

Paste any Solana wallet address and get a breakdown of all memecoin swap trades pulled from
on-chain transaction history. Display entry price, exit price, realized PnL per trade, and
totals. Export the result as CSV. The entire fetch + parse runs client-side via the user's
configured Solana RPC endpoint.

## Files to Touch

- `src/data/walletHistory.js` — new file, RPC fetch + swap parse
- `src/vista/addons/wallet-pnl/page.js` — new file, UI panel
- `src/vista/addons/loader.js` — register the wallet-pnl addon
- `src/assets/styles/default/global.css` — panel styles

## Data Shape

```js
// Intermediate: raw swap event
{
  signature: 'txSig...',
  blockTime:  1700000000,
  type:       'buy' | 'sell',
  mint:       'AbC123...',
  symbol:     'PEPE',          // best-effort from DexScreener
  solAmount:  0.05,            // SOL in (buy) or SOL out (sell)
  tokenAmount: 1_200_000,
  priceUsd:   null,            // filled if DexScreener lookup succeeds
}

// Output: matched trade pair
{
  mint:       'AbC123...',
  symbol:     'PEPE',
  openTs:     1700000000,
  closeTs:    1700003600,      // null = still open
  entrySol:   0.05,
  exitSol:    0.07,            // null = open
  pnlSol:     0.02,            // null = open
  pnlPct:     40.0,            // null = open
  holdSecs:   3600,
}
```

## Implementation Plan

### 1. Create `src/data/walletHistory.js`

Three-phase pipeline:

**Phase 1 — Fetch signatures**
```js
export async function fetchWalletSignatures(walletPubkey, rpcUrl, { limit = 100 } = {}) {
  const body = {
    jsonrpc: '2.0', id: 1,
    method: 'getSignaturesForAddress',
    params: [walletPubkey, { limit }],
  };
  const res = await fetch(rpcUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body) });
  const json = await res.json();
  return (json.result ?? []).map(r => r.signature);
}
```

**Phase 2 — Fetch + parse transactions** (batched, 5 at a time)
```js
export async function fetchParsedTransaction(sig, rpcUrl) {
  const body = { jsonrpc: '2.0', id: 1, method: 'getParsedTransaction',
    params: [sig, { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0 }] };
  const res = await fetch(rpcUrl, { method: 'POST',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const json = await res.json();
  return json.result ?? null;
}
```

Parse Jupiter/Raydium/Orca swap instructions:
- Look for `preTokenBalances` / `postTokenBalances` changes.
- SOL delta = lamport change for the owner account.
- Token delta = token balance change.
- Classify as buy (SOL out, token in) or sell (SOL in, token out).

**Phase 3 — Match buy/sell pairs**
```js
export function matchTrades(swapEvents) {
  // FIFO matching per mint
  const openBuys = {}; // mint → [{solAmount, blockTime}]
  const trades = [];
  for (const ev of swapEvents.sort((a, b) => a.blockTime - b.blockTime)) {
    if (ev.type === 'buy') {
      (openBuys[ev.mint] ??= []).push(ev);
    } else {
      const buy = openBuys[ev.mint]?.shift();
      trades.push({
        mint: ev.mint, symbol: ev.symbol,
        openTs: buy?.blockTime ?? null, closeTs: ev.blockTime,
        entrySol: buy?.solAmount ?? null, exitSol: ev.solAmount,
        pnlSol: buy ? ev.solAmount - buy.solAmount : null,
        pnlPct: buy ? ((ev.solAmount - buy.solAmount) / buy.solAmount) * 100 : null,
        holdSecs: buy ? ev.blockTime - buy.blockTime : null,
      });
    }
  }
  // Remaining open buys
  for (const [mint, buys] of Object.entries(openBuys)) {
    for (const buy of buys) {
      trades.push({ mint, symbol: buy.symbol, openTs: buy.blockTime,
        closeTs: null, entrySol: buy.solAmount, exitSol: null,
        pnlSol: null, pnlPct: null, holdSecs: null });
    }
  }
  return trades;
}
```

### 2. Create `src/vista/addons/wallet-pnl/page.js`

Build a panel with:
- Wallet address input + "Fetch" button
- Progress indicator while fetching (e.g. "Fetching 100 txs…")
- Results table: Symbol | Entry SOL | Exit SOL | PnL SOL | PnL % | Hold Time
- Summary row: Total realized PnL, win rate, number of trades
- "Export CSV" button

```js
function _toCsv(trades) {
  const headers = ['Symbol','Mint','Open','Close','Entry SOL','Exit SOL','PnL SOL','PnL %','Hold (s)'];
  const rows = trades.map(t => [
    t.symbol, t.mint,
    t.openTs ? new Date(t.openTs * 1000).toISOString() : '',
    t.closeTs ? new Date(t.closeTs * 1000).toISOString() : '',
    t.entrySol ?? '', t.exitSol ?? '',
    t.pnlSol != null ? t.pnlSol.toFixed(4) : '',
    t.pnlPct  != null ? t.pnlPct.toFixed(2)  : '',
    t.holdSecs ?? '',
  ]);
  return [headers, ...rows].map(r => r.join(',')).join('\n');
}
```

On "Export CSV": `URL.createObjectURL(new Blob([_toCsv(trades)], { type: 'text/csv' }))`,
create a temporary `<a download="fdv-trades.csv">`, click it, revoke.

### 3. Register in `loader.js`

Add `wallet-pnl` to the addon registry alongside the existing auto/sniper/follow tabs.

### 4. Styles

```css
.fdv-wpnl-panel { padding: 12px; }
.fdv-wpnl-input-row { display: flex; gap: 8px; margin-bottom: 12px; }
.fdv-wpnl-input-row input { flex: 1; }
.fdv-wpnl-table { width: 100%; border-collapse: collapse; font-size: 0.78rem; }
.fdv-wpnl-table th, .fdv-wpnl-table td { padding: 4px 8px; border-bottom: 1px solid var(--border); }
.fdv-wpnl-table .pos { color: #22c55e; }
.fdv-wpnl-table .neg { color: #ef4444; }
```

## Acceptance Criteria

- [ ] User can paste any valid Solana wallet address and click Fetch
- [ ] Fetches last 100 signatures and parses swap events via the user's RPC URL
- [ ] Displays matched trade pairs with entry/exit/PnL per token
- [ ] Open positions (buys with no matching sell) appear as "Open" rows
- [ ] Summary row shows total realized PnL + win rate
- [ ] Export CSV downloads a valid CSV with all trade data
- [ ] Error states: invalid address, RPC unreachable, no transactions found
- [ ] Fetch runs in batches; does not fire 100 parallel RPC calls
