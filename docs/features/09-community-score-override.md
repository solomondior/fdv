# Community Score Override

## Problem

The scoring algorithm in `calculate.js` is purely on-chain signal derived (volume, liquidity,
momentum, activity). It has no community signal. A token might score SHILL algorithmically
but have strong community conviction (or vice versa). FDV token holders could provide
a crowd-sourced modifier to surface or suppress tokens the algorithm misses.

## Goal

FDV token holders vote +1 (boost) or -1 (suppress) per token per day. Votes are aggregated
server-side (Cloudflare KV or similar edge store) and returned as a community modifier.
The card/score display shows `Score: 0.72 (+0.08 community)`. Requires an FDV token balance
check so only holders can vote.

## Files to Touch

- `src/data/communityVotes.js` — new file, vote fetch + submit + balance check
- `src/core/calculate.js` — accept community modifier in final score display
- `src/vista/meme/parts/cards.js` — vote buttons on token card
- `src/vista/meme/page.js` — fetch community data on load, pass to cards
- `src/assets/styles/default/global.css` — vote button styles

## Architecture

This is the only feature that requires a backend. The simplest viable approach is a
Cloudflare Worker + KV:

```
POST /api/vote  { mint, direction: 1|-1, walletPubkey, signature }
GET  /api/votes?mints=mint1,mint2,...
```

The Worker validates the Solana wallet signature to prove ownership, then checks the
FDV token balance via `getTokenAccountsByOwner` against a known RPC. One vote per
wallet per mint per UTC day (keyed as `vote:{mint}:{walletPubkey}:{utcDay}`).

The aggregate endpoint returns:
```json
{ "AbC123...": { "net": 8, "boosts": 15, "suppresses": 7 } }
```

## Data Shape

```js
// In-memory votes map (populated by GET /api/votes):
{
  'AbC123...': { net: 8, boosts: 15, suppresses: 7 },
  'DefG456...': { net: -3, boosts: 2, suppresses: 5 },
}

// Vote submission payload:
{
  mint:         'AbC123...',
  direction:    1,                // +1 | -1
  walletPubkey: 'VoterWallet...',
  signature:    'base58sig...',   // sign(message) to prove ownership
}
```

## Implementation Plan

### 1. Create `src/data/communityVotes.js`

```js
const API_BASE = 'https://votes.fdv.lol'; // Cloudflare Worker URL

let _votesCache = {}; // mint → { net, boosts, suppresses }
let _cacheTs = 0;
const CACHE_TTL = 60_000; // 1 min

export async function fetchVotes(mints) {
  if (Date.now() - _cacheTs < CACHE_TTL) return _votesCache;
  try {
    const res = await fetch(`${API_BASE}/votes?mints=${mints.slice(0, 50).join(',')}`);
    const json = await res.json();
    _votesCache = json;
    _cacheTs = Date.now();
    return json;
  } catch { return _votesCache; }
}

export async function submitVote({ mint, direction, walletPubkey, signFn }) {
  // signFn(message) → base58 signature (caller provides wallet signing capability)
  const message = `fdv-vote:${mint}:${direction}:${Math.floor(Date.now() / 86_400_000)}`;
  const signature = await signFn(message);
  const res = await fetch(`${API_BASE}/vote`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mint, direction, walletPubkey, signature }),
  });
  const json = await res.json();
  if (!json.ok) throw new Error(json.error ?? 'vote_failed');
  // Optimistically update cache
  const prev = _votesCache[mint] ?? { net: 0, boosts: 0, suppresses: 0 };
  _votesCache = { ..._votesCache, [mint]: {
    net: prev.net + direction,
    boosts: direction > 0 ? prev.boosts + 1 : prev.boosts,
    suppresses: direction < 0 ? prev.suppresses + 1 : prev.suppresses,
  }};
  return _votesCache[mint];
}

export function getVoteModifier(mint) {
  const v = _votesCache[mint];
  if (!v) return 0;
  // Map net votes to a score delta: ±10 net votes = ±0.10 score modifier, clamped ±0.15
  return Math.max(-0.15, Math.min(0.15, v.net / 100));
}
```

### 2. Extend score display in `calculate.js`

`scoreAndRecommendOne` already returns `{ score, rec, why, ... }`.
No change needed to the calculation logic — the community modifier is display-only,
applied when rendering the card, not in the core scoring formula.

### 3. Vote buttons in `cards.js`

In `coinCard(it)`, add two vote buttons after the bell/star:

```js
const voteModifier = getVoteModifier(it.mint);
const modStr = voteModifier !== 0
  ? ` <span class="fdv-score-mod ${voteModifier > 0 ? 'pos' : 'neg'}">`
  + `${voteModifier > 0 ? '+' : ''}${(voteModifier * 100).toFixed(0)} comm</span>`
  : '';
```

```html
<button type="button" class="fdv-vote-btn fdv-vote-up" data-vote="1"
  data-mint="${escAttr(it.mint)}" title="Boost">▲</button>
<button type="button" class="fdv-vote-btn fdv-vote-dn" data-vote="-1"
  data-mint="${escAttr(it.mint)}" title="Suppress">▼</button>
```

In `updateCardDOM()`, update displayed score with modifier:
```js
const mod = getVoteModifier(it.mint);
scoreEl.textContent = ((it.score ?? 0) + mod).toFixed(2);
```

### 4. Vote delegation in `page.js`

```js
elCards.addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-vote]');
  if (!btn) return;
  const direction = Number(btn.dataset.vote);
  const mint = btn.dataset.mint;
  // Require wallet connection to vote
  if (!window._fdvConnectedWallet) {
    alert('Connect your wallet to vote');
    return;
  }
  try {
    await submitVote({ mint, direction,
      walletPubkey: window._fdvConnectedWallet.publicKey,
      signFn: window._fdvConnectedWallet.signMessage });
    schedulePaint();
  } catch (err) {
    // Show inline error
  }
});
```

### 5. Cloudflare Worker (not in src/)

The Worker code lives separately (deploy via Wrangler). Key logic:
- Verify ed25519 signature against `fdv-vote:{mint}:{direction}:{utcDay}` message.
- Check FDV token balance ≥ minimum threshold via RPC.
- One vote per wallet per mint per UTC day using KV key `vote:{day}:{walletPubkey}:{mint}`.
- Return aggregate from a second KV key `agg:{mint}` updated atomically.

### 6. Styles

```css
.fdv-vote-btn { background: none; border: 1px solid var(--border); cursor: pointer;
  border-radius: 3px; padding: 1px 5px; font-size: 0.72rem; color: var(--muted); }
.fdv-vote-btn:hover { border-color: var(--accent); color: var(--fg); }
.fdv-score-mod { font-size: 0.72rem; margin-left: 4px; }
.fdv-score-mod.pos { color: #22c55e; }
.fdv-score-mod.neg { color: #ef4444; }
```

## Acceptance Criteria

- [ ] Vote buttons (▲ ▼) appear on each token card
- [ ] Voting requires a connected wallet; prompt is shown otherwise
- [ ] Vote submission sends a signed message to the Cloudflare Worker
- [ ] Worker validates signature and FDV token balance before recording vote
- [ ] One vote per wallet per mint per UTC day is enforced server-side
- [ ] Community modifier appears next to the score on cards: `+8 comm`
- [ ] Votes are fetched in batch (50 mints per request) with 1-minute client cache
- [ ] Modifier is display-only; does not change the underlying `score` field
