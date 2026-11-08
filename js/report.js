/*
 * report.js — everything needed before/after the AI call:
 *   1. anonymise: real names -> "Person A/B", strip phones, emails, links
 *   2. buildTranscript: fit a long chat into a character budget by sampling
 *      conversations evenly across time + the most recent ones
 *   3. statsForPrompt: exact numbers so the AI never invents them
 *   4. requestReport: call the Supabase Edge Function
 *   5. deanonymise: put real names back into the AI's answer (in the browser)
 */
(function (root) {
  'use strict';

  const GAP = 6 * 3600 * 1000;
  const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

  function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
  function pad(n) { return String(n).padStart(2, '0'); }
  const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  /** Build alias table + a text scrubber. */
  function makeAnonymiser(participants, enabled) {
    const labels = {}; // real name -> "Person A"
    const short = {};  // real name -> "A"
    participants.forEach((name, i) => {
      const s = i < 26 ? LETTERS[i] : 'P' + (i + 1);
      short[name] = enabled ? s : name;
      labels[name] = enabled ? 'Person ' + s : name;
    });

    // Name words to scrub from message text: full names + capitalised parts (3+ letters).
    const nameWords = new Map();
    if (enabled) {
      for (const name of participants) {
        const parts = [name, ...name.split(/\s+/).filter((w) => /^\p{Lu}\p{L}{2,}$/u.test(w))];
        for (const p of parts) if (!nameWords.has(p.toLowerCase())) nameWords.set(p.toLowerCase(), labels[name]);
      }
    }
    const words = [...nameWords.keys()].sort((a, b) => b.length - a.length).map(escapeRe);
    const nameRe = words.length ? new RegExp('(?<![\\p{L}\\p{N}])(' + words.join('|') + ')(?![\\p{L}\\p{N}])', 'giu') : null;

    function scrub(text) {
      if (!enabled) return text;
      let t = text
        .replace(/https?:\/\/\S+|www\.\S+/gi, '[link]')
        .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, '[email]')
        .replace(/\+?\d[\d\s-]{8,}\d/g, '[phone]');
      if (nameRe) t = t.replace(nameRe, (m) => nameWords.get(m.toLowerCase()) || m);
      return t;
    }

    function restore(value) { // deep-replace "Person A" -> real name in the AI's JSON
      if (!enabled) return value;
      const pairs = Object.entries(labels).sort((a, b) => b[1].length - a[1].length);
      const fix = (s) => pairs.reduce((acc, [real, label]) =>
        acc.replace(new RegExp('\\b' + escapeRe(label) + '\\b', 'g'), real), s);
      const walk = (v) => typeof v === 'string' ? fix(v)
        : Array.isArray(v) ? v.map(walk)
        : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]))
        : v;
      return walk(value);
    }

    return { labels, short, scrub, restore, enabled };
  }

  function renderMessage(m, anon) {
    let body;
    if (m.type === 'media') body = '[media]';
    else if (m.type === 'deleted') body = '[deleted message]';
    else if (m.type === 'call') body = '[' + m.text.toLowerCase() + ']';
    else body = anon.scrub(m.text).replace(/\n+/g, ' / ');
    if (body.length > 600) body = body.slice(0, 600) + '…';
    return pad(m.date.getHours()) + ':' + pad(m.date.getMinutes()) + ' ' + anon.short[m.sender] + ': ' + body;
  }

  /**
   * Fit the chat into `budget` characters. Returns { text, included, total }.
   * Strategy: ~35% of the budget for the most recent conversations, the rest
   * for conversations picked evenly from the whole history, so the AI sees
   * how things changed over time — not just the last few weeks.
   */
  function buildTranscript(messages, anon, budget) {
    // 1. split into conversations
    const convs = [];
    let cur = null;
    messages.forEach((m, i) => {
      if (!cur || m.date - messages[i - 1].date >= GAP) { cur = []; convs.push(cur); }
      cur.push(m);
    });

    const maxConv = Math.floor(budget * 0.15); // one huge conversation can't eat the budget
    const sized = convs.map((c) => {
      const lines = c.map((m) => renderMessage(m, anon));
      let size = lines.reduce((s, l) => s + l.length + 1, 0) + 24;
      let cut = false;
      while (size > maxConv && lines.length > 10) { size -= lines.pop().length + 1; cut = true; }
      return { msgs: c, lines, size, cut };
    });

    const totalSize = sized.reduce((s, c) => s + c.size, 0);
    let chosen = new Set();
    if (totalSize <= budget) {
      sized.forEach((_, i) => chosen.add(i));
    } else {
      let used = 0;
      // recent conversations
      let i = sized.length - 1;
      while (i >= 0 && used + sized[i].size <= budget * 0.35) { chosen.add(i); used += sized[i].size; i--; }
      // evenly spaced earlier conversations
      const earlier = i + 1;
      if (earlier > 0) {
        const avg = sized.slice(0, earlier).reduce((s, c) => s + c.size, 0) / earlier;
        const k = Math.max(1, Math.floor((budget - used) / avg));
        const step = earlier / k;
        for (let j = 0; j < k; j++) {
          const idx = Math.min(earlier - 1, Math.floor(j * step + step / 2));
          if (!chosen.has(idx) && used + sized[idx].size <= budget) { chosen.add(idx); used += sized[idx].size; }
        }
      }
    }

    // 2. render in chronological order with day headers and skip markers
    const out = [];
    let lastDay = '';
    let skipped = 0;
    let included = 0;
    sized.forEach((c, idx) => {
      if (!chosen.has(idx)) { skipped++; return; }
      if (skipped) { out.push('[… ' + skipped + ' conversation' + (skipped > 1 ? 's' : '') + ' skipped …]'); skipped = 0; }
      c.msgs.slice(0, c.lines.length).forEach((m, k) => {
        const d = m.date;
        const day = d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
        if (day !== lastDay) { out.push('## ' + day + ' (' + DAYS[d.getDay()] + ')'); lastDay = day; }
        out.push(c.lines[k]);
      });
      included += c.lines.length;
      if (c.cut) out.push('[… rest of this conversation trimmed …]');
    });
    if (skipped) out.push('[… ' + skipped + ' conversations skipped …]');

    return { text: out.join('\n'), included, total: messages.length, conversations: sized.length, conversationsIncluded: chosen.size };
  }

  /** Compact, anonymised numbers for the prompt. */
  function statsForPrompt(stats, anon) {
    const pct = (x) => (x === null || x === undefined ? null : Math.round(x * 100));
    const r1 = (x) => (x === null || x === undefined ? null : Math.round(x * 10) / 10);
    const iso = (d) => d && d.toISOString().slice(0, 10);
    return {
      people: stats.participants.map((p) => ({
        label: anon.labels[p.name],
        messages: p.messages,
        share_of_messages_pct: pct(p.share),
        starts_conversations_pct: pct(p.startShare),
        median_reply_minutes: r1(p.medianReplyMin),
        replies_within_5_min_pct: pct(p.fastReplyShare),
        avg_words_per_message: r1(p.avgWords),
        double_texts: p.doubleTexts,
        messages_midnight_to_5am: p.lateNight,
        media_sent: p.media,
        deleted_messages: p.deleted,
        top_emojis: p.topEmojis.map((e) => e[0]).join(''),
      })),
      totals: {
        messages: stats.totals.messages,
        first_message: iso(stats.totals.firstDate),
        last_message: iso(stats.totals.lastDate),
        days_spanned: stats.totals.spanDays,
        days_with_messages: stats.totals.activeDays,
        longest_daily_streak: stats.totals.longestStreak,
        conversations: stats.totals.conversations,
        busiest_hour: stats.totals.busiestHour,
        busiest_day: stats.totals.busiestDay,
      },
      messages_per_month: stats.months.map((m) => m.key + ': ' + m.total),
      definitions: 'A conversation starts after ' + stats.settings.conversationGapHours + 'h of silence. Reply time = gap when the other person answers within a conversation.',
    };
  }

  function endpoint(cfg) {
    return cfg.SUPABASE_URL.replace(/\/+$/, '') + '/functions/v1/' + (cfg.FUNCTION_NAME || 'analyze');
  }

  /** Ask the edge function which AI providers have keys configured. */
  async function availableProviders(cfg) {
    if (!cfg.SUPABASE_URL || !cfg.SUPABASE_PUBLISHABLE_KEY) return [];
    const res = await fetch(endpoint(cfg), { method: 'GET', headers: { apikey: cfg.SUPABASE_PUBLISHABLE_KEY } });
    if (!res.ok) throw new Error('Edge function not reachable (HTTP ' + res.status + ')');
    const data = await res.json();
    return data.providers || [];
  }

  async function requestReport(cfg, payload) {
    const res = await fetch(endpoint(cfg), {
      method: 'POST',
      headers: { apikey: cfg.SUPABASE_PUBLISHABLE_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    let data = null;
    try { data = await res.json(); } catch (_) { /* non-JSON error */ }
    if (!res.ok) throw new Error((data && data.error) || 'AI request failed (HTTP ' + res.status + ')');
    return data;
  }

  const api = { makeAnonymiser, buildTranscript, statsForPrompt, availableProviders, requestReport };
  root.ChatReport = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
