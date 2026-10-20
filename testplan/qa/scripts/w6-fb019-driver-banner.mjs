// FB-019 (card 211026005621) — rung-3 UI drive on the LOCAL dev stack of this
// worktree: driver taps "Nhận lệnh vận chuyển" on a trip whose truck is busy
// (another trip IN_TRANSIT). Backend answers 409 "Xe đang chạy chuyến TRP-…".
//
//   node testplan/qa/scripts/w6-fb019-driver-banner.mjs
//
// Env: FE_PORT (default 7176), BE_PORT (default 3302).
// The script drives TWO builds of the page:
//   BEFORE (pre-fix, HEAD) — banner must show the internal TRP code (reproduces
//   the bug), AFTER (fixed worktree) — banner must name the Số Bill and never
//   contain the TRP code. `after-generic` drives the not-owned blocker variant
//   (board cannot vouch → generic copy + dispatch handoff). DB scenario is
//   seeded/reverted by the caller.
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';

const FE = `http://localhost:${process.env.FE_PORT || 7176}`;
const API = `http://localhost:${process.env.BE_PORT || 3302}/api`;
const OUT = path.resolve('qa/2026-10-21-fb019');
fs.mkdirSync(OUT, { recursive: true });
const LOG = path.join(OUT, 'ui-driver.log');
const log = (line) => { console.log(line); fs.appendFileSync(LOG, line + '\n'); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const TRIP_ID = process.env.FB019_TRIP_ID || '85065';
const BLOCKER_ID = process.env.FB019_BLOCKER_ID || '67894';
const BILL = 'FB020-R21-RB1';
// The banner names the BLOCKING trip (its own internal code) — any /TRP-…/
// match proves the internal code reached the driver screen (the FB-019 bug).
const INTERNAL_CODE = /TRP-\d{6}-\d+/;

async function login(identifier) {
  const res = await fetch(API + '/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier, password: 'Abc123' }),
  });
  if (!res.ok) { log(`LOGIN FAIL ${identifier} HTTP ${res.status}`); return null; }
  const body = await res.json();
  return body.token ?? null;
}

const health = await fetch(API + '/health').then((r) => r.json()).catch(() => null);
log(`HEALTH status=${health?.status} (local stack FE=${FE} BE=${API})`);
if (health?.status !== 'ok') { log('ABORT: backend health not ok'); process.exit(2); }

const token = await login('laixe');
if (!token) process.exit(2);
log('LOGIN laixe ok');

// Which trip did the driver actually get rejected on? The 409 body carries the
// blocker's trip code; capture it from the network layer for the evidence.
let rejectionBody = null;

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage', '--hide-scrollbars'] });
const page = await browser.newPage();
await page.setViewport({ width: 390, height: 844, isMobile: true }); // driver app is mobile-first
page.on('response', async (res) => {
  if (res.status() === 409 && res.url().includes('/progress')) {
    rejectionBody = await res.text().catch(() => null);
    log(`NET 409 ${res.url()} → ${rejectionBody}`);
  }
});

const phase = process.argv[2] || 'before'; // before | after
log(`PHASE ${phase} — open /my-trips/${TRIP_ID}`);
await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);
await page.goto(`${FE}/my-trips/${TRIP_ID}`, { waitUntil: 'networkidle2', timeout: 45000 });
await sleep(2500);
await page.screenshot({ path: path.join(OUT, `ui-1-trip-detail-${phase}.png`), fullPage: true });

const title = await page.title();
log(`PAGE title=${title} url=${page.url()}`);

// Accept CTA (sticky accept bar). If the driver already accepted in a previous
// run the button is gone — that is an abort, not a pass.
const acceptBtn = await page.waitForSelector('button.driver-task-accept-sticky__btn', { timeout: 20000 }).catch(() => null);
if (!acceptBtn) {
  log('ABORT: accept button not found (trip may already be accepted — reseed and rerun).');
  await browser.close();
  process.exit(3);
}
log('CLICK Nhận lệnh vận chuyển');
await page.screenshot({ path: path.join(OUT, `ui-2-before-click-${phase}.png`), fullPage: true });
await acceptBtn.click();
await sleep(3000); // 409 → parse → journey-board fetch → banner render
await page.screenshot({ path: path.join(OUT, `ui-3-after-click-${phase}.png`), fullPage: true });

