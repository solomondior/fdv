# Token Alerts via Telegram

## Problem

The existing price alerts in `src/core/alerts.js` fire an in-tab Web Notification and an
audio ping. Both require the browser tab to be open. Most traders leave alerts set and then
walk away — they need to be notified on their phone, not in a tab they aren't watching.
Telegram bots are the de-facto notification layer for crypto tooling: instant, reliable,
no app install for the user.

## Goal

Extend the existing alert system so that when a price alert fires (or a score threshold is
crossed), it also sends a Telegram message via the bot API. The user pastes their bot token
and chat ID in a settings panel. A test button verifies the credentials. Score-threshold alerts
(GOOD / WATCH / SHILL crossing) are a new alert type added to this feature.

## Files to Touch

- `src/core/telegram.js` — new file, Telegram send helper + credentials store
- `src/core/alerts.js` — call `sendTelegramAlert` on fire; add score-threshold alert type
- `src/vista/meme/page.js` — settings panel for Telegram credentials + test button
- `src/assets/styles/default/global.css` — settings panel styles

## Data Shape

```js
// localStorage key: 'fdv_telegram_v1'
{
  botToken: '7123456789:AAHxxxxxx',
  chatId:   '-1001234567890',
}

// Score-threshold alert (extends existing alert shape):
{
  id:        'uuid',
  mint:      'AbC123...',
  symbol:    'PEPE',
  type:      'score',          // 'price' | 'score'
  direction: 'above',          // 'above' only for score thresholds
  target:    0.60,             // score 0..1
  createdAt: 1700000000000,
  firedAt:   null,
}
```

## Implementation Plan

### 1. Create `src/core/telegram.js`

```js
const CREDS_KEY = 'fdv_telegram_v1';

export function getTelegramCreds() {
  try { return JSON.parse(localStorage.getItem(CREDS_KEY) ?? 'null') ?? null; }
  catch { return null; }
}

export function saveTelegramCreds({ botToken, chatId }) {
  try { localStorage.setItem(CREDS_KEY, JSON.stringify({ botToken, chatId })); } catch {}
}

export function clearTelegramCreds() {
  try { localStorage.removeItem(CREDS_KEY); } catch {}
}

export async function sendTelegramAlert(text) {
  const creds = getTelegramCreds();
  if (!creds?.botToken || !creds?.chatId) return { ok: false, reason: 'no_creds' };
  try {
    const url = `https://api.telegram.org/bot${encodeURIComponent(creds.botToken)}/sendMessage`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: creds.chatId, text, parse_mode: 'HTML' }),
    });
    const json = await res.json();
    return json.ok ? { ok: true } : { ok: false, reason: json.description ?? 'tg_error' };
  } catch (e) {
    return { ok: false, reason: String(e?.message || e) };
  }
}

export async function testTelegramCreds({ botToken, chatId }) {
  const url = `https://api.telegram.org/bot${encodeURIComponent(botToken)}/sendMessage`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: '✅ FDV alert test — credentials OK' }),
    });
    const json = await res.json();
    return json.ok ? { ok: true } : { ok: false, reason: json.description ?? 'tg_error' };
  } catch (e) {
    return { ok: false, reason: String(e?.message || e) };
  }
}
```

### 2. Extend `src/core/alerts.js`

In `_fireNotification(alert, price)`, after the existing audio ping:

```js
import { sendTelegramAlert } from './telegram.js';

// Compose message
const sym = alert.symbol || alert.mint.slice(0, 6);
const text = alert.type === 'score'
  ? `📊 <b>FDV Score Alert: ${sym}</b>\nScore crossed ${(alert.target * 100).toFixed(0)}%`
  : `🔔 <b>FDV Price Alert: ${sym}</b>\n${sym} hit $${alert.target} (now $${price.toPrecision(4)})`;

sendTelegramAlert(text).catch(() => {}); // fire-and-forget
```

Add score-threshold evaluation in `evaluateAlerts(items)`:

```js
// Score alerts — items may carry a .score field from scoreAndRecommendOne
for (const alert of pending) {
  if (alert.type !== 'score') continue;
  const token = items.find(t => t.mint === alert.mint);
  if (!token?.score) continue;
  const hit = alert.direction === 'above'
    ? token.score >= alert.target
    : token.score <= alert.target;
  if (hit) { alert.firedAt = Date.now(); anyFired = true; _fireNotification(alert, token.score); }
}
```

### 3. Settings panel in `page.js`

Add a `<details class="fdv-tg-settings">` section in the alerts dialog or global settings area.

```html
<div class="fdv-tg-settings">
  <h4>Telegram Notifications</h4>
  <label>Bot Token<input type="password" id="fdv-tg-token" placeholder="7123…:AAH…"></label>
  <label>Chat ID<input type="text" id="fdv-tg-chatid" placeholder="-100123…"></label>
  <div class="fdv-tg-actions">
    <button id="fdv-tg-save">Save</button>
    <button id="fdv-tg-test">Test</button>
    <span id="fdv-tg-status"></span>
  </div>
</div>
```

On Save: `saveTelegramCreds(...)`.
On Test: call `testTelegramCreds(...)`, show ✅ or ❌ in the status span.
On load: hydrate inputs from `getTelegramCreds()` (show masked token if set).

### 4. Styles

```css
.fdv-tg-settings { padding: 12px 0; border-top: 1px solid var(--border); margin-top: 12px; }
.fdv-tg-settings h4 { font-size: 0.82rem; margin: 0 0 8px; }
.fdv-tg-settings label { display: flex; flex-direction: column; gap: 3px;
  font-size: 0.78rem; margin-bottom: 8px; }
.fdv-tg-settings input { background: var(--input-bg); border: 1px solid var(--border);
  border-radius: 4px; padding: 4px 8px; color: var(--fg); font-size: 0.82rem; }
.fdv-tg-actions { display: flex; align-items: center; gap: 8px; }
```

## Acceptance Criteria

- [ ] User can save Telegram bot token + chat ID in the settings panel
- [ ] Test button sends a test message and shows success/failure inline
- [ ] Existing price alerts send a Telegram message on fire (fire-and-forget, does not block)
- [ ] No Telegram creds configured → Telegram step silently skipped, in-tab alert still fires
- [ ] Score-threshold alerts can be created and fire via Telegram + in-tab notification
- [ ] Bot token is stored in `localStorage`, never logged or included in error messages
- [ ] Invalid credentials show a clear error in the status span
