// Card 061026043646 — LOCAL UI rung: the /accounting work-inbox WAITING lane
// ("Đang bị chặn") loading announcement must read "Đang tải đang bị chặn…"
// under node-boundary extraction (one text node). The work-inbox API is
// delayed ~3s so the loading state is held long enough to assert + capture.
// Read-only rung: asserts the announcement, screenshots loading + loaded
// states, and records the API response identity (no mutation).
import puppeteer from 'puppeteer';
import { writeFileSync, mkdirSync } from 'node:fs';

const BASE = 'http://localhost:7175';
const API = 'http://localhost:3002/api';
const QA = '/Volumes/LexarSSD/projects/silversea-prod/qa';
const LOG = [];
const log = (step, obj) => {
  const e = { at: new Date().toISOString(), step, ...obj };
  LOG.push(e);
  console.log(JSON.stringify(e));
};

const health = await fetch(`${API}/health`).then((r) => r.json());
log('health', { status: health.status, buildHash: health.buildHash, note: 'dev = live source, not a deployed cut' });

const login = await fetch(`${API}/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ identifier: 'ketoan', password: 'Abc123' }),
});
if (!login.ok) throw new Error(`login ketoan failed: ${login.status}`);
const session = await login.json();
const token = session.token ?? session.accessToken ?? session?.data?.token;
log('login', { user: 'ketoan', role: 'ACCOUNTANT (local demo)', gotToken: Boolean(token) });

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 1000 });

  // Arm interception + token injection, then navigate — same run (pitfall).
  await page.setRequestInterception(true);
  let inboxCalls = 0;
  const inboxBodies = [];
  page.on('response', async (res) => {
    if (res.url().includes('/api/financial/work-inbox')) {
      inboxCalls += 1;
      try { inboxBodies.push({ url: res.url().replace(BASE, ''), status: res.status(), json: await res.json() }); } catch { /* body already consumed */ }
    }
  });
  page.on('request', (req) => {
    if (req.url().includes('/api/financial/work-inbox')) {
      // Hold the work-inbox response so the loading announcement is capturable.
      setTimeout(() => { void req.continue(); }, 3000);
    } else {
      void req.continue();
    }
  });
  await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);
  await page.goto(`${BASE}/accounting`, { waitUntil: 'domcontentloaded', timeout: 60000 });

  // Wait for the WAITING lane to mount, then assert the announcement text.
  await page.waitForSelector('.accounting-work-inbox__lane.is-waiting', { timeout: 20000 });
  await page.waitForSelector('.accounting-work-inbox__lane.is-waiting [role="status"]', { timeout: 20000 });
  const during = await page.evaluate(() => {
    const lane = document.querySelector('.accounting-work-inbox__lane.is-waiting');
    const status = lane.querySelector('[role="status"]');
    const walker = document.createTreeWalker(status, NodeFilter.SHOW_TEXT);
    const parts = [];
    while (walker.nextNode()) parts.push((walker.currentNode.textContent ?? '').trim());
    return { extracted: parts.join(''), raw: status.textContent, visible: !!(status.offsetWidth || status.offsetHeight) };
  });
  log('loading-state-assert', { extractedAnnouncement: during.extracted, rawText: during.raw, matchesExpected: during.extracted === 'Đang tải đang bị chặn…' });
  await page.screenshot({ path: `${QA}/2026-10-06_card061026043646_ui-loading.png` });
  log('screenshot-loading', { path: 'qa/2026-10-06_card061026043646_ui-loading.png' });

  // Release: wait out the 3s hold, then the lane renders its table.
  await page.waitForFunction(() => {
    const lane = document.querySelector('.accounting-work-inbox__lane.is-waiting');
    return lane && !lane.querySelector('[role="status"]');
  }, { timeout: 20000 });
  const loaded = await page.evaluate(() => {
    const lane = document.querySelector('.accounting-work-inbox__lane.is-waiting');
    return { hasTable: Boolean(lane.querySelector('table')), laneText: lane.textContent.slice(0, 200) };
  });
  log('loaded-state', loaded);
  await page.screenshot({ path: `${QA}/2026-10-06_card061026043646_ui-loaded.png` });
  log('screenshot-loaded', { path: 'qa/2026-10-06_card061026043646_ui-loaded.png' });

  log('api-identity', {
    inboxCalls,
    responses: inboxBodies.map((b) => ({ url: b.url, status: b.status, counts: b.json?.counts, items: b.json?.items?.length, totalPages: b.json?.totalPages })),
    note: 'read-only rung — persisted state untouched; API identity recorded',
  });
} finally {
  await browser.close();
}

mkdirSync(QA, { recursive: true });
writeFileSync(`${QA}/2026-10-06_card061026043646_ui-driver.log`, LOG.map((e) => JSON.stringify(e)).join('\n') + '\n');
console.log('DRIVER OK');
