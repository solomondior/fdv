import { esc, fmtNum, relTime } from "../formatters.js";

import { sparklineSVG } from "../../meme/render/sparkline.js";

import { getRugSignalForMint } from "../../meme/metrics/kpi/pumping.js";

const DAS_STORAGE_KEY = "meme_das_history_v1";
const DBS_STORAGE_KEY = "meme_dbs_history_v1";
const COMEBACK_STORAGE_KEY = "meme_comeback_history_v1";
const ENG_STORAGE_KEY = "meme_engagement_history_v1";
const EFF_STORAGE_KEY = "meme_liq_eff_history_v1";
const MOM_STORAGE_KEY = "meme_mcap_momentum_v1";
const DD_STORAGE_KEY = "meme_drawdown_resistance_v1";
const HGV_STORAGE_KEY = "meme_holder_velocity_v1";
const IMB_STORAGE_KEY = "meme_flow_imbalance_v1";
const TX24_STORAGE_KEY = "meme_tx24_counts_v1";

const DBS_WINDOW_DAYS = 3;
const DBS_HALFLIFE_DAYS = 1.25;
const DBS_MIN_LIQ_USD = 5000;
const DBS_MIN_VOL_USD = 1000;

const DAY_MS = 24 * 3600 * 1000;

const SERIES_MAX = 60;
const SPARK_POINTS = 24;
const TICK_MS = 2500;

function normMint(m) {
  return String(m || "").trim();
}

function safeJsonParse(raw, fallback) {
  try {
    const v = JSON.parse(raw);
    return v ?? fallback;
  } catch {
    return fallback;
  }
}

function loadStore() {
  const g = globalThis;
  if (!g.__fdvProfileKpiStore) {
    g.__fdvProfileKpiStore = {
      mint: "",
      byKey: new Map(),
      timer: null,
      lastRenderAt: 0,
    };
  }
  return g.__fdvProfileKpiStore;
}

function clamp(n, lo, hi) {
  return Math.min(hi, Math.max(lo, n));
}

function dedupeAppend(series, { ts, v }) {
  if (!Array.isArray(series)) return [{ ts, v }];
  const last = series[series.length - 1];

  const t = Number(ts || 0) || Date.now();
  const val = Number(v);
  if (!Number.isFinite(val)) return series;

  if (last) {
    const dt = Math.abs(t - Number(last.ts || 0));
    const dv = Math.abs(val - Number(last.v));
    if (dt < 1000) return series; // too soon
    if (dv < 1e-9) return series; // unchanged
  }

  const next = [...series, { ts: t, v: val }];
  return next.length > SERIES_MAX ? next.slice(-SERIES_MAX) : next;
}

function seriesToSparkVals(series) {
  const arr = Array.isArray(series) ? series : [];
  const tail = arr.slice(-SPARK_POINTS);
  return tail.map((p) => (Number.isFinite(Number(p?.v)) ? Number(p.v) : 0));
}

function readByMintHistory(storageKey, mint) {
  try {
    if (typeof localStorage === "undefined") return [];
    const raw = localStorage.getItem(storageKey);
    const h = raw ? safeJsonParse(raw, null) : null;
    const byMint = h && typeof h === "object" ? h.byMint : null;
    const arr = byMint && typeof byMint === "object" ? byMint[mint] : null;
    return Array.isArray(arr) ? arr.slice() : [];
  } catch {
    return [];
  }
}

function seedFromHistoryWithScore(storageKey, mint) {
  const rows = readByMintHistory(storageKey, mint);
  if (!rows.length) return [];
  const series = [];
  for (const e of rows) {
    const ts = Number(e?.ts || 0) || 0;
    const v = Number(e?.score);
    if (!Number.isFinite(v)) continue;
    series.push({ ts, v });
  }
  series.sort((a, b) => a.ts - b.ts);
  return series.slice(-SERIES_MAX);
}

