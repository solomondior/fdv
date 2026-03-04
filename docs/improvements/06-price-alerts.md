# Price Alerts

## Problem

Users have to keep the tab open and watch prices manually. There's no way to say
"notify me when token X hits $0.0025" and walk away. This is table-stakes functionality
for any trading tool and is especially valuable for slow-moving positions.

## Goal

Users can set a price alert (above or below current price) for any token.
When the target is hit, fire a Web Push notification (if permission granted) and/or
an in-tab audio/visual alert. Alerts persist in localStorage and evaluate on every
pipeline price update.

## Files to Touch

- `src/core/alerts.js` — new file, alert store + evaluation engine
- `src/core/sw/register.js` + `sw.js` — Web Push subscription setup
- `src/vista/meme/page.js` — alert icon on token rows + set-alert UI
- `src/vista/profile/page.js` — alert input on token profile page
- `src/assets/css/alerts.css` — modal and icon styles

## Data Shape

```js
// localStorage key: 'fdv_alerts'
[
  {
    id:        'uuid',
    mint:      'AbC123...',
    symbol:    'PEPE',
    direction: 'above',   // 'above' | 'below'
    target:    0.0025,
    createdAt: 1700000000000,
    firedAt:   null,      // null = pending, timestamp = already fired
  }
]
```

## Implementation Plan

### 1. Create `src/core/alerts.js`

```js
const KEY = 'fdv_alerts'

export function getAlerts()          { return JSON.parse(localStorage.getItem(KEY) ?? '[]') }
export function saveAlerts(list)     { localStorage.setItem(KEY, JSON.stringify(list)) }

export function addAlert({ mint, symbol, direction, target }) {
  const alerts = getAlerts()
  alerts.push({ id: crypto.randomUUID(), mint, symbol, direction, target, createdAt: Date.now(), firedAt: null })
  saveAlerts(alerts)
}

export function removeAlert(id) {
  saveAlerts(getAlerts().filter(a => a.id !== id))
}

// Called on every pipeline price update
export function evaluateAlerts(priceMap) {
  const alerts  = getAlerts()
  const pending = alerts.filter(a => !a.firedAt)
  const fired   = []

  for (const alert of pending) {
    const price = priceMap[alert.mint]
    if (price == null) continue
    const hit = alert.direction === 'above'
      ? price >= alert.target
      : price <= alert.target

    if (hit) {
      alert.firedAt = Date.now()
      fired.push(alert)
    }
  }

  if (fired.length) {
    saveAlerts(alerts)
    fired.forEach(fireNotification)
  }
}

function fireNotification(alert) {
  const body = `${alert.symbol} is ${alert.direction} $${alert.target}`

  // In-tab audio ping
  playPing()

  // Web Push (if permission granted)
  if (Notification.permission === 'granted') {
    new Notification(`FDV Alert: ${alert.symbol}`, { body, icon: '/gary.png' })
  }
}

function playPing() {
  const ctx  = new AudioContext()
  const osc  = ctx.createOscillator()
  const gain = ctx.createGain()
  osc.connect(gain)
  gain.connect(ctx.destination)
  osc.frequency.value = 880
  gain.gain.setValueAtTime(0.3, ctx.currentTime)
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4)
  osc.start()
  osc.stop(ctx.currentTime + 0.4)
}
```

### 2. Hook into the pipeline

In `src/engine/pipeline.js`, after each price update batch:

```js
import { evaluateAlerts } from '../core/alerts.js'

// After merging new prices into the store:
evaluateAlerts(buildPriceMap(store))
```

### 3. Set-alert UI

On each token row (and the profile page), add a bell icon:

```html
<button class="alert-bell" title="Set price alert">🔔</button>
```

Clicking opens a small popover:

```
Set alert for PEPE
( ) Above  ( ) Below
Target price: [_______]
[Set Alert]
```

### 4. Alert management panel

Link from the header or settings: "My Alerts" — lists all pending + fired alerts
with a remove (×) button for each.

### 5. Notification permission prompt

Request permission lazily (only when user sets their first alert):

```js
if (Notification.permission === 'default') {
  await Notification.requestPermission()
}
```

## Acceptance Criteria

- [ ] User can set an above/below price alert from token row and profile page
- [ ] Alert evaluates on every pipeline price tick
- [ ] Fired alert shows in-tab audio + browser notification
- [ ] Fired alerts are marked and not re-fired
- [ ] Alerts persist across page refreshes
- [ ] Alert management panel shows all pending/fired alerts
- [ ] Notification permission is only requested when user actually sets an alert
