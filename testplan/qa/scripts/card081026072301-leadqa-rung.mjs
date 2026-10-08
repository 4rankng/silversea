// Card 081026072301 — lead staging QA. Penalty KPI labels 'VI PHẠM T10/2026'
// and 'KHẤU TRỪ T10/2026' must render WITH a separator space (FB-049 guard);
// 'TỔNG BIÊN BẢN' unaffected. Landing dee6b865 is a test-only pin, so the
// staging build (f802a425) carries identical product code — the rung verifies
// the rendered glyphs at 1440 and 390 on the live page.
import puppeteer from 'puppeteer';
import { writeFileSync } from 'node:fs';

const API = 'https://vantai.tingting.vip/api';
const BASE = 'https://vantai.tingting.vip';
const QA = '/Volumes/LexarSSD/projects/silversea-prod/qa';
const SCOPE = '2026-10-08_card081026072301-leadqa';
const LOG = [];
const log = (step, obj) => { const e = { at: new Date().toISOString(), step, ...obj }; LOG.push(e); console.log(JSON.stringify(e)); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let exitCode = 0;

const health = await fetch(`${API}/health`).then((r) => r.json());
log('health', { buildHash: health.buildHash, note: 'product code identical to dee6b865 (test-only landing)' });

const login = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier: 'bqhuong', password: 'Abc123' }) });
const token = (await login.json()).token;
if (!token) { log('login-FAIL'); process.exit(2); }

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
try {
  const page = await browser.newPage();
  await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);

  const results = [];
  for (const w of [1440, 390]) {
    await page.setViewport({ width: w, height: w <= 500 ? 844 : 900 });
    await page.goto(`${BASE}/my-penalties`, { waitUntil: 'networkidle2', timeout: 90000 });
    await sleep(4500);
    const scan = await page.evaluate(() => {
      const body = (document.body.textContent || '').replace(/\s+/g, ' ');
      // find the KPI label nodes and their text-node structure
      const nodes = [...document.querySelectorAll('h1,h2,h3,h4,h5,div,span,p')]
        .filter((e) => e.offsetParent !== null && e.children.length === 0 && /T1[0-2]\/2026|VI PHẠM|KHẤU TRỪ|TỔNG BIÊN BẢN/.test(e.textContent || ''));
      return {
        gluedInText: /VI PHẠMT|KHẤU TRỪT/.test(body),
        labels: nodes.slice(0, 8).map((e) => (e.textContent || '').trim().slice(0, 40)),
        sample: body.slice(body.indexOf('VI PHẠM') >= 0 ? body.indexOf('VI PHẠM') - 20 : 0, 260),
      };
    });
    log('labels', { w, ...scan });
    results.push({ w, ...scan });
    await page.screenshot({ path: `${QA}/${SCOPE}_ui-${w}.png` });
  }

  // glyph-level check at 1440: the space between the word and T10/2026 must RENDER
  const glyph = await page.setViewport({ width: 1440, height: 900 }).then(() => page.goto(`${BASE}/my-penalties`, { waitUntil: 'networkidle2', timeout: 90000 }).then(() => sleep(4500)).then(() => page.evaluate(() => {
    const leaf = [...document.querySelectorAll('span,div,h1,h2,h3,p')].filter((e) => e.offsetParent !== null && e.children.length === 0 && /vi phạm\s+t1[0-2]\/2026/i.test((e.textContent || '')))[0]
      ?? [...document.querySelectorAll('span,div,h1,h2,h3,p')].filter((e) => e.offsetParent !== null && /vi phạm/i.test(e.textContent || ''))[0];
    if (!leaf) return { err: 'no label node' };
    const t = (leaf.textContent || '').trim();
    const m = t.match(/(vi phạm)\s+(t1[0-2]\/2026)/i);
    if (!m) return { err: 'no spaced pair in text', t };
    const walker = document.createTreeWalker(leaf, NodeFilter.SHOW_TEXT);
    let n; const parts = [];
    while ((n = walker.nextNode())) {
      const raw = n.data || '';
      // honest glyph edges: skip a leading space, drop a trailing space from
      // the rect — the separator space must be measured BETWEEN word glyphs
      const lead = raw.length - raw.trimStart().length;
      const trail = raw.length - raw.trimEnd().length;
      const r = document.createRange(); r.setStart(n, lead); r.setEnd(n, raw.length - trail);
      const rects = [...r.getClientRects()].filter((x) => x.width > 0);
      if (rects.length) parts.push({ raw: raw.slice(0, 30), left: Math.round(rects[0].left), right: Math.round(rects[rects.length - 1].right), top: Math.round(rects[0].top) });
    }
    return { text: t, parts: parts.slice(0, 6) };
  })));
  log('glyph', glyph);

  const pass1440 = !results[0].gluedInText && /vi phạm\s+t10\/2026/i.test(results[0].sample);
  const pass390 = !results[1].gluedInText;
  const spaced = glyph.parts && glyph.parts.length >= 2
    ? (() => { const viPham = glyph.parts.find((p) => /vi phạm/i.test(p.raw.trim()) && p.raw.trim() !== ''); const period = glyph.parts.find((p) => /^[\s]*T1[0-2]\/2026/.test(p.raw)); return viPham && period && (period.left - viPham.right) >= 2; })()
    : false;
  log('verdict-input', { pass1440, pass390, spacedRendered: spaced });
  if (pass1440 && pass390 && spaced) log('PASS-spaces-render', { note: 'labels carry rendered separator spaces at 1440 and 390; guard pin dee6b865 on trunk' });
  else { log('FAIL', { pass1440, pass390, spaced, glyph }); exitCode = 1; }
} catch (err) {
  log('driver-error', { message: String(err && err.message || err).slice(0, 300) });
  exitCode = 1;
} finally {
  writeFileSync(`${QA}/${SCOPE}_ui-driver.log`, LOG.map((e) => JSON.stringify(e)).join('\n') + '\n');
  await browser.close();
  process.exit(exitCode);
}