function seedMomVelocity(mint) {
  const rows = readByMintHistory(MOM_STORAGE_KEY, mint)
    .map((e) => ({ ts: Number(e?.ts || 0) || 0, mcap: Number(e?.mcap) }))
    .filter((e) => e.ts > 0 && Number.isFinite(e.mcap));
  rows.sort((a, b) => a.ts - b.ts);
  if (rows.length < 2) return [];

  const out = [];
  for (let i = 1; i < rows.length; i++) {
    const a = rows[i - 1];
    const b = rows[i];
    const dtH = Math.max((b.ts - a.ts) / (3600 * 1000), 1e-6);
    const vel = (b.mcap - a.mcap) / dtH; // USD per hour
    out.push({ ts: b.ts, v: vel });
  }
  return out.slice(-SERIES_MAX);
}

function maxDrawdownPct(prices) {
  if (!Array.isArray(prices) || prices.length < 2) return 0;
  let peak = prices[0];
  let maxDd = 0;
  for (const p of prices) {
    if (!Number.isFinite(p) || p <= 0) continue;
    if (p > peak) peak = p;
    const dd = (peak - p) / peak;
    if (dd > maxDd) maxDd = dd;
  }
  return maxDd * 100;
}

function seedDrawdownResistance(mint) {
  const rows = readByMintHistory(DD_STORAGE_KEY, mint)
    .map((e) => ({ ts: Number(e?.ts || 0) || 0, price: Number(e?.priceUsd) }))
    .filter((e) => e.ts > 0 && Number.isFinite(e.price) && e.price > 0);
  rows.sort((a, b) => a.ts - b.ts);
  if (rows.length < 2) return [];

  const out = [];
  const priceTrail = [];
  for (const r of rows) {
    priceTrail.push(r.price);
    const dd = maxDrawdownPct(priceTrail);
    const resistance = clamp(100 - dd, 0, 100);
    out.push({ ts: r.ts, v: resistance });
  }
  return out.slice(-SERIES_MAX);
}

function seedActivityVelocity(mint) {
  const rows = readByMintHistory(HGV_STORAGE_KEY, mint)
    .map((e) => ({ ts: Number(e?.ts || 0) || 0, a: Number(e?.activity24) }))
    .filter((e) => e.ts > 0 && Number.isFinite(e.a));
  rows.sort((a, b) => a.ts - b.ts);
  if (rows.length < 2) return [];

  const out = [];
  for (let i = 1; i < rows.length; i++) {
    const prev = rows[i - 1];
    const cur = rows[i];
    const dtDays = Math.max((cur.ts - prev.ts) / DAY_MS, 1e-4);
    const vel = (cur.a - prev.a) / dtDays;
    out.push({ ts: cur.ts, v: vel });
  }
  return out.slice(-SERIES_MAX);
}

