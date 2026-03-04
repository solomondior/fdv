import { getRpcConfigFromStorage } from './rpc.js';

const LAMPORTS = 1e9;

// ─── RPC helpers ────────────────────────────────────────────────────────────

async function _rpcPost(rpcUrl, body) {
  const res = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (json?.error) throw new Error(String(json.error.message || 'rpc_error'));
  return json.result ?? null;
}

// Phase 1 — fetch last `limit` confirmed signatures for the wallet
export async function fetchWalletSignatures(walletPubkey, rpcUrl, { limit = 100 } = {}) {
  const result = await _rpcPost(rpcUrl, {
    jsonrpc: '2.0', id: 1,
    method: 'getSignaturesForAddress',
    params: [walletPubkey, { limit }],
  });
  return (Array.isArray(result) ? result : [])
    .filter(r => !r.err) // skip failed txs
    .map(r => ({ signature: r.signature, blockTime: r.blockTime ?? null }));
}

// Phase 2 — batch-fetch parsed transactions (JSON-RPC array batch, 5 at a time)
export async function fetchParsedTransactions(sigs, rpcUrl, { batchSize = 5 } = {}) {
  const results = [];
  for (let i = 0; i < sigs.length; i += batchSize) {
    const chunk = sigs.slice(i, i + batchSize);
    const batchBody = chunk.map((s, idx) => ({
      jsonrpc: '2.0',
      id: idx + 1,
      method: 'getParsedTransaction',
      params: [s.signature, { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0 }],
    }));
    const res = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(batchBody),
    });
    const batch = await res.json();
    const sorted = Array.isArray(batch) ? batch.sort((a, b) => a.id - b.id) : [];
    for (let j = 0; j < sorted.length; j++) {
      results.push({
        signature: chunk[j].signature,
        blockTime: chunk[j].blockTime,
        tx: sorted[j]?.result ?? null,
      });
    }
  }
  return results;
}

// Phase 2b — parse a single transaction for swap events relative to `wallet`
export function parseSwapEvents(txRecord, wallet) {
  const { signature, blockTime, tx } = txRecord;
  if (!tx?.meta || !tx?.transaction) return [];

  const meta = tx.meta;
  const keys = tx.transaction?.message?.accountKeys ?? [];
  const walletIdx = keys.findIndex(k => {
    const pk = typeof k === 'string' ? k : k?.pubkey;
    return pk === wallet;
  });
  if (walletIdx < 0) return []; // wallet is not a signer in this tx

  // SOL delta for wallet (raw lamports, fee already applied)
  const preSol = Number(meta.preBalances?.[walletIdx] ?? 0) / LAMPORTS;
  const postSol = Number(meta.postBalances?.[walletIdx] ?? 0) / LAMPORTS;
  const solDelta = postSol - preSol;

  // Token balance deltas where owner === wallet
  const preMap = {};
  for (const b of (meta.preTokenBalances ?? [])) {
    if (b.owner !== wallet) continue;
    preMap[b.mint] = Number(b.uiTokenAmount?.uiAmount ?? 0);
  }
  const postMap = {};
  for (const b of (meta.postTokenBalances ?? [])) {
    if (b.owner !== wallet) continue;
    postMap[b.mint] = Number(b.uiTokenAmount?.uiAmount ?? 0);
  }

  // Collect all mints touched
  const mints = new Set([...Object.keys(preMap), ...Object.keys(postMap)]);

  const events = [];
  for (const mint of mints) {
    const pre  = preMap[mint]  ?? 0;
    const post = postMap[mint] ?? 0;
    const tokenDelta = post - pre;

    if (Math.abs(tokenDelta) < 1e-9 || Math.abs(solDelta) < 1e-9) continue;

    // buy: wallet spends SOL (negative), receives tokens (positive)
    // sell: wallet receives SOL (positive), spends tokens (negative)
    const isBuy  = solDelta < 0 && tokenDelta > 0;
    const isSell = solDelta > 0 && tokenDelta < 0;
    if (!isBuy && !isSell) continue;

    events.push({
      signature,
      blockTime: blockTime ?? null,
      type: isBuy ? 'buy' : 'sell',
      mint,
      symbol:      '',          // enriched later if needed
      solAmount:   Math.abs(solDelta),
      tokenAmount: Math.abs(tokenDelta),
    });
  }
  return events;
}

