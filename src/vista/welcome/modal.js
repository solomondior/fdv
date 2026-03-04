const KEY = 'fdv_welcome_seen';

const SLIDES = [
  {
    title: 'Radar scans 500+ tokens in real-time',
    sub: 'fdv.lol monitors Pumping Radar leaders — scored, ranked, and refreshed every cycle.',
  },
  {
    title: 'Safety gates filter every entry',
    sub: 'FDV, liquidity, volume, and age gates must all pass before a token qualifies.',
  },
  {
    title: 'Agent Gary decides — you stay in control',
    sub: 'Approval-based entries. The engine measures, Gary decides. Keys never leave your device.',
  },
];

function buildSlide0() {
  const rows = [
    ['BONK',   87, '+14.2%'],
    ['WIF',    82, '+8.7%'],
    ['POPCAT', 76, '+5.1%'],
    ['BOME',   71, '+3.4%'],
    ['MEW',    65, '+2.1%'],
  ];
  return `<div class="wm-radar">
    <div class="wm-radar-hdr"><span>Token</span><span>Score</span><span>24h</span></div>
    ${rows.map(([sym, score, ch], i) => `
      <div class="wm-row" style="animation-delay:${0.08 + i * 0.16}s">
        <span class="wm-sym">${sym}</span>
        <span class="wm-score-wrap">
          <span class="wm-score-bar" style="--tw:${score}%;animation-delay:${0.22 + i * 0.16}s"></span>
          <b class="wm-score-num">${score}</b>
        </span>
        <span class="wm-ch">${ch}</span>
      </div>`).join('')}
  </div>`;
}

function buildSlide1() {
  const gates = [
    ['FDV',       '< $5M',   0.15],
    ['Liquidity', '> $50K',  0.55],
    ['Volume',    '> $10K',  0.95],
    ['Age',       '> 2 hrs', 1.35],
  ];
  return `<div class="wm-gates">
    <div class="wm-gates-title">— Safety Gates —</div>
    ${gates.map(([name, val, d]) => `
      <div class="wm-gate" style="animation-delay:${d}s">
        <span class="wm-check" style="animation-delay:${d + 0.18}s">✓</span>
        <span class="wm-gate-name">${name}</span>
        <span class="wm-gate-val">${val}</span>
      </div>`).join('')}
    <div class="wm-passed" style="animation-delay:1.85s">PASSED — eligible for entry</div>
  </div>`;
}

function buildSlide2() {
  return `<div class="wm-term">
    <div class="wm-tline" style="animation-delay:.1s"><span class="wm-prompt">$</span> scanning 487 tokens...</div>
    <div class="wm-tline" style="animation-delay:.75s"><span class="wm-prompt">›</span> BONK selected as candidate</div>
    <div class="wm-tline" style="animation-delay:1.35s"><span class="wm-prompt">›</span> Agent Gary reviewing...</div>
    <div class="wm-tline wm-tindent" style="animation-delay:1.65s">score: 87 &nbsp;·&nbsp; liq: $180K &nbsp;·&nbsp; vol: $42K</div>
    <div class="wm-tline wm-approved" style="animation-delay:2.4s">▶&nbsp; APPROVED — executing buy</div>
    <div class="wm-cursor" style="animation-delay:2.55s"></div>
  </div>`;
}

const BUILDERS = [buildSlide0, buildSlide1, buildSlide2];