// Lightweight DBS (degen bounce score) calculation copied from KPI logic.
// This enables per-mint scoring over its stored history without depending on internal exports.
const LN2 = Math.log(2);
function decayWeights(arr, nowTs, halflifeDays = DBS_HALFLIFE_DAYS) {
  const lambda = LN2 / Math.max(1e-6, halflifeDays);
  return arr
    .map((e) => {
      const ageDays = (nowTs - (+e.ts)) / DAY_MS;
      const w = ageDays >= 0 ? Math.exp(-lambda * ageDays) : 0;
      return { e, w };
    })
    .filter((x) => x.w > 0);
}
function decayedMeanStd(vals, weights) {
  const wsum = weights.reduce((a, b) => a + b, 0);
  if (wsum <= 0) return { mean: 0, std: 0 };
  const mean = vals.reduce((a, v, i) => a + v * weights[i], 0) / wsum;
  const varNum = vals.reduce((a, v, i) => a + weights[i] * (v - mean) * (v - mean), 0);
  const std = Math.sqrt(Math.max(0, varNum / Math.max(1e-9, wsum)));
  return { mean, std };
}
function safeZ(x, mean, std) {
  return std > 0 ? (x - mean) / std : 0;
}
function computeDbsForMint(records, nowTs) {
  const cutoff = nowTs - DBS_WINDOW_DAYS * DAY_MS;
  const recent = (Array.isArray(records) ? records : []).filter((e) => +e.ts >= cutoff);
  if (!recent.length) return 0;

  const latest = recent[recent.length - 1].kp || {};
  const chg24 = Number(latest?.chg24 ?? latest?.change?.h24 ?? latest?.change24h ?? latest?.chg24 ?? 0) || 0;
  const vol24 = Number(latest?.vol24 ?? latest?.volume?.h24 ?? 0) || 0;
  const liqUsd = Number(latest?.liqUsd ?? latest?.liquidityUsd ?? 0) || 0;
  const priceUsd = Number(latest?.priceUsd ?? 0) || 0;

  if (liqUsd < DBS_MIN_LIQ_USD) return 0;
  if (vol24 < DBS_MIN_VOL_USD) return 0;
  if (!Number.isFinite(priceUsd) || priceUsd <= 0) return 0;

  const dw = decayWeights(recent, nowTs, DBS_HALFLIFE_DAYS);
  const volVals = dw.map((x) => Number(x.e.kp?.vol24) || 0);
  const volWts = dw.map((x) => x.w);
  const priceVals = dw.map((x) => Number(x.e.kp?.priceUsd) || 0);
  const priceWts = dw.map((x) => x.w);

  const { mean: volMean, std: volStd } = decayedMeanStd(volVals, volWts);
  const { mean: priceMean } = decayedMeanStd(priceVals, priceWts);

  const pain = clamp(-chg24, 0, 100);
  const zVol = Math.max(0, safeZ(vol24, volMean, volStd));
  const lastK = recent.slice(-5).map((e) => e.kp?.priceUsd || 0);
  const minRecent = Math.min(...lastK, priceUsd);
  const offBottom = minRecent > 0 ? (priceUsd - minRecent) / minRecent : 0;
  const bounce = clamp(offBottom / 0.10, 0, 1);
  const cheapness = priceMean > 0 ? clamp((priceMean - priceUsd) / priceMean, 0, 1) : 0;

  const score01 = clamp(
    0.40 * (pain / 100) +
      0.25 * clamp(zVol / 3, 0, 1) +
      0.20 * bounce +
      0.15 * cheapness,
    0,
    1
  );
  return Math.round(score01 * 100);
}

function seedDbsSeries(mint) {
  const rows = readByMintHistory(DBS_STORAGE_KEY, mint)
    .map((e) => ({ ts: Number(e?.ts || 0) || 0, kp: e?.kp || {} }))
    .filter((e) => e.ts > 0);
  rows.sort((a, b) => a.ts - b.ts);
  if (rows.length < 2) return [];

  // Compute DBS over time using cumulative history up to each timestamp.
  const out = [];
  const running = [];
  for (const r of rows) {
    running.push(r);
    const v = computeDbsForMint(running, r.ts);
    if (Number.isFinite(v)) out.push({ ts: r.ts, v });
  }
  return out.slice(-SERIES_MAX);
}

function readSnapshotRow(storageKey, mint) {
  try {
    if (typeof localStorage === "undefined") return null;
    const raw = localStorage.getItem(storageKey);
    const rows = raw ? safeJsonParse(raw, null) : null;
    if (!Array.isArray(rows) || !rows.length) return null;
    const m = normMint(mint);
    return rows.find((r) => normMint(r?.mint) === m) || null;
  } catch {
    return null;
  }
}

