/*
 * stats.js — pure number-crunching on parsed messages. No AI here:
 * everything on the stats page is exact arithmetic over the whole chat.
 */
(function (root) {
  'use strict';

  const HOUR = 3600 * 1000;
  const MIN = 60 * 1000;
  const CONVERSATION_GAP = 6 * HOUR; // silence this long = a new conversation
  const DOUBLE_TEXT_GAP = 20 * MIN;  // same person texts again after this long with no reply
  const FAST_REPLY = 5 * MIN;

  const EMOJI = /\p{Extended_Pictographic}/gu;

  // English + common Hinglish/Urdu filler words, so "top words" are interesting.
  const STOP = new Set(('the a an and or but to of in on at for with is are was were be been am i you he she it we they me my your our ' +
    'his her its their this that these those so if not no yes do does did dont don\'t im i\'m its it\'s just like ok okay oh ' +
    'what when where why how who will would can could should have has had get got go going u ur r ya yeah yes no na ' +
    'hai ha haan han ka ki ke ko se me mai main mein tu tum tera teri mera meri hum ho hoga kya kyu kyun to toh bhi aur ' +
    'nahi nhi nahin h hn ye yeh wo woh ek koi kuch abhi phir fir bas ab tha thi the rha rhi raha rahi kar karo kr ' +
    'media omitted message deleted').split(/\s+/));

  function median(arr) {
    if (!arr.length) return null;
    const s = [...arr].sort((x, y) => x - y);
    const mid = s.length >> 1;
    return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
  }

  function dayKey(d) {
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function monthKey(d) {
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
  }
  function topN(counter, n) {
    return Object.entries(counter).sort((a, b) => b[1] - a[1]).slice(0, n);
  }

  function longestStreak(sortedDayKeys) {
    let best = 0, run = 0, prev = null;
    for (const k of sortedDayKeys) {
      const t = new Date(k + 'T12:00:00').getTime();
      run = prev !== null && Math.round((t - prev) / (24 * HOUR)) === 1 ? run + 1 : 1;
      best = Math.max(best, run);
      prev = t;
    }
    return best;
  }

  /**
   * compute(messages, participants) -> stats object (see README for the shape)
   */
  function compute(messages, participants) {
    const P = {};
    for (const name of participants) {
      P[name] = {
        name, messages: 0, words: 0, media: 0, deleted: 0, calls: 0, edited: 0,
        starters: 0, replyTimes: [], doubleTexts: 0, lateNight: 0,
        emojis: {}, wordCounts: {}, hours: new Array(24).fill(0),
      };
    }

    const hours = new Array(24).fill(0);
    const weekdays = new Array(7).fill(0); // 0 = Sunday
    const months = {};
    const days = {};
    let conversations = 0;

    for (let i = 0; i < messages.length; i++) {
      const m = messages[i];
      const prev = messages[i - 1];
      const p = P[m.sender];
      if (!p) continue;

      p.messages++;
      if (m.edited) p.edited++;
      if (m.type === 'media') p.media++;
      else if (m.type === 'deleted') p.deleted++;
      else if (m.type === 'call') p.calls++;
      else {
        const words = m.text.toLowerCase().match(/[\p{L}\p{N}']+/gu) || [];
        p.words += words.length;
        for (const w of words) if (w.length > 2 && !STOP.has(w) && !/^\d+$/.test(w)) p.wordCounts[w] = (p.wordCounts[w] || 0) + 1;
        for (const e of m.text.match(EMOJI) || []) p.emojis[e] = (p.emojis[e] || 0) + 1;
      }

      const h = m.date.getHours();
      hours[h]++;
      p.hours[h]++;
      if (h < 5) p.lateNight++;
      weekdays[m.date.getDay()]++;

      const mk = monthKey(m.date);
      months[mk] = months[mk] || { key: mk, total: 0, by: {} };
      months[mk].total++;
      months[mk].by[m.sender] = (months[mk].by[m.sender] || 0) + 1;

      const dk = dayKey(m.date);
      days[dk] = (days[dk] || 0) + 1;

      const gap = prev ? m.date - prev.date : Infinity;
      if (gap >= CONVERSATION_GAP) {
        conversations++;
        p.starters++;
      } else if (prev.sender !== m.sender) {
        p.replyTimes.push(gap);
      } else if (gap >= DOUBLE_TEXT_GAP) {
        p.doubleTexts++;
      }
    }

    const total = messages.length || 1;
    const totalStarts = Object.values(P).reduce((s, p) => s + p.starters, 0) || 1;
    const dayKeys = Object.keys(days).sort();
    const busiest = topN(days, 1)[0];

    const people = participants.map((name) => {
      const p = P[name];
      const textMsgs = p.messages - p.media - p.deleted - p.calls;
      const med = median(p.replyTimes);
      return {
        name,
        messages: p.messages,
        share: p.messages / total,
        words: p.words,
        avgWords: textMsgs ? p.words / textMsgs : 0,
        media: p.media,
        deleted: p.deleted,
        calls: p.calls,
        edited: p.edited,
        starters: p.starters,
        startShare: p.starters / totalStarts,
        replies: p.replyTimes.length,
        medianReplyMin: med === null ? null : med / MIN,
        fastReplyShare: p.replyTimes.length ? p.replyTimes.filter((t) => t <= FAST_REPLY).length / p.replyTimes.length : null,
        doubleTexts: p.doubleTexts,
        lateNight: p.lateNight,
        peakHour: p.hours.indexOf(Math.max(...p.hours)),
        topEmojis: topN(p.emojis, 6),
        topWords: topN(p.wordCounts, 8),
      };
    });

    const first = messages[0] ? messages[0].date : null;
    const last = messages.length ? messages[messages.length - 1].date : null;

    return {
      participants: people,
      isGroup: participants.length > 2,
      totals: {
        messages: messages.length,
        words: people.reduce((s, p) => s + p.words, 0),
        firstDate: first,
        lastDate: last,
        spanDays: first ? Math.max(1, Math.round((last - first) / (24 * HOUR)) + 1) : 0,
        activeDays: dayKeys.length,
        longestStreak: longestStreak(dayKeys),
        conversations,
        busiestDay: busiest ? { date: busiest[0], count: busiest[1] } : null,
        busiestHour: hours.indexOf(Math.max(...hours)),
        lateNightShare: hours.slice(0, 5).reduce((a, b) => a + b, 0) / total,
      },
      hours,
      weekdays,
      months: Object.values(months).sort((a, b) => (a.key < b.key ? -1 : 1)),
      settings: { conversationGapHours: CONVERSATION_GAP / HOUR, doubleTextGapMin: DOUBLE_TEXT_GAP / MIN },
    };
  }

  const api = { compute, median, CONVERSATION_GAP };
  root.ChatStats = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
