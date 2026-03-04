/**
 * Sell Policy Registry
 *
 * Each policy entry:
 *   { name, priority, factory, modes }
 *
 * modes:
 *   'both'   — included in both normal and fullAiControl pipelines
 *   'normal' — included only in the standard pipeline
 *   'ai'     — included only in the fullAiControl pipeline
 *
 * Usage
 * -----
 * // Register (typically via registerAll.js side-effect import):
 *   registerPolicy('preflight', 10, createPreflightSellPolicy, 'both');
 *
 * // Inspect at runtime:
 *   getRegisteredPolicies();
 *
 * // Build a steps array for runPipeline():
 *   buildPipelineSteps(instanceMap, { mode: 'normal', skipSet, skipExecute });
 */

const _registry = new Map(); // name → { name, priority, factory, modes }

/**
 * Register a sell policy.
 * @param {string} name       — matches the step name used in the orchestrator
 * @param {number} priority   — lower = runs earlier
 * @param {Function} factory  — createXxxPolicy(deps) function
 * @param {'both'|'normal'|'ai'} [modes='both']
 */
export function registerPolicy(name, priority, factory, modes = 'both') {
  _registry.set(name, { name, priority, factory, modes });
}

/** Returns all registered policies sorted by priority ascending. */
export function getRegisteredPolicies() {
  return [..._registry.values()].sort((a, b) => a.priority - b.priority);
}

/** Returns true if a policy with this name has been registered. */
export function isPolicyRegistered(name) {
  return _registry.has(name);
}

/**
 * Build a pipeline steps array for runPipeline().
 *
 * @param {Record<string, Function>} instanceMap
 *   Maps policy name → already-instantiated policy function (i.e. createXxxPolicy(deps) result).
 *   Keys must match the `name` values used in registerPolicy().
 *
 * @param {object} [opts]
 * @param {'normal'|'ai'} [opts.mode='normal']  Pipeline mode.
 * @param {Set<string>}   [opts.skipSet]        Policy names to exclude (from skipPolicies).
 * @param {boolean}       [opts.skipExecute]    If true, omits the 'execute' step.
 *
 * @returns {{ name: string, fn: function }[]}
 */
export function buildPipelineSteps(instanceMap, {
  mode = 'normal',
  skipSet = new Set(),
  skipExecute = false,
} = {}) {
  return getRegisteredPolicies()
    .filter(p => {
      if (p.name === 'execute' && skipExecute) return false;
      if (skipSet.has(p.name)) return false;
      if (p.modes === 'both') return true;
      if (p.modes === 'normal' && mode === 'normal') return true;
      if (p.modes === 'ai' && mode === 'ai') return true;
      return false;
    })
    .map(p => {
      const fn = instanceMap[p.name];
      if (typeof fn !== 'function') return null;
      return { name: p.name, fn: (c) => fn(c) };
    })
    .filter(Boolean);
}
