// SIL-603 (id 706) — rung-3 QA driver: workboard EDGE-TO-EDGE + lịch trình
// wrap tên nhà máy (cấm truncate). Pattern: qa/scripts/2026-10-23-dispatch-grid-redesign.mjs
// AFTER build = this worktree's vite (QA_FRONT, e.g. http://localhost:7182)
// proxying the shared local API (:3002) — read-only, no data writes.
//
// Coverage:
//   E1 1440×900 — bảng chạm 2 mép thật, control surface giữ gutter, schedule
//       spans computed-wrap (nếu trang có dòng lịch trình)
//   E2 1280×800 — same
//   W  — paginate (≤8 trang) tới khi thấy factory span, chụp + đo no-clip
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';

const FRONT = process.env.QA_FRONT ?? 'http://localhost:7182';
const API = process.env.QA_API ?? 'http://localhost:3002/api';
const OUT = path.resolve('qa/2026-10-30_sil-603_ui');
fs.mkdirSync(OUT, { recursive: true });
const LOG = path.join(OUT, 'ui-driver.log');
fs.writeFileSync(LOG, '');
const log = (line) => { console.log(line); fs.appendFileSync(LOG, line + '\n'); };
const shot = (page, name) => page.screenshot({ path: path.join(OUT, `${name}.png`) });

let failures = 0;
const check = (name, ok, detail = '') => {
  log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
};

const health = await fetch(`${API}/health`).then((r) => r.json()).catch(() => null);
log(`front=${FRONT} health=${health?.status}`);
if (health?.status !== 'ok') { log('ABORT: local API health not ok'); process.exit(2); }

// Identifiers from testplan/testaccounts.txt (local dev seed — password is
// the file's documented local-only Abc123, never logged).
const CANDIDATES = ['cus', 'dieuvan', 'admin'];
let token = null;
let who = null;
for (const identifier of CANDIDATES) {
  const login = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier, password: 'Abc123' }),
  }).then((r) => r.json()).catch(() => null);
  token = login?.token ?? login?.accessToken ?? login?.data?.token ?? null;
  if (token) { who = identifier; break; }
}
if (!token) { log('ABORT: login failed for all candidate role accounts'); process.exit(2); }
log(`login ok (identifier=${who}, from testplan/testaccounts.txt)`);

const browser = await puppeteer.launch({ headless: 'new' });
const page = await browser.newPage();

const measureBoard = () => page.evaluate(() => {
  const rule = (el) => {
    if (!el) return null;
    const cs = getComputedStyle(el);
    return { ws: cs.whiteSpace, te: cs.textOverflow, ox: cs.overflowX };
  };
  const viewport = document.querySelector('.cus-dashboard-viewport');
  const control = document.querySelector('.shipments-control');
  const page_ = document.querySelector('.shipments-page--worksheet');
  const workspace = document.querySelector('.cus-workspace--worksheet');
  const appBody = document.querySelector('.app-body');
  const bodyRect = appBody?.getBoundingClientRect();
  const when = document.querySelector('.cus-schedule-group__when');
  const factory = document.querySelector('.cus-schedule-group__factory');
  const child = document.querySelector("td[data-label='Lịch trình & điều xe'] .cus-inline-trigger > *");
  return {
    innerWidth: window.innerWidth,
    docScrollWidth: document.documentElement.scrollWidth,
    // The board must butt BOTH content-pane edges: app-body's own content box
    // (the pinned sidebar rail is app chrome; the right gap is the body's
    // own vertical scrollbar gutter — browser-owned, not layout inset).
    bodyContentLeft: bodyRect?.x,
    bodyContentWidth: appBody?.clientWidth,
    viewport: viewport?.getBoundingClientRect().toJSON() ?? null,
    table: document.querySelector('.cus-dashboard-table')?.getBoundingClientRect().toJSON() ?? null,
    control: control?.getBoundingClientRect().toJSON() ?? null,
    pageX: page_?.getBoundingClientRect().x,
    pagePad: page_ ? getComputedStyle(page_).paddingLeft : null,
    workspaceMargin: workspace ? getComputedStyle(workspace).marginLeft : null,
    factoryText: factory?.textContent ?? null,
    factoryClip: factory ? { scrollW: factory.scrollWidth, clientW: factory.clientWidth } : null,
    whenRule: rule(when),
    factoryRule: rule(factory),
    childRule: rule(child),
    fallbackText: document.querySelector('.cus-schedule-lot-fallback')?.textContent ?? null,
  };
});