const KPI_DEFS = [
  {
    key: "pumping",
    label: "PUMP",
    metricLabel: "Score",
    seedSeries: () => [],
    readNow: (mint) => {
      const sig = getRugSignalForMint(mint);
      if (!sig) return null;
      return { v: Number(sig.score || 0), note: sig.badge || "" };
    },
    fmt: (v) => (Number.isFinite(v) ? v.toFixed(2) : "—"),
  },
  {
    key: "dbs",
    label: "DBS",
    metricLabel: "Score",
    seedSeries: (mint) => seedDbsSeries(mint),
    readNow: (mint) => {
      const rows = readByMintHistory(DBS_STORAGE_KEY, mint);
      if (!rows.length) return null;
      const recs = rows.map((e) => ({ ts: Number(e?.ts || 0) || 0, kp: e?.kp || {} })).filter((e) => e.ts > 0);
      if (!recs.length) return null;
      const ts = recs[recs.length - 1].ts;
      const v = computeDbsForMint(recs, ts);
      return { v };
    },
    fmt: (v) => (Number.isFinite(v) ? fmtNum(Math.round(v)) : "—"),
  },
  {
    key: "das",
    label: "DAS",
    metricLabel: "Score",
    seedSeries: (mint) => seedFromHistoryWithScore(DAS_STORAGE_KEY, mint),
    readNow: (mint) => {
      const rows = readByMintHistory(DAS_STORAGE_KEY, mint);
      const last = rows[rows.length - 1];
      const v = Number(last?.score);
      return Number.isFinite(v) ? { v } : null;
    },
    fmt: (v) => (Number.isFinite(v) ? fmtNum(Math.round(v)) : "—"),
  },
  {
    key: "comeback",
    label: "COMEBACK",
    metricLabel: "Score",
    seedSeries: (mint) => seedFromHistoryWithScore(COMEBACK_STORAGE_KEY, mint),
    readNow: (mint) => {
      const rows = readByMintHistory(COMEBACK_STORAGE_KEY, mint);
      const last = rows[rows.length - 1];
      const v = Number(last?.score);
      return Number.isFinite(v) ? { v } : null;
    },
    fmt: (v) => (Number.isFinite(v) ? fmtNum(Math.round(v)) : "—"),
  },
  {
    key: "eng",
    label: "ENG",
    metricLabel: "Score",
    seedSeries: (mint) => seedFromHistoryWithScore(ENG_STORAGE_KEY, mint),
    readNow: (mint) => {
      const rows = readByMintHistory(ENG_STORAGE_KEY, mint);
      const last = rows[rows.length - 1];
      const v = Number(last?.score);
      return Number.isFinite(v) ? { v } : null;
    },
    fmt: (v) => (Number.isFinite(v) ? fmtNum(Math.round(v)) : "—"),
  },
  {
    key: "liq_eff",
    label: "Liq Eff",
    metricLabel: "Metric",
    seedSeries: (mint) => seedFromHistoryWithScore(EFF_STORAGE_KEY, mint),
    readNow: (mint) => {
      const rows = readByMintHistory(EFF_STORAGE_KEY, mint);
      const last = rows[rows.length - 1];
      const v = Number(last?.score);
      return Number.isFinite(v) ? { v } : null;
    },
    fmt: (v) => (Number.isFinite(v) ? v.toFixed(4) : "—"),
  },
  {
    key: "mom",
    label: "MCAP Δ/h",
    metricLabel: "USD/h",
    seedSeries: (mint) => seedMomVelocity(mint),
    readNow: (mint) => {
      const rows = readByMintHistory(MOM_STORAGE_KEY, mint);
      const a = rows[rows.length - 2];
      const b = rows[rows.length - 1];
      const tsA = Number(a?.ts || 0) || 0;
      const tsB = Number(b?.ts || 0) || 0;
      const mA = Number(a?.mcap);
      const mB = Number(b?.mcap);
      if (!(tsA > 0 && tsB > tsA && Number.isFinite(mA) && Number.isFinite(mB))) return null;
      const vel = (mB - mA) / Math.max((tsB - tsA) / (3600 * 1000), 1e-6);
      return { v: vel };
    },
    fmt: (v) => (Number.isFinite(v) ? "$" + Intl.NumberFormat(undefined, { notation: "compact" }).format(v) : "—"),
  },
  {
    key: "dd",
    label: "DD Resist",
    metricLabel: "%",
    seedSeries: (mint) => seedDrawdownResistance(mint),
    readNow: (mint) => {
      const rows = readByMintHistory(DD_STORAGE_KEY, mint)
        .map((e) => Number(e?.priceUsd))
        .filter((p) => Number.isFinite(p) && p > 0);
      if (rows.length < 2) return null;
      const dd = maxDrawdownPct(rows);
      return { v: clamp(100 - dd, 0, 100) };
    },
    fmt: (v) => (Number.isFinite(v) ? `${v.toFixed(1)}%` : "—"),
  },
  {
    key: "hgv",
    label: "HGV",
    metricLabel: "/day",
    seedSeries: (mint) => seedActivityVelocity(mint),
    readNow: (mint) => {
      const rows = readByMintHistory(HGV_STORAGE_KEY, mint);
      const a = rows[rows.length - 2];
      const b = rows[rows.length - 1];
      const tsA = Number(a?.ts || 0) || 0;
      const tsB = Number(b?.ts || 0) || 0;
      const xA = Number(a?.activity24);
      const xB = Number(b?.activity24);
      if (!(tsA > 0 && tsB > tsA && Number.isFinite(xA) && Number.isFinite(xB))) return null;
      const vel = (xB - xA) / Math.max((tsB - tsA) / DAY_MS, 1e-4);
      return { v: vel };
    },
    fmt: (v) => (Number.isFinite(v) ? fmtNum(Math.round(v)) : "—"),
  },
  {
    key: "imb",
    label: "Imbalance",
    metricLabel: "%",
    seedSeries: () => [],
    readNow: (mint) => {
      const row = readSnapshotRow(IMB_STORAGE_KEY, mint);
      const v = Number(row?.metric);
      return Number.isFinite(v) ? { v } : null;
    },
    fmt: (v) => (Number.isFinite(v) ? `${v.toFixed(1)}%` : "—"),
  },
  {
    key: "tx24",
    label: "Tx 24h",
    metricLabel: "Tx",
    seedSeries: () => [],
    readNow: (mint) => {
      const row = readSnapshotRow(TX24_STORAGE_KEY, mint);
      const v = Number(row?.tx24 ?? row?.metric);
      return Number.isFinite(v) ? { v } : null;
    },
    fmt: (v) => (Number.isFinite(v) ? fmtNum(Math.round(v)) : "—"),
  },
];

