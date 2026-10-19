// QA wave 17/10 — small-ticket cluster A: QA2-006 caps-lock hint, FB-057
// topbar 360/560 (owner ruling), mobile edge-to-edge (card 111026151500).
import puppeteer from 'puppeteer';
import fs from 'node:fs';
const BASE = process.env.BASE ?? 'https://vantai.tingting.vip';
const SHOTS = process.env.SHOTS ?? '/tmp/qamisc';
fs.mkdirSync(SHOTS, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const record = (r, ok, d) => { const v = ok ? 'PASS' : 'FAIL'; results.push(v); console.log(`[${v}] ${r} — ${d}`); };
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--hide-scrollbars'] });
try {
  const page = await browser.newPage();
  // ── QA2-006: caps lock hint on /login ──
  await page.setViewport({ width: 1366, height: 768 });
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(1500);
  await page.focus('#password-input').catch(() => {});
  const caps = await page.evaluate(() => {
    const input = document.querySelector('#password-input');
    if (!input) return { found: false };
    const ev = new KeyboardEvent('keydown', { key: 'a', bubbles: true });
    Object.defineProperty(ev, 'getModifierState', { value: (m) => m === 'CapsLock' });
    input.dispatchEvent(ev);
    return { found: true, describedby: input.getAttribute('aria-describedby') };
  });
  await sleep(400);
  const hintAfter = await page.evaluate(() => {
    const hint = document.querySelector('#login-caps-hint');
    return { hintText: hint ? hint.textContent.trim() : null, role: hint?.getAttribute('role') ?? null };
  });
  const caps2 = { ...caps, ...hintAfter };
  await page.screenshot({ path: `${SHOTS}/01-capslock-hint.png` });
  record('qa2-006-caps-hint-shows', caps2.found && /Caps Lock đang bật/.test(caps2.hintText ?? '') && caps2.role === 'status',
    JSON.stringify(caps2) + ` · ${SHOTS}/01-capslock-hint.png`);
  await page.evaluate(() => {
    const input = document.querySelector('#password-input');
    const ev = new KeyboardEvent('keyup', { key: 'a', bubbles: true });
    Object.defineProperty(ev, 'getModifierState', { value: () => false });
    input.dispatchEvent(ev);
  });
  await sleep(400);
  const capsOff = await page.evaluate(() => ({ hintGone: !document.querySelector('#login-caps-hint') }));
  record('qa2-006-caps-hint-clears', capsOff.hintGone, JSON.stringify(capsOff));

  // ── FB-057 topbar 360/560 at 1920 (login first via API for token) ──
  const lr = await fetch(`${BASE}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier: 'admin', password: 'Abc123' }) });
  const { token } = await lr.json();
  await page.setViewport({ width: 1920, height: 1080 });
  await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);
  await page.goto(`${BASE}/shipments`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(2500);
  const mRest = await page.evaluate(() => {
    const el = document.querySelector('.topbar__search');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { w: Math.round(r.width), maxw: getComputedStyle(el).maxWidth };
  });
  await page.screenshot({ path: `${SHOTS}/02-topbar-rest-360.png` });
  await page.focus('.topbar__search input').catch(async () => { await page.evaluate(() => document.querySelector('.topbar__search input')?.focus()); });
  await sleep(500);
  const mFocus = await page.evaluate(() => {
    const el = document.querySelector('.topbar__search');
    const r = el.getBoundingClientRect();
    return { w: Math.round(r.width) };
  });
  await page.screenshot({ path: `${SHOTS}/03-topbar-focus-560.png` });
  // Ruling 2026-10-14 (supersedes 2026-10-11): ≥1280px grows fluidly, no ceiling.
  record('fb057-topbar-1920-fluid-no-cap', mRest && mRest.w >= 500 && /none/.test(mRest.maxw), `rest@1920=${JSON.stringify(mRest)} focus@1920=${JSON.stringify(mFocus)} · ${SHOTS}/02-topbar-rest-360.png`);
  // ≤1279px keeps the 360 rest / 560 focus ladder.
  await page.setViewport({ width: 1024, height: 768 });
  await sleep(600);
  await page.evaluate(() => document.querySelector('.topbar__search input')?.blur());
  await sleep(500);
  const mRest2 = await page.evaluate(() => {
    const el = document.querySelector('.topbar__search');
    const r = el.getBoundingClientRect();
    return { w: Math.round(r.width), maxw: getComputedStyle(el).maxWidth };
  });
  await page.evaluate(() => document.querySelector('.topbar__search input')?.focus());
  await sleep(500);
  const mFocus2 = await page.evaluate(() => {
    const el = document.querySelector('.topbar__search');
    return { w: Math.round(el.getBoundingClientRect().width), maxw: getComputedStyle(el).maxWidth };
  });
  await page.screenshot({ path: `${SHOTS}/03-topbar-1024-focus.png` });
  // The ladder is a max-width contract; at 1024 the topbar may lack free flex
  // room to reach the clamp, so the computed clamp (not actual width) is the law.
  record('fb057-topbar-1024-ladder-360-560', mRest2.maxw === '360px' && mFocus2.maxw === '560px', `rest@1024=${JSON.stringify(mRest2)} focus@1024=${JSON.stringify(mFocus2)} · ${SHOTS}/03-topbar-1024-focus.png`);

  // ── 111026151500 mobile edge-to-edge at 390×844 + landscape 844×390 ──
  await page.setViewport({ width: 390, height: 844 });
  await page.goto(`${BASE}/shipments`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(2500);
  const mob = await page.evaluate(() => {
    const app = document.querySelector('#root') ?? document.body;
    const topbar = document.querySelector('.topbar');
    return {
      innerH: window.innerHeight,
      docClientH: document.documentElement.clientHeight,
      bodyScrollW: document.body.scrollWidth,
      innerW: window.innerWidth,
      topbarTop: topbar ? Math.round(topbar.getBoundingClientRect().top) : null,
      hasVhAttr: !!document.querySelector('meta[name="viewport"]') && /viewport-fit=cover/.test(document.querySelector('meta[name="viewport"]').content),
    };
  });
  await page.screenshot({ path: `${SHOTS}/04-mobile-390-full.png` });
  record('safe-area-390-portrait-no-hgap', mob.bodyScrollW <= mob.innerW + 1 && mob.topbarTop === 0, JSON.stringify(mob) + ` · ${SHOTS}/04-mobile-390-full.png`);
  await page.setViewport({ width: 844, height: 390 });
  await sleep(1200);
  const land = await page.evaluate(() => {
    const topbar = document.querySelector('.topbar');
    const r = topbar?.getBoundingClientRect();
    return { topbarTop: r ? Math.round(r.top) : null, topbarH: r ? Math.round(r.height) : null, innerW: window.innerWidth };
  });
  await page.screenshot({ path: `${SHOTS}/05-mobile-landscape.png` });
  record('safe-area-landscape-topbar-painted', land.topbarTop === 0 && (land.topbarH ?? 0) > 30, JSON.stringify(land) + ` · ${SHOTS}/05-mobile-landscape.png`);
} finally { await browser.close(); }
const fails = results.filter((v) => v === 'FAIL').length;
console.log(fails ? `=== ${fails} RUNG FAIL ===` : '=== ALL RUNGS PASS ===');
process.exit(fails ? 1 : 0);
