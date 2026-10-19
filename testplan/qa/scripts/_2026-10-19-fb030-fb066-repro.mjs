// FB-030/075 + FB-066 — real-surface repro at HEAD (fresh-tab puppeteer).
//
// FB-030/075 (gõ '14' ô ngày/giờ KHÔNG tự nhảy segment): drive the forms QA
//   actually names — "khai báo lô" (/shipments/new) and the CUS quick-edit
//   "Chỉnh sửa Lịch trình" dialog — plus the accounting phơi phiếu surface
//   (the R23 FAIL landed in the Kế toán batch). Type "14" into the day segment,
//   capture whether focus advances to the month segment.
//
// FB-066 (thiếu nút thêm nhanh BKS): open the LCL "Gán xe nhóm" dialog on
//   /dispatch-detail and check the "BKS thực" select for a "+ Thêm nhanh"
//   affordance (r25 guide step 3 — free-text gõ mới exists but no quick-add
//   registration button).
//
// Usage: QA_BASE=http://localhost:7178 API=http://localhost:3003/api \
//        node testplan/qa/scripts/2026-10-19-fb030-fb066-repro.mjs
import puppeteer from 'puppeteer';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const API = process.env.API || 'http://localhost:3003/api';
const QA_BASE_URL = process.env.QA_BASE || 'http://localhost:7178';
const OUT = process.env.QA_OUT
  ? path.resolve(process.env.QA_OUT)
  : path.resolve(import.meta.dirname, '../../../qa/2026-10-19_fb030-fb066_repro');
fs.mkdirSync(OUT, { recursive: true });

const results = [];
let exitCode = 0;
const record = (id, pass, detail) => {
  results.push({ id, pass, detail });
  if (!pass) exitCode = 1;
  console.log(JSON.stringify({ id, pass, detail }));
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const login = async (identifier) => {
  const res = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier, password: 'Abc123' }),
  });
  if (!res.ok) throw new Error(`login ${identifier} -> ${res.status}`);
  const { token } = await res.json();
  return token;
};

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--hide-scrollbars'] });

// Read the day/month/year segment values + which segment holds focus.
const segState = (page, scopeSelector) => page.evaluate((scopeSelector) => {
  const scope = scopeSelector ? document.querySelector(scopeSelector) : document;
  const a = document.activeElement;
  const segs = {};
  for (const s of ['dd', 'mm2', 'yyyy']) segs[s] = scope?.querySelector(`[data-seg="${s}"]`)?.value ?? null;
  return {
    activeSeg: a?.getAttribute('data-seg') ?? null,
    activeLabel: a?.getAttribute('aria-label') ?? null,
    activeTag: a?.tagName ?? null,
    timeValue: scope?.querySelector('.time-input input')?.value ?? null,
    ...segs,
  };
}, scopeSelector);

