// End-to-end test: real page in Chromium + the real edge-function handler,
// with the AI provider replaced by a fake. Run:
//   node --experimental-strip-types tests/e2e.mjs
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { handle } from '../supabase/functions/analyze/handler.ts';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = process.argv[2] || '/tmp';

// static server for the site
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const server = createServer(async (req, res) => {
  try {
    const p = req.url === '/' ? '/index.html' : req.url.split('?')[0];
    let body = await readFile(join(ROOT, p));
    if (p === '/js/config.js') {
      body = String(body).replace(/SUPABASE_URL: '[^']*'/, "SUPABASE_URL: 'https://demo.supabase.co'")
        .replace(/SUPABASE_PUBLISHABLE_KEY: '[^']*'/, "SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test'");
    }
    res.writeHead(200, { 'Content-Type': types[extname(p)] || 'text/plain' });
    res.end(body);
  } catch { res.writeHead(404); res.end(); }
});
await new Promise((r) => server.listen(8765, r));

// fake AI: records what it was sent, answers with a report using the anonymised labels
let aiCall = null;
const fakeFetch = async (url, init) => {
  aiCall = { url, body: JSON.parse(init.body) };
  const report = {
    title: 'Two Clocks, One Rhythm',
    opening: 'Person B opens the door most mornings and Person A walks through it a little later.\n\nFrom what I read, it is warm.',
    chapters: [{ heading: 'The slow replier', body: 'Person A takes longer to answer.', quotes: ['send the notes pls'] }],
    who_cares_more: { verdict: 'Person B shows it faster; Person A shows it steadier.', explanation: 'Numbers plus tone.' },
    what_changed: 'Things settled.',
    people: [{ label: 'Person A', summary: 'Steady.', superpower: 'Calm', blind_spot: 'Silence' },
      { label: 'Person B', summary: 'Bright.', superpower: 'Energy', blind_spot: 'Overthinking' }],
    strengths: ['Inside jokes'], watch_outs: ['Late replies after fights'], advice: ['Say when you are busy'],
    care_note: '',
  };
  return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: '```json\n' + JSON.stringify(report) + '\n```' }] } }] }),
    { status: 200, headers: { 'Content-Type': 'application/json' } });
};
const env = new Map([['GEMINI_API_KEY', 'test-key'], ['ANTHROPIC_API_KEY', 'test-key-2']]);

// PW_CHANNEL=msedge uses the installed Edge instead of Playwright's own Chromium
const browser = await chromium.launch(process.env.PW_CHANNEL ? { channel: process.env.PW_CHANNEL } : {});
const results = [];
const check = (name, ok, extra = '') => { results.push(ok); console.log((ok ? '  ✓ ' : '  ✗ ') + name + (extra ? ' — ' + extra : '')); };

for (const scheme of ['light', 'dark']) {
  const page = await browser.newPage({ viewport: { width: 1100, height: 900 }, colorScheme: scheme });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/jszip|ERR_|Failed to load resource/i.test(m.text())) errors.push(m.text()); });

  // route the edge function to the real handler
  await page.route('https://demo.supabase.co/functions/v1/analyze', async (route) => {
    const r = route.request();
    const req = new Request(r.url(), { method: r.method(), headers: { ...r.headers(), origin: 'http://localhost:8765' }, body: r.postData() ?? undefined });
    const res = await handle(req, env, fakeFetch);
    await route.fulfill({ status: res.status, headers: Object.fromEntries(res.headers), body: await res.text() });
  });

  await page.goto('http://localhost:8765/');
  if (scheme === 'light') await page.screenshot({ path: `${OUT}/1-upload.png` });
  await page.click('#sampleBtn');
  await page.waitForSelector('#statsSection:not(.hidden)');
  await page.waitForFunction(() => !document.getElementById('reportBtn').disabled);
  await page.screenshot({ path: `${OUT}/2-stats-${scheme}.png`, fullPage: true });

  if (scheme === 'light') {
    const options = await page.$$eval('#providerSelect option', (o) => o.map((x) => x.textContent));
    check('provider list comes from edge function', options.join(',') === 'Google Gemini,Claude (Anthropic)', options.join(','));
    check('info line shows sample size', /The AI will read/.test(await page.textContent('#reportInfo')), await page.textContent('#reportInfo'));

    await page.click('#reportBtn');
    await page.waitForSelector('#reportOut .title', { timeout: 10000 });
    const sent = JSON.stringify(aiCall.body);
    check('called Gemini generateContent', /gemini-3\.8-flash:generateContent/.test(aiCall.url));
    check('no real names sent to AI', !/aarav|meera/i.test(sent));
    check('labels used in transcript', /\n\d\d:\d\d B: /.test(aiCall.body.contents[0].parts[0].text));
    check('stats included in prompt', /share_of_messages_pct/.test(sent));
    const reportText = await page.textContent('#reportOut');
    const [a, b] = await page.evaluate(() => [...document.querySelectorAll('.person-head')].map((e) => e.textContent.trim()));
    check('names restored in browser', reportText.includes(a + ' takes longer') && reportText.includes(b + ' opens the door'), `A=${a}, B=${b}`);
    console.log('    transcript excerpt:\n' + aiCall.body.contents[0].parts[0].text.split('<transcript>')[1].slice(0, 400).replace(/^/gm, '      '));
    check('no "Person A" left on page', !/Person [AB]/.test(reportText));
    await page.screenshot({ path: `${OUT}/3-report.png`, fullPage: true });
  }

  // mobile layout: no horizontal scroll
  await page.setViewportSize({ width: 375, height: 800 });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check(`no horizontal scroll at 375px (${scheme})`, overflow <= 0, 'overflow ' + overflow + 'px');
  if (scheme === 'light') await page.screenshot({ path: `${OUT}/4-mobile.png`, fullPage: false });
  check(`no JS errors (${scheme})`, errors.length === 0, errors.join(' | '));
  await page.close();
}

// handler unit checks
const bad = await handle(new Request('http://x/', { method: 'POST', body: '{"provider":"openrouter","transcript":"hi"}' }), env, fakeFetch);
check('rejects provider without key', bad.status === 400);
const blocked = await handle(new Request('http://x/', { method: 'POST', headers: { origin: 'https://evil.example' }, body: '{}' }),
  new Map([['GEMINI_API_KEY', 'k'], ['ALLOWED_ORIGINS', 'https://mysite.com']]), fakeFetch);
check('blocks other origins when ALLOWED_ORIGINS set', blocked.status === 403);

await browser.close();
server.close();
console.log(`\n${results.filter(Boolean).length}/${results.length} passed`);
process.exit(results.every(Boolean) ? 0 : 1);