const CSS = `
#wm-overlay{position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,.88);display:flex;align-items:center;justify-content:center;animation:wmFadeIn .25s ease;}
@keyframes wmFadeIn{from{opacity:0}to{opacity:1}}

#wm-modal{position:relative;width:min(600px,calc(100vw - 24px));background:#0a070f;border:1px solid rgba(168,85,247,.25);border-radius:16px;overflow:hidden;box-shadow:0 40px 100px rgba(0,0,0,.8),0 0 0 1px rgba(168,85,247,.08),0 0 60px rgba(168,85,247,.06);animation:wmModalIn .38s cubic-bezier(.22,1,.36,1);}
@keyframes wmModalIn{from{transform:translateY(28px) scale(.96);opacity:0}to{transform:none;opacity:1}}

#wm-close{position:absolute;top:8px;right:10px;z-index:20;background:none;border:none;color:rgba(200,180,255,.35);font-size:19px;cursor:pointer;padding:4px 8px;border-radius:8px;line-height:1;transition:color .15s;}
#wm-close:hover{color:rgba(200,180,255,.85);}

/* macOS window */
#wm-window{height:268px;background:rgba(5,6,7,.98);border-bottom:1px solid rgba(168,85,247,.14);position:relative;overflow:hidden;}
#wm-window::before{content:'';position:absolute;inset:0;pointer-events:none;background:radial-gradient(ellipse 90% 55% at 50% 0%,rgba(168,85,247,.09),transparent 65%);z-index:0;}
.wm-chrome{display:flex;align-items:center;height:34px;padding:0 14px;gap:6px;background:rgba(10,7,15,.95);border-bottom:1px solid rgba(168,85,247,.11);position:relative;z-index:1;}
.wm-dot{width:12px;height:12px;border-radius:50%;flex-shrink:0;}
.wm-dot.r{background:#ff5f57;} .wm-dot.y{background:#febc2e;} .wm-dot.g{background:#28c840;}
.wm-url{flex:1;text-align:center;font-family:ui-monospace,monospace;font-size:11px;color:rgba(200,180,255,.28);letter-spacing:.03em;}

#wm-content{position:relative;height:234px;overflow:hidden;padding:14px 18px;z-index:1;}

/* Slide transitions */
.wm-slide-wrap{position:absolute;inset:0;padding:14px 18px;transition:opacity .22s ease,transform .22s ease;}
.wm-slide-wrap.wm-out{opacity:0;transform:translateX(-18px);pointer-events:none;}
.wm-slide-wrap.wm-in{opacity:0;transform:translateX(18px);pointer-events:none;}

/* ── Slide 0: Token radar ── */
.wm-radar{display:flex;flex-direction:column;height:100%;}
.wm-radar-hdr{display:grid;grid-template-columns:90px 1fr 70px;padding:0 4px 6px;font-family:monospace;font-size:10px;color:rgba(168,85,247,.5);letter-spacing:.07em;text-transform:uppercase;border-bottom:1px solid rgba(168,85,247,.1);margin-bottom:2px;}
.wm-row{display:grid;grid-template-columns:90px 1fr 70px;align-items:center;padding:7px 4px;border-bottom:1px solid rgba(168,85,247,.06);opacity:0;transform:translateX(-10px);animation:wmRowIn .32s ease forwards;}
@keyframes wmRowIn{to{opacity:1;transform:none}}
.wm-sym{font-family:monospace;font-weight:800;font-size:13px;color:rgba(248,244,255,.9);}
.wm-score-wrap{display:flex;align-items:center;gap:7px;}
.wm-score-bar{height:4px;border-radius:2px;background:linear-gradient(90deg,rgba(168,85,247,.55),rgba(192,132,252,.95));width:0;animation:wmBarIn .55s ease forwards;}
@keyframes wmBarIn{to{width:var(--tw,60%)}}
.wm-score-num{font-family:monospace;font-size:11px;font-weight:700;color:rgba(192,132,252,.85);}
.wm-ch{font-family:monospace;font-size:11px;color:#4ade80;text-align:right;}

/* ── Slide 1: Gates ── */
.wm-gates{display:flex;flex-direction:column;gap:6px;padding:2px 0;}
.wm-gates-title{font-family:monospace;font-size:10px;letter-spacing:.1em;color:rgba(168,85,247,.45);text-align:center;padding-bottom:8px;border-bottom:1px solid rgba(168,85,247,.1);margin-bottom:2px;}
.wm-gate{display:flex;align-items:center;gap:10px;padding:8px 10px;border-radius:8px;background:rgba(168,85,247,.04);border:1px solid rgba(168,85,247,.1);opacity:0;transform:translateY(7px);animation:wmGateIn .32s ease forwards;}
@keyframes wmGateIn{to{opacity:1;transform:none}}
.wm-check{width:20px;height:20px;border-radius:6px;display:grid;place-items:center;background:rgba(74,222,128,.12);border:1px solid rgba(74,222,128,.3);font-size:11px;color:#4ade80;font-weight:900;opacity:0;transform:scale(.5);animation:wmCheckPop .22s ease forwards;}
@keyframes wmCheckPop{to{opacity:1;transform:none}}
.wm-gate-name{flex:1;font-family:monospace;font-size:12px;font-weight:700;color:rgba(248,244,255,.85);}
.wm-gate-val{font-family:monospace;font-size:11px;color:rgba(200,180,255,.55);}
.wm-passed{margin-top:4px;padding:7px 12px;border-radius:8px;background:rgba(74,222,128,.07);border:1px solid rgba(74,222,128,.18);font-family:monospace;font-size:11px;font-weight:700;color:#4ade80;letter-spacing:.05em;text-align:center;opacity:0;animation:wmFadeIn .35s ease forwards;}

/* ── Slide 2: Terminal ── */
.wm-term{font-family:'Courier New',monospace;display:flex;flex-direction:column;gap:9px;padding:2px 0;height:100%;}
.wm-tline{font-size:12.5px;color:rgba(248,244,255,.78);opacity:0;transform:translateY(4px);animation:wmTlIn .28s ease forwards;line-height:1.4;}
@keyframes wmTlIn{to{opacity:1;transform:none}}
.wm-tindent{padding-left:16px;color:rgba(200,180,255,.55);font-size:11.5px;}
.wm-prompt{color:rgba(168,85,247,.85);margin-right:5px;}
.wm-approved{color:#c084fc;font-weight:700;font-size:13.5px;letter-spacing:.02em;text-shadow:0 0 16px rgba(168,85,247,.5);}
.wm-cursor{width:8px;height:13px;background:#a855f7;display:inline-block;opacity:0;animation:wmBlink .75s step-end infinite,wmTlIn .12s ease forwards;}
@keyframes wmBlink{50%{opacity:0}}

/* ── Bottom ── */
#wm-bottom{padding:16px 20px 0;}
#wm-title{font-size:18px;font-weight:800;color:rgba(248,244,255,.96);font-family:ui-monospace,monospace;letter-spacing:-.01em;margin-bottom:5px;transition:opacity .18s ease,transform .18s ease;}
#wm-sub{font-size:13px;color:rgba(200,180,255,.65);line-height:1.5;min-height:36px;transition:opacity .18s ease,transform .18s ease;}
#wm-title.wm-fade,#wm-sub.wm-fade{opacity:0;transform:translateY(5px);}

#wm-dots{display:flex;gap:6px;justify-content:center;padding:12px 0 8px;}
.wm-pdot{width:6px;height:6px;border-radius:50%;background:rgba(168,85,247,.22);transition:all .25s ease;cursor:pointer;}
.wm-pdot.on{width:20px;border-radius:3px;background:rgba(168,85,247,.82);}

#wm-bar{display:flex;align-items:center;justify-content:space-between;padding:10px 20px 15px;border-top:1px solid rgba(168,85,247,.09);margin-top:6px;}
#wm-label{font-size:11.5px;color:rgba(185,155,255,.45);font-family:monospace;}
#wm-next{padding:9px 20px;border-radius:10px;cursor:pointer;background:linear-gradient(180deg,rgba(168,85,247,1),rgba(168,85,247,.82));color:#fff;font-weight:700;font-size:13px;border:1px solid rgba(168,85,247,.85);font-family:ui-monospace,monospace;letter-spacing:.02em;transition:filter .14s,transform .12s;}
#wm-next:hover{filter:brightness(1.12);transform:translateY(-1px);}
#wm-next:active{transform:translateY(0);}
`;

