/**
 * registerAll.js — Canonical priority table for all sell policies.
 *
 * Import this module once (side-effect import) to populate the registry:
 *   import './registerAll.js';
 *
 * To add a new policy:
 *   1. Create the policy file in this directory.
 *   2. Add one registerPolicy() line below. Done — orchestrator untouched.
 *
 * To disable a policy:
 *   Comment out its registerPolicy() line below.
 *
 * modes:
 *   'both'   — runs in both normal and fullAiControl pipelines
 *   'normal' — runs only in the standard pipeline
 *   'ai'     — runs only in the fullAiControl pipeline
 */

import { registerPolicy } from './registry.js';

import { createPreflightSellPolicy }       from './preflight.js';
import { createLeaderModePolicy }          from './leaderMode.js';
import { createUrgentSellPolicy }          from './urgent.js';
import { createRugPumpDropPolicy }         from './rugPumpDrop.js';
import { createEarlyFadePolicy }           from './earlyFade.js';
import { createObserverPolicy }            from './observer.js';
import { createVolatilityGuardPolicy }     from './volatilityGuard.js';
import { createQuoteAndEdgePolicy }        from './quoteAndEdge.js';
import { createFastExitPolicy }            from './fastExit.js';
import { createWarmingPolicyHook }         from './warmingHook.js';
import { createProfitLockPolicy }          from './profitLock.js';
import { createObserverThreePolicy }       from './observerThree.js';
import { createFallbackSellPolicy }        from './fallbackSell.js';
import { createForceFlagDecisionPolicy }   from './forceFlagDecision.js';
import { createReboundGatePolicy }         from './reboundGate.js';
import { createAgentDecisionPolicy }       from './agentDecision.js';
import { createExecuteSellDecisionPolicy } from './executeSellDecision.js';

// ─── Active pipeline policies ────────────────────────────────────────────────
//  priority  name                factory                           modes
registerPolicy('preflight',        10,  createPreflightSellPolicy,       'both');
registerPolicy('leaderMode',       15,  createLeaderModePolicy,          'normal');
registerPolicy('urgent',           17,  createUrgentSellPolicy,          'normal');
registerPolicy('rugPumpDrop',      18,  createRugPumpDropPolicy,         'normal');
registerPolicy('earlyFade',        20,  createEarlyFadePolicy,           'normal');
registerPolicy('observer',         25,  createObserverPolicy,            'normal');
registerPolicy('volatilityGuard',  30,  createVolatilityGuardPolicy,     'normal');
registerPolicy('quoteAndEdge',     35,  createQuoteAndEdgePolicy,        'both');
registerPolicy('fastExit',         37,  createFastExitPolicy,            'normal');
registerPolicy('warmingHook',      40,  createWarmingPolicyHook,         'both');
registerPolicy('profitLock',       45,  createProfitLockPolicy,          'normal');
registerPolicy('observerThree',    47,  createObserverThreePolicy,       'normal');
registerPolicy('fallback',         50,  createFallbackSellPolicy,        'normal');
registerPolicy('forceFlagDecision',55,  createForceFlagDecisionPolicy,   'normal');
registerPolicy('reboundGate',      57,  createReboundGatePolicy,         'normal');
// momentumForce (60) and profitFloor (62) are inline in the orchestrator.
registerPolicy('agentDecision',    65,  createAgentDecisionPolicy,       'both');
registerPolicy('execute',         100,  createExecuteSellDecisionPolicy,  'both');
