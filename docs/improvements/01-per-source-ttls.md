# Per-Source Cache TTLs

## Problem

The pipeline uses a single global 90-second TTL for all cached data regardless of source.
DEXScreener updates pair data every ~10s, while CoinGecko historical data barely changes in an hour.
A flat TTL means either stale prices (too long) or hammering slow APIs (too short).

## Goal

Give each data source its own TTL so fast-moving sources refresh aggressively and slow sources stay cached longer.

## Files to Touch

- `src/config/env.js` — add `CACHE_TTL` map
- `src/core/cache.js` (or wherever the TTL constant lives) — consume the map
- Each fetcher in `src/data/` — pass source key when reading/writing cache

## Implementation Plan

### 1. Define TTLs in `env.js`

```js
export const CACHE_TTL = {
  dexscreener:  10_000,   // 10s  — live pair data
  jupiter:      15_000,   // 15s  — trending + quotes
  birdeye:      30_000,   // 30s  — on-chain metrics
  coingecko:   300_000,   // 5m   — market cap / history
  rpc:          60_000,   // 1m   — holder counts
  default:      90_000,   // 90s  — fallback
}
```

### 2. Update cache read/write helpers

```js
// src/core/cache.js
import { CACHE_TTL } from '../config/env.js'

export function cacheGet(key, source = 'default') {
  const ttl = CACHE_TTL[source] ?? CACHE_TTL.default
  const entry = sessionStorage.getItem(key)
  if (!entry) return null
  const { ts, data } = JSON.parse(entry)
  if (Date.now() - ts > ttl) return null
  return data
}

export function cacheSet(key, data) {
  sessionStorage.setItem(key, JSON.stringify({ ts: Date.now(), data }))
}
```

### 3. Update each fetcher

Pass the source name when calling `cacheGet`:

```js
// src/data/dexscreener.js
const cached = cacheGet(cacheKey, 'dexscreener')
```

## Acceptance Criteria

- [ ] DEXScreener data refreshes within ~10s of a change
- [ ] CoinGecko is not re-fetched more than once per 5 minutes
- [ ] Unknown sources fall back to 90s default without errors
- [ ] No regression in existing cache-hit behavior
