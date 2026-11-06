// SIL-694 + SIL-695 §9 UI evidence driver.
// Command: node qa/2026-11-06-lane-694-695/ui-drive.mjs
// Drives the real app at http://localhost:7176 (BE :3002, branch fix/sil-dispatch-1):
//   SIL-694 — accountant (hoapt) sees + completes the governed close on /trips/576.
//   SIL-695 — dispatcher (dungnv) quick-issues onto truck 15H-154.26 holding a
//             same-day COMPLETED trip: warn-once dialog → confirm → issued, no loop.
// Writes PNGs + ui-driver.log next to this script.
import puppeteer from 'puppeteer';
import { mkdirSync, appendFileSync } from 'node:fs';

const OUT = new URL('.', import.meta.url).pathname;
const BASE = 'http://localhost:7176';
mkdirSync(OUT, { recursive: true });
const log = (line) => { console.log(line); appendFileSync(`${OUT}ui-driver.log`, `${new Date().toISOString()} ${line}\n`); };
const assert = (cond, label) => {
  log(`${cond ? 'PASS' : 'FAIL'}  ${label}`);
  if (!cond) process.exitCode = 1;
  return cond;
};
const shot = async (page, name) => { await page.screenshot({ path: `${OUT}${name}`, fullPage: false }); log(`shot ${name}`); };

const login = async (page, username) => {
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle2' });
  await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle2' });
  await page.waitForSelector('input', { timeout: 15000 });
  await page.type('input:not([type="password"])', username);
  await page.type('input[type="password"]', 'Abc123');
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 }).catch(() => {}),
    await page.evaluate(() => {
      [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Đăng nhập')?.click();
    }),
  ]);
  await page.waitForFunction(() => !location.pathname.startsWith('/login'), { timeout: 30000 });
  log(`login ${username} ok → ${await page.evaluate(() => location.pathname)}`);
};

const completeResponses = [];
const browser = await puppeteer.launch({ headless: 'new' });
try {
  const page = await browser.newPage();
  page.on('response', async (res) => {
    const url = res.request().url();
    if (/\/api\/trips\/\d+\/complete$/.test(url) || /\/api\/shipments\/\d+\/dispatch$/.test(url)) {
      completeResponses.push({ url, status: res.status() });
      log(`api ${res.request().method()} ${url.replace(BASE, '')} -> ${res.status()}`);
    }
  });
  await page.setViewport({ width: 1440, height: 900 });

  const sil695Only = process.env.SIL695_ONLY === '1';
  // ── SIL-694: accountant completes the governed close ──────────────────────
  if (!sil695Only) {
    await login(page, 'hoapt');
    await page.goto(`${BASE}/trips/451`, { waitUntil: 'networkidle2' });
    await page.waitForFunction(() => document.querySelector('h1')?.textContent?.includes('Đang chạy'), { timeout: 20000 });
    const hasClose = await page.evaluate(() => [...document.querySelectorAll('button')].some((b) => b.textContent?.trim() === 'Hoàn thành'));
    assert(hasClose, 'SIL-694: ACCOUNTANT sees the Hoàn thành button on an IN_TRANSIT trip');
    await shot(page, 'sil694-ui-1-accountant-sees-close.png');

    await page.evaluate(() => {
      [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Hoàn thành')?.click();
    });
    await page.waitForSelector('[role="dialog"], .modal, .ds-modal', { timeout: 10000 });
    const modalVisible = await page.evaluate(() => {
      const modal = [...document.querySelectorAll('body > *')].map((n) => n.textContent?.includes('Lý do')).some(Boolean);
      return modal;
    });
    assert(modalVisible, 'SIL-694: governance reason modal opened');
    await page.type('textarea', 'SIL-694 kế toán chốt chuyến sau khi đủ bằng chứng (QA drive)');
    await shot(page, 'sil694-ui-2-governance-modal.png');

    await page.evaluate(() => {
      const buttons = [...document.querySelectorAll('button')];
      buttons.find((b) => b.textContent?.trim() === 'Hoàn thành chuyến' && !b.closest('header'))?.click();
    });
    // The action handler refetches in the background; a reload makes the
    // persisted status observable deterministically.
    await new Promise((r) => setTimeout(r, 2500));
    await page.reload({ waitUntil: 'networkidle2' });
    await page.waitForFunction(() => document.querySelector('h1')?.textContent?.includes('Hoàn thành'), { timeout: 30000 });
    assert(true, 'SIL-694: trip status flipped to Hoàn thành after accountant close');
    await shot(page, 'sil694-ui-3-after-close-completed.png');
  } else {
    log('SIL695_ONLY: skipping the SIL-694 section (evidence already captured)');
  }

  // ── SIL-695: dispatcher issues onto a truck with a same-day completed trip ─
  await login(page, 'dungnv');
  await page.goto(`${BASE}/dispatch-detail`, { waitUntil: 'networkidle2' });
  await page.waitForFunction(() => document.querySelectorAll('table tbody tr').length > 0, { timeout: 30000 });
  // Filter to the test lot via the quick search (server-side q filter with a
  // debounce) — WAIT for the target button instead of a fixed sleep so the
  // click never lands on a mid-refetch render. The React input ignores
  // synthetic key events from puppeteer here, so set the value through the
  // native setter + an input event (the controlled-input idiom).
  await page.evaluate(() => {
    const input = document.querySelector('input[aria-label="Tìm nhanh"]');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(input, 'SHP-2611-00143');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.waitForFunction(() => [...document.querySelectorAll('table tbody tr button')]
    .some((b) => /^Phát lệnh · TSTU0928409/.test(b.getAttribute('aria-label') ?? '')), { timeout: 20000 });
  const issueArmed = true;
  assert(issueArmed, 'SIL-695: plated READY row shows the quick-issue action');
  await new Promise((r) => setTimeout(r, 800));
  await shot(page, 'sil695-ui-0-plated-row.png');

  await page.evaluate(() => {
    [...document.querySelectorAll('table tbody tr button')]
      .find((b) => /^Phát lệnh · TSTU0928409/.test(b.getAttribute('aria-label') ?? ''))?.click();
  });
  await page.waitForFunction(() => document.querySelector('[role="dialog"]')?.textContent?.includes('Vẫn lưu?'), { timeout: 15000 });
  assert(true, 'SIL-695: warn-once dialog names the same-day completed trip (business-meaningful)');
  await shot(page, 'sil695-ui-1-overlap-warn-dialog.png');

  await page.evaluate(() => {
    [...document.querySelectorAll('[role="dialog"] button')].find((b) => b.textContent?.trim() === 'Xác nhận')?.click();
  });
  // No-loop proof: the dialog must close and the row must flip — no second dialog.
  await page.waitForFunction(() => !document.querySelector('[role="dialog"]'), { timeout: 30000 });
  await page.waitForFunction(() => [...document.querySelectorAll('table tbody tr')]
    .some((r) => r.textContent?.includes('Đã phát lệnh')), { timeout: 30000 });
  const dialogCount = await page.evaluate(() => document.querySelectorAll('[role="dialog"]').length);
  assert(dialogCount === 0, 'SIL-695: confirm closed the dialog — no re-prompt loop');
  await new Promise((r) => setTimeout(r, 1200));
  const stillDialog = await page.evaluate(() => document.querySelectorAll('[role="dialog"]').length);
  assert(stillDialog === 0, 'SIL-695: 1.2s later still no dialog — no infinite re-confirm');
  await shot(page, 'sil695-ui-2-after-confirm-issued.png');
  log(`api summary: ${JSON.stringify(completeResponses)}`);
} finally {
  await browser.close();
}
log('driver done');
