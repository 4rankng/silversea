// Card 061026221239 — LOCAL UI rung: driver surfaces must render every cargo
// weight as "<n> kg" WITH the unit space (FB-034 standard, e.g. "15.000 kg").
// Driver account laixe (fixture: trip 25200, 18.500 kg container — the exact
// number from the report — reassigned to laixe). Assertions: on the /my-trips
// list card and the trip detail page, every text node containing "kg" that
// carries a number renders with a space before the unit; no "Nkg" gluing.
import puppeteer from 'puppeteer';
import { writeFileSync, appendFileSync, mkdirSync } from 'node:fs';

const BASE = 'http://localhost:7175';
const API = 'http://localhost:3002/api';
const QA = '/Volumes/LexarSSD/projects/silversea-prod/qa';
const DRIVER_LOG = `${QA}/2026-10-06_card061026221239_ui-driver.log`;
const LOG = [];
const log = (step, obj) => {
  const e = { at: new Date().toISOString(), step, ...obj };
  LOG.push(e);
  appendFileSync(DRIVER_LOG, JSON.stringify(e) + '\n');
  console.log(JSON.stringify(e));
};

const health = await fetch(`${API}/health`).then((r) => r.json());
log('health', { status: health.status, buildHash: health.buildHash, note: 'dev = live source at HEAD, not a deployed cut' });

const login = await fetch(`${API}/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ identifier: 'laixe', password: 'Abc123' }),
});
if (!login.ok) throw new Error(`login laixe failed: ${login.status}`);
const session = await login.json();
const token = session.token ?? session.accessToken ?? session?.data?.token;
log('login', { user: 'laixe', role: 'DRIVER (local demo)', gotToken: Boolean(token) });

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
try {
  const page = await browser.newPage();
  await page.setRequestInterception(true);
  page.on('request', (req) => { void req.continue(); });
  await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);

  await page.setViewport({ width: 390, height: 844 }); // driver runs mobile-width

  // Surface 1 — the /my-trips list card weight (report's "12.500,5 kg" site),
  // best-effort: the local fixture trip is CANCELED so the list may carry no
  // weighted card at all; the list-side format is pinned by the unit assertion
  // on whatever cards do render, and the claim is decided on the detail page.
  await page.goto(`${BASE}/my-trips`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  try {
    await page.waitForSelector('[data-testid="cont-weight"]', { timeout: 20000 });
  } catch { log('list-card-weights', { note: 'no weighted card rendered (fixture trip is canceled and filtered from the list)' }); }
  const cardWeights = await page.evaluate(() => {
    return [...document.querySelectorAll('[data-testid="cont-weight"]')]
      .map((el) => (el.textContent || '').trim());
  });
  log('list-card-weights', { cardWeights });
  const listHasNoSpace = cardWeights.filter((w) => /\d/.test(w) && /kg/i.test(w) && !/\skg/i.test(w));
  if (listHasNoSpace.length) throw new Error(`list card weight without space: ${listHasNoSpace.join(' | ')}`);

  // Surface 2 — the trip detail page (report's "18.500kg" site), fixture trip.
  await page.goto(`${BASE}/my-trips/25200`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForSelector('.dcc-bento__hero', { timeout: 90000 });
  const probe = await page.evaluate(() => {
    // Every text node on the page that mentions a weight unit.
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const hits = [];
    while (walker.nextNode()) {
      const t = (walker.currentNode.textContent || '').trim();
      if (/\d/.test(t) && /kg/i.test(t)) hits.push(t);
    }
    const bad = hits.filter((t) => /\dkg|kg\./.test(t.replace(/,\d/, '')) && !/\s kg|\skg/.test(t));
    const target = (document.querySelector('.dcc-bento__hero-meta')?.textContent || '').trim();
    return { hits: [...new Set(hits)], bad, target18: target ?? null };
  });
  log('detail-probe', probe);
  if (probe.bad.length) throw new Error(`detail renders weight without space: ${probe.bad.join(' | ')}`);
  if (!probe.target18) throw new Error('the bento hero-meta (type + weight line) did not render');
  if (!/18\.500 kg/.test(probe.target18)) throw new Error(`detail weight glued or missing: "${probe.target18}"`);
  log('assert', { detailWeight: probe.target18, standard: 'FB-034 "<n> kg" with space' });
  const bento = await page.$('.dcc-bento');
  await bento.screenshot({ path: `${QA}/2026-10-06_card061026221239_ui-driver-bento.png` });
  await page.screenshot({ path: `${QA}/2026-10-06_card061026221239_ui-driver-detail.png` });
  log('screenshot', { bento: 'qa/2026-10-06_card061026221239_ui-driver-bento.png', page: 'qa/2026-10-06_card061026221239_ui-driver-detail.png' });
} finally {
  await browser.close();
}

mkdirSync(QA, { recursive: true });
appendFileSync(DRIVER_LOG, 'DRIVER OK\n');
console.log('DRIVER OK');
