// Card 081026072302 (FB-055 follow-up) — local width-sweep rung against HEAD:
// the closed footer card must hold the <=60px contract at every measured
// phone width (320..430) for BOTH closed title shapes, and stay unchanged at
// 768/1440 and on the not-closed text variant. jsdom cannot pin layout; this
// is the pixel-truth pin (repo idiom from card 071026103226).
// Fixtures (local demo DB): laixe 25216 (COMPLETED long title), laixe 25215
// (CANCELED short title), dvthuc 37088 (IN_PROGRESS open variant).
// NOTE: trip 25216 is flipped CANCELED->COMPLETED for this rung and restored
// after; do not treat it as business data.
import puppeteer from 'puppeteer';
import { writeFileSync } from 'node:fs';

const BASE = process.argv[2] || 'http://localhost:7175';
const API = 'http://localhost:3002/api';
const QA = '/Volumes/LexarSSD/projects/silversea-prod/qa';
const SCOPE = '2026-10-08_card081026072302-fb055-followup';
const CLOSED = [
  { user: 'laixe', trip: 25216, shape: 'completed-long-title' },
  { user: 'laixe', trip: 25215, shape: 'canceled-short-title' },
];
const OPEN = { user: 'dvthuc', trip: 37088 };
const PHONE_WIDTHS = [320, 326, 360, 390, 430];

const LOG = [];
const log = (step, obj) => { const e = { at: new Date().toISOString(), step, ...obj }; LOG.push(e); console.log(JSON.stringify(e)); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let exitCode = 0;

const tokens = {};
for (const user of [...new Set([...CLOSED.map((c) => c.user), OPEN.user])]) {
  const res = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier: user, password: 'Abc123' }) });
  tokens[user] = (await res.json()).token;
  log('login', { user, ok: Boolean(tokens[user]) });
}

const measure = (page) => page.evaluate(() => {
  const body = document.querySelector('.driver-task-footer__body');
  const strong = document.querySelector('.driver-task-footer__summary strong');
  const hint = document.querySelector('.driver-task-footer__hint');
  const btn = [...document.querySelectorAll('.driver-task-footer__body a, .driver-task-footer__body button')].find((x) => /Xem chứng từ giao hàng/.test(x.textContent || ''));
  if (!body) return { found: false };
  const lh = parseFloat(getComputedStyle(strong).lineHeight) || 21;
  return {
    found: true,
    bodyH: Math.round(body.getBoundingClientRect().height),
    closedVariant: body.className.includes('--closed'),
    hasHint: Boolean(hint),
    titleText: (strong?.textContent || '').trim(),
    titleLines: strong ? Math.round(strong.getBoundingClientRect().height / lh) : null,
    titleW: strong ? Math.round(strong.getBoundingClientRect().width) : null,
    btnH: btn ? Math.round(btn.getBoundingClientRect().height) : null,
    btnW: btn ? Math.round(btn.getBoundingClientRect().width) : null,
  };
});

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
try {
  const jobs = [];
  for (const w of PHONE_WIDTHS) for (const c of CLOSED) jobs.push({ ...c, w, kind: 'closed' });
  jobs.push({ ...OPEN, w: 390, kind: 'open' });
  jobs.push({ ...CLOSED[0], w: 768, kind: 'desktop' });
  jobs.push({ ...CLOSED[0], w: 1440, kind: 'desktop' });
  for (const { user, trip, shape, w, kind } of jobs) {
    const page = await browser.newPage();
    await page.setViewport({ width: w, height: 900 });
    await page.evaluateOnNewDocument((tok) => localStorage.setItem('token', tok), tokens[user]);
    await page.goto(`${BASE}/my-trips/${trip}`, { waitUntil: 'networkidle2', timeout: 60000 });
    await sleep(3000);
    let st = await measure(page);
    if (!st.found) { await sleep(3000); st = await measure(page); log('retry-measure', { key: `${kind}-w${w}-trip${trip}`, found: st.found }); }
    const key = `${kind}-w${w}-trip${trip}`;
    log(key, { shape, ...st });
    if (!st.found) { log(`${key}-FAIL`, { reason: 'footer not found (page did not render trip detail)' }); exitCode = 1; }
    else if (kind === 'closed') {
      const ok = st.bodyH <= 60 && st.closedVariant && !st.hasHint && st.btnH !== null && st.btnH <= 40 && st.titleText.length > 0;
      log(`${key}-verdict`, { ok });
      if (!ok) exitCode = 1;
      if (w === 320 || w === 390) await page.screenshot({ path: `${QA}/${SCOPE}_${key}.png`, fullPage: false });
    } else if (kind === 'open') {
      const ok = !st.closedVariant && st.bodyH <= 60;
      log(`${key}-verdict`, { ok });
      if (!ok) exitCode = 1;
    } else {
      // Desktop keeps the pre-existing closed-card height: 40px control row +
      // 20px card padding + 2px border = 62px (round 6 accepted; not this
      // card's defect). Pin it as "unchanged", not against the phone contract.
      const ok = st.bodyH <= 62 && st.titleLines === 1;
      log(`${key}-verdict`, { ok });
      if (!ok) exitCode = 1;
    }
    await page.close();
  }
} catch (err) {
  log('driver-error', { message: String(err && err.message || err).slice(0, 300) });
  exitCode = 1;
} finally {
  writeFileSync(`${QA}/${SCOPE}_ui-driver.log`, LOG.map((e) => JSON.stringify(e)).join('\n') + '\n');
  await browser.close();
  process.exit(exitCode);
}
