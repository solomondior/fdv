import { MAX_CARDS } from '../../config/env.js';

import { loadAds, pickAd, adCard, initAdBanners } from "../../ads/load.js";

import { showHome } from '../../router/main/home.js';

import { ensureAddonsUI } from './metrics/register.js';
import { ingestSnapshot } from './metrics/ingest.js';

// Addons (KPI)
import './metrics/kpi/pumping.js';
// import './metrics/kpi/honey.js';
import './metrics/kpi/three.js';
import './metrics/kpi/performers.js';
import './metrics/kpi/liquid.js';
import './metrics/kpi/smq.js';
import './metrics/kpi/degen.js';
import './metrics/kpi/comeback.js';
import './metrics/kpi/engagement.js';
import './metrics/kpi/das.js';
import './metrics/kpi/holders.js';
import './metrics/kpi/24h.js';
import './metrics/kpi/bsi.js';
import './metrics/kpi/mom.js';
import './metrics/kpi/draw.js';
import './metrics/kpi/sticky.js';

// Swap direct init() calls for the widget loader VM
import { widgets, registerCoreWidgets, prewarmDefaults } from '../addons/loader.js';

// Keep button factories for header
import { createOpenLibraryButton } from '../addons/library/index.js';
import { initSearch, createOpenSearchButton } from '../addons/search/index.js';
// import { createOpenFavboardButton } from '../widgets/favboard/index.js';

import {
  initHeader,
  ensureOpenLibraryHeaderBtn,
  // ensureFavboardHeaderBtn
} from './parts/header.js';

// import {
//   ensureMarqueeSlot,
//   renderMarquee
// } from './parts/marquee.js';

import {
  patchKeyedGridAnimated,
  buildOrUpdateCard,
  applyLeaderHysteresis,
  sortItems,
  filterByQuery,
  isDisplayReady
} from './parts/cards.js';

import { getWatchlist, toggleWatch } from '../../core/watchlist.js';
import { getAlertsForMint, hasPendingAlert, addAlert, removeAlert } from '../../core/alerts.js';
import { getTelegramCreds, saveTelegramCreds, testTelegramCreds } from '../../core/telegram.js';
import { fetchVotes, submitVote, setMyVote } from '../../data/communityVotes.js';
import { scoreAndRecommendOne } from '../../core/calculate.js';
import { RANK_WEIGHTS, loadWeights, saveWeights, clearWeights } from '../../core/userWeights.js';

const raf = typeof requestAnimationFrame === 'function' ? requestAnimationFrame : (fn)=>setTimeout(fn,16);
const ric = typeof requestIdleCallback === 'function'
  ? requestIdleCallback
  : (fn)=>setTimeout(()=>fn({ didTimeout:false, timeRemaining:()=>8 }), 48);

export const elCards    = document.getElementById('cards');
export const elMetaBase = document.getElementById('metaBaseSpan');
export const elQ        = document.getElementById('q');
export const elSort     = document.getElementById('sort');

function getQueryValue() {
  return (document.getElementById('q')?.value || '').trim();
}

export const elTimeDerived = document.getElementById('stimeDerived');
export const elRefresh = document.getElementById('refresh');
export const elRelax = document.getElementById('relax');

const   elSearchWrap    = document.getElementById('searchWrap');
const   elQResults      = document.getElementById('qResults');
const   pageSpinnerEl   = document.querySelector('.spinner') && document.querySelector('.loader');
const   elStream        = document.getElementById('stream');

let _latestItems = [];
let _latestAd = null;
let _latestMarquee = null;

// Custom scoring weights — null means use pipeline defaults.
let _customWeights = loadWeights();

let _lastPaintSig = '';
let _paintQueued = false;

let _elCardAdSlot = null;
let _elMarqueeAdSlot = null;

const STATE = {
  settleTimer: null,
  needsPaint: false
};

elSort.addEventListener('change', () => showHome()); // hmmm. good placement?
elRefresh.addEventListener('click', () => showHome({ force: true }));
elRelax.addEventListener('change', () => showHome({ force: true }));

// Star / watchlist toggle — event delegation on the cards grid.
if (elCards) {
  elCards.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-watch-btn]');
    if (!btn) return;
    e.stopPropagation();
    const mint = btn.dataset.mint;
    if (!mint) return;
    const watched = toggleWatch(mint);
    btn.classList.toggle('active', watched);
    schedulePaint();
  });
}

// ── Alert bell dialog ──────────────────────────────────────────────────────
let _alertDialog = null;
let _alertMint = null;

