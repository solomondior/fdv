import { getRugEvents, clearRugEvents } from '../../../core/rugTracker.js';

const DAYS  = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const HOURS = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0'));

function _buildCounts(events) {
  // counts[dayOfWeek 0–6][hour 0–23]
  const counts = Array.from({ length: 7 }, () => new Array(24).fill(0));
  for (const e of events) {
    const d = Number(e.dayOfWeek);
    const h = Number(e.hour);
    if (d >= 0 && d < 7 && h >= 0 && h < 24) counts[d][h]++;
  }
  return counts;
}

function _findPeak(counts) {
  let max = 0, peakDay = 0, peakHour = 0;
  for (let d = 0; d < 7; d++) {
    for (let h = 0; h < 24; h++) {
      if (counts[d][h] > max) { max = counts[d][h]; peakDay = d; peakHour = h; }
    }
  }
  return { count: max, day: peakDay, hour: peakHour };
}

function _render(container, events) {
  const counts   = _buildCounts(events);
  const maxCount = Math.max(1, ...counts.flat());
  const total    = events.length;
  const peak     = _findPeak(counts);

  const summaryHtml = `
    <div class="fdv-hm-summary">
      <span>Rugs tracked: <strong>${total}</strong></span>
      ${total > 0
        ? `<span>Most dangerous: <strong>${DAYS[peak.day]} ${HOURS[peak.hour]}:00 UTC</strong> (${peak.count})</span>`
        : '<span>No rug events recorded yet — data builds up over time.</span>'}
      <button class="btn fdv-hm-clear" type="button" title="Clear all rug event data">Clear</button>
      <button class="btn fdv-hm-refresh" type="button">Refresh</button>
    </div>`;

  // Build grid HTML: corner + hour headers + (day label + 24 cells) × 7
  let gridHtml = '<div class="fdv-hm-grid">';
  // Corner
  gridHtml += '<div class="fdv-hm-corner"></div>';
  // Hour headers
  for (const h of HOURS) {
    gridHtml += `<div class="fdv-hm-hr">${h}</div>`;
  }
  // Day rows
  for (let d = 0; d < 7; d++) {
    gridHtml += `<div class="fdv-hm-day">${DAYS[d]}</div>`;
    for (let h = 0; h < 24; h++) {
      const c = counts[d][h];
      const intensity = (c / maxCount).toFixed(3);
      const label = `${DAYS[d]} ${HOURS[h]}:00 UTC — ${c} rug${c !== 1 ? 's' : ''}`;
      gridHtml += `<div class="fdv-hm-cell" style="--intensity:${intensity}" title="${label}" data-count="${c}"></div>`;
    }
  }
  gridHtml += '</div>';

  const legendHtml = `
    <div class="fdv-hm-legend">
      <span>Low</span>
      <div class="fdv-hm-legend-bar"></div>
      <span>High</span>
    </div>`;

  container.innerHTML = summaryHtml + gridHtml + legendHtml;

  container.querySelector('.fdv-hm-clear').addEventListener('click', () => {
    if (!confirm('Clear all recorded rug events?')) return;
    clearRugEvents();
    _render(container, []);
  });

  container.querySelector('.fdv-hm-refresh').addEventListener('click', () => {
    _render(container, getRugEvents());
  });
}

export function initHeatmap(container) {
  if (!container) return;
  container.className = 'fdv-hm-panel';
  _render(container, getRugEvents());

  // Live-update whenever a new rug is recorded
  window.addEventListener('fdv:rug-recorded', () => {
    try { _render(container, getRugEvents()); } catch {}
  });
}
