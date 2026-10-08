// Card 061026221839 — LOCAL UI rung: the /finance/treasury account-name cell
// must render the FULL account name (wrap, never an ellipsis). Fixture: id
// 2928, code ZAI-KB221839, name = the exact string from the report. Assertions:
// the <strong> carries the whole name, no computed ellipsis on any ancestor of
// the name node, and no horizontal clipping at 1440 and 1024 (card handoff).
import puppeteer from 'puppeteer';
import { writeFileSync, appendFileSync, mkdirSync } from 'node:fs';

const BASE = 'http://localhost:7175';
const API = 'http://localhost:3002/api';
const QA = '/Volumes/LexarSSD/projects/silversea-prod/qa';
const FULL_NAME = 'ACB - Tai khoan cong ty ACB';
const LOG = [];
const DRIVER_LOG = `${QA}/2026-10-06_card061026221839_ui-driver.log`;
const log = (step, obj) => {
  const e = { at: new Date().toISOString(), step, ...obj };
  LOG.push(e);
  // Crash-safe trail under hot-tree load: every step lands on disk as it happens.
  appendFileSync(DRIVER_LOG, JSON.stringify(e) + '\n');
  console.log(JSON.stringify(e));
};

const health = await fetch(`${API}/health`).then((r) => r.json());
log('health', { status: health.status, buildHash: health.buildHash, note: 'dev = live source at HEAD, not a deployed cut' });

const login = await fetch(`${API}/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ identifier: 'admin', password: 'Abc123' }),
});
if (!login.ok) throw new Error(`login admin failed: ${login.status}`);
const session = await login.json();
const token = session.token ?? session.accessToken ?? session?.data?.token;
log('login', { user: 'admin', role: 'ADMIN (local demo)', gotToken: Boolean(token) });

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
try {
  const page = await browser.newPage();
  await page.setRequestInterception(true);
  page.on('request', (req) => { void req.continue(); });
  await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);

  for (const width of [1440, 1024]) {
    await page.setViewport({ width, height: 1000 });
    await page.goto(`${BASE}/finance/treasury`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForSelector('.treasury-table__account strong', { timeout: 90000 });

    const probe = await page.evaluate((expected) => {
      const strongs = [...document.querySelectorAll('.treasury-table__account strong')];
      const target = strongs.find((el) => (el.textContent || '').includes(expected));
      if (!target) return { found: false, renderedNames: strongs.map((el) => (el.textContent || '').trim()) };
      const clipChain = [];
      let node = target;
      while (node && node.tagName !== 'TD') {
        const cs = getComputedStyle(node);
        clipChain.push({
          tag: `${node.tagName}.${node.className || ''}`.slice(0, 60),
          textOverflow: cs.textOverflow,
          whiteSpace: cs.whiteSpace,
          clipped: node.scrollWidth > node.clientWidth + 1,
        });
        node = node.parentElement;
      }
      return {
        found: true,
        rendered: (target.textContent || '').trim(),
        fullRendered: (target.textContent || '').trim() === expected,
        anyEllipsis: clipChain.some((c) => c.textOverflow === 'ellipsis'),
        anyClipped: clipChain.some((c) => c.clipped),
        clipChain,
      };
    }, FULL_NAME);
    log(`probe-${width}`, probe);
    if (!probe.found) throw new Error(`fixture row not rendered at ${width}`);
    if (!probe.fullRendered) throw new Error(`name truncated at ${width}: "${probe.rendered}"`);
    if (probe.anyEllipsis || probe.anyClipped) throw new Error(`clipping/ellipsis detected at ${width}`);
    // The screenshot must show the target itself (qa-visual gate): puppeteer's
    // element screenshot scrolls the row into view at capture time, so the
    // unstable default row order cannot race the shot.
    const rows = await page.$$('.record-table tbody tr');
    let fixtureRow = null;
    for (const tr of rows) {
      const text = await tr.evaluate((el) => el.textContent || '');
      if (text.includes(FULL_NAME)) { fixtureRow = tr; break; }
    }
    if (!fixtureRow) throw new Error(`fixture <tr> not found at ${width}`);
    await fixtureRow.screenshot({ path: `${QA}/2026-10-06_card061026221839_ui-treasury-row-${width}.png` });
    await page.screenshot({ path: `${QA}/2026-10-06_card061026221839_ui-treasury-${width}.png` });
    log(`screenshot-${width}`, {
      row: `qa/2026-10-06_card061026221839_ui-treasury-row-${width}.png`,
      page: `qa/2026-10-06_card061026221839_ui-treasury-${width}.png`,
    });
  }
} finally {
  await browser.close();
}

mkdirSync(QA, { recursive: true });
appendFileSync(DRIVER_LOG, 'DRIVER OK\n');
console.log('DRIVER OK');
