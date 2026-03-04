import { getRegisteredPolicies } from '../auto/lib/sell/policies/registry.js';

// ── Built-in stateless simulateFn implementations ────────────────────────────
// Each policy that is meaningful to backtest has an entry here.
// Real policies are stateful async factories — these are simplified, synchronous
// equivalents that work on normalized snapshot context objects.
//
// ctx shape: { mint, symbol, pnlPct, pnlSol, ageMs, curSol, costSol,
//              pxNow, hwmPx, urgent: { reason, sev }|null, state, decision }
//
// Set ctx.decision = { action, reason } to trigger a simulated sell.

const SIMULATE_FNS = {
  fastExit(ctx, params) {
    const sl = Number(params.stopLossPct   ?? ctx.state?.stopLossPct   ?? 8);
    const tp = Number(params.takeProfitPct ?? ctx.state?.takeProfitPct ?? 12);
    if (ctx.pnlPct <= -sl) {
      ctx.decision = { action: 'sell_all', reason: `SL ${ctx.pnlPct.toFixed(2)}%` };
    } else if (ctx.pnlPct >= tp) {
      ctx.decision = { action: 'sell_all', reason: `TP ${ctx.pnlPct.toFixed(2)}%` };
    }
  },

  profitLock(ctx, params) {
    const armAt  = Number(params.profitLockArmNetPct ?? ctx.state?.profitLockArmNetPct ?? 10);
    const retain = Number(params.profitLockRetainFrac ?? ctx.state?.profitLockRetainFrac ?? 0.55);
    if (ctx.pnlPct < armAt) return; // not armed yet
    if (ctx.hwmPx > 0 && ctx.pxNow > 0) {
      const dropFrac = (ctx.hwmPx - ctx.pxNow) / ctx.hwmPx;
      if (dropFrac >= 1 - retain) {
        ctx.decision = { action: 'sell_all', reason: `PROFIT_LOCK drop=${(dropFrac * 100).toFixed(1)}%` };
      }
    }
  },

  urgent(ctx) {
    if (Number(ctx.urgent?.sev ?? 0) >= 0.75) {
      ctx.decision = { action: 'sell_all', reason: `URGENT:${ctx.urgent?.reason || 'unknown'}` };
    }
  },

  fallback(ctx, params) {
    const maxHold = Number(params.maxHoldSecs ?? ctx.state?.maxHoldSecs ?? 0);
    if (maxHold > 0 && ctx.ageMs >= maxHold * 1000) {
      ctx.decision = { action: 'sell_all', reason: `FALLBACK max_hold=${maxHold}s` };
    }
  },
};

/** Returns true if a policy has a simulateFn and can participate in backtesting. */
export function hasSimulateFn(policyName) {
  return policyName === 'execute' ||
    Object.prototype.hasOwnProperty.call(SIMULATE_FNS, policyName);
}

// ── Snapshot loading ──────────────────────────────────────────────────────────

export async function listSnapshots() {
  try {
    const res = await fetch('/tools/snapshots/manifest.json');
    return res.ok ? res.json() : [];
  } catch { return []; }
}

export async function loadSnapshot(filename) {
  const res = await fetch(`/tools/snapshots/${encodeURIComponent(filename)}`);
  if (!res.ok) throw new Error(`Snapshot not found: ${filename}`);
  const data = await res.json();
  // Accept either an array of ticks or a single context object.
  return Array.isArray(data) ? data : [data];
}

// ── Snapshot normalization ────────────────────────────────────────────────────
// Handles two formats:
//   Spec tick:   { ts, mint, symbol, costSol, priceUsd, hwmPx, pnlPct }
//   Actual snap: { nowTs, pos: { costSol, acquiredAt, hwmPx }, pxNow, curSol, urgent, state }

