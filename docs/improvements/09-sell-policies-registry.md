# Sell Policies Registry Pattern

## Problem

The 17 sell policy modules in `src/vista/addons/auto/lib/sell/policies/` are wired together
in the orchestrator using a series of `import` statements and conditional checks. Adding a new
policy means touching the orchestrator file directly. There's no runtime way to inspect which
policies are active or disable one without editing code.

## Goal

Replace the manual import chain with a policy registry. Policies register themselves;
the orchestrator iterates the registry. New policies are added by creating a file and
adding one line to the registry — the orchestrator never changes.

## Current Pattern (Problem)

```js
// orchestrator.js (simplified)
import { agentDecision }     from './policies/agentDecision.js'
import { profitLock }        from './policies/profitLock.js'
import { dynamicHardStop }   from './policies/dynamicHardStop.js'
// ... 14 more imports ...

async function evaluateSell(position, market) {
  if (await agentDecision(position, market))   return { sell: true, reason: 'agent' }
  if (await profitLock(position, market))      return { sell: true, reason: 'profit-lock' }
  if (await dynamicHardStop(position, market)) return { sell: true, reason: 'hard-stop' }
  // ... 14 more ifs ...
  return { sell: false }
}
```

## Target Pattern (Registry)

```js
// policies/registry.js
const policies = []

export function registerPolicy(policy) {
  // policy: { name, priority, evaluate(position, market) → Promise<{sell, reason}|null> }
  policies.push(policy)
  policies.sort((a, b) => a.priority - b.priority)
}

export function getPolicies() { return [...policies] }
```

Each policy self-registers:

```js
// policies/profitLock.js
import { registerPolicy } from './registry.js'

registerPolicy({
  name: 'profit-lock',
  priority: 20,
  async evaluate(position, market) {
    // ... existing logic ...
    if (shouldLock) return { sell: true, reason: 'profit-lock' }
    return null
  }
})
```

The orchestrator becomes:

```js
// orchestrator.js
import './policies/agentDecision.js'    // side-effect: registers itself
import './policies/profitLock.js'
// ... one import per policy, nothing else changes ...
import { getPolicies } from './policies/registry.js'

async function evaluateSell(position, market) {
  for (const policy of getPolicies()) {
    const result = await policy.evaluate(position, market)
    if (result) return result
  }
  return { sell: false }
}
```

## Benefits

- **Add a policy:** create file + one import line. Orchestrator untouched.
- **Disable a policy:** comment out its import. No logic changes.
- **Debug:** iterate `getPolicies()` to see exactly what's registered and in what order.
- **Test:** inject mock policies into the registry in unit tests.

## Priority Assignments

| Priority | Policy |
|----------|--------|
| 10 | preflight |
| 15 | agentDecision |
| 20 | profitLock |
| 25 | dynamicHardStop |
| 30 | volatilityGuard |
| 40 | earlyFade |
| 50 | pnlFadeExit |
| 60 | leaderMode |
| 70 | fallbackSell |
| ... | (remaining policies) |

## Migration Steps

1. Create `policies/registry.js`
2. For each policy file: wrap logic in `registerPolicy({ name, priority, evaluate })`
3. Update orchestrator to import-for-side-effects + use `getPolicies()`
4. Remove the 17 manual if-chains from the orchestrator
5. Verify `tools/trader.mjs` simulation produces identical sell decisions

## Acceptance Criteria

- [ ] `policies/registry.js` exists with `registerPolicy` and `getPolicies`
- [ ] All 17 existing policies self-register on import
- [ ] Orchestrator contains no direct policy logic, only iteration
- [ ] Policies fire in priority order
- [ ] Commenting out a policy import disables it cleanly
- [ ] `tools/trader.mjs` simulation passes without behavioral changes
