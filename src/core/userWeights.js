import { RANK_WEIGHTS } from '../config/env.js';

const KEY = 'fdv_rank_weights_v1';
const KEYS = ['volume', 'liquidity', 'momentum', 'activity'];

export { RANK_WEIGHTS };

export function loadWeights() {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY));
    if (saved && typeof saved === 'object') return _normalize(saved);
  } catch {}
  return null; // null = use pipeline defaults
}

export function saveWeights(raw) {
  const w = _normalize(raw);
  try { localStorage.setItem(KEY, JSON.stringify(w)); } catch {}
  return w;
}

export function clearWeights() {
  try { localStorage.removeItem(KEY); } catch {}
}

function _normalize(raw) {
  const vals = KEYS.map(k => Math.max(0, Number(raw[k]) || 0));
  const sum = vals.reduce((a, b) => a + b, 0) || 1;
  return Object.fromEntries(KEYS.map((k, i) => [k, vals[i] / sum]));
}
