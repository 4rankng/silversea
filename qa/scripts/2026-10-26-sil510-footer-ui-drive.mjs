// SIL-510 UI drive — the ONE action bar of the Tạo lô hàng worksheet.
//
// Owner 26/10 SPEC (board 572, comment 2021):
//   (1) the footer action bar is viewport-fixed bottom — always visible while
//       scrolling (asserted at scroll TOP and scroll BOTTOM @1440×900);
//   (2) the bar is ONE row (~56-60px incl. 10px padding), actions
//       right-aligned, no tall empty block (bar hugs the viewport edge);
//   (4) ONE action bar per viewport — the topline carries no buttons.
// Read-only drive: the sweep must issue NO mutating API call (SPEC is
// layout-only), so the captured /api traffic doubles as the persisted-state
// identity evidence.
//
// Usage: cd frontend && node ../qa/scripts/2026-10-26-sil510-footer-ui-drive.mjs
// Output: ../qa/2026-10-26_sil510-footer-sticky/*.png + assertions JSON on stdout.

import puppeteer from 'puppeteer';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const FE = process.env.QA_BASE_URL || 'http://localhost:7196';
const OUT = resolve(process.cwd(), '../qa/2026-10-26_sil510-footer-sticky');
mkdirSync(OUT, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new',
  defaultViewport: { width: 1440, height: 900 },
});

const results = { A_scrollTop_1440: {}, B_scrollBottom_1440: {}, C_phone_390: {}, api: {} };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Login through the real form, capturing every /api call of the session. */
async function login(user, pass) {
  const page = await browser.newPage();
  const apiCalls = [];
  page.on('request', (r) => {
    const url = new URL(r.url());
    if (url.pathname.startsWith('/api/')) apiCalls.push(`${r.method()} ${url.pathname}`);
  });
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
  return { page, apiCalls };
}

/** The one law every viewport asserts: fixed bottom bar, one row, right
 *  buttons, topline empty. */
async function assertBar(page, label) {
  return page.evaluate((label) => {
    const bar = document.querySelector('.csc-form-actions');
    if (!bar) throw new Error('no .csc-form-actions on the page');
    const rect = bar.getBoundingClientRect();
    const cs = getComputedStyle(bar);
    const buttons = [...bar.querySelectorAll('button')];
    const topline = document.querySelector('.csc-topline');
    const bars = document.querySelectorAll('.csc-form-actions').length;
    const group = bar.querySelector('[role="group"]');
    const rows = new Set(buttons.map((b) => Math.round(b.getBoundingClientRect().top)));
    return {
      label,
      position: cs.position,
      pinnedToViewportBottom: Math.abs(rect.bottom - window.innerHeight) <= 2,
      barHeightPx: Math.round(rect.height),
      oneRow: rect.height <= 68 && rows.size === 1,
      rightAligned: Math.abs(rect.right - buttons[buttons.length - 1].getBoundingClientRect().right) <= 20,
      buttons: buttons.map((b) => b.textContent?.trim()),
      toplineButtonCount: topline ? topline.querySelectorAll('button').length : -1,
      actionBarInstances: bars,
      groupAriaLabel: group?.getAttribute('aria-label') ?? null,
    };
  }, label);
}

// ── A+B. desktop 1440×900 — scroll top, then scroll bottom ─────────────────
{
  const { page, apiCalls } = await login('cus', 'Abc123');
  await page.setViewport({ width: 1440, height: 900 });
  await page.goto(`${FE}/shipments/new`, { waitUntil: 'networkidle2', timeout: 30000 });
  await page.waitForFunction(() => document.querySelector('h1')?.textContent?.includes('Tạo lô hàng'), { timeout: 20000 });
  await page.waitForSelector('.csc-form-actions', { timeout: 20000 });
  await sleep(600); // fonts + freight preview settle

  results.A_scrollTop_1440 = await assertBar(page, 'scroll-top');
  await page.screenshot({ path: resolve(OUT, '01-top-1440.png') });

  // Scroll the shell scroller to its very end (scroll-behavior: smooth on
  // .app-body — force instant so the assertion reads the settled state).
  await page.evaluate(() => {
    const scroller = document.querySelector('.app-body');
    scroller.scrollTo({ top: scroller.scrollHeight, behavior: 'instant' });
  });
  await sleep(400);

  results.B_scrollBottom_1440 = {
    ...(await assertBar(page, 'scroll-bottom')),
    scroller: await page.evaluate(() => {
      const scroller = document.querySelector('.app-body');
      const bar = document.querySelector('.csc-form-actions').getBoundingClientRect();
      const cargo = document.querySelector('#shipment-section-cargo')?.getBoundingClientRect();
      const add = [...document.querySelectorAll('button')].find((b) => b.textContent?.includes('Thêm container'));
      return {
        scrollTop: Math.round(scroller.scrollTop),
        scrollHeight: scroller.scrollHeight,
        clientHeight: scroller.clientHeight,
        noVerticalScrollbar: scroller.scrollHeight <= scroller.clientHeight + 2,
        cargoBottom: cargo ? Math.round(cargo.bottom) : null,
        barTop: Math.round(bar.top),
        addContainerVisible: add ? add.getBoundingClientRect().bottom <= bar.top + 4 : null,
      };
    }),
  };
  await page.screenshot({ path: resolve(OUT, '02-bottom-1440.png') });

  results.api.desktop = apiCalls;
  await page.close();
}