function _escAlertHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] || c));
}

function _ensureAlertDialog() {
  if (_alertDialog) return _alertDialog;
  const d = document.createElement('dialog');
  d.id = 'fdv-alert-dialog';
  d.className = 'fdv-alert-dialog';
  d.innerHTML = `
    <button class="fdv-alert-x" aria-label="Close">×</button>
    <h3 class="fdv-alert-title">Price alert — <span data-alert-sym></span></h3>
    <p class="fdv-alert-curprice">Current: <strong data-alert-curprice></strong></p>
    <div class="fdv-alert-radios">
      <label><input type="radio" name="fdv-dir" value="above" checked> Above</label>
      <label><input type="radio" name="fdv-dir" value="below"> Below</label>
    </div>
    <div class="fdv-alert-row">
      <input class="fdv-alert-input" type="number" placeholder="Target price" step="any" min="0">
      <button class="btn fdv-alert-submit" type="button">Set Alert</button>
    </div>
    <ul class="fdv-alert-list" data-alert-list></ul>
    <div class="fdv-alert-sep"></div>
    <h4 class="fdv-alert-subtitle">Score alert</h4>
    <p class="fdv-alert-hint">Fire when score crosses threshold (0–1):</p>
    <div class="fdv-alert-row">
      <input class="fdv-score-input" type="number" placeholder="e.g. 0.60" step="0.01" min="0" max="1">
      <button class="btn fdv-score-submit" type="button">Set Score Alert</button>
    </div>
    <div class="fdv-tg-settings">
      <h4>Telegram notifications</h4>
      <label>Bot token<input type="password" class="fdv-tg-token" placeholder="7123…:AAH…" autocomplete="off" spellcheck="false"></label>
      <label>Chat ID<input type="text" class="fdv-tg-chatid" placeholder="-100123…" autocomplete="off"></label>
      <div class="fdv-tg-actions">
        <button class="btn fdv-tg-save" type="button">Save</button>
        <button class="btn fdv-tg-test" type="button">Test</button>
        <span class="fdv-tg-status"></span>
      </div>
    </div>
  `;
  document.body.appendChild(d);

  d.querySelector('.fdv-alert-x').addEventListener('click', () => d.close());
  d.addEventListener('click', (e) => { if (e.target === d) d.close(); });

  d.querySelector('.fdv-alert-submit').addEventListener('click', () => {
    const mint = _alertMint;
    if (!mint) return;
    const dir = d.querySelector('input[name="fdv-dir"]:checked')?.value || 'above';
    const target = parseFloat(d.querySelector('.fdv-alert-input').value);
    if (!Number.isFinite(target) || target <= 0) return;
    const sym = d.querySelector('[data-alert-sym]')?.textContent || '';
    addAlert({ mint, symbol: sym, direction: dir, target, type: 'price' });
    _renderAlertList(d, mint);
    d.querySelector('.fdv-alert-input').value = '';
    _syncBellState(mint);
  });

  d.querySelector('.fdv-score-submit').addEventListener('click', () => {
    const mint = _alertMint;
    if (!mint) return;
    const target = parseFloat(d.querySelector('.fdv-score-input').value);
    if (!Number.isFinite(target) || target < 0 || target > 1) return;
    const sym = d.querySelector('[data-alert-sym]')?.textContent || '';
    addAlert({ mint, symbol: sym, direction: 'above', target, type: 'score' });
    _renderAlertList(d, mint);
    d.querySelector('.fdv-score-input').value = '';
    _syncBellState(mint);
  });

  // Telegram settings
  const tgCreds = getTelegramCreds();
  if (tgCreds?.botToken) d.querySelector('.fdv-tg-token').value = tgCreds.botToken;
  if (tgCreds?.chatId)   d.querySelector('.fdv-tg-chatid').value = tgCreds.chatId;

  d.querySelector('.fdv-tg-save').addEventListener('click', () => {
    const token  = d.querySelector('.fdv-tg-token').value.trim();
    const chatId = d.querySelector('.fdv-tg-chatid').value.trim();
    const status = d.querySelector('.fdv-tg-status');
    if (!token || !chatId) { status.textContent = 'Enter token and chat ID'; return; }
    saveTelegramCreds({ botToken: token, chatId });
    status.textContent = '\u2713 Saved';
    setTimeout(() => { status.textContent = ''; }, 2000);
  });

  d.querySelector('.fdv-tg-test').addEventListener('click', async () => {
    const token  = d.querySelector('.fdv-tg-token').value.trim();
    const chatId = d.querySelector('.fdv-tg-chatid').value.trim();
    const status = d.querySelector('.fdv-tg-status');
    if (!token || !chatId) { status.textContent = 'Enter token and chat ID first'; return; }
    status.textContent = 'Sending\u2026';
    const result = await testTelegramCreds({ botToken: token, chatId });
    status.textContent = result.ok ? '\u2705 Sent!' : `\u274c ${result.reason}`;
  });

  _alertDialog = d;
  return d;
}

