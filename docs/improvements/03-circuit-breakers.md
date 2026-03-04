# Per-Source Circuit Breakers

## Problem

If DEXScreener, CoinGecko, Birdeye, or any other data source goes down or starts returning errors,
the pipeline currently retries endlessly or silently fails. This can cause the whole radar to
stall, show stale data with no warning, or spam the console with errors.

## Goal

Each data source gets a circuit breaker: after N consecutive failures it trips OPEN and stops
attempting fetches for a cooldown period, then moves to HALF-OPEN to probe recovery.
The UI shows a small badge when a source is degraded.

## Files to Touch

- `src/core/circuitBreaker.js` — new file, circuit breaker class
- `src/data/*.js` — wrap each fetcher with the breaker
- `src/vista/meme/page.js` (or header component) — show degraded-source indicator

## States

```
CLOSED  → normal, requests pass through
OPEN    → tripped, requests blocked for cooldown (default 30s)
HALF    → cooldown elapsed, next request is a probe; success → CLOSED, fail → OPEN again
```

## Implementation Plan

### 1. Create `src/core/circuitBreaker.js`

```js
export class CircuitBreaker {
  #state = 'CLOSED'
  #failures = 0
  #lastFailTime = 0

  constructor({
    name,
    threshold   = 3,      // failures before tripping
    cooldown    = 30_000, // ms before trying again
    onStateChange,
  } = {}) {
    this.name = name
    this.threshold = threshold
    this.cooldown = cooldown
    this.onStateChange = onStateChange ?? (() => {})
  }

  get state() { return this.#state }

  async call(fn) {
    if (this.#state === 'OPEN') {
      if (Date.now() - this.#lastFailTime < this.cooldown) {
        throw new Error(`[CircuitBreaker:${this.name}] OPEN — skipping request`)
      }
      this.#setState('HALF')
    }

    try {
      const result = await fn()
      this.#onSuccess()
      return result
    } catch (err) {
      this.#onFailure()
      throw err
    }
  }

  #onSuccess() {
    this.#failures = 0
    if (this.#state !== 'CLOSED') this.#setState('CLOSED')
  }

  #onFailure() {
    this.#failures++
    this.#lastFailTime = Date.now()
    if (this.#state === 'HALF' || this.#failures >= this.threshold) {
      this.#setState('OPEN')
    }
  }

  #setState(next) {
    this.#state = next
    this.onStateChange(this.name, next)
  }
}
```

### 2. Instantiate one breaker per source

```js
// src/data/breakers.js
import { CircuitBreaker } from '../core/circuitBreaker.js'
import { emitSourceHealth } from '../engine/pipeline.js'

const make = (name) => new CircuitBreaker({
  name,
  onStateChange: (src, state) => emitSourceHealth(src, state)
})

export const breakers = {
  dexscreener: make('dexscreener'),
  jupiter:     make('jupiter'),
  birdeye:     make('birdeye'),
  coingecko:   make('coingecko'),
  rpc:         make('rpc'),
}
```

### 3. Wrap fetchers

```js
// src/data/dexscreener.js
import { breakers } from './breakers.js'

export async function fetchPairs(mints) {
  return breakers.dexscreener.call(() => _fetchPairs(mints))
}
```

### 4. Show degraded indicator in UI

When `emitSourceHealth` fires with `state === 'OPEN'`, render a small pill in the header:

```
⚠ DEXScreener degraded
```

Auto-dismiss when state returns to `CLOSED`.

## Acceptance Criteria

- [ ] 3 consecutive fetch failures for a source trips the breaker
- [ ] Tripped source stops being called for 30s
- [ ] After cooldown, one probe request is sent
- [ ] Successful probe resets the breaker to CLOSED
- [ ] UI shows a degraded pill when any source is OPEN
- [ ] Other sources continue working normally when one is tripped
