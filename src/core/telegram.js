const CREDS_KEY = 'fdv_telegram_v1';

export function getTelegramCreds() {
  try { return JSON.parse(localStorage.getItem(CREDS_KEY) ?? 'null') ?? null; }
  catch { return null; }
}

export function saveTelegramCreds({ botToken, chatId }) {
  try {
    localStorage.setItem(CREDS_KEY, JSON.stringify({
      botToken: String(botToken || ''),
      chatId: String(chatId || ''),
    }));
  } catch {}
}

export function clearTelegramCreds() {
  try { localStorage.removeItem(CREDS_KEY); } catch {}
}

export async function sendTelegramAlert(text) {
  const creds = getTelegramCreds();
  if (!creds?.botToken || !creds?.chatId) return { ok: false, reason: 'no_creds' };
  try {
    // Note: bot token goes directly in path — do NOT encodeURIComponent (colon in token)
    const url = `https://api.telegram.org/bot${creds.botToken}/sendMessage`;
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
  try {
    const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: '\u2705 FDV alert test \u2014 credentials OK' }),
    });
    const json = await res.json();
    return json.ok ? { ok: true } : { ok: false, reason: json.description ?? 'tg_error' };
  } catch (e) {
    return { ok: false, reason: String(e?.message || e) };
  }
}