function _renderAlertList(dialog, mint) {
  const ul = dialog.querySelector('[data-alert-list]');
  if (!ul) return;
  const alerts = getAlertsForMint(mint);
  if (!alerts.length) { ul.innerHTML = ''; return; }
  ul.innerHTML = alerts.map(a => {
    const arrow = _escAlertHtml(a.direction === 'above' ? '↑' : '↓');
    const label = a.type === 'score'
      ? `Score ${arrow} ${Math.round((a.target || 0) * 100)}%`
      : `${arrow} $${_escAlertHtml(a.target)}`;
    return `
    <li class="fdv-alert-item${a.firedAt ? ' fired' : ''}" data-alert-id="${_escAlertHtml(a.id)}">
      <span>${label}</span>
      <span class="fdv-alert-status">${a.firedAt ? '✓ Fired' : 'Pending'}</span>
      <button class="fdv-alert-del" aria-label="Remove">×</button>
    </li>`;
  }).join('');

  ul.querySelectorAll('.fdv-alert-del').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.closest('[data-alert-id]')?.dataset.alertId;
      if (!id) return;
      removeAlert(id);
      _renderAlertList(dialog, mint);
      _syncBellState(mint);
    });
  });
}

function _syncBellState(mint) {
  if (!elCards || !mint) return;
  const pending = hasPendingAlert(mint);
  elCards.querySelectorAll(`[data-alert-btn][data-mint="${CSS.escape(mint)}"]`).forEach(el => {
    el.classList.toggle('active', pending);
  });
}

if (elCards) {
  elCards.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-alert-btn]');
    if (!btn) return;
    e.stopPropagation();
    const mint = btn.dataset.mint;
    if (!mint) return;
    _alertMint = mint;
    const d = _ensureAlertDialog();
    d.querySelector('[data-alert-sym]').textContent = btn.dataset.symbol || mint.slice(0, 8);
    const price = btn.dataset.price;
    d.querySelector('[data-alert-curprice]').textContent = price ? `$${Number(price).toPrecision(5)}` : '—';
    _renderAlertList(d, mint);
    if (!d.open) d.showModal();
  });
}

// Repaint bell states after any alert change or fire.
try {
  window.addEventListener('fdv:alert-fired', () => schedulePaint());
} catch {}

// Community vote delegation
if (elCards) {
  elCards.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-vote]');
    if (!btn) return;
    e.stopPropagation();
    const direction = Number(btn.dataset.vote);
    const mint = btn.dataset.mint;
    if (!mint) return;

    const wallet = window._fdvConnectedWallet;
    if (!wallet) {
      alert('Connect your wallet to vote');
      return;
    }
    if (!wallet.publicKey || typeof wallet.signMessage !== 'function') {
      alert('Wallet connection is incomplete — please reconnect');
      return;
    }

    const prev = btn.textContent;
    btn.disabled = true;
    btn.textContent = '…';
    try {
      await submitVote({
        mint,
        direction,
        walletPubkey: wallet.publicKey,
        signFn: wallet.signMessage,
      });
      setMyVote(mint, direction);
      schedulePaint();
    } catch (err) {
      btn.textContent = '!';
      setTimeout(() => { try { btn.textContent = prev; btn.disabled = false; } catch {} }, 1500);
      return;
    }
    btn.textContent = prev;
    btn.disabled = false;
  });
}


