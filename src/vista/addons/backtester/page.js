import '../auto/lib/sell/policies/registerAll.js'; // side-effect: populate registry
import { getRegisteredPolicies } from '../auto/lib/sell/policies/registry.js';
import { runBacktest, loadSnapshot, listSnapshots, hasSimulateFn } from './sim.js';
import { esc as _esc } from '../../../lib/escapeHtml.js';

const MAX_COMBOS = 3;

function _fmtSol(v) {
  const n = Number(v);
  return { text: (n >= 0 ? '+' : '') + n.toFixed(4), cls: n >= 0 ? 'pos' : 'neg' };
}

function _fmtPct(v) {
  const n = Number(v) * 100;
  return { text: `${n.toFixed(1)}%`, cls: n >= 50 ? 'pos' : 'neg' };
}

function _fmtMs(ms) {
  const s = Math.round(ms / 1000);
  if (!s) return '—';
  if (s < 60)   return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
}

// ── Main init ─────────────────────────────────────────────────────────────────

export async function initBacktester(container) {
  if (!container) return;

  let _snaps   = [];   // flat array of raw snap objects loaded
  let _results = [];   // one result per combo after a run
  let _combos  = [{ id: 1, activePolicies: new Set(['execute']) }];
  let _nextId  = 2;

  container.innerHTML = `
    <div class="fdv-bt-panel">
      <div class="fdv-bt-load-row">
        <label class="fdv-bt-load-label">
          Snapshot
          <select class="fdv-bt-snap-select">
            <option value="">— loading —</option>
          </select>
        </label>
        <button class="btn fdv-bt-load-btn" type="button">Load</button>
        <span class="fdv-bt-snap-status"></span>
      </div>

      <div class="fdv-bt-combos-wrap"></div>

      <div class="fdv-bt-actions">
        <button class="btn fdv-bt-add-combo" type="button">+ Add Combo</button>
        <button class="btn fdv-bt-run" type="button">▶ Run Backtest</button>
      </div>

      <div class="fdv-bt-results" hidden></div>
    </div>`;

  const snapSelect  = container.querySelector('.fdv-bt-snap-select');
  const loadBtn     = container.querySelector('.fdv-bt-load-btn');
  const snapStatus  = container.querySelector('.fdv-bt-snap-status');
  const combosWrap  = container.querySelector('.fdv-bt-combos-wrap');
  const addComboBtn = container.querySelector('.fdv-bt-add-combo');
  const runBtn      = container.querySelector('.fdv-bt-run');
  const resultsEl   = container.querySelector('.fdv-bt-results');

  // ── Load manifest ──────────────────────────────────────────────────────────
  (async () => {
    const files = await listSnapshots();
    if (!files.length) {
      snapSelect.innerHTML = '<option value="">No snapshots found</option>';
      snapStatus.textContent = 'Add filenames to /tools/snapshots/manifest.json to get started.';
      return;
    }
    snapSelect.innerHTML = files
      .map(f => `<option value="${_esc(f)}">${_esc(f)}</option>`)
      .join('');
  })().catch(() => {
    snapSelect.innerHTML = '<option value="">Manifest unavailable</option>';
  });

  // ── Load snapshot ──────────────────────────────────────────────────────────
  loadBtn.addEventListener('click', async () => {
    const filename = snapSelect.value;
    if (!filename) return;
    loadBtn.disabled = true;
    loadBtn.textContent = 'Loading…';
    snapStatus.textContent = '';
    try {
      _snaps   = await loadSnapshot(filename);
      _results = [];
      resultsEl.hidden = true;
      snapStatus.textContent = `Loaded ${_snaps.length} snapshot${_snaps.length !== 1 ? 's' : ''}.`;
    } catch (e) {
      snapStatus.textContent = `Error: ${e.message}`;
    } finally {
      loadBtn.disabled = false;
      loadBtn.textContent = 'Load';
    }
  });

  // ── Combo rendering ────────────────────────────────────────────────────────
  const allPolicies = getRegisteredPolicies();

  function _renderCombos() {
    combosWrap.innerHTML = '';
    for (let i = 0; i < _combos.length; i++) {
      const combo = _combos[i];
      const col   = document.createElement('div');
      col.className = 'fdv-bt-combo';
      col.innerHTML = `
        <div class="fdv-bt-combo-header">
          <strong>Combo ${i + 1}</strong>
          ${_combos.length > 1
            ? `<button class="fdv-bt-remove-combo" data-id="${combo.id}" title="Remove">×</button>`
            : ''}
        </div>
        <div class="fdv-bt-policy-list">
          ${allPolicies.map(p => {
            const canSim = hasSimulateFn(p.name);
            const isExec = p.name === 'execute';
            const checked = combo.activePolicies.has(p.name);
            return `
              <label class="fdv-bt-policy-row${canSim ? '' : ' live-only'}"
                     title="${canSim ? '' : 'No simulateFn — skipped during backtest'}">
                <input type="checkbox"
                  data-combo-id="${combo.id}"
                  data-policy="${_esc(p.name)}"
                  ${checked  ? 'checked'  : ''}
                  ${isExec || !canSim ? 'disabled' : ''}>
                ${_esc(p.name)}${canSim ? '' : ' <span class="fdv-bt-live-only">(live only)</span>'}
              </label>`;
          }).join('')}
        </div>`;
      combosWrap.appendChild(col);
    }

    addComboBtn.disabled = _combos.length >= MAX_COMBOS;

    // Wire checkboxes
    combosWrap.querySelectorAll('input[type="checkbox"]').forEach(cb => {
      cb.addEventListener('change', () => {
        const id     = Number(cb.dataset.comboId);
        const policy = cb.dataset.policy;
        const combo  = _combos.find(c => c.id === id);
        if (!combo) return;
        if (cb.checked) combo.activePolicies.add(policy);
        else            combo.activePolicies.delete(policy);
      });
    });

    // Wire remove buttons
    combosWrap.querySelectorAll('.fdv-bt-remove-combo').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = Number(btn.dataset.id);
        _combos  = _combos.filter(c => c.id !== id);
        _results = [];
        resultsEl.hidden = true;
        _renderCombos();
      });
    });
  }

  _renderCombos();

  // ── Add combo ──────────────────────────────────────────────────────────────
  addComboBtn.addEventListener('click', () => {
    if (_combos.length >= MAX_COMBOS) return;
    _combos.push({ id: _nextId++, activePolicies: new Set(['execute']) });
    _results = [];
    resultsEl.hidden = true;
    _renderCombos();
  });

  // ── Run backtest ───────────────────────────────────────────────────────────
  runBtn.addEventListener('click', () => {
    if (!_snaps.length) {
      snapStatus.textContent = 'Load a snapshot file first.';
      return;
    }
    _results = _combos.map(combo =>
      runBacktest(_snaps, { activePolicies: [...combo.activePolicies] })
    );
    _renderResults();
  });

  // ── Results rendering ──────────────────────────────────────────────────────
  function _renderResults() {
    if (!_results.length) { resultsEl.hidden = true; return; }

    const comboHeaders = _combos.map((_, i) => `<th>Combo ${i + 1}</th>`).join('');

    const rows = [
      {
        label: 'Total PnL (SOL)',
        render: r => { const f = _fmtSol(r.totalPnlSol); return `<td class="${f.cls}">${f.text}</td>`; },
      },
      {
        label: 'Win Rate',
        render: r => { const f = _fmtPct(r.winRate); return `<td class="${f.cls}">${f.text}</td>`; },
      },
      {
        label: 'Avg Hold',
        render: r => `<td>${_fmtMs(r.avgHoldMs)}</td>`,
      },
      {
        label: 'Max Drawdown',
        render: r => { const f = _fmtSol(r.maxDrawdown); return `<td class="${f.cls}">${f.text}</td>`; },
      },
      {
        label: 'Triggered / Total',
        render: r => `<td>${r.trades.length} / ${r.total}</td>`,
      },
    ];

    resultsEl.innerHTML = `
      <table class="fdv-bt-table">
        <thead>
          <tr><th></th>${comboHeaders}</tr>
        </thead>
        <tbody>
          ${rows.map(row => `
            <tr>
              <td class="fdv-bt-row-label">${_esc(row.label)}</td>
              ${_results.map(row.render).join('')}
            </tr>`).join('')}
        </tbody>
      </table>`;

    resultsEl.hidden = false;
  }
}
