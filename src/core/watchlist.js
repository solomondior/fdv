const KEY = 'fdv_watchlist';

let _cache = null;

function load() {
  if (_cache) return _cache;
  try { _cache = JSON.parse(localStorage.getItem(KEY)) ?? []; }
  catch { _cache = []; }
  return _cache;
}

function save(list) {
  _cache = list;
  try { localStorage.setItem(KEY, JSON.stringify(list)); } catch {}
}

export function getWatchlist() { return load(); }

export function isWatched(mint) {
  if (!mint) return false;
  return load().includes(mint);
}

export function toggleWatch(mint) {
  if (!mint) return false;
  const list = load();
  const watched = list.includes(mint);
  const next = watched ? list.filter(m => m !== mint) : [...list, mint];
  save(next);
  try {
    window.dispatchEvent(new CustomEvent('fdv:watchlist-change', {
      detail: { mint, watched: !watched },
    }));
  } catch {}
  return !watched;
}

export function clearWatchlist() { save([]); }