// Post-click DOM assertion on the blocking banner.
const banner = await page.evaluate(() => {
  const el = document.querySelector('[data-testid="blocking-trip-banner"]');
  if (!el) return null;
  return {
    role: el.getAttribute('role'),
    text: (el.textContent || '').replace(/\s+/g, ' ').trim(),
    hasLink: !!el.querySelector('a.driver-task-link'),
    linkHref: el.querySelector('a.driver-task-link')?.getAttribute('href') ?? null,
  };
});
log(`BANNER ${JSON.stringify(banner)}`);

// Toast content (transient; captured within the 3s window).
const toastText = await page.evaluate(() => {
  const nodes = Array.from(document.querySelectorAll('[class*="toast" i], [role="status"], [role="alert"]'));
  return nodes.map((n) => (n.textContent || '').replace(/\s+/g, ' ').trim()).filter(Boolean).join(' | ') || null;
});
log(`TOAST ${JSON.stringify(toastText)}`);

let failed = false;
if (!banner) { log('FAIL: blocking banner not rendered'); failed = true; }
else {
  if (phase === 'before') {
    // Reproduction: the bug IS the internal TRP code on the driver screen.
    const leaked = banner.text.match(INTERNAL_CODE)?.[0] ?? null;
    if (!leaked) { log(`FAIL: expected the internal TRP code in the banner (bug reproduction), got: ${banner.text}`); failed = true; }
    else log(`PASS(repro): banner leaks the internal code — bug reproduced (${leaked})`);
  } else if (phase === 'after-generic') {
    if (INTERNAL_CODE.test(banner.text)) { log('FAIL: banner still contains an internal TRP code'); failed = true; }
    // Blocker belongs to another driver: the board cannot vouch for it, so
    // the banner states the gap honestly and hands off to dispatch.
    if (!banner.text.includes('chưa hoàn thành')) { log(`FAIL: generic banner copy expected, got: ${banner.text}`); failed = true; }
    if (!banner.text.includes('Liên hệ điều vận')) { log('FAIL: dispatch handoff line missing'); failed = true; }
    if (banner.hasLink) { log('FAIL: no Mở chuyến đang chạy link may render for a non-owned blocker'); failed = true; }
    if (!failed) log('PASS: non-owned blocker renders honest generic copy + dispatch handoff, no code, no link');
  } else {
    if (INTERNAL_CODE.test(banner.text)) { log('FAIL: banner still contains an internal TRP code'); failed = true; }
    if (!banner.text.includes(BILL)) { log(`FAIL: banner must name the Số Bill ${BILL}, got: ${banner.text}`); failed = true; }
    if (banner.hasLink && banner.linkHref !== `/my-trips/${BLOCKER_ID}`) { log(`FAIL: unexpected link href ${banner.linkHref}`); failed = true; }
    if (banner.text.includes('hoàn thành chuyến đó trước khi nhận lệnh mới')) log('PASS: banner reason copy intact');
    if (!failed) log(`PASS: banner names the Số Bill (${BILL}), no internal code, owned link preserved`);
  }
}
if (!rejectionBody) log('WARN: no 409 progress response captured (banner may be stale state, not a live rejection)');
else {
  const toastLeak = toastText ? INTERNAL_CODE.test(toastText) : false;
  if (phase === 'before' && toastLeak) log('PASS(repro): error toast also carries the internal code (both surfaces leaked)');
  if (phase === 'after') {
    if (toastLeak) { log('FAIL: toast still contains an internal TRP code'); failed = true; }
    else if (!toastText || !toastText.includes('hoàn thành chuyến đó trước')) { log(`FAIL: toast must still carry the reason code-free, got: ${toastText}`); failed = true; }
    else log('PASS: toast carries the reason without the internal code (both surfaces keep the reason)');
  }
}

await browser.close();
log(failed ? 'RESULT: FAIL' : 'RESULT: PASS');
process.exit(failed ? 1 : 0);
