// Card 081026093500 — lead decision rung on cut 22837bc3 (decision authority
// 08/10). Client-side nav race: URL changes but the OLD page's content stays.
// Real taps on 'Đội xe' and 'Kỷ luật' from /trips; sample URL + rendered
// heading immediately after the tap and after settle. Distinguishes the bug
// (old CONTENT after URL change) from legitimate lazy-Suspense (PageLoader).
// Read-only navigation.
import puppeteer from 'puppeteer';
import { writeFileSync } from 'node:fs';

const API = 'https://vantai.tingting.vip/api';
const BASE = 'https://vantai.tingting.vip';
const QA = '/Volumes/LexarSSD/projects/silversea-prod/qa';
const SCOPE = '2026-10-08_card081026093500-leadqa';
const LOG = [];
const log = (step, obj) => { const e = { at: new Date().toISOString(), step, ...obj }; LOG.push(e); console.log(JSON.stringify(e)); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let exitCode = 0;

const health = await fetch(`${API}/health`).then((r) => r.json());
log('health', { buildHash: health.buildHash, expect: '22837bc3' });
if (!String(health.buildHash || '').startsWith('22837bc3')) { log('build-currency-FAIL'); process.exit(2); }

const login = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier: 'admin', password: 'Abc123' }) });
const token = (await login.json()).token;
if (!token) { log('login-FAIL'); process.exit(2); }

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);
  await page.goto(`${BASE}/trips`, { waitUntil: 'networkidle2', timeout: 90000 });
  await sleep(4000);

  const sample = () => page.evaluate(() => {
    const main = document.querySelector('main') ?? document.body;
    const h = main.querySelector('h1,h2,h3');
    const body = (main.textContent || '').replace(/\s+/g, ' ').trim();
    return {
      path: location.pathname,
      heading: h ? (h.textContent || '').trim().slice(0, 60) : null,
      loading: /Đang tải|loading/i.test(body.slice(0, 400)),
      bodyStart: body.slice(0, 110),
    };
  });

  const findNav = async (label) => {
    // expand collapsed sidebar sections, then locate the item
    for (let round = 0; round < 3; round++) {
      const pt = await page.evaluate((lb) => {
        const cands = [...document.querySelectorAll('a,button')].filter((e) => e.offsetParent !== null);
        const item = cands.find((x) => (x.textContent || '').trim() === lb);
        if (item) {
          const r = item.getBoundingClientRect();
          return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
        }
        // expand ALL collapsed section headers to reveal every item
        const togs = cands.filter((x) => x.getAttribute('aria-expanded') === 'false');
        if (togs.length) return { expand: togs.map((t) => { const r = t.getBoundingClientRect(); return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), label: (t.textContent || '').trim().slice(0, 24) }; }) };
        return { err: 'exhausted', sample: cands.map((c) => (c.textContent || '').trim().slice(0, 18)).slice(0, 16) };
      }, label);
      if (pt.err) return pt;
      if (pt.expand) { for (const t of pt.expand) { await page.mouse.click(t.x, t.y); await sleep(500); } await sleep(900); continue; }
      return pt;
    }
    return { err: 'not-found' };
  };

  const legs = [['Đội xe', '/fleet'], ['Kỷ luật', '/penalties']];
  const findings = [];
  for (let round = 0; round < 3; round++) {
    // reset to /trips between rounds
    if (round > 0) {
      await page.goto(`${BASE}/trips`, { waitUntil: 'networkidle2', timeout: 90000 });
      await sleep(2500);
    }
    const before = await sample();
    for (const [label, wantPath] of legs) {
      const nav = await findNav(label);
      log('nav-probe', { round, label, nav });
      if (nav.err || nav.x === undefined) { findings.push({ round, label, verdict: 'nav-not-found' }); continue; }
      const pre = await sample();
      await page.mouse.click(nav.x, nav.y);
      const t0 = await sample();          // immediately post-tap
      await sleep(300); const t300 = await sample();
      await sleep(1200); const t1500 = await sample();
      await sleep(2500); const settled = await sample();
      log('leg', { round, label, wantPath, pre: pre.path, t0, t300: { path: t300.path, heading: t300.heading }, settled });
      if (round === 0 && label === 'Đội xe') await page.screenshot({ path: `${QA}/${SCOPE}_ui-fleet.png` });
      if (round === 0 && label === 'Kỷ luật') await page.screenshot({ path: `${QA}/${SCOPE}_ui-penalties.png` });
      // race signature: URL already at target while rendered heading is STILL the previous page's (not a loader)
      const raceAt = [t0, t300, t1500].filter((s) => s.path === wantPath && !s.loading && pre.heading && s.heading === pre.heading && pre.path !== wantPath);
      findings.push({ round, label, settledOk: settled.path === wantPath, raceSamples: raceAt.length });
    }
  }
  // ── Cold-context confirmation: fresh browser context = cold HTTP cache, so
  // the lazy /fleet chunk must load — the condition that showed the stale
  // tree in round 0. Instant screenshot BEFORE any evaluate roundtrip.
  const mkCtx = browser.createBrowserContext ?? browser.createIncognitoBrowserContext;
  const coldResults = [];
  for (let iter = 0; iter < 2; iter++) {
    const ctx = await mkCtx.call(browser);
    const cp = await ctx.newPage();
    await cp.setViewport({ width: 1440, height: 900 });
    await cp.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);
    await cp.goto(`${BASE}/trips`, { waitUntil: 'networkidle2', timeout: 90000 });
    await sleep(4000);
    const navPt = await cp.evaluate(() => {
      const cands = [...document.querySelectorAll('a,button')].filter((e) => e.offsetParent !== null);
      let item = cands.find((x) => (x.textContent || '').trim() === 'Đội xe');
      return item ? (() => { const r = item.getBoundingClientRect(); return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }; })() : { err: 'no Đội xe' };
    });
    if (navPt.err) { log('cold-nav-miss', { iter }); await ctx.close(); continue; }
    await cp.mouse.click(navPt.x, navPt.y);
    await cp.screenshot({ path: `${QA}/${SCOPE}_ui-cold-t0-iter${iter}.png` });   // captured during the lag window
    const t0 = await cp.evaluate(() => {
      const main = document.querySelector('main') ?? document.body;
      const h = main.querySelector('h1,h2,h3');
      return { path: location.pathname, heading: h ? (h.textContent || '').trim().slice(0, 50) : null, loading: /Đang tải|loading/i.test((main.textContent || '').slice(0, 400)) };
    });
    await sleep(3000);
    const settled = await cp.evaluate(() => ({ path: location.pathname, heading: (document.querySelector('main h1,h2,h3')?.textContent || '').trim().slice(0, 50) }));
    log('cold-nav', { iter, t0, settled });
    coldResults.push({ iter, stale: t0.path === '/fleet' && !t0.loading && t0.heading && t0.heading !== 'Đội xe', settledOk: settled.path === '/fleet' && settled.heading === 'Đội xe' });
    await ctx.close();
  }

  const races = findings.filter((f) => f.raceSamples > 0);
  const coldStale = coldResults.filter((c) => c.stale);
  const notFound = findings.filter((f) => f.verdict === 'nav-not-found');
  if (coldStale.length > 0 || races.length > 0) { log('REPRO-race', { warmRounds: races, coldContext: coldResults, note: 'cold lazy-chunk nav keeps the old page while the URL already changed' }); exitCode = 1; }
  else if (notFound.length > 0 && !findings.some((f) => f.settledOk)) { log('INCONCLUSIVE', { notFound, coldResults }); exitCode = 2; }
  else log('PASS-no-race', { warmRounds: 3, legs: legs.map((l) => l[0]), coldResults });
} catch (err) {
  log('driver-error', { message: String(err && err.message || err).slice(0, 300) });
  exitCode = 1;
} finally {
  writeFileSync(`${QA}/${SCOPE}_ui-driver.log`, LOG.map((e) => JSON.stringify(e)).join('\n') + '\n');
  await browser.close();
  process.exit(exitCode);
}
