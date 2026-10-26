// SIL-509 UI drive — create-lot form alignment audit (owner ticket, 26/10).
//
// Claims measured (one rung-3 pass per claim, same page state):
//   1. "Số tờ khai" head label + chip field sit on the SAME baseline row as
//      the "Khách hàng" / "Hình thức xuất nhập khẩu" labels + controls
//      (onescreen ≥1280: declaration strip shares grid row 3 with --contact).
//   2. Topline actions (Hủy / Lưu nháp / Tạo lô hàng) are separated from the
//      "Nhận diện lô" section band by ≥ 12px.
//   3. Audit table: every identity-section field's label style + control
//      geometry, dumped for comparison.
//
// Evidence: qa/2026-10-26_sil509-alignment/*.png (grid overlay burned in) +
// measurements JSON on stdout. Usage:
//   cd frontend && node ../qa/scripts/2026-10-26-sil509-alignment-ui-drive.mjs
// Env: QA_BASE_URL (default http://localhost:7196), TAG (before|after).

import puppeteer from 'puppeteer';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const FE = process.env.QA_BASE_URL || 'http://localhost:7196';
const TAG = process.env.TAG || 'before';
const OUT = resolve(process.cwd(), '../qa/2026-10-26_sil509-alignment');
mkdirSync(OUT, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new',
  defaultViewport: { width: 1440, height: 900 },
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Real-form login (shared-context storage cleared first — /login redirects
// authenticated sessions to home).
async function login(user, pass) {
  const page = await browser.newPage();
  await page.goto(`${FE}/`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
  await page.goto(`${FE}/login`, { waitUntil: 'networkidle0', timeout: 30000 });
  await page.waitForSelector('input[name="username"]', { timeout: 30000 });
  await page.type('input[name="username"]', user);
  await page.type('input[name="password"]', pass);
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 20000 }).catch(() => {}),
    page.click('button[type="submit"]'),
  ]);
  if (page.url().includes('login')) throw new Error(`login failed for ${user}`);
  return page;
}

const page = await login('cus', 'Abc123');
await page.goto(`${FE}/shipments/new`, { waitUntil: 'networkidle2', timeout: 30000 });
await page.waitForFunction(() => document.body?.innerText?.includes('Nhận diện lô'), { timeout: 30000 });
// Let fonts/layout settle (Vite cold transform can shift once).
await sleep(800);

