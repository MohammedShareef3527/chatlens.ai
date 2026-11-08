/*
 * app.js — wires the page together: upload -> parse -> stats -> AI report.
 */
(function () {
  'use strict';

  const cfg = window.CHATLENS_CONFIG || {};
  const { parse } = window.ChatParser;
  const { compute } = window.ChatStats;
  const R = window.ChatReport;
  const C = window.Charts;
  const $ = (id) => document.getElementById(id);
  const esc = C.esc;

  const state = { parsed: null, stats: null };
  const PROVIDER_NAMES = { gemini: 'Google Gemini', anthropic: 'Claude (Anthropic)', openrouter: 'OpenRouter' };
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  // ---------------- Step 1: reading the file ----------------

  async function readChatFile(file) {
    const isZip = /\.zip$/i.test(file.name) || /zip/.test(file.type);
    if (!isZip) return file.text();
    if (!window.JSZip) throw new Error('Could not load the zip reader. Check your internet connection, or upload the .txt instead.');
    const zip = await window.JSZip.loadAsync(file);
    const txts = Object.values(zip.files).filter((f) => !f.dir && /\.txt$/i.test(f.name));
    if (!txts.length) throw new Error('No .txt chat file found inside that zip.');
    const best = txts.find((f) => /_chat\.txt$/i.test(f.name)) ||
      txts.find((f) => /whatsapp/i.test(f.name)) || txts[0];
    return best.async('string');
  }

  function setStep(n) {
    $('stepLabel').textContent = 'Step ' + n + ' of 3';
    $('stepLabel').dataset.step = n;
  }

  function showError(id, msg) {
    const el = $(id);
    el.textContent = msg;
    el.classList.toggle('hidden', !msg);
  }

  async function handleFile(file) {
    showError('uploadError', '');
    if (!file) return;
    if (file.size > 300 * 1024 * 1024) return showError('uploadError', 'That file is over 300 MB. Export the chat "Without media" and try again.');
    $('fileStatus').textContent = 'Reading ' + file.name + '…';
    try {
      const text = await readChatFile(file);
      load(text, file.name);
    } catch (e) {
      $('fileStatus').textContent = '';
      showError('uploadError', e.message);
    }
  }

  function load(text, label) {
    const parsed = parse(text);
    if (parsed.messages.length < 10) {
      $('fileStatus').textContent = '';
      return showError('uploadError', "Couldn't find WhatsApp messages in this file. Make sure it's a chat export (.txt or .zip) from WhatsApp.");
    }
    state.parsed = parsed;
    state.stats = compute(parsed.messages, parsed.participants);
    $('fileStatus').textContent = label + ' — ' + parsed.messages.length.toLocaleString() + ' messages found';
    renderStats(state.stats);
    $('uploadSection').classList.add('hidden');
    $('statsSection').classList.remove('hidden');
    $('reportSection').classList.remove('hidden');
    setStep(2);
    $('reportOut').innerHTML = '';
    showError('reportError', '');
    setupReport();
    window.scrollTo({ top: 0 });
  }

  // ---------------- Step 2: stats ----------------

  function fmtDate(d) {
    return d.getDate() + ' ' + MONTHS[d.getMonth()] + ' ' + d.getFullYear();
  }
  function fmtMinutes(m) {
    if (m === null) return '—';
    if (m < 1) return Math.round(m * 60) + ' sec';
    if (m < 60) return (m < 10 ? m.toFixed(1) : Math.round(m)) + ' min';
    return (m / 60).toFixed(1) + ' h';
  }
  function hourLabel(h) {
    return (h % 12 || 12) + (h < 12 ? 'a' : 'p');
  }
  const pct = (x) => (x === null ? '—' : Math.round(x * 100) + '%');

  function tile(label, value, note) {
    return '<div class="card tile"><div class="label">' + esc(label) + '</div><div class="value">' + esc(value) +
      '</div>' + (note ? '<div class="note">' + esc(note) + '</div>' : '') + '</div>';
  }

  /** Charts show up to 7 people by name; the rest fold into "Others". */
  function folded(people, key) {
    if (people.length <= 8) return people.map((p) => ({ label: p.name, value: p[key] }));
    const top = people.slice(0, 7).map((p) => ({ label: p.name, value: p[key] }));
    const rest = people.slice(7).reduce((s, p) => s + p[key], 0);
    return top.concat([{ label: 'Others', value: rest, color: 'var(--muted)' }]);
  }

  function renderStats(s) {
    const t = s.totals;
    const names = s.participants.map((p) => p.name);
    $('statsTitle').textContent = s.isGroup ? 'Your group, in numbers' : names.join(' & ');
    $('statsSub').textContent = fmtDate(t.firstDate) + ' → ' + fmtDate(t.lastDate) + ' · ' +
      t.spanDays.toLocaleString() + ' days · ' + t.conversations.toLocaleString() + ' conversations';

    const busiest = t.busiestDay ? new Date(t.busiestDay.date + 'T12:00:00') : null;
    $('tiles').innerHTML =
      tile('Messages', t.messages.toLocaleString(), Math.round(t.messages / t.spanDays) + ' a day on average') +
      tile('Days you talked', t.activeDays.toLocaleString(), Math.round((t.activeDays / t.spanDays) * 100) + '% of all days') +
      tile('Longest streak', t.longestStreak + ' days', 'in a row without a silent day') +
      tile('Busiest day', busiest ? t.busiestDay.count.toLocaleString() + ' msgs' : '—', busiest ? fmtDate(busiest) : '') +
      tile('After midnight', pct(t.lateNightShare), 'of messages sent 12am–5am');

    C.stack($('shareChart'), folded(s.participants, 'messages'), 'messages');
    C.stack($('startChart'), folded(s.participants, 'starters'), 'conversations started');

    C.columns($('hourChart'), { labels: s.hours.map((_, h) => hourLabel(h)), series: [{ name: 'Messages', values: s.hours }] }, { tickEvery: 3 });

    const months = s.months;
    const monthLabels = months.map((m) => { const [y, mo] = m.key.split('-'); return MONTHS[Number(mo) - 1] + " '" + y.slice(2); });
    const byPerson = s.participants.length <= 4;
    C.columns($('monthChart'), {
      labels: monthLabels,
      series: byPerson
        ? s.participants.map((p) => ({ name: p.name, values: months.map((m) => m.by[p.name] || 0) }))
        : [{ name: 'Messages', values: months.map((m) => m.total) }],
    }, { tickEvery: Math.max(1, Math.ceil(months.length / 6)) });

    const order = [1, 2, 3, 4, 5, 6, 0]; // Monday first
    C.columns($('weekChart'), {
      labels: order.map((d) => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d]),
      series: [{ name: 'Messages', values: order.map((d) => s.weekdays[d]) }],
    });

    $('people').innerHTML = s.participants.slice(0, 8).map((p, i) => {
      const kv = (k, v) => '<div class="kv"><span>' + esc(k) + '</span><strong>' + esc(v) + '</strong></div>';
      return '<div class="card person">' +
        '<div class="person-head"><i class="swatch" style="background:' + C.color(i) + '"></i>' + esc(p.name) + '</div>' +
        kv('Messages', p.messages.toLocaleString() + ' (' + pct(p.share) + ')') +
        kv('Starts conversations', pct(p.startShare)) +
        kv('Typical reply time', fmtMinutes(p.medianReplyMin)) +
        kv('Replies within 5 min', pct(p.fastReplyShare)) +
        kv('Words per message', p.avgWords.toFixed(1)) +
        kv('Double texts', p.doubleTexts.toLocaleString()) +
        kv('Most active at', hourLabel(p.peakHour) + 'm') +
        kv('Media · deleted', p.media + ' · ' + p.deleted) +
        (p.topEmojis.length ? '<div class="emojis" title="Top emojis">' + p.topEmojis.map((e) => esc(e[0])).join(' ') + '</div>' : '') +
        (p.topWords.length ? '<div class="chips">' + p.topWords.map((w) => '<span class="chip">' + esc(w[0]) + '</span>').join('') + '</div>' : '') +
        '</div>';
    }).join('');
  }

  // ---------------- Step 3: AI report ----------------

  async function setupReport() {
    const sel = $('providerSelect');
    const btn = $('reportBtn');
    $('anonCheck').checked = cfg.ANONYMISE_BY_DEFAULT !== false;
    sel.innerHTML = '';
    btn.disabled = true;

    if (!cfg.SUPABASE_URL || !cfg.SUPABASE_PUBLISHABLE_KEY) {
      sel.innerHTML = '<option>AI not connected</option>';
      sel.disabled = true;
      $('reportInfo').textContent = 'To turn on AI reports, add your Supabase URL and publishable key in js/config.js (see README, Phase 3).';
      return;
    }
    $('reportInfo').textContent = 'Checking which AI providers are set up…';
    try {
      const providers = await R.availableProviders(cfg);
      if (!providers.length) {
        sel.innerHTML = '<option>No AI keys set</option>';
        $('reportInfo').textContent = 'The edge function is running, but no AI API key is set. Add one with "supabase secrets set" (see README).';
        return;
      }
      sel.disabled = false;
      sel.innerHTML = providers.map((p) => '<option value="' + p + '">' + esc(PROVIDER_NAMES[p] || p) + '</option>').join('');
      btn.disabled = false;
      updateInfo();
    } catch (e) {
      sel.innerHTML = '<option>Unavailable</option>';
      $('reportInfo').textContent = e.message + '. Is the edge function deployed?';
    }
  }

  function prepare() {
    const anon = R.makeAnonymiser(state.parsed.participants, $('anonCheck').checked);
    const transcript = R.buildTranscript(state.parsed.messages, anon, cfg.TRANSCRIPT_CHAR_BUDGET || 150000);
    return { anon, transcript };
  }

  function updateInfo() {
    if (!state.parsed || $('reportBtn').disabled) return;
    const { transcript } = prepare();
    $('reportInfo').textContent = 'The AI will read ' + transcript.included.toLocaleString() + ' of ' +
      transcript.total.toLocaleString() + ' messages (' + transcript.conversationsIncluded + ' of ' +
      transcript.conversations + ' conversations, spread across the whole timeline).';
  }

  async function writeReport() {
    const btn = $('reportBtn');
    showError('reportError', '');
    btn.disabled = true;
    const original = btn.textContent;
    btn.innerHTML = '<span class="spinner"></span> Reading your chat…';
    setStep(3);
    $('reportOut').innerHTML = '<div class="card skeleton" aria-busy="true">' +
      '<div class="loading-note"><span class="spinner"></span> Reading your chat and writing the report — this can take up to a minute.</div>' +
      '<i class="h"></i><i></i><i></i><i class="s"></i><i></i><i class="s"></i></div>';
    $('reportOut').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    try {
      const { anon, transcript } = prepare();
      const data = await R.requestReport(cfg, {
        provider: $('providerSelect').value,
        stats: R.statsForPrompt(state.stats, anon),
        transcript: transcript.text,
        meta: { included: transcript.included, total: transcript.total },
      });
      renderReport(anon.restore(data.report), data);
      $('reportOut').scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (e) {
      $('reportOut').innerHTML = '';
      showError('reportError', e.message);
    } finally {
      btn.disabled = false;
      btn.textContent = original;
    }
  }

  function paragraphs(text) {
    return String(text || '').split(/\n{2,}|\n/).filter((p) => p.trim()).map((p) => '<p>' + esc(p.trim()) + '</p>').join('');
  }
  function list(title, items) {
    if (!Array.isArray(items) || !items.length) return '';
    return '<div class="chapter"><h3>' + esc(title) + '</h3><ul>' + items.map((i) => '<li>' + esc(i) + '</li>').join('') + '</ul></div>';
  }

  function renderReport(r, meta) {
    let html = '<h2 class="title">' + esc(r.title || 'Your chat, read closely') + '</h2>';
    if (r.care_note && String(r.care_note).trim()) {
      html += '<div class="care"><h3>Something important</h3>' + paragraphs(r.care_note) + '</div>';
    }
    html += paragraphs(r.opening);
    (r.chapters || []).forEach((c) => {
      html += '<div class="chapter"><h3>' + esc(c.heading || '') + '</h3>' + paragraphs(c.body) +
        (c.quotes || []).map((q) => '<blockquote>“' + esc(q) + '”</blockquote>').join('') + '</div>';
    });
    if (r.who_cares_more) {
      html += '<div class="verdict"><h3>Who cares more?</h3><p><strong>' + esc(r.who_cares_more.verdict || '') + '</strong></p>' +
        paragraphs(r.who_cares_more.explanation) + '</div>';
    }
    if (r.what_changed) html += '<div class="chapter"><h3>What changed over time</h3>' + paragraphs(r.what_changed) + '</div>';
    (r.people || []).forEach((p) => {
      html += '<div class="chapter"><h3>' + esc(p.label || '') + '</h3>' + paragraphs(p.summary) +
        '<ul>' + (p.superpower ? '<li><strong>Superpower:</strong> ' + esc(p.superpower) + '</li>' : '') +
        (p.blind_spot ? '<li><strong>Blind spot:</strong> ' + esc(p.blind_spot) + '</li>' : '') + '</ul></div>';
    });
    html += list('What works', r.strengths) + list('Worth watching', r.watch_outs) + list('Try this', r.advice);
    html += '<p class="muted">Written by ' + esc(PROVIDER_NAMES[meta.provider] || meta.provider) + ' (' + esc(meta.model) +
      ') from a sample of your messages. It can be wrong — trust what you know.</p>';
    $('reportOut').innerHTML = '<div class="card">' + html + '</div>';
  }

  // ---------------- events ----------------

  const drop = $('drop');
  $('fileInput').addEventListener('change', (e) => handleFile(e.target.files[0]));
  drop.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $('fileInput').click(); } });
  ['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
  drop.addEventListener('drop', (e) => handleFile(e.dataTransfer.files[0]));
  $('sampleBtn').addEventListener('click', () => load(window.ChatSample.generate({ days: 120 }), 'Sample chat'));
  $('restartBtn').addEventListener('click', () => {
    state.parsed = state.stats = null;
    $('fileInput').value = '';
    $('fileStatus').textContent = '';
    $('statsSection').classList.add('hidden');
    $('reportSection').classList.add('hidden');
    $('uploadSection').classList.remove('hidden');
    setStep(1);
  });
  $('anonCheck').addEventListener('change', updateInfo);
  $('reportBtn').addEventListener('click', writeReport);
})();