function ensureAdSlots() {
  const cardsEl = elCards || document.querySelector('.cards');
  const host = cardsEl?.parentElement || document.body;

  if (!_elCardAdSlot) {
    _elCardAdSlot = document.createElement('div');
    _elCardAdSlot.id = 'cardAdSlot';
    _elCardAdSlot.className = 'ad-slot ad-slot-cards';
  }

  // Always render after the cards grid (bottom of container)
  if (cardsEl && cardsEl.parentElement) {
    const parent = cardsEl.parentElement;
    const desiredNext = cardsEl.nextSibling;
    if (_elCardAdSlot.parentElement !== parent || desiredNext !== _elCardAdSlot) {
      parent.insertBefore(_elCardAdSlot, desiredNext);
    }
  } else if (host && _elCardAdSlot.parentElement !== host) {
    host.appendChild(_elCardAdSlot);
  }

  // if (!_elMarqueeAdSlot) {
  //   const host = elCards?.parentElement || document.body;
  //   const marqueeHost =
  //     document.querySelector('[data-marquee-slot]') ||
  //     document.getElementById('marqueeSlot') ||
  //     document.querySelector('.marquee, .marquee-slot') ||
  //     null;

  //   _elMarqueeAdSlot = document.createElement('div');
  //   _elMarqueeAdSlot.id = 'marqueeAdSlot';
  //   _elMarqueeAdSlot.className = 'ad-slot ad-slot-marquee';

  //   if (marqueeHost && marqueeHost.parentElement) {
  //     marqueeHost.parentElement.insertBefore(_elMarqueeAdSlot, marqueeHost.nextSibling);
  //   } else {
  //     (host).insertBefore(_elMarqueeAdSlot, elCards || host.firstChild);
  //   }
  // }
}

function renderAdInto(slot, ad) {
  if (!slot) return;
  if (!ad) { slot.innerHTML = ''; return; }
  try {
    const node = adCard(ad);
    if (typeof node === 'string') {
      slot.innerHTML = node;
    } else if (node instanceof Node) {
      slot.innerHTML = '';
      slot.appendChild(node);
    } else {
      slot.innerHTML = '';
    }
  } catch {
    slot.innerHTML = '';
  }
}

function renderAdSlots() {
  if (!_latestAd) return;
  ensureAdSlots();
  renderAdInto(_elCardAdSlot, _latestAd);
  // renderAdInto(_elMarqueeAdSlot, _latestAd);
}

async function loadAndRenderAd() {
  try {
    if (_elCardAdSlot && _elCardAdSlot.childElementCount > 0) return;
    if (_elMarqueeAdSlot && _elMarqueeAdSlot.childElementCount > 0) return;
    const ads = await loadAds();
    const pick = pickAd(ads);
    if (pick) {
      _latestAd = pick;
      renderAdSlots();
    }
    await initAdBanners(document);
  } catch {}
}

export function setLoadingStatus(msg = '') {
  try {
    if (elMetaBase && typeof msg === 'string' && elMetaBase.textContent !== msg) {
      elMetaBase.textContent = msg;
    }
    if (pageSpinnerEl) {
      if (pageSpinnerEl.getAttribute('aria-label') !== (msg || 'Loading…'))
        pageSpinnerEl.setAttribute('aria-label', msg || 'Loading…');
      if (pageSpinnerEl.getAttribute('title') !== (msg || 'Loading…'))
        pageSpinnerEl.setAttribute('title', msg || 'Loading…');
    }
  } catch {}
}

function isStreamOnLocal() {
  const btn = elStream;
  if (!btn) return true;
  const ap = btn.getAttribute('aria-pressed');
  if (ap != null) return ap === 'true' || ap === '1';
  return /on/i.test(btn.textContent || '');
}

function setLoadingStatusAuto() {
  if (isStreamOnLocal()) {
    setLoadingStatus('Collecting instant Solana pairs…');
  } else {
    setLoadingStatus('Stream is Off — feed disabled');
  }
}

function syncPageSpinner() {
  if (!elCards || !pageSpinnerEl) return;
  const hasResults = elCards.getAttribute('data-has-results') === '1';
  pageSpinnerEl.hidden = !!hasResults;
  pageSpinnerEl.setAttribute('aria-hidden', hasResults ? 'true' : 'false');
}

function updateResultsState(hasResults) {
  if (!elCards) return;
  elCards.setAttribute('data-has-results', hasResults ? '1' : '0');
  syncPageSpinner();
}

if (elCards) {
  new MutationObserver(syncPageSpinner).observe(elCards, { childList: true });
}

function _applyCustomWeights(items) {
  if (!_customWeights) return items;
  return items.map(t => {
    const r = scoreAndRecommendOne(t, { weights: _customWeights });
    return { ...t, score: r.score, recommendation: r.recommendation, why: r.why };
  });
}

