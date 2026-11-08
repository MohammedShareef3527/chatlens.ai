/*
 * sample.js — generates a fake WhatsApp export (two fictional people) so you can
 * test the app without using a real chat. Output is in Android export format.
 */
(function (root) {
  'use strict';

  function rng(seed) { // mulberry32: same seed -> same chat every time
    return function () {
      seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const A = 'Aarav';
  const B = 'Meera';

  const LINES = {
    open: {
      [A]: ['gm', 'good morning ☀️', 'oye', 'you up?', 'free now?', 'heyy'],
      [B]: ['good morninggg 🌸', 'AARAV', 'wake up 😤', 'guess what happened', 'heyyy', 'are you alive'],
    },
    chat: {
      [A]: ['haha', 'sahi hai', 'wait what 😂', 'ok ok', 'class was so boring', 'lab got extended again',
        'did you eat?', 'I made chai ☕', 'send the notes pls', 'that prof is unreal', 'lol', 'same',
        'miss you', 'tell me everything', 'I\'ll call after dinner', 'hmm', 'proud of you'],
      [B]: ['hahaha 😂😂', 'noooo', 'okay listen', 'I swear', 'you never listen 🙄', 'that\'s so cute',
        'I\'m so tired', 'did you finish the assignment?', 'omg', '😭😭', 'stop it 😂', 'I miss you',
        'come to the canteen', 'my mom is calling brb', 'yesss', 'you\'re so dumb ❤️', 'tell me tell me'],
    },
    tense: {
      [A]: ['I was busy', 'why are you overthinking', 'ok fine', 'can we talk later', 'I said sorry'],
      [B]: ['you could have just texted', 'it\'s fine.', 'whatever', 'you always do this', 'I waited the whole evening'],
    },
    makeup: {
      [A]: ['I\'m sorry, I should have told you', 'can I call?', 'you matter to me, okay?'],
      [B]: ['okay 🥺', 'I\'m sorry too', 'call me', 'love you idiot ❤️'],
    },
    night: {
      [A]: ['go to sleep', 'gn ❤️', 'you sleep first', 'it\'s 2am 😂'],
      [B]: ['can\'t sleep', 'one more episode', 'gn 🌙', 'talk to me till I sleep'],
    },
  };

  function pad(n) { return String(n).padStart(2, '0'); }

  function fmt(d) {
    let h = d.getHours();
    const ap = h >= 12 ? 'pm' : 'am';
    h = h % 12 || 12;
    //   (narrow no-break space) before am/pm is what real Android exports use
    return pad(d.getDate()) + '/' + pad(d.getMonth() + 1) + '/' + String(d.getFullYear()).slice(2) +
      ', ' + h + ':' + pad(d.getMinutes()) + ' ' + ap;
  }

  function generate(opts) {
    const days = (opts && opts.days) || 120;
    const r = rng((opts && opts.seed) || 7);
    const pick = (arr) => arr[Math.floor(r() * arr.length)];
    const out = [];
    const start = new Date(2026, 4, 1, 8, 0, 0);
    out.push(fmt(start) + ' - Messages and calls are end-to-end encrypted. Only people in this chat can read, listen to, or share them. Learn more.');

    for (let day = 0; day < days; day++) {
      if (r() < 0.06) continue; // occasional day with no chat
      const sessions = 1 + Math.floor(r() * 4);
      const tense = r() < 0.08; // roughly one rough patch every ~2 weeks
      const hours = Array.from({ length: sessions }, () => [8, 11, 14, 17, 20, 22, 23][Math.floor(r() * 7)])
        .sort((x, y) => x - y);
      let last = 0;
      for (let s = 0; s < sessions; s++) {
        let t = new Date(start.getTime() + day * 86400000);
        t.setHours(hours[s], Math.floor(r() * 60), 0);
        if (t.getTime() <= last) t = new Date(last + 2 * 3600000); // keep sessions in order
        if (t.getDate() !== new Date(start.getTime() + day * 86400000).getDate()) break;
        let who = r() < 0.6 ? B : A; // Meera starts a bit more often
        out.push(fmt(t) + ' - ' + who + ': ' + pick(LINES.open[who]));
        const len = 6 + Math.floor(r() * 30);
        for (let k = 0; k < len; k++) {
          const sameAgain = r() < 0.3;
          if (!sameAgain) who = who === A ? B : A;
          // Aarav replies a bit slower than Meera
          const wait = who === A ? 1 + r() * 9 : 0.3 + r() * 3;
          t = new Date(t.getTime() + wait * 60000);
          let pool = LINES.chat[who];
          if (tense && s === sessions - 1 && k > len / 3 && k < (2 * len) / 3) pool = LINES.tense[who];
          if (tense && s === sessions - 1 && k >= (2 * len) / 3) pool = LINES.makeup[who];
          if (t.getHours() >= 23 || t.getHours() < 4) pool = r() < 0.5 ? LINES.night[who] : pool;
          let text = pick(pool);
          const roll = r();
          if (roll < 0.04) text = '<Media omitted>';
          else if (roll < 0.05) text = 'This message was deleted';
          else if (roll < 0.06) text = text + '\nalso remind me about tomorrow';
          out.push(fmt(t) + ' - ' + who + ': ' + text);
        }
        last = t.getTime();
      }
    }
    return out.join('\n');
  }

  const api = { generate };
  root.ChatSample = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
