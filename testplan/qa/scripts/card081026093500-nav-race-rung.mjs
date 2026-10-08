/**
 * Card 081026093500 — client-side navigation race: the URL changes but the page
 * body still shows the PREVIOUS route ("Đội xe" → /fleet showing /trips content,
 * then "Kỷ luật" → /penalties showing /fleet content).
 *
 * Real pointer taps on the left nav, reading BOTH the URL and the rendered
 * heading after each click. Reads the h1, not an arbitrary node, so a claim
 * like "renders Sổ chuyến đi" is checked against what the page says.
 *
 * Usage: node card081026093500-nav-race-rung.mjs [baseUrl]
 */
import puppeteer from 'puppeteer';
import { writeFileSync } from 'node:fs';

const BASE = process.argv[2] || 'http://localhost:7175';
const LOG = [];
const log = (s, o) => { const e = { at: new Date().toISOString(), step: s, ...o }; LOG.push(e); console.log(JSON.stringify(e)); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const token = (await (await fetch(`${BASE}/api/auth/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ identifier: 'admin', password: 'Abc123' }),
})).json()).token;
if (!token) { console.error('login failed'); process.exit(2); }

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
let failures = 0;
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 1000 });
  await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle2', timeout: 90000 });
  await sleep(4000);

  const readState = () => page.evaluate(() => ({
    url: location.pathname,
    heading: (document.querySelector('main h1, main h2, .page-header__title, h1')
      ?.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 60),
  }));

  // Tap by visible nav label, then hit-test before clicking — a stale hit test
  // is its own false positive and has burned this project before.
  const tapNav = async (label) => {
    const box = await page.evaluate((lbl) => {
      const el = [...document.querySelectorAll('a,button')]
        .find((n) => (n.textContent || '').replace(/\s+/g, ' ').trim().startsWith(lbl));
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2, w: r.width, h: r.height };
    }, label);
    if (!box) { log('nav-not-found', { label }); return null; }
    if (box.w === 0 || box.h === 0) { log('nav-zero-size', { label, box }); return null; }
    const hit = await page.evaluate(({ x, y }) => {
      const n = document.elementFromPoint(x, y);
      return n ? `${n.tagName}.${(n.className || '').toString().split(' ')[0]}` : null;
    }, box);
    log('hit-test', { label, hit });
    await page.mouse.move(box.x, box.y);
    await page.mouse.down();
    await page.mouse.up();
    return box;
  };

  const CASES = [
    { label: 'Sổ chuyến đi', expectPath: '/trips', expectWord: 'Sổ chuyến đi' },
    { label: 'Đội xe', expectPath: '/fleet', expectWord: 'Đội xe' },
    { label: 'Kỷ luật', expectPath: '/penalties', expectWord: 'Kỷ luật' },
  ];

  for (const c of CASES) {
    const box = await tapNav(c.label);
    if (!box) { failures++; continue; }
    // Sample right after the tap AND after settling: a race can be invisible by
    // the time a screenshot is taken, which is exactly how this slips through.
    const samples = [];
    for (const waitMs of [0, 120, 400, 1200]) {
      if (waitMs) await sleep(waitMs === 120 ? 120 : waitMs - samples.length * 120);
      samples.push({ atMs: waitMs, ...(await readState()) });
    }
    const last = samples[samples.length - 1];
    const mismatch = samples.filter((x) => x.url !== `/${c.expectPath.replace(/^\//, '')}`);
    const ok = last.url === c.expectPath && last.heading.includes(c.expectWord);
    if (!ok) failures++;
    log('case', {
      label: c.label, expect: { path: c.expectPath, word: c.expectWord },
      settled: last, ok,
      earlySamples: samples.slice(0, -1),
      sawLaggingUrl: mismatch.length > 0,
    });
    await page.screenshot({ path: `/Volumes/LexarSSD/projects/silversea-prod/qa/093500-nav-${c.expectPath.replace(/\//g, '_')}.png` });
  }

  log('verdict', { failures, verdict: failures === 0 ? 'NO RACE OBSERVED' : 'RACE OBSERVED' });
  writeFileSync('/Volumes/LexarSSD/projects/silversea-prod/qa/093500-nav-race.log', LOG.map((e) => JSON.stringify(e)).join('\n') + '\n');
} catch (err) {
  log('driver-error', { message: String((err && err.message) || err).slice(0, 300) });
  failures++;
} finally {
  await browser.close();
}
process.exit(failures === 0 ? 0 : 1);