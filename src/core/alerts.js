import { sendTelegramAlert } from './telegram.js';

const KEY = 'fdv_alerts';

export function getAlerts() {
  try { return JSON.parse(localStorage.getItem(KEY) ?? '[]'); } catch { return []; }
}

function saveAlerts(list) {
  try { localStorage.setItem(KEY, JSON.stringify(list)); } catch {}
}

export function getAlertsForMint(mint) {
  return getAlerts().filter(a => a.mint === mint);
}

export function hasPendingAlert(mint) {
  if (!mint) return false;
  return getAlerts().some(a => a.mint === mint && !a.firedAt);
}

export function addAlert({ mint, symbol, direction, target, type }) {
  const alerts = getAlerts();
  alerts.push({
    id: crypto.randomUUID(),
    mint,
    symbol: symbol || '',
    type: type || 'price',
    direction,
    target: Number(target),
    createdAt: Date.now(),
    firedAt: null,
  });
  saveAlerts(alerts);
  try {
    window.dispatchEvent(new CustomEvent('fdv:alert-added', { detail: { mint } }));
  } catch {}
}

export function removeAlert(id) {
  saveAlerts(getAlerts().filter(a => a.id !== id));
  try {
    window.dispatchEvent(new CustomEvent('fdv:alert-removed', { detail: { id } }));
  } catch {}
}

export function evaluateAlerts(items) {
  if (!Array.isArray(items) || !items.length) return;
  const alerts = getAlerts();
  const pending = alerts.filter(a => !a.firedAt);
  if (!pending.length) return;

  const priceMap = {};
  const scoreMap = {};
  for (const t of items) {
    if (t.mint && t.priceUsd != null) priceMap[t.mint] = +t.priceUsd;
    if (t.mint && t.score   != null) scoreMap[t.mint] = +t.score;
  }

  let anyFired = false;
  for (const alert of pending) {
    if (alert.type === 'score') {
      const score = scoreMap[alert.mint];
      if (score == null) continue;
      const hit = alert.direction === 'above' ? score >= alert.target : score <= alert.target;
      if (hit) {
        alert.firedAt = Date.now();
        anyFired = true;
        _fireNotification(alert, score);
      }
    } else {
      const price = priceMap[alert.mint];
      if (price == null) continue;
      const hit = alert.direction === 'above' ? price >= alert.target : price <= alert.target;
      if (hit) {
        alert.firedAt = Date.now();
        anyFired = true;
        _fireNotification(alert, price);
      }
    }
  }

  if (anyFired) {
    saveAlerts(alerts);
    try {
      window.dispatchEvent(new CustomEvent('fdv:alert-fired'));
    } catch {}
  }
}

function _fireNotification(alert, value) {
  const sym = alert.symbol || alert.mint.slice(0, 6);

  let body, title, tgText;
  if (alert.type === 'score') {
    const tgtPct = (alert.target * 100).toFixed(0);
    const nowPct = (value * 100).toFixed(0);
    title  = `FDV Score Alert: ${sym}`;
    body   = `${sym} score crossed ${tgtPct}% (now ${nowPct}%)`;
    tgText = `\ud83d\udcc8 <b>FDV Score Alert: ${sym}</b>\nScore crossed ${tgtPct}% (now ${nowPct}%)`;
  } else {
    title  = `FDV Alert: ${sym}`;
    body   = `${sym} hit $${alert.target} (now $${(+value).toPrecision(4)})`;
    tgText = `\ud83d\udd14 <b>FDV Price Alert: ${sym}</b>\n${sym} hit $${alert.target} (now $${(+value).toPrecision(4)})`;
  }

  sendTelegramAlert(tgText).catch(() => {}); // fire-and-forget, never throws

  _playPing();
  try {
    if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      new Notification(title, { body, icon: '/gary.png' });
    }
  } catch {}
}

let _audioCtx = null;
function _playPing() {
  try {
    if (!_audioCtx) _audioCtx = new AudioContext();
    if (_audioCtx.state === 'suspended') _audioCtx.resume();
    const osc = _audioCtx.createOscillator();
    const gain = _audioCtx.createGain();
    osc.connect(gain);
    gain.connect(_audioCtx.destination);
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.3, _audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, _audioCtx.currentTime + 0.4);
    osc.start();
    osc.stop(_audioCtx.currentTime + 0.4);
  } catch {}
}
