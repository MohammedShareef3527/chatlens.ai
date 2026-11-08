// Run with:  node tests/test-report.js
const assert = require('assert');
const { parse } = require('../js/parser.js');
const { compute } = require('../js/stats.js');
const { generate } = require('../js/sample.js');
const R = require('../js/report.js');

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ✓ ' + name); }
  catch (e) { console.log('  ✗ ' + name + '\n    ' + e.message); process.exitCode = 1; }
}

test('anonymiser scrubs names, phones, emails, links — and restores names', () => {
  const anon = R.makeAnonymiser(['Meera Shah', 'Aarav'], true);
  const out = anon.scrub('AARAV call meera at +91 98765 43210 or m.shah@mail.com, see https://x.com/a. Shah family!');
  assert.ok(!/aarav|meera|shah|98765|mail\.com|x\.com/i.test(out), out);
  assert.ok(out.includes('[phone]') && out.includes('[email]') && out.includes('[link]'));
  const back = anon.restore({ t: 'Person A and Person B', list: ['Person B!'] });
  assert.deepStrictEqual(back, { t: 'Meera Shah and Aarav', list: ['Aarav!'] });
});

test('anonymiser off = untouched', () => {
  const anon = R.makeAnonymiser(['Meera', 'Aarav'], false);
  assert.strictEqual(anon.scrub('hi Meera'), 'hi Meera');
  assert.strictEqual(anon.short.Meera, 'Meera');
});

test('big chat is sampled within budget, across the whole timeline', () => {
  const { messages, participants } = parse(generate({ days: 1500, seed: 3 }));
  const anon = R.makeAnonymiser(participants, true);
  const budget = 150000;
  const t = R.buildTranscript(messages, anon, budget);
  assert.ok(t.text.length <= budget * 1.05, 'length ' + t.text.length);
  assert.ok(t.included < t.total);
  const days = t.text.match(/^## (\d{4})-/gm).map((d) => d.slice(3, 7));
  const years = new Set(days);
  const firstYear = messages[0].date.getFullYear();
  const lastYear = messages[messages.length - 1].date.getFullYear();
  assert.ok(years.has(String(firstYear)) && years.has(String(lastYear)), [...years].join(','));
  assert.ok(/skipped/.test(t.text));
  console.log('    sent', t.included, 'of', t.total, 'messages,', t.text.length, 'chars, years', [...years].join(' '));
});

test('stats for prompt are anonymised', () => {
  const { messages, participants } = parse(generate({ days: 60 }));
  const stats = compute(messages, participants);
  const anon = R.makeAnonymiser(participants, true);
  const s = JSON.stringify(R.statsForPrompt(stats, anon));
  assert.ok(!/aarav|meera/i.test(s));
  assert.ok(/Person A/.test(s));
});

console.log(`\n${passed} passed`);
