// Re-verify TC-COPY-PLACE-02 after COPY-PLACE-02-D1 (icon covered the tail of
// the container number): the icon must now sit in the ordinal's slot and never
// intersect the container-number glyphs.
import puppeteer from 'puppeteer';
import { mkdirSync, writeFileSync } from 'fs';

const BASE = 'http://localhost:7174';
const API = 'http://localhost:3001/api';
const SHIPMENT_ID = Number(process.env.SHIPMENT_ID || 41987);
const SUFFIX = process.env.SEARCH_SUFFIX || 'QACOPY-1789696973253';

mkdirSync('qa', { recursive: true });
const ts = new Date().toISOString().replace(/[:.]/g, '-');
const LOGFILE = `qa/${ts}_local-ledger-copy-icon_ui-driver.log`;
const lines = [];
const log = (s) => { console.log(s); lines.push(s); writeFileSync(LOGFILE, lines.join('\n') + '\n'); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const r = await fetch(`${API}/auth/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ identifier: 'thanhdc', password: 'Abc123' }),
});
const { token } = await r.json();
log(`login thanhdc ok (shipment ${SHIPMENT_ID}, search ${SUFFIX})`);

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);
  await page.goto(`${BASE}/shipments?searchSuffix=${SUFFIX}`, { waitUntil: 'networkidle2', timeout: 30000 });
  await page.waitForSelector(`#cus-dashboard-detail-${SHIPMENT_ID}`, { timeout: 20000 });
  await page.click(`#cus-dashboard-detail-${SHIPMENT_ID}`);
  await page.waitForSelector(`#cus-detail-drawer-${SHIPMENT_ID} .cus-container-row__copy`, { timeout: 20000 });
  await sleep(800);
  log('drawer + ledger rows loaded');

  const probe = await page.evaluate(() => {
    const rowWithCopy = document.querySelector('.cus-container-row:has(.cus-container-row__copy)');
    const button = rowWithCopy.querySelector('.cus-container-row__copy');
    const strong = rowWithCopy.querySelector('.cus-container-cell--identity strong');
    const ordinal = rowWithCopy.querySelector('.cus-container-row__ordinal');
    const trigger = rowWithCopy.querySelector('.cus-appointment-trigger');
    const rect = (n) => { const b = n.getBoundingClientRect(); return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) }; };
    // real glyph boxes, not the stretched grid item box
    const range = document.createRange();
    range.selectNodeContents(strong);
    const glyphs = Array.from(range.getClientRects()).map((b) => ({ x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) }));
    const intersects = (a, b) => !(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y);
    const bRect = rect(button);
    const cs = getComputedStyle(button);
    const oc = getComputedStyle(ordinal);
    const tr = trigger.getBoundingClientRect();
    return {
      buttonRect: bRect,
      buttonVisibility: cs.visibility,
      buttonShape: { radius: cs.borderRadius, border: cs.borderTopWidth + ' ' + cs.borderTopColor, background: cs.backgroundColor },
      ordinalText: ordinal.textContent, ordinalVisibility: oc.visibility, ordinalRect: rect(ordinal),
      containerNumber: strong.textContent, glyphRects: glyphs,
      copyOverlapsGlyphs: glyphs.some((g) => intersects(bRect, g)),
      copyOverlapsTrigger: intersects(bRect, rect(trigger)),
      triggerText: trigger.textContent.trim(),
      triggerTopElementInside: (document.elementFromPoint(tr.x + tr.width / 2, tr.y + tr.height / 2)?.closest('.cus-appointment-trigger') !== null),
      copyInIdentityCell: Boolean(button.closest('th.cus-container-cell--identity')),
      buttonsInAppointmentCell: document.querySelectorAll('.cus-appointment-cell button').length,
    };
  });
  log('hover probe: ' + JSON.stringify(probe, null, 2));

  const drawer = await page.$(`#cus-detail-drawer-${SHIPMENT_ID}`);
  const box = await drawer.boundingBox();
  await page.screenshot({ path: `qa/${ts}_ledger-copy-icon-hover.png` });
  await page.screenshot({ path: `qa/${ts}_ledger-copy-icon-clip.png`, clip: { x: box.x, y: box.y, width: box.width, height: Math.min(box.height, 420) } });

  // hover the source row explicitly, then click the icon
  await page.hover('.cus-container-row:has(.cus-container-row__copy)');
  await sleep(300);
  const afterHover = await page.evaluate(() => {
    const row = document.querySelector('.cus-container-row:has(.cus-container-row__copy)');
    const b = row.querySelector('.cus-container-row__copy');
    const strong = row.querySelector('.cus-container-cell--identity strong');
    const range = document.createRange(); range.selectNodeContents(strong);
    const glyphs = Array.from(range.getClientRects()).map((x) => ({ x: Math.round(x.x), y: Math.round(x.y), w: Math.round(x.width), h: Math.round(x.height) }));
    const bb = b.getBoundingClientRect();
    const br = { x: Math.round(bb.x), y: Math.round(bb.y), w: Math.round(bb.width), h: Math.round(bb.height) };
    const intersects = (a, c) => !(a.x + a.w <= c.x || c.x + c.w <= a.x || a.y + a.h <= c.y || c.y + c.h <= a.y);
    return {
      visibility: getComputedStyle(b).visibility,
      ordinalVisibility: getComputedStyle(row.querySelector('.cus-container-row__ordinal')).visibility,
      copiesVisible: [...document.querySelectorAll('.cus-container-row__copy')].filter((n) => getComputedStyle(n).visibility === 'visible').length,
      copyOverlapsGlyphs: glyphs.some((g) => intersects(br, g)),
    };
  });
  log('after hover: ' + JSON.stringify(afterHover));
  await page.screenshot({ path: `qa/${ts}_ledger-copy-icon-row-hover.png` });

  await page.click('.cus-container-row:has(.cus-container-row__copy) .cus-container-row__copy');
  await sleep(900);
  const afterClick = await page.evaluate(() => ({
    triggerTexts: [...document.querySelectorAll('.cus-appointment-trigger')].map((n) => n.textContent.trim()),
    toast: [...document.querySelectorAll('[role="status"]')].map((n) => n.innerText.trim()).filter(Boolean),
    copyAffordancesLeft: document.querySelectorAll('.cus-container-row__copy').length,
  }));
  log('after click: ' + JSON.stringify(afterClick, null, 2));
  await page.screenshot({ path: `qa/${ts}_ledger-copy-icon-after-click.png` });
  log('artifact log: ' + LOGFILE);
} finally {
  await browser.close();
}