function computeRanked(items, sortKey, q) {
  const eligible = _applyCustomWeights(
    Array.isArray(items) ? items.filter(isDisplayReady) : []
  );
  if (!eligible.length) return [];

  if (sortKey === 'watchlist') {
    const wl = getWatchlist();
    const watched = eligible.filter(t => wl.includes(t.mint));
    return sortItems(watched, 'score').slice(0, MAX_CARDS);
  }

  const filtered = filterByQuery(eligible, q);
  if (!filtered.length) return [];
  const ranked0  = sortItems(filtered, sortKey).slice(0, MAX_CARDS);
  return applyLeaderHysteresis(ranked0);
}

function schedulePaint(immediate = false) {
  if (_paintQueued) return;
  _paintQueued = true;
  const doPaint = () => {
    _paintQueued = false;
    paintNow();
  };
  if (immediate) return raf(doPaint);
  // Let JS finish & allow browser a breath!!!!!
  ric(doPaint);
}

function paintNow() {
  const sortKey = elSort?.value || 'score';
  const q = getQueryValue(elQ);
  const ranked = computeRanked(_latestItems, sortKey, q);

  const sig = (() => {
    const ids = ranked.slice(0,5).map(x => x.mint || x.id).join(',');
    return `${ranked.length}|${ids}|${sortKey}|${q}`;
  })();
  if (sig === _lastPaintSig) return;
  _lastPaintSig = sig;

  const hasResults = ranked.length > 0;
  updateResultsState(hasResults);

  if (!hasResults) {
    if (sortKey === 'watchlist') {
      setLoadingStatus('★ Star any token with ★ to track it here');
    } else if (!isStreamOnLocal()) {
      setLoadingStatus('Stream is Off — feed disabled');
    } else {
      const t = Date.now() % 9000;
      const hint = t < 3000 ? 'Collecting instant Solana pairs…'
        : t < 6000 ? 'Hydrating (volume & txns)…'
        : 'Scoring and ranking measured coins…';
      setLoadingStatus(hint);
    }
  } else {
    setLoadingStatus('');
  }

  patchKeyedGridAnimated(elCards, ranked, x => x.mint || x.id, buildOrUpdateCard);
}

export function renderHomeView(items, adPick, marquee) {
  _latestItems = Array.isArray(items) ? items : [];
  _latestAd = adPick || _latestAd;
  _latestMarquee = marquee || null;

  ensureOpenLibraryHeaderBtn(createOpenLibraryButton);
  // ensureFavboardHeaderBtn();
  try { ingestSnapshot(_latestItems); } catch {}

  // Fetch community votes (1-min cache); repaint after to show modifiers.
  try {
    const mints = _latestItems.map(t => t.mint).filter(Boolean);
    if (mints.length) fetchVotes(mints).then(() => schedulePaint()).catch(() => {});
  } catch {}
  // renderMarquee(_latestMarquee);

  // if (_latestAd) renderAdSlots();

  STATE.needsPaint = true;

  if (STATE.settleTimer) {
    clearTimeout(STATE.settleTimer);
    STATE.settleTimer = null;
  }

  schedulePaint(true); // first paint ASAP

  STATE.settleTimer = setTimeout(() => {
    STATE.settleTimer = null;
    if (STATE.needsPaint) {
      schedulePaint(true);
      STATE.needsPaint = false;
    }
  }, 3000); // was 7500ms
}

export function renderSkeleton(n = 0) {
  updateResultsState(false);
  setLoadingStatus('Preparing view…');
  if (!n || !elCards) return;
  if (elCards.firstChild) elCards.innerHTML = '';
  const frag = document.createDocumentFragment();
  for (let i = 0; i < n; i++) {
    const d = document.createElement('div');
    d.className = 'card';
    d.innerHTML = `
      <div class="top">
        <div class="logo skel"></div>
        <div style="flex:1">
          <div class="sym skel" style="height:14px;width:120px;border-radius:6px"></div>
          <div class="addr skel" style="height:10px;width:160px;margin-top:6px;border-radius:6px"></div>
        </div>
        <div class="rec skel" style="width:60px;height:22px"></div>
      </div>
      <div class="metrics" style="margin-top:10px">
        ${Array.from({length:6}).map(()=>`<div class="kv"><div class="k skel" style="height:10px;border-radius:5px"></div><div class="v skel" style="height:14px;margin-top:6px;border-radius:6px"></div></div>`).join('')}
      </div>`;
    frag.appendChild(d);
  }
  elCards.appendChild(frag);
}

function wireSort() {
  elSort?.addEventListener('change', () => {
    STATE.needsPaint = true;
    schedulePaint();
  }, { passive: true });
}

