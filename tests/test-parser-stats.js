// Run with:  node tests/test-parser-stats.js
const assert = require('assert');
const { parse } = require('../js/parser.js');
const { compute } = require('../js/stats.js');
const { generate } = require('../js/sample.js');

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ✓ ' + name); }
  catch (e) { console.log('  ✗ ' + name + '\n    ' + e.message); process.exitCode = 1; }
}

console.log('Parser');

test('Android, day-first, 12h with narrow space, multi-line, system line', () => {
  const txt = [
    '31/12/23, 9:41 pm - Messages and calls are end-to-end encrypted. Learn more.',
    '31/12/23, 9:41 pm - Meera: hello',
    '31/12/23, 9:45 pm - Aarav: hi',
    'second line of Aarav',
    '01/01/24, 12:05 am - Meera: <Media omitted>',
    '01/01/24, 12:06 am - Meera: This message was deleted',
    '01/01/24, 12:07 am - Aarav: ok <This message was edited>',
  ].join('\n');
  const r = parse(txt);
  assert.strictEqual(r.messages.length, 5);
  assert.strictEqual(r.systemLines, 1);
  assert.strictEqual(r.dateOrder, 'DMY');
  assert.strictEqual(r.messages[1].text, 'hi\nsecond line of Aarav');
  assert.strictEqual(r.messages[0].date.getHours(), 21);
  assert.strictEqual(r.messages[2].date.getHours(), 0); // 12:05 am -> 00:05
  assert.strictEqual(r.messages[2].type, 'media');
  assert.strictEqual(r.messages[3].type, 'deleted');
  assert.strictEqual(r.messages[4].edited, true);
  assert.strictEqual(r.messages[4].text, 'ok');
});

test('iPhone, bracketed, seconds, U+200E markers', () => {
  const txt = [
    '[12/03/2024, 10:15:02] Chat Name: ‎Messages and calls are end-to-end encrypted.',
    '[12/03/2024, 10:15:30] Sara: Morning!',
    '‎[12/03/2024, 10:16:00] Leo: ‎image omitted',
    '[12/03/2024, 10:16:40] Leo: ‎Missed voice call',
    '[12/03/2024, 22:16:40] Chat Name: ‎Sara added Leo',
    '[13/03/2024, 08:00:00] Sara: I added sugar to it',
  ].join('\n');
  const r = parse(txt);
  assert.strictEqual(r.messages.length, 4, JSON.stringify(r.messages.map((m) => m.text)));
  assert.strictEqual(r.systemLines, 2);
  assert.strictEqual(r.messages[1].type, 'media');
  assert.strictEqual(r.messages[2].type, 'call');
  assert.strictEqual(r.messages[3].text, 'I added sugar to it'); // not mistaken for a system line
  assert.deepStrictEqual(r.participants.sort(), ['Leo', 'Sara']);
});

test('US month-first with AM/PM', () => {
  const txt = '12/31/23, 11:59 PM - Jo: last one\n1/1/24, 12:00 AM - Sam: happy new year';
  const r = parse(txt);
  assert.strictEqual(r.dateOrder, 'MDY');
  assert.strictEqual(r.messages[0].date.getMonth(), 11);
  assert.strictEqual(r.messages[1].date.getFullYear(), 2024);
});

test('German dots, 24h', () => {
  const r = parse('24.12.23, 18:30 - Lena: Frohe Weihnachten\n24.12.23, 18:31 - Max: Danke!');
  assert.strictEqual(r.messages.length, 2);
  assert.strictEqual(r.messages[0].date.getDate(), 24);
  assert.strictEqual(r.messages[0].date.getHours(), 18);
});

test('Sender names with spaces and emoji; message containing colons', () => {
  const r = parse('05/06/25, 7:00 am - Mom ❤️: time: 7:30, don\'t be late');
  assert.strictEqual(r.messages[0].sender, 'Mom ❤️');
  assert.strictEqual(r.messages[0].text, 'time: 7:30, don\'t be late');
});

console.log('Stats');

test('who starts, reply times, double texts', () => {
  const txt = [
    '01/02/24, 9:00 am - A: hey',          // A starts conversation 1
    '01/02/24, 9:10 am - B: hi',           // B replies after 10 min
    '01/02/24, 9:12 am - A: how are you',  // A replies after 2 min
    '01/02/24, 9:40 am - A: hello??',      // A double-texts after 28 min
    '01/02/24, 8:00 pm - B: sorry 😅😅',   // >6h gap -> B starts conversation 2
    '02/02/24, 1:00 am - A: gn 🌙',        // >=5h gap? no (5h) -> reply, late night
  ].join('\n');
  const { messages, participants } = parse(txt);
  const s = compute(messages, participants);
  const A = s.participants.find((p) => p.name === 'A');
  const B = s.participants.find((p) => p.name === 'B');
  assert.strictEqual(s.totals.conversations, 2);
  assert.strictEqual(A.starters, 1);
  assert.strictEqual(B.starters, 1);
  assert.strictEqual(B.medianReplyMin, 10);
  assert.strictEqual(A.doubleTexts, 1);
  assert.strictEqual(A.lateNight, 1);
  assert.deepStrictEqual(B.topEmojis[0], ['😅', 2]);
  assert.strictEqual(s.totals.activeDays, 2);
  assert.strictEqual(s.totals.longestStreak, 2);
});

test('sample chat parses cleanly and looks plausible', () => {
  const r = parse(generate({ days: 120 }));
  const s = compute(r.messages, r.participants);
  assert.deepStrictEqual(r.participants.sort(), ['Aarav', 'Meera']);
  assert.ok(r.messages.length > 1000, 'messages: ' + r.messages.length);
  assert.strictEqual(r.systemLines, 1);
  const shares = s.participants.map((p) => p.share).reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(shares - 1) < 1e-9);
  const meera = s.participants.find((p) => p.name === 'Meera');
  const aarav = s.participants.find((p) => p.name === 'Aarav');
  assert.ok(meera.startShare > aarav.startShare, 'Meera should start more');
  assert.ok(aarav.medianReplyMin > meera.medianReplyMin, 'Aarav should reply slower');
  console.log('    sample:', r.messages.length, 'msgs |', s.totals.activeDays, 'active days | streak', s.totals.longestStreak,
    '| Meera starts', (meera.startShare * 100).toFixed(0) + '% | median reply A/M',
    aarav.medianReplyMin.toFixed(1), '/', meera.medianReplyMin.toFixed(1), 'min');
});

test('big chat performance (~30k messages)', () => {
  const big = generate({ days: 1500, seed: 3 });
  const t0 = Date.now();
  const r = parse(big);
  const s = compute(r.messages, r.participants);
  const ms = Date.now() - t0;
  console.log('    ', r.messages.length, 'messages in', ms, 'ms');
  assert.ok(ms < 3000);
  assert.ok(s.months.length > 40);
});

console.log(`\n${passed} passed`);