// Phase 3 — FIFO match buys → sells per mint
export function matchTrades(swapEvents) {
  const sorted = [...swapEvents].sort((a, b) => (a.blockTime ?? 0) - (b.blockTime ?? 0));
  const openBuys = {}; // mint → [event, ...]
  const trades = [];

  for (const ev of sorted) {
    if (ev.type === 'buy') {
      (openBuys[ev.mint] ??= []).push(ev);
    } else {
      const buy = openBuys[ev.mint]?.shift() ?? null;
      const pnlSol = buy ? ev.solAmount - buy.solAmount : null;
      trades.push({
        mint:      ev.mint,
        symbol:    ev.symbol || buy?.symbol || '',
        openTs:    buy?.blockTime ?? null,
        closeTs:   ev.blockTime,
        entrySol:  buy?.solAmount ?? null,
        exitSol:   ev.solAmount,
        pnlSol,
        pnlPct:    (buy && buy.solAmount > 0) ? (pnlSol / buy.solAmount) * 100 : null,
        holdSecs:  (buy?.blockTime != null && ev.blockTime != null)
          ? ev.blockTime - buy.blockTime
          : null,
      });
    }
  }

  // Remaining open buys (no matching sell yet)
  for (const [mint, buys] of Object.entries(openBuys)) {
    for (const buy of buys) {
      trades.push({
        mint,
        symbol:    buy.symbol || '',
        openTs:    buy.blockTime,
        closeTs:   null,
        entrySol:  buy.solAmount,
        exitSol:   null,
        pnlSol:    null,
        pnlPct:    null,
        holdSecs:  null,
      });
    }
  }

  return trades;
}

// ─── Main entry point ────────────────────────────────────────────────────────

/**
 * Full pipeline: signatures → transactions → swap events → matched trades.
 * @param {string} walletPubkey
 * @param {{ onProgress?: (msg: string) => void, limit?: number }} opts
 */
export async function fetchWalletTrades(walletPubkey, { onProgress, limit = 100, _rpcOverride } = {}) {
  const rpcUrl = _rpcOverride || getRpcConfigFromStorage().rpcUrl;
  if (!rpcUrl) throw new Error('No RPC URL configured. Set one in the Auto Tools panel.');

  onProgress?.(`Fetching last ${limit} signatures…`);
  const sigRecords = await fetchWalletSignatures(walletPubkey, rpcUrl, { limit });
  if (!sigRecords.length) return [];

  onProgress?.(`Fetching ${sigRecords.length} transactions…`);
  const txRecords = await fetchParsedTransactions(sigRecords, rpcUrl, { batchSize: 5 });

  onProgress?.('Parsing swap events…');
  const swapEvents = txRecords.flatMap(r => parseSwapEvents(r, walletPubkey));

  onProgress?.('Matching trades…');
  return matchTrades(swapEvents);
}

// ─── CSV export ──────────────────────────────────────────────────────────────

export function tradesToCsv(trades) {
  const headers = ['Symbol', 'Mint', 'Open (UTC)', 'Close (UTC)', 'Entry SOL', 'Exit SOL',
    'PnL SOL', 'PnL %', 'Hold (s)'];
  const rows = trades.map(t => [
    t.symbol,
    t.mint,
    t.openTs  ? new Date(t.openTs  * 1000).toISOString() : '',
    t.closeTs ? new Date(t.closeTs * 1000).toISOString() : '',
    t.entrySol != null ? t.entrySol.toFixed(4) : '',
    t.exitSol  != null ? t.exitSol.toFixed(4)  : '',
    t.pnlSol   != null ? t.pnlSol.toFixed(4)   : '',
    t.pnlPct   != null ? t.pnlPct.toFixed(2)   : '',
    t.holdSecs ?? '',
  ]);
  return [headers, ...rows].map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
}
