const API_BASE = 'https://votes.fdv.lol'; // Cloudflare Worker URL
const MY_VOTES_KEY = 'fdv_my_votes_v1';

export function getMyVote(mint) {
  try {
    const store = JSON.parse(localStorage.getItem(MY_VOTES_KEY) || '{}');
    const entry = store[mint];
    const today = Math.floor(Date.now() / 86_400_000);
    return (entry && entry.day === today) ? entry.dir : null;
  } catch { return null; }
}

export function setMyVote(mint, dir) {
  try {
    const store = JSON.parse(localStorage.getItem(MY_VOTES_KEY) || '{}');
    store[mint] = { dir, day: Math.floor(Date.now() / 86_400_000) };
    localStorage.setItem(MY_VOTES_KEY, JSON.stringify(store));
  } catch {}
}

let _votesCache = {}; // mint → { net, boosts, suppresses }
let _cacheTs    = 0;
const CACHE_TTL = 60_000; // 1 minute

/**
 * Fetch community vote aggregates for a list of mints.
 * Results are cached for 1 minute to avoid hammering the edge API.
 * @param {string[]} mints
 * @returns {Promise<Record<string, { net: number, boosts: number, suppresses: number }>>}
 */
export async function fetchVotes(mints) {
  if (Date.now() - _cacheTs < CACHE_TTL) return _votesCache;
  try {
    const res = await fetch(`${API_BASE}/votes?mints=${mints.slice(0, 50).join(',')}`);
    if (!res.ok) return _votesCache;
    const json = await res.json();
    _votesCache = json;
    _cacheTs = Date.now();
    return json;
  } catch { return _votesCache; }
}

/**
 * Submit a community vote for a token.
 * The caller provides a signFn that signs the daily message with their wallet.
 * Optimistically updates the local cache on success.
 *
 * @param {{ mint: string, direction: 1|-1, walletPubkey: string, signFn: Function }} opts
 */
export async function submitVote({ mint, direction, walletPubkey, signFn }) {
  const utcDay  = Math.floor(Date.now() / 86_400_000);
  const message = `fdv-vote:${mint}:${direction}:${utcDay}`;
  const signature = await signFn(message);
  const res = await fetch(`${API_BASE}/vote`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mint, direction, walletPubkey, signature }),
  });
  const json = await res.json();
  if (!json.ok) throw new Error(json.error ?? 'vote_failed');

  // Optimistically update local cache
  const prev = _votesCache[mint] ?? { net: 0, boosts: 0, suppresses: 0 };
  _votesCache = {
    ..._votesCache,
    [mint]: {
      net:        prev.net + direction,
      boosts:     direction > 0 ? prev.boosts + 1 : prev.boosts,
      suppresses: direction < 0 ? prev.suppresses + 1 : prev.suppresses,
    },
  };
  return _votesCache[mint];
}

/**
 * Return raw net vote count for a mint (null if unknown).
 * @param {string} mint
 * @returns {number|null}
 */
export function getVoteNet(mint) {
  const v = _votesCache[mint];
  return v != null ? v.net : null;
}

/**
 * Map net votes to a display score modifier.
 * ±100 net votes = ±0.10 modifier, clamped to ±0.15.
 * @param {string} mint
 * @returns {number}
 */
export function getVoteModifier(mint) {
  const v = _votesCache[mint];
  if (!v) return 0;
  return Math.max(-0.15, Math.min(0.15, v.net / 100));
}