try {
  /* ══════════ FB-030/075 — CUS quick-edit "Chỉnh sửa Lịch trình" ══════════ */
  const cusToken = await login('cus');
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), cusToken);

  // Find an enabled schedule trigger on /shipments.
  await page.goto(`${QA_BASE_URL}/shipments`, { waitUntil: 'networkidle2', timeout: 60000 });
  await page.waitForSelector('table', { timeout: 20000 });
  let triggerId = null;
  for (let p = 1; p <= 8 && !triggerId; p += 1) {
    if (p > 1) await page.goto(`${QA_BASE_URL}/shipments?page=${p}`, { waitUntil: 'networkidle2', timeout: 60000 });
    await page.waitForSelector('table', { timeout: 20000 });
    triggerId = await page.evaluate(() => {
      const b = Array.from(document.querySelectorAll('button[aria-label^="Sửa ô lịch trình lô hàng"]')).find((x) => !x.disabled);
      return b ? b.id : null;
    });
  }
  if (!triggerId) {
    record('FB030-dialog-open', false, 'no enabled schedule trigger on /shipments pages 1..8');
  } else {
    await page.evaluate((id) => { document.getElementById(id)?.click(); }, triggerId);
    await page.waitForSelector('[role="dialog"]', { timeout: 15000 });
    await sleep(400);

    // --- Day → month advance ---
    await page.evaluate(() => { document.querySelector('[role="dialog"] [data-seg="dd"]'); });
    await page.focus('[role="dialog"] [data-seg="dd"]');
    // Select whatever is there then type "14".
    await page.evaluate(() => { const el = document.querySelector('[role="dialog"] [data-seg="dd"]'); el?.select?.(); });
    await page.type('[role="dialog"] [data-seg="dd"]', '14', { delay: 40 });
    await sleep(300);
    let st = await segState(page, '[role="dialog"]');
    const dayAdvances = st.activeSeg === 'mm2' && st.dd === '14';
    record('FB030-dialog-day-to-month', dayAdvances, `after typing 14: ${JSON.stringify(st)}`);
    await page.screenshot({ path: path.join(OUT, 'fb030-dialog-after-day14.png') });

    // --- Giờ typed-complete → day hand-off ---
    await page.focus('[role="dialog"] .time-input input');
    await page.evaluate(() => { const el = document.querySelector('[role="dialog"] .time-input input'); el?.select?.(); });
    await page.type('[role="dialog"] .time-input input', '1430', { delay: 40 });
    await sleep(400);
    st = await segState(page, '[role="dialog"]');
    const gioHandoff = st.timeValue === '14:30' && st.activeSeg === 'dd';
    record('FB030-dialog-gio-handoff', gioHandoff, `after typing 1430: ${JSON.stringify(st)}`);
    await page.screenshot({ path: path.join(OUT, 'fb030-dialog-after-gio1430.png') });

    // Cancel the dialog (no mutation).
    await page.keyboard.press('Escape');
    await sleep(300);
  }

  /* ══════════ FB-066 — LCL "Gán xe nhóm" BKS quick-add ══════════ */
  const dvToken = await login('dieuvan');
  const dp = await browser.newPage();
  await dp.setViewport({ width: 1440, height: 900 });
  await dp.evaluateOnNewDocument((t) => localStorage.setItem('token', t), dvToken);
  await dp.goto(`${QA_BASE_URL}/dispatch-detail`, { waitUntil: 'networkidle2', timeout: 60000 });
  await sleep(800);

  // Tick at least TWO LCL lots (the assign button needs ≥2) to reveal "Gán xe nhóm".
  const ticked = await dp.evaluate(() => {
    const boxes = Array.from(document.querySelectorAll('input[type="checkbox"][aria-label^="Chọn lô"]'))
      .filter((cb) => !cb.disabled);
    const picked = boxes.slice(0, 2);
    picked.forEach((cb) => cb.click());
    return { total: boxes.length, picked: picked.length };
  });
  await sleep(500);
  const assignBtn = await dp.evaluate(() => {
    const btn = Array.from(document.querySelectorAll('button')).find((b) => /Gán xe nhóm/i.test(b.textContent || ''));
    return btn ? { text: btn.textContent.trim(), disabled: btn.disabled } : null;
  });
  if (!assignBtn) {
    record('FB066-assign-dialog', false, `no "Gán xe nhóm" button found (tick=${ticked})`);
    await dp.screenshot({ path: path.join(OUT, 'fb066-dispatch-detail.png') });
  } else {
    await dp.evaluate(() => {
      const btn = Array.from(document.querySelectorAll('button')).find((b) => /Gán xe nhóm/i.test(b.textContent || ''));
      btn?.click();
    });
    await dp.waitForSelector('[role="dialog"]', { timeout: 15000 }).catch(() => {});
    await sleep(600);
    // Look for a quick-add button near the BKS thực select.
    const quickAdd = await dp.evaluate(() => {
      const dlg = document.querySelector('[role="dialog"]');
      if (!dlg) return { found: false, reason: 'no dialog' };
      const btns = Array.from(dlg.querySelectorAll('button')).map((b) => (b.textContent || '').trim()).filter(Boolean);
      const hasQuickAdd = btns.some((t) => /thêm nhanh/i.test(t));
      const bksLabel = Array.from(dlg.querySelectorAll('label,span')).map((e) => e.textContent || '').find((t) => /BKS thực/i.test(t));
      return { found: hasQuickAdd, buttons: btns.slice(0, 30), bksLabel: bksLabel || null };
    });
    record('FB066-quick-add-present', quickAdd.found, JSON.stringify(quickAdd));
    await dp.screenshot({ path: path.join(OUT, 'fb066-assign-truck-group.png') });
    await dp.keyboard.press('Escape');
  }

  /* ══════════ FB-030 — accounting phơi phiếu date (Kế toán batch surface) ══════════ */
  const ktToken = await login('ketoan');
  const ap = await browser.newPage();
  await ap.setViewport({ width: 1440, height: 900 });
  await ap.evaluateOnNewDocument((t) => localStorage.setItem('token', t), ktToken);
  await ap.goto(`${QA_BASE_URL}/accounting/phoi-phieu`, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
  await sleep(1500);
  const phoiSegs = await ap.evaluate(() => ({
    hasSegments: Boolean(document.querySelector('[data-seg="dd"]')),
    hasSingleDate: Boolean(document.querySelector('input[data-date-input]')),
    dateLabels: Array.from(document.querySelectorAll('label')).map((l) => (l.textContent || '').trim()).filter((t) => /ngày/i.test(t)).slice(0, 8),
  }));
  await ap.screenshot({ path: path.join(OUT, 'fb030-phoi-phieu.png') });
  console.log(JSON.stringify({ id: 'FB030-phoi-phieu-surface', info: phoiSegs }));

  await browser.close();
} catch (err) {
  console.error('DRIVER ERROR:', err);
  exitCode = 1;
}
console.log('SUMMARY', JSON.stringify(results, null, 2));
process.exit(exitCode);