// ── measurements ────────────────────────────────────────────────────────────
const m = await page.evaluate(() => {
  const rect = (el) => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { top: +r.top.toFixed(1), bottom: +r.bottom.toFixed(1), left: +r.left.toFixed(1), right: +r.right.toFixed(1), height: +r.height.toFixed(1), width: +r.width.toFixed(1) };
  };
  /** Text line box of an element's first text run (baseline-accurate for
   *  same-font comparisons — DOM has no baseline API, tops+heights suffice). */
  const textRect = (el) => {
    if (!el) return null;
    const range = document.createRange();
    range.selectNodeContents(el);
    const r = range.getBoundingClientRect();
    return { top: +r.top.toFixed(1), bottom: +r.bottom.toFixed(1), height: +r.height.toFixed(1), text: (el.textContent ?? '').trim() };
  };
  const style = (el, props) => {
    if (!el) return null;
    const s = getComputedStyle(el);
    return Object.fromEntries(props.map((p) => [p, s.getPropertyValue(p)]));
  };
  const q = (sel) => document.querySelector(sel);
  let labelBoxes;

  // Req 1 — labels in the shared row (onescreen row 3) + the strip head.
  const labels = {
    customer: textRect(q('[data-field="shipment-customer"] label')),
    tradeDirection: textRect(q('[data-field-id="shipment-trade-direction"] label')),
    declarationTitle: textRect(q('.csc-declaration-strip__title')),
    booking: textRect(q('[data-field-id="shipment-booking-ref"] label')),
    flagsLabel: textRect(q('.csc-identity-grid__flags-label')),
  };
  const labelStyle = {
    customer: style(q('[data-field="shipment-customer"] label'), ['font-size', 'line-height', 'font-weight']),
    declarationTitle: style(q('.csc-declaration-strip__title'), ['font-size', 'line-height', 'font-weight']),
    declarationHeadAlign: style(q('.csc-declaration-strip__head'), ['align-items', 'height']),
  };
  // Req 1 — control boxes (the bordered input surfaces). [data-uui-control]
  // is the repo's boundary law element (control-geometry.css) — measure that,
  // plus the hand-rolled strip field.
  const controls = {
    customerBoundary: rect(q('[data-field="shipment-customer"] [data-uui-control]')),
    customerInput: rect(q('[data-field="shipment-customer"] input')),
    tradeDirectionBoundary: rect(q('[data-field-id="shipment-trade-direction"] [data-uui-control]')),
    declarationField: rect(q('.csc-declaration-strip__field')),
    declarationInput: rect(q('.csc-declaration-strip__input')),
    declarationCount: rect(q('.csc-declaration-strip__count')),
    declarationActions: rect(q('.csc-declaration-strip__actions')),
    bookingBoundary: rect(q('[data-field-id="shipment-booking-ref"] [data-uui-control]')),
    shippingLineBoundary: rect(q('[data-field-id="shipment-shipping-line"] [data-uui-control]')),
  };
  const controlStyle = {
    customerBoundary: style(q('[data-field="shipment-customer"] [data-uui-control]'), ['height', 'min-height', 'border-radius', 'border-width']),
    declarationField: style(q('.csc-declaration-strip__field'), ['padding-top', 'padding-bottom', 'border-radius', 'border-width', 'min-height']),
  };
  // The visible trade-direction label rides the UUI labeled wrapper — not the
  // hidden native select (whose options poisoned the first pass). Pick the
  // first actually-rendered label under the wrapper.
  const tdWrapEl = q('[data-field-id="shipment-trade-direction"]');
  labels.tradeDirectionVisible = textRect(q('[data-field-id="shipment-trade-direction"] .ds-uui-select > label')
    ?? tdWrapEl?.querySelector('label'));
  // Element-box comparison (apples-to-apples with the strip title): the
  // customer Label is a flex row whose range union inflates by the required
  // asterisk span — the BOX top is the alignment contract, not the range.
  labelBoxes = {
    customer: rect(q('[data-field="shipment-customer"] label')),
    // The select's visible label is wrapped in quirky internals (hidden
    // native select + template); its wrapper box IS the row-top anchor —
    // first rendered content sits at the wrapper top (see PNG crop).
    tradeDirection: rect(q('[data-field-id="shipment-trade-direction"] .ds-uui-select')),
    tradeDirectionIsWrapperProxy: true,
    declarationTitle: rect(q('.csc-declaration-strip__title')),
    declarationHead: rect(q('.csc-declaration-strip__head')),
  };

  // Req 2 — topline actions vs identity section band.
  const toplineActions = rect(q('.csc-topline__actions'));
  const topline = rect(q('.csc-topline'));
  const identityHeading = rect(q('#shipment-section-identity .csc-section__heading'));
  const identitySection = rect(q('#shipment-section-identity'));
  const toplineStyle = style(q('.csc-topline'), ['margin-bottom']);

  // Req 3 — audit every identity-section field: label text metrics + control
  // geometry, keyed by data-field-id (strip included).
  const audit = [...document.querySelectorAll('#shipment-section-identity [data-field-id], #shipment-section-identity .csc-declaration-strip')].map((wrap) => {
    const id = wrap.getAttribute('data-field-id') ?? 'csc-declaration-strip';
    const labelEl = wrap.querySelector('label') ?? wrap.querySelector('.csc-declaration-strip__title') ?? wrap.querySelector('.csc-identity-grid__flags-label');
    const controlEl = wrap.querySelector('input:not([type="checkbox"]), select, .csc-declaration-strip__field');
    return {
      field: id,
      label: textRect(labelEl),
      labelStyle: style(labelEl, ['font-size', 'line-height', 'font-weight']),
      control: rect(controlEl),
      controlStyle: style(controlEl, ['height', 'border-radius', 'font-size', 'padding-top', 'padding-bottom']),
    };
  });

  // Grid geometry of the identity section (row edges) for the audit.
  const rows = {};
  const contact = q('.csc-identity-grid--contact');
  const refs = q('.csc-identity-grid--refs');
  const choices = q('.csc-identity-grid--choices');
  const strip = q('.csc-declaration-strip');
  rows.contact = rect(contact);
  rows.refs = rect(refs);
  rows.choices = rect(choices);
  rows.strip = rect(strip);

  return { labels, labelBoxes, labelStyle, controls, controlStyle, toplineActions, topline, identityHeading, identitySection, toplineStyle, audit, rows, viewport: { w: innerWidth, h: innerHeight, dpr: devicePixelRatio, scrollGap: document.documentElement.scrollHeight - innerHeight } };
});

// ── 1280×800 no-scroll pass (onescreen law §5 vs the new 12px topline gap) ──
await page.setViewport({ width: 1280, height: 800 });
await sleep(400);
const tight = await page.evaluate(() => ({
  viewport: { w: innerWidth, h: innerHeight },
  scrollGap: document.documentElement.scrollHeight - innerHeight,
  toplineGap: (() => {
    const a = document.querySelector('.csc-topline__actions')?.getBoundingClientRect();
    const h = document.querySelector('#shipment-section-identity .csc-section__heading')?.getBoundingClientRect();
    return a && h ? +(h.top - a.bottom).toFixed(1) : null;
  })(),
}));
m.tight1280x800 = tight;
await page.setViewport({ width: 1440, height: 900 });
await sleep(400);