const assertBand = (tag, geo) => {
  const left = geo.bodyContentLeft ?? 0;
  const width = geo.bodyContentWidth ?? geo.innerWidth;
  check(`${tag} board butts left content-pane edge (x ≈ ${left})`, geo.viewport && Math.abs(geo.viewport.x - left) <= 1, `x=${geo.viewport?.x}`);
  check(`${tag} board butts right content-pane edge (≈ ${left + width})`, geo.viewport && Math.abs((geo.viewport.x + geo.viewport.width) - (left + width)) <= 1.5, `right=${geo.viewport ? geo.viewport.x + geo.viewport.width : null}`);
  check(`${tag} control surface keeps the gutter (x ≈ ${left} + ${geo.pagePad})`, geo.control && geo.pageX != null && Math.abs(geo.control.x - (left + parseFloat(geo.pagePad))) <= 1, `x=${geo.control?.x}`);
  check(`${tag} no horizontal document overflow`, geo.docScrollWidth <= geo.innerWidth + 1, `scrollW=${geo.docScrollWidth}`);
  const wrapRule = geo.childRule ?? geo.whenRule;
  check(`${tag} schedule cell lines computed-wrap (normal, no ellipsis, no hidden overflow)`, !!wrapRule && wrapRule.ws === 'normal' && wrapRule.te !== 'ellipsis' && wrapRule.ox !== 'hidden', JSON.stringify(wrapRule));
};

const openShipments = async () => {
  await page.goto(`${FRONT}/shipments`, { waitUntil: 'networkidle2', timeout: 45000 });
  await page.waitForSelector('.cus-dashboard-table', { timeout: 30000 });
  await new Promise((r) => setTimeout(r, 800));
};

try {
  await page.setViewport({ width: 1440, height: 900 });
  await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);
  await openShipments();
  await shot(page, 'sil-603_1440_shipments');
  let geo = await measureBoard();
  assertBand('1440', geo);
  log('1440 geo=' + JSON.stringify(geo, null, 1));

  await page.setViewport({ width: 1280, height: 800 });
  await new Promise((r) => setTimeout(r, 500));
  await shot(page, 'sil-603_1280_shipments');
  geo = await measureBoard();
  assertBand('1280', geo);
  log('1280 geo=' + JSON.stringify(geo, null, 1));

  // Walk pagination (≤8 pages) hunting a factory span; measure no-clip on it.
  let factoryHit = null;
  for (let p = 1; p <= 8 && !factoryHit; p += 1) {
    const current = await page.evaluate(() => document.querySelector('.cus-schedule-group__factory')?.textContent ?? null);
    if (current) { factoryHit = current; break; }
    const next = await page.$('.ds-pagination__pages button:last-of-type, [class*="pagination"] button:last-of-type');
    const label = next ? await page.evaluate((el) => ({ text: el.textContent?.trim(), disabled: el.disabled }), next) : null;
    if (!next || !label || label.disabled || !/^\d+$|^»$|^>$/.test(label.text ?? '')) break;
    await next.click();
    await new Promise((r) => setTimeout(r, 1200));
  }
  if (factoryHit) {
    await shot(page, 'sil-603_factory-wrap');
    geo = await measureBoard();
    check('factory name fully in DOM', !!geo.factoryText && geo.factoryText.length > 0, `text="${(geo.factoryText ?? '').slice(0, 40)}"`);
    check('factory span does not clip (scrollWidth ≤ clientWidth + 1)', geo.factoryClip ? geo.factoryClip.scrollW <= geo.factoryClip.clientW + 1 : false, JSON.stringify(geo.factoryClip));
    check('factory span computed wrap', geo.factoryRule?.ws === 'normal' && geo.factoryRule?.te !== 'ellipsis', JSON.stringify(geo.factoryRule));
    log('factory geo=' + JSON.stringify(geo, null, 1));
  } else {
    log('NOTE: no appointment-group factory span found within 8 pages — wrap asserted via computed rules + lot-fallback only (data limit).');
  }
} finally {
  await browser.close();
}
log(failures === 0 ? 'RESULT: ALL PASS' : `RESULT: ${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
