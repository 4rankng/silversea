// SIL-500 UI drive — two regression lanes on the local dev stack.
//
// A. Post-create view (/shipments/:id as CUS): the action cluster carries
//    "Tạo mới lô hàng" (primary) again; clicking it navigates to
//    /shipments/new WITHOUT any POST /shipments (navigation is the whole
//    effect — nothing persists).
// B. Dispatch detailed plan (/dispatch-detail as DISPATCHER): the
//    "Chưa phân nhà xe" carrier line is click-to-edit again; clicking opens
//    the "Chỉnh sửa điều phối" dialog; Hủy closes it with NO PUT/PATCH —
//    the dialog open/close is UI-only.
//
// Usage: cd frontend && node ../qa/scripts/2026-10-26-sil500-ui-drive.mjs
// Output: qa/2026-10-26-sil500/*.png + ui-drive-assertions.json on stdout.

import puppeteer from 'puppeteer';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const FE = process.env.QA_BASE_URL || 'http://localhost:7195';
const OUT = resolve(process.cwd(), '../qa/2026-10-26-sil500');
const VIEW_SHIPMENT = process.env.VIEW_SHIPMENT || '260'; // customer 5 (cus-linked) — any lot works for the view
mkdirSync(OUT, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new',
  defaultViewport: { width: 1440, height: 900 },
});

const results = { A: {}, B: {} };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Login through the real form, then return the page + api capture list.
 *  /login redirects authenticated sessions to their home (App.tsx route
 *  guard), so every fresh login first clears the shared-context storage. */
async function login(user, pass) {
  const page = await browser.newPage();
  const apiCalls = [];
  page.on('request', (r) => {
    const url = r.url();
    if (url.includes('/api/')) apiCalls.push(`${r.method()} ${new URL(url).pathname}`);
  });
  await page.goto(`${FE}/`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
  await page.goto(`${FE}/login`, { waitUntil: 'networkidle0', timeout: 30000 });
  // First load of a cold Vite transform can lag — wait for the form itself.
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

const visibleText = (sel) => document.querySelector(sel)?.textContent?.trim() ?? null;

// ── A. post-create view actions (CUS) ──────────────────────────────────────
{
  const { page, apiCalls } = await login('cus', 'Abc123');
  await page.goto(`${FE}/shipments/${VIEW_SHIPMENT}`, { waitUntil: 'networkidle2', timeout: 30000 });
  await page.waitForSelector('h1', { timeout: 20000 });
  await page.waitForFunction(() => document.querySelector('h1')?.textContent?.includes('Chi tiết lô hàng'), { timeout: 20000 });

  results.A.cluster = await page.evaluate(() => {
    const buttons = [...document.querySelectorAll('[role="group"][aria-label*="Thao tác xem lô hàng"] button')];
    const name = (b) => (b.getAttribute('aria-label') ?? b.textContent)?.trim();
    const names = ['Quay lại', 'Sửa', 'Tạo mới lô hàng', 'Quay lại (cuối trang)', 'Sửa (cuối trang)', 'Tạo mới lô hàng (cuối trang)'];
    const primary = buttons.find((b) => b.getAttribute('data-control-color') === 'primary');
    return {
      present: Object.fromEntries(names.map((n) => [n, buttons.some((b) => name(b) === n)])),
      primaryLabel: primary ? name(primary) : null,
    };
  });
  await page.screenshot({ path: resolve(OUT, 'A-view-1440-before-click.png') });

  const postsBefore = apiCalls.filter((c) => c.startsWith('POST ')).length;
  // Click the topline primary by its accessible name.
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll('[role="group"][aria-label="Thao tác xem lô hàng"] button')]
      .find((b) => (b.getAttribute('aria-label') ?? b.textContent)?.trim() === 'Tạo mới lô hàng');
    btn.click();
  });
  await page.waitForFunction(() => location.pathname === '/shipments/new', { timeout: 15000 });
  await page.waitForFunction(() => document.querySelector('h1')?.textContent?.includes('Tạo lô hàng'), { timeout: 20000 });
  await sleep(400);
  await page.screenshot({ path: resolve(OUT, 'A-view-1440-after-click-taomoi.png') });

  results.A.afterClick = await page.evaluate(() => ({
    pathname: location.pathname,
    heading: document.querySelector('h1')?.textContent?.trim() ?? null,
    requiredChip: !!document.querySelector('.csc-topline__progress'),
  }));
  results.A.identity = {
    postCountDuringDrive: apiCalls.filter((c) => c.startsWith('POST ')).length - postsBefore,
    posts: apiCalls.filter((c) => c.startsWith('POST ')),
    note: 'expect 0 — "Tạo mới lô hàng" only NAVIGATES; no lot is created',
  };
  await page.close();
}

