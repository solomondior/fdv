# Features Backlog

---

## 1. Portfolio P&L Timeline

A chart showing cumulative realized PnL over time across all bot sessions.

**What to build:**
- Persist every closed position's entry/exit/pnl to localStorage on resolution
- Render a line chart (canvas or SVG, no library) in the Auto panel Overview tab
- X-axis: time (session-relative or wall clock), Y-axis: cumulative SOL PnL
- Show total realized PnL as a KPI above the chart

**Files:** `lib/stores/traderStore.js` (persist closed trades), `auto/overview.js` (chart render)

---

## 2. Scoring Playground

Let users drag sliders to tune the 4 scoring weights and see the token grid re-rank live.

**What to build:**
- Drawer/panel with 4 sliders: Volume (0–100), Liquidity (0–100), Momentum (0–100), Activity (0–100)
- Sliders auto-normalize to sum to 100%
- On change, re-run `calculate.js` scoring with custom weights and re-sort the grid
- "Reset to defaults" button
- Weights persist in localStorage so users keep their tuning

**Files:** `src/core/calculate.js` (accept weight overrides), `src/vista/meme/page.js` (slider UI)

---

## 3. Token Alerts via Telegram

When a score threshold or price target is hit, send a Telegram message via bot API.

**What to build:**
- Settings panel: user pastes their Telegram bot token + chat ID
- Alert types: price above/below, score crosses GOOD/WATCH/SHILL threshold
- On alert fire, POST to `https://api.telegram.org/bot{token}/sendMessage`
- Fallback to Web Push if no Telegram configured (covered in improvement #06)
- Test button to verify credentials before saving

**Files:** `src/core/alerts.js` (extend existing), new `src/core/telegram.js`

---

## 4. Wallet PnL Import

Paste any Solana wallet address and get a breakdown of all memecoin trades pulled from on-chain data.

**What to build:**
- Input field: paste wallet address
- Fetch transaction history via Solana RPC (`getSignaturesForAddress` + `getParsedTransaction`)
- Parse Jupiter/DEX swap instructions to reconstruct buy/sell pairs
- Display: token symbol, entry price, exit price, realized PnL per trade, total PnL
- Export as CSV button

**Files:** new `src/data/walletHistory.js`, new `src/vista/addons/wallet-pnl/page.js`

---

## 5. Rug Pull Heatmap

Visual heatmap of recent rugs by launch time-of-day and day-of-week.

**What to build:**
- Track tokens that drop >80% within 1h of appearing in the pipeline (classify as rug)
- Store rug events with `{ mint, symbol, hour, dayOfWeek, timestamp }` in localStorage
- Render a 7×24 grid heatmap (days × hours) colored by rug frequency
- Tooltip on each cell: "X rugs this slot"
- Helps traders see "Sunday 2AM UTC is peak rug hours" and adjust Sentry timing

**Files:** new `src/core/rugTracker.js`, new `src/vista/addons/heatmap/page.js`

---

## 6. Agent Gary Training Dashboard

Surface the IndexedDB training captures as a UI to label and export fine-tuning data.

**What to build:**
- Read training captures from IndexedDB (already collected by Gary Training persona)
- List view: timestamp, token, decision, outcome
- Label UI: user marks each decision as Good/Bad/Skip
- Filter by labeled/unlabeled, date range, token
- Export labeled rows as JSONL (OpenAI fine-tune format)
- Stats: total captures, labeled %, good/bad ratio

**Files:** new `src/vista/addons/training/page.js`, extend `src/agents/gary-training.js`

---

## 7. Multi-Wallet Aggregation

Track several wallets (not just one Follow target) and see their combined activity feed.

**What to build:**
- Wallet list in settings: add/remove/label up to 10 wallet addresses
- Poll each wallet for new transactions on a staggered interval
- Unified activity feed: "Wallet A bought PEPE, Wallet B sold DOGE"
- Optional: one-click copy any trade from the feed into the Follow bot

**Files:** extend `src/vista/addons/auto/follow.js`, new `src/data/multiWallet.js`

---

## 8. Strategy Backtester

Run sell policy combinations against historical snapshot data and show what PnL each would have produced.

**What to build:**
- Load snapshots from `tools/snapshots/` (already exist)
- Policy selector: checkboxes for each of the 17 sell policies
- Run simulation: replay snapshots through selected policies, track entry/exit/PnL
- Results table: policy combo → total PnL, win rate, avg hold time, max drawdown
- Compare up to 3 strategy combos side by side

**Files:** extend `tools/trader.mjs` logic into browser, new `src/vista/addons/backtester/page.js`

---

## 9. Community Score Override

Let FDV token holders vote to boost or suppress a token's displayed score.

**What to build:**
- On-chain program or simple signed-message voting (off-chain weighted by FDV balance)
- Each holder can cast +1 (boost) or -1 (suppress) vote per token per day
- Votes aggregated and stored (Cloudflare KV or similar edge store)
- Score display shows community modifier: `Score: 72 (+8 community)`
- Requires FDV token balance check via RPC

**Files:** new `src/data/communityVotes.js`, extend `src/core/calculate.js` scoring

---

## 10. Shareable Trade Cards

One-click generate a styled image card showing a trade result for sharing on CT/Twitter.

**What to build:**
- "Share" button on each closed position in the Overview/Hold/Trader panels
- Render card to `<canvas>`: token name, buy price, sell price, PnL %, time held, FDV branding
- `canvas.toBlob()` → copy to clipboard or download as PNG
- Card designs: Green (profit) / Red (loss) themed
- Optional: QR code linking to the token's FDV profile page

**Files:** new `src/lib/tradeCard.js` (canvas renderer), wire into position close flows
