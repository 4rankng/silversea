#!/usr/bin/env node
/**
 * SIL-835 — Chốt Debit 1440px geometry + access-matrix verification driver.
 * Usage: node testplan/qa/scripts/2026-11-16-sil835-ui-verify.mjs
 *  - hoapt (ACCOUNTANT, the role the ticket's named CUS role was substituted
 *    with per the SIL-825 access-matrix pin — CUS never had this route):
 *      /accounting/chot-debit at 1440x900: 9 columns, LỢI NHUẬN + GHI CHÚ
 *      fully inside the viewport, NO horizontal scroll.
 *  - tiepvv (CUS): /accounting/chot-debit shows the denial notice and never
 *    renders the board (the SIL-825 by-design pin, quoted in the board comment).
 */
import { login, DEFAULT_FRONTEND, DEFAULT_BACKEND } from '../../../scripts/lib/http.mjs';
import { withSession, STANDARD_BROWSER_ARGS } from '../../../scripts/lib/ui-driver.mjs';
import { mkdirSync } from 'node:fs';

const DIR = 'qa/2026-11-16_sil835';
mkdirSync(DIR, { recursive: true });

const MEASURE_GRID = () => {
  const out = { denied: false, title: null };
  if (document.body.textContent.includes('Bạn không có quyền truy cập trang này.')) out.denied = true;
  const h1 = [...document.querySelectorAll('h1, h2')].find((e) => (e.textContent || '').includes('KIỂM SOÁT LÔ HÀNG'));
  out.title = h1 ? h1.textContent.trim().slice(0, 40) : null;
  const scroller = [...document.querySelectorAll('*')].find((el) => el.scrollWidth > el.clientWidth + 1 && el.clientWidth > 500 && getComputedStyle(el).overflowX !== 'visible');
  out.hScroll = scroller ? { tag: scroller.tagName + '.' + (scroller.className || '').toString().split(' ')[0], scrollW: scroller.scrollWidth, clientW: scroller.clientWidth } : null;
  const headers = [...document.querySelectorAll('th, [role="columnheader"]')].map((e) => (e.textContent || '').trim()).filter(Boolean);
  out.headers = headers.slice(0, 14);
  const loiNhuan = [...document.querySelectorAll('th, [role="columnheader"], strong, span')].find((e) => (e.textContent || '').trim().startsWith('LỢI NHUẬN'));
  const ghiChu = [...document.querySelectorAll('th, [role="columnheader"], strong, span')].find((e) => (e.textContent || '').trim().startsWith('GHI CHÚ'));
  const vw = window.innerWidth;
  out.edge = {
    viewport: vw,
    loiNhuan: loiNhuan ? Math.round(loiNhuan.getBoundingClientRect().right) : null,
    ghiChu: ghiChu ? Math.round(ghiChu.getBoundingClientRect().right) : null,
    docScrollW: document.documentElement.scrollWidth,
    docClientW: document.documentElement.clientWidth,
  };
  out.fullyVisible = !out.hScroll && out.edge.docScrollW <= out.edge.docClientW + 1
    && (out.edge.loiNhuan == null || out.edge.loiNhuan <= vw)
    && (out.edge.ghiChu == null || out.edge.ghiChu <= vw);
  return out;
};

const hoapt = await login('hoapt', { backend: DEFAULT_BACKEND, frontend: DEFAULT_FRONTEND });
await withSession(hoapt, async (page, ctx) => {
  await page.setViewport({ width: 1440, height: 900 });
  await page.goto(`${DEFAULT_FRONTEND}/accounting/chot-debit`, { waitUntil: 'networkidle2' });
  await new Promise((r) => setTimeout(r, 2500));
  const m1440open = await page.evaluate(MEASURE_GRID);
  await page.screenshot({ path: `${DIR}/sil835-1440-open-hoapt.png` });
  console.log('hoapt 1440 sidebar-open:', JSON.stringify(m1440open));
  ctx.log.push('hoapt 1440 open ' + JSON.stringify(m1440open));

  // close sidebar for the wide canvas
  await page.evaluate(() => {
    const app = document.querySelector('.app');
    const closed = app.classList.contains('sidebar-closed');
    if (!closed) {
      const btn = document.querySelector('button[aria-label*="điều hướng"], header button[aria-label*="menu"]');
      (btn || [...document.querySelectorAll('header button')].find((b) => (b.getAttribute('aria-label') || '').includes('menu')))?.click();
    }
  });
  await new Promise((r) => setTimeout(r, 900));
  const m1440closed = await page.evaluate(MEASURE_GRID);
  await page.screenshot({ path: `${DIR}/sil835-1440-closed-hoapt.png` });
  console.log('hoapt 1440 sidebar-closed:', JSON.stringify(m1440closed));
  ctx.log.push('hoapt 1440 closed ' + JSON.stringify(m1440closed));
}, { viewport: { width: 1440, height: 900 }, args: STANDARD_BROWSER_ARGS, artifactDir: 'qa', name: '2026-11-16_sil835-hoapt' });

const tiepvv = await login('tiepvv', { backend: DEFAULT_BACKEND, frontend: DEFAULT_FRONTEND });
await withSession(tiepvv, async (page, ctx) => {
  await page.setViewport({ width: 1440, height: 900 });
  await page.goto(`${DEFAULT_FRONTEND}/accounting/chot-debit`, { waitUntil: 'networkidle2' });
  await new Promise((r) => setTimeout(r, 2000));
  const m = await page.evaluate(MEASURE_GRID);
  const url = page.url();
  console.log('tiepvv (CUS):', JSON.stringify({ denied: m.denied, boardTitle: m.title, redirectedTo: url }));
  ctx.log.push('tiepvv ' + JSON.stringify({ denied: m.denied, boardTitle: m.title, url }));
}, { viewport: { width: 1440, height: 900 }, args: STANDARD_BROWSER_ARGS, artifactDir: 'qa', name: '2026-11-16_sil835-tiepvv' });