// ── grid overlay + screenshots (evidence burned into the PNG) ───────────────
await page.evaluate((m) => {
  const ov = document.createElement('div');
  ov.id = 'qa-grid-overlay';
  ov.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:99999;';
  // 8px minor grid + 40px major grid, subtle.
  ov.style.background = [
    'repeating-linear-gradient(to bottom, rgba(30,60,120,0.10) 0 1px, transparent 1px 8px)',
    'repeating-linear-gradient(to right, rgba(30,60,120,0.10) 0 1px, transparent 1px 8px)',
    'repeating-linear-gradient(to bottom, rgba(30,60,120,0.22) 0 1px, transparent 1px 40px)',
    'repeating-linear-gradient(to right, rgba(30,60,120,0.22) 0 1px, transparent 1px 40px)',
  ].join(',');
  document.body.appendChild(ov);
  // Guide lines at the measured edges (label tops + control tops), colored.
  const guides = [
    { y: m.labels.customer?.top, color: '#d93025', tag: 'label KH top' },
    { y: m.labels.tradeDirectionVisible?.top, color: '#e37400', tag: 'label XNK top' },
    { y: m.labels.declarationTitle?.top, color: '#188038', tag: 'label TK top' },
    { y: m.controls.customerBoundary?.top, color: '#d93025', tag: 'input KH top' },
    { y: m.controls.tradeDirectionBoundary?.top, color: '#e37400', tag: 'input XNK top' },
    { y: m.controls.declarationField?.top, color: '#188038', tag: 'input TK top' },
    { y: m.toplineActions?.bottom, color: '#9334e6', tag: 'actions bottom' },
    { y: m.identityHeading?.top, color: '#9334e6', tag: 'band top' },
  ].filter((g) => Number.isFinite(g.y));
  for (const g of guides) {
    const line = document.createElement('div');
    line.style.cssText = `position:fixed;left:0;right:0;top:${g.y}px;height:1px;background:${g.color};z-index:100000;`;
    const tagEl = document.createElement('span');
    tagEl.textContent = `${g.tag} @${g.y}`;
    tagEl.style.cssText = `position:fixed;left:4px;top:${g.y - 12}px;background:${g.color};color:#fff;font:600 9px/12px monospace;padding:0 3px;z-index:100001;border-radius:2px;`;
    ov.appendChild(line);
    ov.appendChild(tagEl);
  }
}, m);

await page.screenshot({ path: resolve(OUT, `sil509-form-1440-${TAG}-grid.png`) });
const section = await page.$('#shipment-section-identity');
if (section) await section.screenshot({ path: resolve(OUT, `sil509-identity-section-${TAG}-grid.png`) });

// Zoomed crop: topline actions + identity band + shared row (top ~420px of page).
await page.screenshot({
  path: resolve(OUT, `sil509-alignment-zone-1440-${TAG}.png`),
  clip: { x: 0, y: 0, width: 1440, height: 460 },
});

// Verdicts computed from the same measurement set (no re-query drift).
const verdict = {
  req2_gap_px: +(m.identityHeading.top - m.toplineActions.bottom).toFixed(1),
  req2_pass: m.identityHeading.top - m.toplineActions.bottom >= 12,
  req1_labelTopDelta_px: {
    box_customer_vs_declaration: +(m.labelBoxes.declarationTitle.top - m.labelBoxes.customer.top).toFixed(1),
    box_tradeDirection_vs_declaration: +(m.labelBoxes.declarationTitle.top - (m.labelBoxes.tradeDirection?.top ?? NaN)).toFixed(1),
    range_customer_vs_declaration: +(m.labels.declarationTitle.top - m.labels.customer.top).toFixed(1),
  },
  req1_controlTopDelta_px: {
    customerBoundary_vs_declarationField: +(m.controls.declarationField.top - m.controls.customerBoundary.top).toFixed(1),
    tradeDirectionBoundary_vs_declarationField: +(m.controls.declarationField.top - m.controls.tradeDirectionBoundary.top).toFixed(1),
  },
  req1_controlHeights_px: {
    customerBoundary: m.controls.customerBoundary?.height,
    tradeDirectionBoundary: m.controls.tradeDirectionBoundary?.height,
    declarationField: m.controls.declarationField?.height,
  },
  onescreen_1280x800: m.tight1280x800,
};

writeFileSync(resolve(OUT, `sil509-measurements-${TAG}.json`), JSON.stringify({ tag: TAG, verdict, ...m }, null, 2));
console.log(JSON.stringify(verdict, null, 2));
await browser.close();
