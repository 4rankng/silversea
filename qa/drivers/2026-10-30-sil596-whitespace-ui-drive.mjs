// SIL-596 (id 696) — rung-3 evidence: whitespace on /shipments/new ≥1280.
// Drives the REAL create-lot form and MEASURES the boxes the ticket names:
//   - identity card vs workspace/content width (empty column inside the card)
//   - identity internal bands (--contact/--refs/--choices) — col-1-only pins
//   - the white gap below the rail (mode/freight/identity) to "Lịch & ghi chú"
//   - SIL-499 budget @1280×800: no vertical scrollbar
// Viewports: 1307×800 (ticket evidence), 1440×900, 390×844 (mobile card).
// LOCAL ONLY: vite 7175 → api 3002 (dev-port-contract). Read-only: no form submit.
import puppeteer from 'puppeteer';
import fs from 'node:fs';

const BASE = process.env.BASE ?? 'http://localhost:7175';
const API = `${BASE}/api`;
const TAG = process.env.TAG ?? 'before';
const OUT = process.env.EVIDENCE ?? `qa/2026-10-30_sil596-${TAG}`;
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let L = null;
for (let i = 1; i <= 3 && !L?.token; i++) {
  const t = await (await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier: 'admin', password: 'Abc123' }),
  })).text();
  try { L = JSON.parse(t); } catch { await sleep(1200 * i); }
}
if (!L?.token) { console.log('LOGIN FAILED as admin'); process.exit(1); }
console.log(`LOGIN OK (admin) — evidence dir ${OUT}`);

const browser = await puppeteer.launch({
  headless: 'new',
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--hide-scrollbars'],
});
const page = await browser.newPage();
await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), L.token);
page.on('pageerror', (err) => console.log(`PAGEERROR: ${err.message}`));

const MEASURE = () => {
  const box = (sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), right: Math.round(r.right), bottom: Math.round(r.bottom) };
  };
  const identityEl = document.querySelector('#shipment-section-identity');
  const identity = box('#shipment-section-identity');
  const mode = box('#shipment-section-mode');
  const schedule = box('#shipment-section-schedule');
  const route = box('#shipment-section-route');
  const freight = box('[data-freight-preview]');
  const contact = box('.csc-identity-grid--contact');
  const refs = box('.csc-identity-grid--refs');
  const choices = box('.csc-identity-grid--choices');
  const workspace = box('.csc-workspace');
  const body = document.querySelector('.app-body');
  const cs = identityEl ? getComputedStyle(identityEl) : null;
  const cols = cs ? cs.gridTemplateColumns : null;
  // identity internal: widest band right edge vs card content right edge → dead column
  let bandRight = 0;
  for (const b of [contact, refs, choices]) if (b) bandRight = Math.max(bandRight, b.right);
  const identityInnerRight = identity ? identity.right - 14 : 0; // card padding-right 14 (onescreen)
  return {
    viewport: { w: window.innerWidth, h: window.innerHeight },
    workspace, identity, mode, schedule, route, freight, contact, refs, choices,
    identityGridColumns: cols,
    identityDeadColumnPx: identity ? Math.max(0, identityInnerRight - bandRight) : null,
    contentRight: workspace ? workspace.right : null,
    gapBelowIdentityToNext: (() => {
      if (!identity) return null;
      const next = schedule ?? route;
      if (!next) return null;
      return Math.max(0, next.y - identity.bottom);
    })(),
    gapBelowRailCol1ToNext: (() => {
      if (!mode) return null;
      const next = schedule ?? route;
      if (!next) return null;
      return Math.max(0, next.y - mode.bottom);
    })(),
    scrollbar: body ? { scrollH: body.scrollHeight, clientH: body.clientHeight, overflowY: body.scrollHeight - body.clientHeight } : null,
  };
};

const results = {};
for (const vp of [
  { w: 1280, h: 800, name: '1280' },
  { w: 1307, h: 800, name: '1307' },
  { w: 1440, h: 900, name: '1440' },
  { w: 768, h: 900, name: '768' },
  { w: 390, h: 844, name: '390' },
]) {
  await page.setViewport({ width: vp.w, height: vp.h });
  await page.goto(`${BASE}/shipments/new`, { waitUntil: 'networkidle2', timeout: 45000 });
  await page.waitForSelector('#shipment-section-identity', { timeout: 20000 });
  await sleep(700);
  const m = await page.evaluate(MEASURE);
  results[vp.name] = m;
  await page.screenshot({ path: `${OUT}/ui-${TAG}-${vp.name}.png`, fullPage: false });
  const ident = m.identity;
  console.log(`\n== ${vp.name}x${m.viewport.h} ==`);
  console.log(`identity: ${JSON.stringify(ident)} deadColumnPx=${m.identityDeadColumnPx} gridCols=${m.identityGridColumns}`);
  console.log(`mode: ${JSON.stringify(m.mode)}`);
  console.log(`schedule: ${JSON.stringify(m.schedule)} route: ${JSON.stringify(m.route)} freight: ${JSON.stringify(m.freight)}`);
  console.log(`contact: ${JSON.stringify(m.contact)}\nrefs: ${JSON.stringify(m.refs)}\nchoices: ${JSON.stringify(m.choices)}`);
  console.log(`gapBelowIdentity→nextBand: ${m.gapBelowIdentityToNext} gapBelowMode→nextBand: ${m.gapBelowRailCol1ToNext} scrollbarOverflow: ${m.scrollbar?.overflowY}`);
}

fs.writeFileSync(`${OUT}/${TAG}-measurements.json`, JSON.stringify(results, null, 2));
await browser.close();
console.log(`\nDONE — measurements + screenshots in ${OUT}`);
