/*
 * parser.js — turns a WhatsApp "Export chat" .txt into a list of messages.
 *
 * Handles both export styles:
 *   Android:  31/12/23, 9:41 pm - Meera: hello
 *   iPhone:   [31/12/23, 9:41:05 PM] Meera: hello
 * plus 24-hour times, 2- or 4-digit years, "/", "." or "-" date separators,
 * multi-line messages, system lines, media/deleted/call placeholders.
 *
 * Works in the browser (window.ChatParser) and in Node (module.exports) for tests.
 */
(function (root) {
  'use strict';

  // Invisible direction marks / BOM that WhatsApp sprinkles into exports.
  const INVISIBLE = /[‎‏‪-‮⁦-⁩﻿]/g;

  // Start of a new message line. Groups:
  // 1-3 date parts, 4 hour, 5 minute, 6 second (optional), 7 am/pm (optional), 8 the rest
  const LINE_START =
    /^\[?(\d{1,4})[\/.\-](\d{1,2})[\/.\-](\d{1,4}),?\s+(\d{1,2})[:.](\d{2})(?:[:.](\d{2}))?\s*([ap]\.?\s?m\.?)?\]?\s*(?:[-–]\s+)?(.*)$/i;

  // Notices that can appear under a sender name even without the iPhone marker.
  const SYSTEM_PATTERNS = [
    /end-to-end encrypted/i,
    /security code (changed|with)/i,
    /turned (on|off) disappearing messages/i,
  ];

  const MEDIA = [
    /^<media omitted>$/i,
    /^(image|video|audio|sticker|gif|document|contact card) omitted$/i,
    /^<attached: .+>$/i,
    /\.(jpe?g|png|webp|gif|opus|mp3|m4a|mp4|mov|pdf|vcf) \(file attached\)/i,
    /^null$/i, // some Android exports write "null" for view-once media
  ];
  const DELETED = /^(this message was deleted|you deleted this message)\.?$/i;
  const CALL = /^(missed )?(voice|video|group voice|group video) call/i;
  const EDITED = /\s*<this message was edited>\s*$/i;

  function clean(line) {
    return line.replace(INVISIBLE, '').replace(/[  ]/g, ' ').replace(/\s+$/, '');
  }

  function classify(text) {
    if (DELETED.test(text)) return 'deleted';
    if (CALL.test(text)) return 'call';
    if (MEDIA.some((re) => re.test(text))) return 'media';
    return 'text';
  }

  /** Decide whether dates are day-first, month-first or year-first. */
  function detectDateOrder(rows) {
    if (rows.some((r) => r.a.length === 4)) return 'YMD';
    if (rows.some((r) => Number(r.a) > 12)) return 'DMY';
    if (rows.some((r) => Number(r.b) > 12)) return 'MDY';
    return 'DMY'; // ambiguous everywhere — day-first is most common worldwide
  }

  function toDate(r, order) {
    let y, m, d;
    if (order === 'YMD') [y, m, d] = [r.a, r.b, r.c];
    else if (order === 'MDY') [m, d, y] = [r.a, r.b, r.c];
    else [d, m, y] = [r.a, r.b, r.c];
    y = Number(y);
    if (y < 100) y += 2000;
    let h = Number(r.h);
    if (r.ampm) {
      const pm = /^p/i.test(r.ampm);
      if (pm && h < 12) h += 12;
      if (!pm && h === 12) h = 0;
    }
    return new Date(y, Number(m) - 1, Number(d), h, Number(r.mi), Number(r.s || 0));
  }

  /**
   * parse(text) -> { messages, participants, dateOrder, systemLines }
   * messages: [{ date: Date, sender, text, type: 'text'|'media'|'deleted'|'call', edited }]
   */
  function parse(raw) {
    const lines = String(raw).replace(/\r\n?/g, '\n').split('\n');
    const rows = [];
    let current = null;

    for (const original of lines) {
      const line = clean(original);
      const m = line.match(LINE_START);
      if (m) {
        // iPhone marks system notices ("X added Y", "Messages are encrypted") with an
        // invisible U+200E right after "Sender: ". Remember it before cleaning.
        const marked = /:\s‎/.test(original);
        current = { a: m[1], b: m[2], c: m[3], h: m[4], mi: m[5], s: m[6], ampm: m[7], rest: m[8], marked };
        rows.push(current);
      } else if (current && line.length) {
        current.rest += '\n' + line; // continuation of a multi-line message
      }
    }

    const dateOrder = detectDateOrder(rows);
    const messages = [];
    let systemLines = 0;

    for (const r of rows) {
      const sep = r.rest.indexOf(': ');
      if (sep <= 0) { systemLines++; continue; } // "X added Y", "Messages are encrypted"
      const sender = r.rest.slice(0, sep).trim();
      let text = r.rest.slice(sep + 2).trim();
      const edited = EDITED.test(text);
      if (edited) text = text.replace(EDITED, '');
      const type = classify(text);
      // System notice: iPhone-marked plain text, or a known notice pattern on a short line.
      if (type === 'text' && (r.marked || (text.length < 160 && SYSTEM_PATTERNS.some((re) => re.test(text))))) {
        systemLines++; continue;
      }
      const date = toDate(r, dateOrder);
      if (isNaN(date)) { systemLines++; continue; }
      messages.push({ date, sender, text, type, edited });
    }

    messages.sort((x, y) => x.date - y.date); // exports are ordered, but be safe

    const counts = {};
    for (const msg of messages) counts[msg.sender] = (counts[msg.sender] || 0) + 1;
    const participants = Object.keys(counts).sort((p, q) => counts[q] - counts[p]);

    return { messages, participants, dateOrder, systemLines };
  }

  const api = { parse, classify, detectDateOrder };
  root.ChatParser = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