function renderTable(mint) {
  const body = document.getElementById("kpiMetricsBody");
  if (!body) return false;

  const store = loadStore();

  const rowsHtml = KPI_DEFS.map((def) => {
    const seriesKey = `${mint}:${def.key}`;
    const series = store.byKey.get(seriesKey) || [];
    const last = series[series.length - 1] || null;
    const lastTs = Number(last?.ts || 0) || 0;
    const age = lastTs ? relTime(Date.now() - lastTs) : "—";

    const sparkVals = seriesToSparkVals(series);
    const spark = sparkVals.length >= 2 ? sparklineSVG(sparkVals, { w: 84, h: 20 }) : "";

    const lastVal = last && Number.isFinite(Number(last.v)) ? Number(last.v) : NaN;
    const latestTxt = def.fmt(lastVal);

    return `
      <tr>
        <td>
          <b>${esc(def.label)}</b>
          <span class="muted small" style="margin-left:6px;">${esc(def.metricLabel)}</span>
        </td>
        <td>
          <span>${esc(latestTxt)}</span>
          <span class="muted small" style="margin-left:8px;">${esc(age)}</span>
        </td>
        <td>${spark || '<span class="muted small">—</span>'}</td>
      </tr>
    `;
  }).join("");

  body.innerHTML = rowsHtml;
  store.lastRenderAt = Date.now();
  return true;
}

function ensureSeeded(mint) {
  const store = loadStore();
  for (const def of KPI_DEFS) {
    const seriesKey = `${mint}:${def.key}`;
    if (store.byKey.has(seriesKey)) continue;
    let seeded = [];
    try {
      seeded = def.seedSeries ? def.seedSeries(mint) : [];
    } catch {
      seeded = [];
    }
    store.byKey.set(seriesKey, Array.isArray(seeded) ? seeded : []);
  }
}

