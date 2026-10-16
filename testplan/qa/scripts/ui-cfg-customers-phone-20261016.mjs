// UI driver — /config/customers phone-band polish (2026-10-16).
// Captures the current phone-band rendering of the customer catalog at
// 390/768, plus computed-style probes for the row card, the details
// disclosure and the fact grid, as the before/after evidence for the
// polish pass. Usage: node testplan/qa/scripts/ui-cfg-customers-phone-20261016.mjs [tag]
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';

const API = 'http://localhost:3002/api';
const BASE = 'http://localhost:7175';
const TAG = process.argv[2] || 'before';
const OUT = new URL(`../../../qa/2026-10-16_cfg-customers-phone-ui/`, import.meta.url).pathname;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function login() {
  const res = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier: 'admin', password: 'Abc123' }),
  });
  if (!res.ok) throw new Error(`login -> ${res.status}`);
  const body = await res.json();
  return body.token;
}

const PROBE = () => {
  const cs = (el, props) => {
    if (!el) return null;
    const c = getComputedStyle(el);
    return Object.fromEntries(props.map((p) => [p, c.getPropertyValue(p)]));
  };
  const box = (el) => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
  };
  const row = document.querySelector('.cfg-customer-table tbody tr');
  const details = document.querySelector('.cfg-customer-details');
  return {
    row: cs(row, ['display', 'grid-template-columns', 'padding', 'background-color', 'border', 'border-bottom', 'border-radius', 'gap']),
    identityTd: cs(document.querySelector('.cfg-customer-table tbody tr > td:first-child'), ['padding', 'font-size']),
    shortName: cs(document.querySelector('.cfg-customer-short-name'), ['font-size', 'line-height', 'color', 'font-weight', 'text-transform']),
    fullName: cs(document.querySelector('.cfg-customer-full-name'), ['font-size', 'line-height', 'color', 'font-weight']),
    meta: cs(document.querySelector('.cfg-customer-compact-meta'), ['font-size', 'color', 'margin-top', 'gap']),
    summary: details ? cs(details.querySelector('summary'), ['display', 'min-height', 'font-size', 'color', 'font-weight', 'list-style-type']) : null,
    dl: details ? cs(details.querySelector('dl'), ['display', 'grid-template-columns', 'gap', 'margin']) : null,
    dt: details ? cs(details.querySelector('dt'), ['font-size', 'color', 'font-weight', 'text-transform', 'line-height']) : null,
    dd: details ? cs(details.querySelector('dd'), ['font-size', 'color', 'line-height', 'margin']) : null,
    firstRowBox: box(row),
    filterCard: box(document.querySelector('.filter-bar')),
    fetchStatus: box(document.querySelector('.cfg-customer-fetch-status')),
    kpiGrid: box(document.querySelector('.cfg-customer-summary')),
    pageHeader: box(document.querySelector('.page-header, .cfg-page > header')),
    page: cs(document.querySelector('.cfg-page--customers'), ['padding', 'gap', 'display']),
    activeChip: cs(document.querySelector('.filter-chip.is-active'), ['background-color', 'color', 'border-radius', 'height']),
    docWidth: document.documentElement.scrollWidth,
  };
};

const run = async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const token = await login();
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'], protocolTimeout: 180000 });
  // Close the headless browser even when a step throws mid-run — an orphaned
  // Chrome outlives the script otherwise.
  try {
    const page = await browser.newPage();
    await drive(page, token);
  } finally {
    await browser.close();
  }
};

const drive = async (page, token) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console.error: ' + m.text().slice(0, 240)); });
  await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);

  // PROBE_ONLY=1 skips the heavy full-page captures (the dev catalog renders
  // every row; captureScreenshot can time out on thousands of rows).
  const probeOnly = process.env.PROBE_ONLY === '1';
  const report = { tag: TAG, widths: {} };
  for (const [w, h] of [[390, 844], [768, 1024]]) {
    await page.setViewport({ width: w, height: h });
    await page.goto(`${BASE}/config/customers`, { waitUntil: 'networkidle2', timeout: 60000 });
    await sleep(2000);
    if (!probeOnly) await page.screenshot({ path: path.join(OUT, `${TAG}_${w}_list.png`), fullPage: true });
    report.widths[w] = await page.evaluate(PROBE);
    // Expand the first row's details and capture the open state.
    const summary = await page.$('.cfg-customer-details > summary');
    if (summary) {
      await summary.evaluate((el) => el.scrollIntoView({ block: 'center' }));
      await sleep(300);
      await summary.evaluate((el) => el.click());
      await sleep(600);
      if (!probeOnly) await page.screenshot({ path: path.join(OUT, `${TAG}_${w}_details-open.png`), fullPage: true });
      if (w === 390) report.detailsOpenProbe = await page.evaluate(PROBE);
      await summary.evaluate((el) => el.click());
      await sleep(300);
    }
  }
  report.consoleErrors = errors;
  fs.writeFileSync(path.join(OUT, `${TAG}_probe.json`), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ ok: true, out: OUT, errors: errors.length }, null, 2));
};

run().catch((e) => { console.error('DRIVER FAILED:', e.message); process.exit(1); });
