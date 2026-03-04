import {
  isTrainingCaptureEnabled,
  getAllCaptures,
  saveLabel,
  deleteCapture,
} from '../../../agents/training.js';
import { esc as _esc } from '../../../lib/escapeHtml.js';

export { isTrainingCaptureEnabled };

const PAGE_SIZE = 50;

// ── Helpers ──────────────────────────────────────────────────────────────────

function _fmtTime(ts) {
  if (!ts) return '—';
  try {
    const d = new Date(ts);
    return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch { return String(ts); }
}

function _systemPrompt() {
  return 'You are Agent Gary, an AI that analyzes Solana memecoin trading signals and decides whether to buy, hold, or sell. Base your decisions on liquidity, volume, momentum, FDV/liq ratio, and on-chain activity. Respond with a JSON object containing "action" and optionally "reason".';
}

function _toFineTuneRecord(capture) {
  return JSON.stringify({
    messages: [
      { role: 'system',    content: _systemPrompt() },
      { role: 'user',      content: JSON.stringify(capture.signals || {}) },
      { role: 'assistant', content: JSON.stringify({ action: capture.decision, label: capture.label }) },
    ],
  });
}

function _shortKey(storageKey) {
  // e.g. 'fdv_gary_training_captures_v1' → 'gary'
  const s = String(storageKey || '');
  const parts = s.replace(/^fdv_/, '').split('_');
  return parts.slice(0, 2).join('_') || s.slice(0, 12) || '?';
}

// ── Main panel ───────────────────────────────────────────────────────────────

export async function initTraining(container) {
  if (!container) return;

  if (!isTrainingCaptureEnabled()) {
    container.innerHTML = `
      <div class="fdv-train-disabled">
        <p>Training capture is disabled.</p>
        <p>Enable it by setting <code>TRAINING_CAPTURE_ENABLED=true</code>.</p>
      </div>`;
    return;
  }

  container.innerHTML = '<div class="fdv-train-loading">Loading captures\u2026</div>';

  let _all = [];
  try {
    _all = await getAllCaptures();
  } catch {
    container.innerHTML = '<div class="fdv-train-error">Failed to read IndexedDB captures.</div>';
    return;
  }

  let _page = 0;
  const _filters = { storageKey: '', label: '', dateFrom: '', dateTo: '' };

  // ── Filter ─────────────────────────────────────────────────────────────────
  function _applyFilters(rows) {
    let r = rows;
    if (_filters.storageKey) r = r.filter(c => c.storageKey === _filters.storageKey);
    if (_filters.label === 'unlabeled') r = r.filter(c => !c.label);
    else if (_filters.label)            r = r.filter(c => c.label === _filters.label);
    if (_filters.dateFrom) {
      const from = new Date(_filters.dateFrom).getTime();
      if (Number.isFinite(from)) r = r.filter(c => (c.ts || 0) >= from);
    }
    if (_filters.dateTo) {
      const to = new Date(_filters.dateTo).getTime() + 86_400_000; // end of day
      if (Number.isFinite(to)) r = r.filter(c => (c.ts || 0) < to);
    }
    return r;
  }

  // ── Row HTML ───────────────────────────────────────────────────────────────
  function _rowHtml(c) {
    const pnl     = c.outcome?.pnlSol;
    const pnlHtml = pnl != null
      ? `<span class="${pnl >= 0 ? 'pos' : 'neg'}">${pnl >= 0 ? '+' : ''}${pnl.toFixed(4)}</span>`
      : '—';
    const g = c.label === 'good', b = c.label === 'bad', s = c.label === 'skip';
    return `
      <tr data-capture-id="${c.id}">
        <td class="fdv-train-td-time">${_fmtTime(c.ts)}</td>
        <td title="${_esc(c.storageKey || '')}">${_esc(_shortKey(c.storageKey))}</td>
        <td>${_esc(c.decision || '—')}</td>
        <td>${pnlHtml}</td>
        <td>
          <div class="fdv-label-btns">
            <button class="fdv-label-btn good ${g ? 'active' : ''}" data-label="good" data-id="${c.id}" title="Mark good">G</button>
            <button class="fdv-label-btn bad  ${b ? 'active' : ''}" data-label="bad"  data-id="${c.id}" title="Mark bad">B</button>
            <button class="fdv-label-btn skip ${s ? 'active' : ''}" data-label="skip" data-id="${c.id}" title="Skip">S</button>
          </div>
        </td>
        <td><button class="fdv-train-del" data-id="${c.id}" aria-label="Delete">×</button></td>
      </tr>`;
  }

  // ── Full render ────────────────────────────────────────────────────────────
  function _render() {
    const filtered   = _applyFilters(_all);
    const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
    _page = Math.min(_page, totalPages - 1);
    const rows = filtered.slice(_page * PAGE_SIZE, (_page + 1) * PAGE_SIZE);

    // Stats
    const total     = _all.length;
    const good      = _all.filter(c => c.label === 'good').length;
    const bad       = _all.filter(c => c.label === 'bad').length;
    const labeled   = good + bad;
    const unlabeled = _all.filter(c => !c.label).length;
    const pct       = total ? Math.round(labeled / total * 100) : 0;

    // Unique storageKeys for filter dropdown
    const keys = [...new Set(_all.map(c => c.storageKey).filter(Boolean))].sort();

    container.innerHTML = `
      <div class="fdv-train-panel">
        <div class="fdv-train-stats">
          <span class="fdv-train-stat">Total <strong>${total}</strong></span>
          <span class="fdv-train-stat">Labeled <strong>${labeled} (${pct}%)</strong></span>
          <span class="fdv-train-stat fdv-train-stat-good">Good <strong>${good}</strong></span>
          <span class="fdv-train-stat fdv-train-stat-bad">Bad <strong>${bad}</strong></span>
          <span class="fdv-train-stat">Unlabeled <strong>${unlabeled}</strong></span>
        </div>

        <div class="fdv-train-filters">
          <select class="fdv-train-fk">
            <option value="">All bots</option>
            ${keys.map(k => `<option value="${_esc(k)}" ${_filters.storageKey === k ? 'selected' : ''}>${_esc(_shortKey(k))}</option>`).join('')}
          </select>
          <select class="fdv-train-fl">
            <option value=""        ${_filters.label === ''          ? 'selected' : ''}>All labels</option>
            <option value="unlabeled" ${_filters.label === 'unlabeled' ? 'selected' : ''}>Unlabeled</option>
            <option value="good"    ${_filters.label === 'good'      ? 'selected' : ''}>Good</option>
            <option value="bad"     ${_filters.label === 'bad'       ? 'selected' : ''}>Bad</option>
            <option value="skip"    ${_filters.label === 'skip'      ? 'selected' : ''}>Skip</option>
          </select>
          <input type="date" class="fdv-train-fd" value="${_esc(_filters.dateFrom)}" title="Date from">
          <input type="date" class="fdv-train-ft" value="${_esc(_filters.dateTo)}"   title="Date to">
          <button class="btn fdv-train-export" type="button">Export JSONL</button>
        </div>

        <div class="fdv-train-scroll">
          <table class="fdv-train-table">
            <thead>
              <tr>
                <th>Time</th>
                <th>Bot</th>
                <th>Decision</th>
                <th>PnL</th>
                <th>Label</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              ${rows.length
                ? rows.map(_rowHtml).join('')
                : '<tr><td colspan="6" class="fdv-train-empty">No captures match filters</td></tr>'}
            </tbody>
          </table>
        </div>

        <div class="fdv-train-pagination">
          <button class="btn fdv-train-prev" type="button" ${_page === 0 ? 'disabled' : ''}>← Prev</button>
          <span>Page ${_page + 1} / ${totalPages} &middot; ${filtered.length} record${filtered.length !== 1 ? 's' : ''}</span>
          <button class="btn fdv-train-next" type="button" ${_page >= totalPages - 1 ? 'disabled' : ''}>Next →</button>
        </div>
      </div>`;

    _wire();
  }

  // ── Event wiring ───────────────────────────────────────────────────────────
  function _wire() {
    // Filter selects
    container.querySelector('.fdv-train-fk')?.addEventListener('change', e => {
      _filters.storageKey = e.target.value; _page = 0; _render();
    });
    container.querySelector('.fdv-train-fl')?.addEventListener('change', e => {
      _filters.label = e.target.value; _page = 0; _render();
    });
    container.querySelector('.fdv-train-fd')?.addEventListener('change', e => {
      _filters.dateFrom = e.target.value; _page = 0; _render();
    });
    container.querySelector('.fdv-train-ft')?.addEventListener('change', e => {
      _filters.dateTo = e.target.value; _page = 0; _render();
    });

    // Pagination
    container.querySelector('.fdv-train-prev')?.addEventListener('click', () => {
      if (_page > 0) { _page--; _render(); }
    });
    container.querySelector('.fdv-train-next')?.addEventListener('click', () => {
      const totalPages = Math.ceil(_applyFilters(_all).length / PAGE_SIZE);
      if (_page < totalPages - 1) { _page++; _render(); }
    });

    // Export JSONL (OpenAI fine-tuning format — good + bad only)
    container.querySelector('.fdv-train-export')?.addEventListener('click', () => {
      const exportable = _all.filter(c => c.label === 'good' || c.label === 'bad');
      if (!exportable.length) {
        // Show inline feedback instead of a blocking alert
        const btn = container.querySelector('.fdv-train-export');
        const prev = btn.textContent;
        btn.textContent = 'Nothing to export';
        setTimeout(() => { btn.textContent = prev; }, 2000);
        return;
      }
      const blob = new Blob(
        exportable.map(c => _toFineTuneRecord(c) + '\n'),
        { type: 'application/jsonl' }
      );
      const a = Object.assign(document.createElement('a'), {
        href: URL.createObjectURL(blob),
        download: `gary-finetune-${Date.now()}.jsonl`,
        style: 'display:none',
      });
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { try { URL.revokeObjectURL(a.href); a.remove(); } catch {} }, 150);
    });

    // Label buttons + delete (event delegation on tbody)
    const tbody = container.querySelector('.fdv-train-table tbody');
    if (!tbody) return;

    tbody.addEventListener('click', async e => {
      // Label toggle
      const labelBtn = e.target.closest('[data-label]');
      if (labelBtn) {
        const id  = Number(labelBtn.dataset.id);
        const lbl = labelBtn.dataset.label;
        const rec = _all.find(c => c.id === id);
        if (!rec) return;
        // Clicking the active label clears it; clicking a different label sets it
        const next = rec.label === lbl ? null : lbl;
        rec.label     = next;
        rec.labeledAt = next ? Date.now() : null;
        try { await saveLabel(id, next); } catch {}
        _render();
        return;
      }

      // Delete
      const delBtn = e.target.closest('.fdv-train-del');
      if (delBtn) {
        const id = Number(delBtn.dataset.id);
        if (!id) return;
        try { await deleteCapture(id); } catch {}
        _all = _all.filter(c => c.id !== id);
        _render();
      }
    });
  }

  _render();
}
