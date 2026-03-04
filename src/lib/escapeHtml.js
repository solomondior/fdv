/**
 * Escape a string for safe insertion into HTML content or attribute values.
 * Handles &, <, >, ", and ' — sufficient for both innerHTML and quoted attributes.
 * @param {*} s
 * @returns {string}
 */
export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] || c));
}
