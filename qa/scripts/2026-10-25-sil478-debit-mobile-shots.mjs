// SIL-478 — /shipments-debit mobile card list evidence (LOCAL ONLY).
// Captures the phone presentation at 390/768 BEFORE and AFTER the row rebuild,
// plus a mechanical DOM probe: which presentation rendered (record cards vs the
// desktop matrix), the status chip's computed font-family (the audit's "script
// font" claim), and the left-block's text content (the audit's "empty left"
// claim) so the diagnosis rides evidence, not guesswork.
// Run: node qa/scripts/2026-10-25-sil478-debit-mobile-shots.mjs --label before
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';

const label = process.argv.includes('--label')
  ? process.argv[process.argv.indexOf('--label') + 1]
  : 'before';
const FRONT = process.env.FRONT_URL ?? 'http://localhost:7175';
const API = process.env.API_URL ?? 'http://localhost:3002/api';
const WIDTHS = (process.env.WIDTHS ?? '390,768').split(',').map(Number);
const ROLES = (process.env.ROLES ?? 'cus,ketoan').split(',');
const OUT = path.resolve(process.env.OUT_DIR ?? 'qa/2026-10-25-sil478');
fs.mkdirSync(OUT, { recursive: true });
const LOG = path.join(OUT, `driver-${label}.log`);
fs.writeFileSync(LOG, '');
const log = (line) => { console.log(line); fs.appendFileSync(LOG, line + '\n'); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const health = await fetch(`${API}/health`).then((r) => r.json()).catch(() => null);
log(`HEALTH status=${health?.status} api=${API} front=${FRONT}`);
if (health?.status !== 'ok') { log('ABORT: local API health not ok'); process.exit(2); }

const browser = await puppeteer.launch({ headless: true });

for (const role of ROLES) {
  const loginRes = await fetch(`${API}/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier: role, password: 'Abc123' }),
  });
  if (!loginRes.ok) { log(`ABORT role=${role}: login failed (${loginRes.status})`); continue; }
  const { token } = await loginRes.json();
  log(`LOGIN ok role=${role}`);
  const page = await browser.newPage();
  await page.evaluateOnNewDocument((t) => { if (location.origin.startsWith('http://localhost')) localStorage.setItem('token', t); }, token);
  for (const width of WIDTHS) {
    await page.setViewport({ width, height: 844, isMobile: width < 700, hasTouch: width < 700 });
    await page.goto(`${FRONT}/shipments-debit`, { waitUntil: 'networkidle2', timeout: 60000 });
    try {
      await page.waitForSelector('.shipment-debit-workspace', { timeout: 30000 });
      // The rows ride the summary query — wait for either presentation to paint.
      await page.waitForSelector('.ledger-glist__item, .shipment-debit-table tbody tr, .ledger-record-list__empty', { timeout: 30000 });
    } catch { log(`WARN ${width}: no workspace — capturing viewport anyway`); }
    // Let the summary query land (cards or table paint after it).
    await sleep(1500);
    await page.screenshot({ path: path.join(OUT, `debit-${role}-${width}-${label}.png`), fullPage: false });
    const probe = await page.evaluate(() => {
      const recordCards = document.querySelectorAll('.ledger-glist__item, .ledger-record');
      const matrix = document.querySelector('.shipment-debit-table');
      const chip = document.querySelector('.ledger-glist__chip') ?? document.querySelector('.shipment-debit-status');
      const card = recordCards[0] ?? null;
      const chipStyle = chip ? ((el) => { const s = getComputedStyle(el); return { fontFamily: s.fontFamily.slice(0, 30), fontSize: s.fontSize, height: s.height, background: s.backgroundColor, color: s.color, radius: s.borderRadius }; })(chip) : null;
      const leftText = card ? (card.querySelector('.ledger-glist__name, .panel__title')?.textContent ?? '') + ' | ' + (card.querySelector('.ledger-glist__meta, .panel__subtitle')?.textContent ?? '') : null;
      const row = card?.querySelector('.ledger-glist__row') ?? null;
      const rowStyle = row ? ((el) => { const s = getComputedStyle(el); return { display: s.display, cols: s.gridTemplateColumns, minHeight: s.minHeight, height: Math.round(el.getBoundingClientRect().height) }; })(row) : null;
      return {
        viewport: { w: innerWidth, h: innerHeight },
        recordCardCount: recordCards.length,
        matrixRendered: !!matrix && getComputedStyle(matrix).display !== 'none',
        firstCardLeftText: leftText,
        rowStyle,
        amountText: card?.querySelector('.ledger-glist__amount')?.textContent ?? null,
        chip: chipStyle,
        kebabCount: document.querySelectorAll('.shipment-debit-menu__trigger').length,
      };
    });
    log(`PROBE role=${role} w=${width} ${JSON.stringify(probe)}`);
  }
  await page.close();
}
await browser.close();
log(`DONE label=${label}`);
