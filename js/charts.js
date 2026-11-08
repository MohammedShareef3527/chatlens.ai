/*
 * charts.js — tiny dependency-free charts built from divs.
 * Any element with a data-tip attribute gets a hover/focus tooltip.
 */
(function (root) {
  'use strict';

  const fmt = (n) => (n >= 10000 ? (n / 1000).toFixed(n >= 100000 ? 0 : 1) + 'K' : n.toLocaleString());
  const color = (i) => (i < 8 ? 'var(--s' + (i + 1) + ')' : 'var(--muted)');

  function esc(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // ---- tooltip ----
  const tip = () => document.getElementById('tooltip');
  function showTip(el, x, y) {
    const t = tip();
    t.textContent = el.dataset.tip;
    t.style.left = x + 'px';
    t.style.top = y + 'px';
    t.classList.remove('hidden');
  }
  document.addEventListener('mouseover', (e) => {
    const el = e.target.closest('[data-tip]');
    if (el) showTip(el, e.clientX, e.clientY); else tip().classList.add('hidden');
  });
  document.addEventListener('mousemove', (e) => {
    const el = e.target.closest('[data-tip]');
    if (el) showTip(el, e.clientX, e.clientY);
  });
  document.addEventListener('focusin', (e) => {
    const el = e.target.closest('[data-tip]');
    if (el) { const r = el.getBoundingClientRect(); showTip(el, r.left + r.width / 2, r.top); }
  });
  document.addEventListener('focusout', () => tip().classList.add('hidden'));

  function legend(items) {
    return '<div class="legend">' + items.map((it) =>
      '<span><i class="swatch" style="background:' + it.color + '"></i>' + esc(it.label) + '</span>').join('') + '</div>';
  }

  function table(headers, rows) {
    return '<details class="table"><summary>Show as table</summary><table><thead><tr>' +
      headers.map((h) => '<th>' + esc(h) + '</th>').join('') + '</tr></thead><tbody>' +
      rows.map((r) => '<tr>' + r.map((c) => '<td>' + esc(c) + '</td>').join('') + '</tr>').join('') +
      '</tbody></table></details>';
  }

  /** 100% stacked bar. items: [{label, value}] already in a fixed order. */
  function stack(el, items, unit) {
    const total = items.reduce((s, i) => s + i.value, 0) || 1;
    const coloured = items.map((it, i) => ({ ...it, color: it.color || color(i), pct: (it.value / total) * 100 }));
    el.innerHTML =
      legend(coloured) +
      '<div class="stack">' + coloured.map((it) =>
        '<div tabindex="0" style="flex:' + it.value + ' 1 0;background:' + it.color + '" data-tip="' +
        esc(it.label + ': ' + it.pct.toFixed(0) + '% (' + fmt(it.value) + ' ' + unit + ')') + '"></div>').join('') + '</div>' +
      '<div class="stack-labels">' + coloured.map((it) =>
        '<span>' + esc(it.label) + ' <strong>' + it.pct.toFixed(0) + '%</strong></span>').join('') + '</div>' +
      table(['Who', unit, '%'], coloured.map((it) => [it.label, it.value, it.pct.toFixed(1) + '%']));
  }

  /**
   * Column chart, optionally stacked.
   * data: { labels: [...], series: [{ name, values: [...] }] }
   * opts: { tickEvery: n, tickFormat: fn(label, i) }
   */
  function columns(el, data, opts) {
    opts = opts || {};
    const n = data.labels.length;
    const totals = data.labels.map((_, i) => data.series.reduce((s, ser) => s + ser.values[i], 0));
    const max = Math.max(1, ...totals);
    const multi = data.series.length > 1;
    let html = multi ? legend(data.series.map((s, i) => ({ label: s.name, color: color(i) }))) : '';
    html += '<div class="cols">';
    for (let i = 0; i < n; i++) {
      const tipText = data.labels[i] + ': ' + fmt(totals[i]) +
        (multi ? ' (' + data.series.map((s) => s.name + ' ' + fmt(s.values[i])).join(', ') + ')' : '');
      html += '<div class="col" tabindex="0" data-tip="' + esc(tipText) + '">';
      data.series.forEach((s, k) => {
        const v = s.values[i];
        if (v > 0) html += '<div class="seg" style="height:' + ((v / max) * 100).toFixed(2) + '%;background:' + color(k) + '"></div>';
      });
      html += '</div>';
    }
    html += '</div><div class="axis-x">';
    const every = opts.tickEvery || 1;
    for (let i = 0; i < n; i++) {
      const lab = i % every === 0 ? (opts.tickFormat ? opts.tickFormat(data.labels[i], i) : data.labels[i]) : '';
      html += '<span>' + esc(lab) + '</span>';
    }
    html += '</div>';
    html += table(['', ...(multi ? data.series.map((s) => s.name) : []), 'Total'],
      data.labels.map((l, i) => [l, ...(multi ? data.series.map((s) => s.values[i]) : []), totals[i]]));
    el.innerHTML = html;
  }

  root.Charts = { stack, columns, legend, color, fmt, esc };
})(window);