// ── C. phone 390×844 — the bar stays EXACTLY one row (flex-fill law) ───────
{
  const page = await browser.newPage();
  const apiCalls = [];
  page.on('request', (r) => {
    const url = new URL(r.url());
    if (url.pathname.startsWith('/api/')) apiCalls.push(`${r.method()} ${url.pathname}`);
  });
  await page.setViewport({ width: 390, height: 844 });
  await page.goto(`${FE}/shipments/new`, { waitUntil: 'networkidle2', timeout: 30000 });
  await page.waitForFunction(() => document.querySelector('h1')?.textContent?.includes('Tạo lô hàng'), { timeout: 20000 });
  await page.waitForSelector('.csc-form-actions', { timeout: 20000 });
  await sleep(500);

  results.C_phone_390.top = await assertBar(page, '390-scroll-top');
  await page.screenshot({ path: resolve(OUT, '03-top-390.png') });
  await page.evaluate(() => {
    const scroller = document.querySelector('.app-body');
    scroller.scrollTo({ top: scroller.scrollHeight, behavior: 'instant' });
  });
  await sleep(400);
  results.C_phone_390.bottom = await assertBar(page, '390-scroll-bottom');
  await page.screenshot({ path: resolve(OUT, '04-bottom-390.png') });

  results.api.phone = apiCalls;
  await page.close();
}

await browser.close();

// ── Verdict ─────────────────────────────────────────────────────────────────
const problems = [];
for (const [key, r] of Object.entries(results.A_scrollTop_1440).length ? [['A', results.A_scrollTop_1440], ['B', results.B_scrollBottom_1440], ['C-top', results.C_phone_390.top], ['C-bottom', results.C_phone_390.bottom]] : []) {
  if (r.position !== 'fixed') problems.push(`${key}: position=${r.position}`);
  if (!r.pinnedToViewportBottom) problems.push(`${key}: bar not pinned to viewport bottom`);
  if (!r.oneRow) problems.push(`${key}: bar is not ONE row (height=${r.barHeightPx})`);
  if (!r.rightAligned) problems.push(`${key}: actions not right-aligned`);
  if (r.toplineButtonCount !== 0) problems.push(`${key}: topline still carries ${r.toplineButtonCount} buttons (duplicate bar)`);
  if (r.actionBarInstances !== 1) problems.push(`${key}: ${r.actionBarInstances} action bars on the page`);
  if (JSON.stringify(r.buttons) !== JSON.stringify(['Huỷ', 'Lưu nháp', 'Tạo lô hàng'])) problems.push(`${key}: buttons=${JSON.stringify(r.buttons)}`);
}
const scrollBottom = results.B_scrollBottom_1440.scroller ?? {};
if (scrollBottom.noVerticalScrollbar === false) problems.push('B: vertical scrollbar present at 1440 (SIL-499 law)');
if (scrollBottom.addContainerVisible === false) problems.push('B: fixed bar covers the Thêm container control at scroll-end');
// Read-only drive: no DATA mutation may fire. The one POST /api/auth/login is
// session establishment itself, not a persisted-state change.
const mutating = [...results.api.desktop ?? [], ...results.api.phone ?? []]
  .filter((c) => /^(POST|PATCH|PUT|DELETE) /.test(c))
  .filter((c) => !c.startsWith('POST /api/auth/'));
if (mutating.length) problems.push(`read-only drive violated: ${mutating.join(', ')}`);

writeFileSync(resolve(OUT, 'ui-drive-assertions.json'), `${JSON.stringify(results, null, 2)}\n`);
console.log(JSON.stringify(results, null, 2));
if (problems.length) {
  console.error(`ALL CHECKS FAIL:\n${problems.map((p) => ` - ${p}`).join('\n')}`);
  process.exit(1);
}
console.log('ALL CHECKS PASS');