function tick(mint) {
  const body = document.getElementById("kpiMetricsBody");
  if (!body) return false;

  const store = loadStore();

  ensureSeeded(mint);

  // Best-available instant metrics based on the current token snapshot (if present).
  // These fill in immediately on landing even if there is no KPI history yet.
  try {
    const token = store.token;
    const tokenMint = normMint(token?.mint ?? token?.id);
    if (token && tokenMint && tokenMint === normMint(mint)) {
      const buys = Number(token?.tx24h?.buys);
      const sells = Number(token?.tx24h?.sells);
      if (Number.isFinite(buys) && Number.isFinite(sells)) {
        const tx24 = buys + sells;
        const denom = Math.max(tx24, 1);
        const imbPct = ((buys - sells) / denom) * 100;
        // Use dedicated keys so the same KPI row will show something instantly.
        {
          const seriesKey = `${mint}:tx24`;
          const prev = store.byKey.get(seriesKey) || [];
          store.byKey.set(seriesKey, dedupeAppend(prev, { ts: Date.now(), v: tx24 }));
        }
        {
          const seriesKey = `${mint}:imb`;
          const prev = store.byKey.get(seriesKey) || [];
          store.byKey.set(seriesKey, dedupeAppend(prev, { ts: Date.now(), v: imbPct }));
        }
      }

      const chg24 = Number(token?.change24h);
      if (Number.isFinite(chg24)) {
        const ddRes = clamp(100 + chg24, 0, 100);
        const seriesKey = `${mint}:dd`;
        const prev = store.byKey.get(seriesKey) || [];
        store.byKey.set(seriesKey, dedupeAppend(prev, { ts: Date.now(), v: ddRes }));
      }

      const liq = Number(token?.liquidityUsd);
      const vol24 = Number(token?.v24hTotal);
      if (Number.isFinite(liq) && liq >= 0 && Number.isFinite(vol24) && vol24 >= 0) {
        const effBase = vol24 / (liq + 1);
        const seriesKey = `${mint}:liq_eff`;
        const prev = store.byKey.get(seriesKey) || [];
        store.byKey.set(seriesKey, dedupeAppend(prev, { ts: Date.now(), v: effBase }));
      }
    }
  } catch {}

  for (const def of KPI_DEFS) {
    try {
      const nowVal = def.readNow?.(mint);
      if (!nowVal || !Number.isFinite(Number(nowVal.v))) continue;
      const seriesKey = `${mint}:${def.key}`;
      const prev = store.byKey.get(seriesKey) || [];
      const next = dedupeAppend(prev, { ts: Date.now(), v: Number(nowVal.v) });
      if (next !== prev) store.byKey.set(seriesKey, next);
    } catch {}
  }

  renderTable(mint);
  return true;
}

export function mountProfileKpiMetrics({ mint, token } = {}) {
  const m = normMint(mint);
  if (!m) return null;

  const body = document.getElementById("kpiMetricsBody");
  if (!body) return null;

  const store = loadStore();

  // Keep the latest token snapshot around for instant best-effort metrics.
  if (token && typeof token === 'object') store.token = token;

  // Reset timer if mint changes
  if (store.timer && store.mint && store.mint !== m) {
    try {
      clearInterval(store.timer);
    } catch {}
    store.timer = null;
  }
  store.mint = m;

  // Prime once.
  try {
    ensureSeeded(m);
    // Render immediately to clear the "Loading…" row even if tick() finds no data.
    renderTable(m);
    tick(m);
  } catch {}

  if (!store.timer) {
    store.timer = setInterval(() => {
      try {
        const ok = tick(store.mint);
        if (!ok) {
          clearInterval(store.timer);
          store.timer = null;
        }
      } catch {}
    }, TICK_MS);
  }

  return { mint: m };
}