function _normalizeSnap(raw) {
  if (raw.ts != null && raw.priceUsd != null) {
    // Spec tick format
    const costSol = Number(raw.costSol || 0);
    const curSol  = raw.curSol != null
      ? Number(raw.curSol)
      : costSol * (1 + Number(raw.pnlPct || 0) / 100);
    return {
      ts:     Number(raw.ts),
      mint:   String(raw.mint || ''),
      symbol: String(raw.symbol || raw.mint || '').slice(0, 8),
      costSol,
      curSol,
      pxNow:  Number(raw.priceUsd || 0),
      hwmPx:  Number(raw.hwmPx || 0),
      pnlPct: raw.pnlPct != null ? Number(raw.pnlPct)
        : costSol > 0 ? (curSol / costSol - 1) * 100 : 0,
      ageMs:  Number(raw.ageMs || 0),
      urgent: raw.urgent || null,
      state:  raw.state || {},
    };
  }

  // Actual snapshot format from tools/snapshots/
  const costSol = Number(raw.pos?.costSol || 0);
  const curSol  = Number(raw.curSol || 0);
  const ageMs   = (raw.nowTs && raw.pos?.acquiredAt)
    ? Math.max(0, Number(raw.nowTs) - Number(raw.pos.acquiredAt))
    : 0;

  return {
    ts:     Number(raw.nowTs || 0),
    mint:   String(raw.mint || ''),
    symbol: String(raw.symbol || raw.mint || '').slice(0, 8),
    costSol,
    curSol,
    pxNow:  Number(raw.pxNow || 0),
    hwmPx:  Number(raw.pos?.hwmPx || 0),
    pnlPct: costSol > 0 ? (curSol / costSol - 1) * 100 : 0,
    ageMs,
    urgent: raw.urgent || null,
    state:  raw.state || {},
  };
}

// ── Backtest engine ───────────────────────────────────────────────────────────

/**
 * Replay a set of snapshots through a policy combo and return aggregate stats.
 *
 * @param {Array}    snaps              Raw snapshot objects (single or array)
 * @param {object}   opts
 * @param {string[]} opts.activePolicies  Policy names to activate
 * @param {object}   opts.params          Optional param overrides (stopLossPct, etc.)
 * @returns {{ trades, total, totalPnlSol, winRate, avgHoldMs, maxDrawdown }}
 */
export function runBacktest(snaps, { activePolicies = [], params = {} } = {}) {
  const allPolicies = getRegisteredPolicies()
    .filter(p => activePolicies.includes(p.name));

  const trades = [];

  for (const raw of snaps) {
    const snap = _normalizeSnap(raw);

    const ctx = {
      mint:     snap.mint,
      symbol:   snap.symbol,
      pnlPct:   snap.pnlPct,
      pnlSol:   snap.curSol - snap.costSol,
      ageMs:    snap.ageMs,
      curSol:   snap.curSol,
      costSol:  snap.costSol,
      pxNow:    snap.pxNow,
      hwmPx:    snap.hwmPx,
      urgent:   snap.urgent,
      state:    snap.state,
      decision: null,
    };

    for (const p of allPolicies) {
      if (p.name === 'execute') continue; // execute is a no-op in simulation
      const simFn = SIMULATE_FNS[p.name] || p.simulateFn;
      if (typeof simFn === 'function') {
        simFn(ctx, params);
        if (ctx.decision) break;
      }
    }

    if (ctx.decision) {
      trades.push({
        mint:       snap.mint,
        symbol:     snap.symbol,
        pnlSol:     snap.curSol - snap.costSol,
        holdMs:     snap.ageMs,
        exitReason: ctx.decision.reason || ctx.decision.action || '',
      });
    }
  }

  return _summarize(trades, snaps.length);
}

function _summarize(trades, total = 0) {
  if (!trades.length) {
    return { trades, total, totalPnlSol: 0, winRate: 0, avgHoldMs: 0, maxDrawdown: 0 };
  }
  const totalPnlSol = trades.reduce((s, t) => s + t.pnlSol, 0);
  const winners     = trades.filter(t => t.pnlSol > 0).length;
  const winRate     = winners / trades.length;
  const avgHoldMs   = trades.reduce((s, t) => s + t.holdMs, 0) / trades.length;
  let peak = 0, maxDrawdown = 0, cum = 0;
  for (const t of trades) {
    cum += t.pnlSol;
    if (cum > peak) peak = cum;
    maxDrawdown = Math.min(maxDrawdown, cum - peak);
  }
  return { trades, total, totalPnlSol, winRate, avgHoldMs, maxDrawdown };
}
