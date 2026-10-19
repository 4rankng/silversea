// FB-108 (kanban card 171026115830) — the create page must offer the three
// actions (Huỷ / Lưu nháp / Tạo lô hàng) a SECOND time at the foot of the
// worksheet, for both Hàng FCL and Hàng lẻ, so the operator never has to
// scroll back to the head to act.
//
// LOCAL ONLY: vite 7175 → api 3002. Role CUS (thanhdc).
//   node testplan/qa/scripts/2026-10-17-fb108-footer-actions-rung.mjs
// Exit 0 = every rung PASS.

import puppeteer from 'puppeteer';
import fs from 'node:fs';

const BASE = process.env.BASE ?? 'http://localhost:7175';
const API = `${BASE}/api`;
const SHOTS = process.env.SHOTS ?? '/tmp/fb108';
fs.mkdirSync(SHOTS, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
function record(rung, verdict, detail) {
  results.push({ rung, verdict, detail });
  console.log(`[${verdict}] ${rung} — ${detail}`);
}

async function loginWithRetry(id, attempts = 3) {
  for (let i = 1; i <= attempts; i++) {
    const res = await fetch(`${API}/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: id, password: 'Abc123' }),
    });
    const text = await res.text();
    if (res.ok && text) { try { return JSON.parse(text); } catch { /* retry */ } }
    await sleep(1500 * i);
  }
  throw new Error(`login ${id} failed`);
}

const login = await loginWithRetry('thanhdc');
console.log(`logged in as ${login.user?.username} (${login.user?.role})`);

const browser = await puppeteer.launch({
  headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage', '--hide-scrollbars'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 1000 });
await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), login.token);

/** Both action clusters, with their geometry and accessible names. */
async function readClusters() {
  return page.evaluate(() => {
    const groups = [...document.querySelectorAll('[role="group"][aria-label*="Thao tác tạo lô hàng"]')]
      .map((g) => ({
        ariaLabel: g.getAttribute('aria-label'),
        rect: g.getBoundingClientRect(),
        buttons: [...g.querySelectorAll('button')].map((b) => ({
          text: (b.innerText || '').trim(),
          aria: b.getAttribute('aria-label') || '',
          disabled: b.disabled || b.getAttribute('aria-disabled') === 'true',
        })),
      }));
    const top = groups.find((g) => g.ariaLabel === 'Thao tác tạo lô hàng');
    const foot = groups.find((g) => /cuối trang/i.test(g.ariaLabel || ''));
    return {
      count: groups.length,
      top: top ? { buttons: top.buttons.map((b) => b.aria || b.text), y: Math.round(top.rect.top) } : null,
      foot: foot ? { buttons: foot.buttons.map((b) => b.aria || b.text), y: Math.round(foot.rect.top) } : null,
      footBelowTop: top && foot ? foot.rect.top > top.rect.top : false,
    };
  });
}

async function shot(name) {
  await sleep(700);
  const path = `${SHOTS}/${name}.png`;
  await page.screenshot({ path });
  return path;
}

try {
  await page.goto(`${BASE}/shipments/new`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForSelector('.csc-form-actions', { timeout: 45000 });
  await sleep(2500);

  // ── Items 1-2: both clusters, the second one at the FOOT ──────────────
  const fcl = await readClusters();
  const shotFcl = await shot('01-fcl-cuc-thao-tac-cuoi-trang');
  record('item1-2-fcl-two-clusters',
    fcl.count === 2 && fcl.footBelowTop
    && fcl.top.buttons.length === 3 && fcl.foot.buttons.length === 3
    && fcl.foot.buttons.every((t) => /cuối trang/i.test(t)) ? 'PASS' : 'FAIL',
    `clusters=${fcl.count} belowTop=${fcl.footBelowTop} top=${JSON.stringify(fcl.top)} foot=${JSON.stringify(fcl.foot)} · ${shotFcl}`);

  // Scroll to the foot so the screenshot shows the cluster in place.
  await page.evaluate(() => {
    document.querySelector('.csc-form-actions')?.scrollIntoView({ block: 'center' });
  });
  const shotFoot = await shot('02-fcl-cuoi-trang-dang-trong-man-hinh');
  record('footer-visible-in-viewport', (await readClusters()).footBelowTop ? 'PASS' : 'FAIL',
    `footer cluster scrolled into view · ${shotFoot}`);

  // ── The same cluster must survive the switch to Hàng lẻ ───────────────
  await page.evaluate(() => {
    const el = [...document.querySelectorAll('button, [role="tab"], label')]
      .find((b) => /hàng lẻ/i.test((b.innerText || '').trim()));
    el?.scrollIntoView({ block: 'center' });
    el?.click();
  });
  await sleep(2500);
  const lcl = await readClusters();
  const shotLcl = await shot('03-hang-le-van-co-cuc-cuoi-trang');
  record('item2-lcl-keeps-footer',
    lcl.count === 2 && lcl.footBelowTop && lcl.foot.buttons.length === 3 ? 'PASS' : 'FAIL',
    `Hàng lẻ: clusters=${lcl.count} belowTop=${lcl.footBelowTop} foot=${JSON.stringify(lcl.foot)} · ${shotLcl}`);

  // ── Item 3: the footer buttons behave like the head's. An EMPTY form has
  //    nothing to save, so "Lưu nháp" fires no request at all (which reads as
  //    a dead button) — pick a customer first, so the draft has content.
  //    "Tạo lô hàng" is deliberately NOT pressed here, since it would create a
  //    real lot; the submit path itself is card 171026115810's evidence.
  await page.evaluate(() => {
    const host = document.querySelector('[data-field-id="shipment-customer"] [role="combobox"]');
    host?.focus();
  });
  await sleep(300);
  await page.keyboard.press('ArrowDown');
  await page.waitForFunction(() => document.querySelectorAll('[role="option"]').length > 0, { timeout: 8000 }).catch(() => {});
  await sleep(400);
  await page.keyboard.type('LONG MINH', { delay: 40 });
  await sleep(800);
  await page.evaluate(() => {
    const o = [...document.querySelectorAll('[role="option"]')]
      .find((el) => /long minh/i.test((el.innerText || '').trim()));
    o?.click();
  });
  await sleep(2000);

  const writes = [];
  page.on('response', (res) => {
    const u = res.url();
    if (!u.includes('/api/shipments')) return;
    if (!/PUT|POST|PATCH/.test(res.request().method())) return;
    writes.push({ method: res.request().method(), path: u.replace(BASE, ''), status: res.status() });
  });

  await page.evaluate(() => {
    document.querySelector('.csc-form-actions')?.scrollIntoView({ block: 'center' });
  });
  await sleep(600);
  const pressed = await page.evaluate(() => {
    const g = [...document.querySelectorAll('[role="group"][aria-label*="cuối trang"]')][0];
    const b = [...(g?.querySelectorAll('button') ?? [])]
      .find((x) => /lưu nháp/i.test(`${x.getAttribute('aria-label') || ''} ${x.innerText || ''}`));
    if (!b || b.disabled) return false;
    b.click();
    return true;
  });
  await sleep(4000);
  // The toast lives in a live region; matching body text was picking up the
  // BUTTON's own "Lưu nháp" label and reporting it as a toast.
  const toast = await page.evaluate(() => {
    const region = document.querySelector('[role="status"], [role="alert"], .toast, [class*="toast"]');
    const live = (region?.innerText || '').replace(/\s+/g, ' ').trim();
    return live || null;
  });
  const shotDraft = await shot('04-luu-nhap-tu-cuoi-trang');
  record('item3-footer-button-behaves',
    pressed && writes.length > 0 ? 'PASS' : 'FAIL',
    `pressed=${pressed} writes=${JSON.stringify(writes)} toast=${JSON.stringify(toast)} · ${shotDraft}`);
} catch (e) {
  record('RUNNER', 'FAIL', String(e.message ?? e));
  await page.screenshot({ path: `${SHOTS}/99-error.png`, fullPage: true }).catch(() => {});
} finally {
  await browser.close();
}

const failed = results.filter((r) => r.verdict === 'FAIL');
console.log(`\n=== ${failed.length === 0 ? 'ALL RUNGS PASS' : failed.length + ' RUNG(S) FAILED'} ===`);
for (const r of results) console.log(`  ${r.verdict.padEnd(5)} ${r.rung}`);
process.exit(failed.length === 0 ? 0 : 1);
