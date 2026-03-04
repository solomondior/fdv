# Split dex.js into Focused Modules

## Problem

`src/vista/addons/auto/lib/dex.js` is 2870 lines and handles:
- Jupiter quote fetching
- Route selection and comparison
- Swap transaction building
- Slippage calculation and bumping
- Fallback routing paths
- Error handling and retries

This is a classic god file. It's hard to test, hard to reason about, and any change
risks unintended side effects. New contributors can't find what they need.

## Goal

Split `dex.js` into 4 focused modules without changing any external behavior.
All existing callers continue to work by importing from a thin re-export barrel.

## Proposed Module Split

```
src/vista/addons/auto/lib/
├── dex/
│   ├── index.js        ← re-exports everything (backwards compat)
│   ├── quote.js        ← Jupiter quote fetching & response parsing
│   ├── swap.js         ← transaction building & submission
│   ├── routing.js      ← route selection, comparison, fallback logic
│   └── slippage.js     ← slippage calculation, bump schedules, guards
└── dex.js              ← kept as thin proxy → import * from './dex/index.js'
```

## Module Responsibilities

### `quote.js`
- `fetchQuote(inputMint, outputMint, amount, opts)`
- `parseQuoteResponse(raw)`
- Quote caching and deduplication
- API key management for Jupiter

### `swap.js`
- `buildSwapTransaction(quote, wallet, opts)`
- `submitSwap(tx, connection, opts)`
- Confirmation polling
- Priority fee attachment

### `routing.js`
- `selectBestRoute(quotes)`
- `comparRoutes(a, b)`
- Fallback route enumeration (split paths, bridge tokens)
- No-route error handling and cooldown

### `slippage.js`
- `calcSlippage(liquidity, size, market)`
- `bumpSlippage(current, attempt)`
- Max slippage guards
- Dynamic slippage under RPC backoff

## Migration Strategy

1. **No behavior changes** — this is a pure refactor
2. Work function-by-function: move each function to its new home, update internal calls within the module
3. `dex/index.js` re-exports everything so existing `import { X } from './dex.js'` calls keep working
4. Delete old `dex.js` content last, after all imports are verified

## Step-by-Step

```
Step 1: Create dex/ directory and empty module files
Step 2: Move slippage functions to slippage.js (no internal deps)
Step 3: Move quote functions to quote.js (imports slippage.js)
Step 4: Move routing functions to routing.js (imports quote.js)
Step 5: Move swap functions to swap.js (imports all three)
Step 6: Write dex/index.js re-exports
Step 7: Replace dex.js content with: export * from './dex/index.js'
Step 8: Run the trader simulator (tools/trader.mjs) to verify no regression
```

## Acceptance Criteria

- [ ] `dex.js` is a one-line re-export, not functional code
- [ ] Each new module is under 800 lines
- [ ] All existing callers still work without modification
- [ ] `tools/trader.mjs` simulation passes without errors
- [ ] No new public API surface — same function names exported