// ── A390. the same cluster wraps on phones (reuses the CUS session token) ─
{
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844 });
  await page.goto(`${FE}/shipments/${VIEW_SHIPMENT}`, { waitUntil: 'networkidle2', timeout: 30000 });
  await page.waitForFunction(() => document.querySelector('h1')?.textContent?.includes('Chi tiết lô hàng'), { timeout: 20000 });
  results.A.mobile390 = await page.evaluate(() => {
    const btn = [...document.querySelectorAll('[role="group"][aria-label="Thao tác xem lô hàng"] button')]
      .find((b) => (b.getAttribute('aria-label') ?? b.textContent)?.trim() === 'Tạo mới lô hàng');
    if (!btn) return { present: false };
    const box = btn.getBoundingClientRect();
    return { present: true, visible: box.width > 0 && box.height > 0, box: { w: Math.round(box.width), h: Math.round(box.height) } };
  });
  await page.screenshot({ path: resolve(OUT, 'A-view-390-cluster.png') });
  await page.close();
}

// ── B. dispatch cell click-to-edit (DISPATCHER) ───────────────────────────
{
  const { page, apiCalls } = await login('dieuvan', 'Abc123');
  await page.setViewport({ width: 1440, height: 900 });
  await page.goto(`${FE}/dispatch-detail`, { waitUntil: 'networkidle2', timeout: 40000 });
  await page.waitForSelector('.dispatch-assignment-cell', { timeout: 30000 });

  results.B.cell = await page.evaluate(() => {
    const carrierButtons = [...document.querySelectorAll('.dispatch-assignment-cell__carrier--action')];
    const unassigned = carrierButtons.find((b) => b.textContent?.trim() === 'Chưa phân nhà xe');
    return {
      carrierButtons: carrierButtons.length,
      unassignedPresent: !!unassigned,
      firstUnassignedAria: unassigned?.getAttribute('aria-label') ?? null,
    };
  });
  await page.screenshot({ path: resolve(OUT, 'B-dispatch-1440-before-click.png') });

  const mutatorsBefore = apiCalls.filter((c) => /^(PUT|PATCH|POST) /.test(c)).length;
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll('.dispatch-assignment-cell__carrier--action')]
      .find((b) => b.textContent?.trim() === 'Chưa phân nhà xe');
    btn.click();
  });
  await page.waitForSelector('[role="dialog"]', { timeout: 15000 });
  await page.waitForFunction(() => (document.querySelector('[role="dialog"]')?.textContent ?? '').includes('Chỉnh sửa điều phối'), { timeout: 15000 });
  await sleep(400);
  await page.screenshot({ path: resolve(OUT, 'B-dispatch-1440-after-click-dialog.png') });

  results.B.afterClick = await page.evaluate(() => {
    const dlg = document.querySelector('[role="dialog"]');
    return {
      dialogTextHead: (dlg?.textContent ?? '').replace(/\s+/g, ' ').slice(0, 160),
      hasCarrierLabel: (dlg?.textContent ?? '').includes('Nhà xe'),
      hasPlateLabel: (dlg?.textContent ?? '').includes('Xe / biển số'),
    };
  });

  // Hủy — the dialog closes without any persisted write.
  await page.evaluate(() => {
    const dlg = document.querySelector('[role="dialog"]');
    const cancel = [...dlg.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Hủy');
    cancel.click();
  });
  await page.waitForFunction(() => !document.querySelector('[role="dialog"]'), { timeout: 15000 });
  results.B.afterCancel = {
    dialogGone: true,
    mutatorCallsDuringDrive: apiCalls.filter((c) => /^(PUT|PATCH|POST) /.test(c)).length - mutatorsBefore,
    mutators: apiCalls.filter((c) => /^(PUT|PATCH|POST) /.test(c)),
    note: 'expect 0 mutators — click opens/closes the dialog only',
  };
  await page.screenshot({ path: resolve(OUT, 'B-dispatch-1440-after-cancel.png') });
  await page.close();
}

// ── B768. grid band keeps the click verb (reuses the DISPATCHER token) ────
{
  const page = await browser.newPage();
  await page.setViewport({ width: 768, height: 900 });
  await page.goto(`${FE}/dispatch-detail`, { waitUntil: 'networkidle2', timeout: 40000 });
  await page.waitForSelector('.dispatch-assignment-cell', { timeout: 30000 });
  const present = await page.evaluate(() => {
    const btn = [...document.querySelectorAll('.dispatch-assignment-cell__carrier--action')]
      .find((b) => b.textContent?.trim() === 'Chưa phân nhà xe');
    if (!btn) return false;
    btn.click();
    return true;
  });
  results.B.tablet768 = { present };
  if (present) {
    await page.waitForFunction(() => (document.querySelector('[role="dialog"]')?.textContent ?? '').includes('Chỉnh sửa điều phối'), { timeout: 15000 });
    results.B.tablet768.dialogOpened = true;
    await page.screenshot({ path: resolve(OUT, 'B-dispatch-768-dialog.png') });
  }
  await page.close();
}

await browser.close();
writeFileSync(resolve(OUT, 'ui-drive-assertions.json'), JSON.stringify(results, null, 2));
console.log(JSON.stringify(results, null, 2));