function injectCSS() {
  if (document.getElementById('wm-style')) return;
  const s = document.createElement('style');
  s.id = 'wm-style';
  s.textContent = CSS;
  document.head.appendChild(s);
}

function buildHTML() {
  return `
  <div id="wm-overlay">
    <div id="wm-modal">
      <button id="wm-close" aria-label="Close">×</button>

      <div id="wm-window">
        <div class="wm-chrome">
          <span class="wm-dot r"></span>
          <span class="wm-dot y"></span>
          <span class="wm-dot g"></span>
          <span class="wm-url">fdv.lol — memecoin radar</span>
        </div>
        <div id="wm-content"></div>
      </div>

      <div id="wm-bottom">
        <div id="wm-title"></div>
        <div id="wm-sub"></div>
        <div id="wm-dots">
          <span class="wm-pdot" data-i="0"></span>
          <span class="wm-pdot" data-i="1"></span>
          <span class="wm-pdot" data-i="2"></span>
        </div>
      </div>

      <div id="wm-bar">
        <span id="wm-label">🚀 fdv.lol — Solana memecoin radar</span>
        <button id="wm-next">Next →</button>
      </div>
    </div>
  </div>`;
}

export function initWelcomeModal() {
  try {
    if (localStorage.getItem(KEY)) return;
  } catch { return; }

  injectCSS();
  document.body.insertAdjacentHTML('beforeend', buildHTML());

  const overlay  = document.getElementById('wm-overlay');
  const content  = document.getElementById('wm-content');
  const titleEl  = document.getElementById('wm-title');
  const subEl    = document.getElementById('wm-sub');
  const nextBtn  = document.getElementById('wm-next');
  const closeBtn = document.getElementById('wm-close');
  const dots     = document.querySelectorAll('.wm-pdot');

  let current = 0;
  let autoTimer = null;

  function close() {
    try { localStorage.setItem(KEY, '1'); } catch {}
    overlay.style.transition = 'opacity .2s ease';
    overlay.style.opacity = '0';
    setTimeout(() => overlay.remove(), 220);
  }

  function setSlide(idx, dir = 1) {
    current = idx;

    // Swap window content (restarts all CSS animations automatically)
    const wrap = document.createElement('div');
    wrap.className = 'wm-slide-wrap wm-in';
    wrap.innerHTML = BUILDERS[idx]();

    // Fade out old content
    const old = content.querySelector('.wm-slide-wrap');
    if (old) {
      old.classList.add('wm-out');
      old.classList.remove('wm-in');
      setTimeout(() => old.remove(), 230);
    }
    content.appendChild(wrap);
    // Trigger reflow then animate in
    requestAnimationFrame(() => {
      requestAnimationFrame(() => wrap.classList.remove('wm-in'));
    });

    // Update text with a brief fade
    titleEl.classList.add('wm-fade');
    subEl.classList.add('wm-fade');
    setTimeout(() => {
      titleEl.textContent = SLIDES[idx].title;
      subEl.textContent   = SLIDES[idx].sub;
      titleEl.classList.remove('wm-fade');
      subEl.classList.remove('wm-fade');
    }, 180);

    // Dots
    dots.forEach((d, i) => d.classList.toggle('on', i === idx));

    // Next button label
    nextBtn.textContent = idx === SLIDES.length - 1 ? 'Launch →' : 'Next →';

    // Reset auto-advance
    clearTimeout(autoTimer);
    autoTimer = setTimeout(() => {
      if (current < SLIDES.length - 1) setSlide(current + 1);
    }, 4200);
  }

  nextBtn.addEventListener('click', () => {
    if (current < SLIDES.length - 1) {
      setSlide(current + 1);
    } else {
      close();
    }
  });

  closeBtn.addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

  dots.forEach((d) => {
    d.addEventListener('click', () => setSlide(Number(d.dataset.i)));
  });

  // Kick off slide 0
  setSlide(0);
}