let _searchDebounce = 0;
function wireSearch() {
  if (!elQ) return;
  elQ.addEventListener('input', (e) => {
    const raw = e.currentTarget.value || '';
    const wrap = document.getElementById('searchWrap');
    const has = raw ? '1' : '0';
    if (wrap && wrap.getAttribute('data-hastext') !== has) wrap.setAttribute('data-hastext', has);

    clearTimeout(_searchDebounce);
    _searchDebounce = setTimeout(() => {
      STATE.needsPaint = true;
      schedulePaint();
    }, 120); // debounce
  }, { passive: true });

  document.getElementById('qClear')?.addEventListener('click', () => {
    if (!elQ) return;
    elQ.value = '';
    document.getElementById('searchWrap')?.setAttribute('data-hastext','0');
    const r = elQResults;
    if (r){ r.hidden = true; r.innerHTML = ''; }
    _lastPaintSig = ''; 
    STATE.needsPaint = true;
    schedulePaint();
    elQ.focus();
  }, { passive: true });
}

function initInitialLoading() {
  const apply = () => {
    updateResultsState(false);
    setLoadingStatusAuto();
    const sb = elStream;
    if (sb && !sb.dataset.loadingWired) {
      sb.dataset.loadingWired = '1';
      sb.addEventListener('click', () => {
        const hasResults = elCards?.getAttribute('data-has-results') === '1';
        if (!hasResults) setLoadingStatusAuto();
      }, { passive: true });
    }
  };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', apply, { once: true });
  } else {
    apply();
  }
}

function wirePlayground() {
  const details = document.getElementById('fdv-score-playground');
  if (!details) return;

  const DEFAULTS = RANK_WEIGHTS; // { volume, liquidity, momentum, activity }

  // Hydrate sliders from saved weights (or defaults)
  function _hydrate(w) {
    const src = w ?? DEFAULTS;
    details.querySelectorAll('[data-sp-slider]').forEach(input => {
      const key = input.dataset.spSlider;
      input.value = Math.round((src[key] ?? DEFAULTS[key]) * 100);
    });
    _updatePcts();
  }

  // Recompute normalized % labels from current raw slider values
  function _updatePcts() {
    const sliders = [...details.querySelectorAll('[data-sp-slider]')];
    const vals = sliders.map(s => Math.max(0, Number(s.value) || 0));
    const sum = vals.reduce((a, b) => a + b, 0) || 1;
    sliders.forEach((s, i) => {
      const pct = Math.round((vals[i] / sum) * 100);
      const span = details.querySelector(`[data-sp-pct="${s.dataset.spSlider}"]`);
      if (span) span.textContent = pct + '%';
    });
  }

  // On any slider move: update labels, save, re-sort
  details.addEventListener('input', (e) => {
    if (!e.target.dataset.spSlider) return;
    _updatePcts();
    const raw = {};
    details.querySelectorAll('[data-sp-slider]').forEach(s => {
      raw[s.dataset.spSlider] = Number(s.value) || 0;
    });
    _customWeights = saveWeights(raw);
    _lastPaintSig = ''; // force repaint even if ranked order hasn't changed
    schedulePaint();
  });

  // Reset button
  details.addEventListener('click', (e) => {
    if (!e.target.closest('[data-sp-reset]')) return;
    clearWeights();
    _customWeights = null;
    _hydrate(null);
    _lastPaintSig = '';
    schedulePaint();
  });

  // Close playground when clicking outside
  document.addEventListener('click', (e) => {
    if (details.open && !details.contains(e.target)) details.open = false;
  }, { passive: true });

  _hydrate(_customWeights);
}

(function boot() {
  try { initHeader(createOpenLibraryButton, createOpenSearchButton); } catch {}
  try { ensureAddonsUI(); } catch {}

  try { registerCoreWidgets(); } catch {}
  try { prewarmDefaults(); } catch {}

  try { widgets.mount('auto'); } catch {}
  try {
    // Search needs inputs from this page
    widgets.mount('search', { elQ, elQResults, elSearchWrap });
  } catch {}



  // try { initLibrary(); } catch {}
  // try { initFavboard(); } catch {}
  // try {
  //   const host = document.getElementById('hdrToolsPanels') || document.body;
  //   initAutoWidget(host);
  // } catch {}

  initSearch(elQ, elQResults, elSearchWrap);

  loadAndRenderAd().catch(() => {});

  // ensureMarqueeSlot(elCards);

  wireSort();
  wireSearch();
  wirePlayground();
  initInitialLoading();
})();
