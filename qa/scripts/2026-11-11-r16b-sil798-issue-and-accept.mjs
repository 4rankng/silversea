// qa/scripts/2026-11-11-r16b-sil798-issue-and-accept.mjs
// SIL-798 E2E (UI DRIVEN): dispatcher issues a fresh order onto truck 42
// (60C-12345, driver laixe — 2 live IN_TRANSIT trips), then the DRIVER opens
// the new order and presses "Nhận lệnh vận chuyển" → 409 DRIVER_TRIP_BLOCKED
// → the banner must NAME the blocking trip (Số Bill/Booking) and LINK it.
// Screenshots land in qa/2026-11-11_r16b-dispatch-ui/.
import { chromium } from '../../frontend/node_modules/@playwright/test/index.mjs';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const FE = 'http://localhost:7175';
const OUT = resolve(process.cwd(), 'qa/2026-11-11_r16b-dispatch-ui');
mkdirSync(OUT, { recursive: true });
const log = (m) => console.log(m);
const browser = await chromium.launch();

async function login(page, username) {
  await page.goto(`${FE}/login`, { waitUntil: 'networkidle' });
  await page.fill('input[name="username"]', username);
  await page.fill('input[name="password"]', 'Abc123');
  await page.locator('button[type="submit"]').first().click();
  await page.waitForURL((u) => !page.url().includes('login'), { timeout: 20000 });
  await page.waitForTimeout(1000);
}

try {
  // ── 1. Dispatcher: issue a fresh order on truck 42 ────────────────────
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const apiCalls = [];
  page.on('response', async (r) => {
    if (!r.url().includes('/api/') || r.url().includes('health')) return;
    let body = '';
    if (r.status() >= 400) { try { body = ' :: ' + (await r.text()).slice(0, 200); } catch { /* stream gone */ } }
    apiCalls.push(`${r.request().method()} ${r.status()} ${r.url().replace(FE, '').slice(0, 110)}${body}`);
  });
  await login(page, 'dieuvan');
  await page.goto(`${FE}/dispatch-detail?q=SIL676QA182305A`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${OUT}/sil798-01-board.png` });

  // The ⋯ menu opens the editor for the first row (probe-proven recipe).
  await page.locator('[class*="row-actions"] button:visible').last().click();
  await page.getByRole('menuitem', { name: 'Sửa điều phối' }).waitFor({ state: 'visible', timeout: 10000 });
  await page.getByRole('menuitem', { name: 'Sửa điều phối' }).click();
  await page.waitForSelector('[role="dialog"]', { timeout: 10000 });
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${OUT}/sil798-02-editor.png` });

  // Carrier: OWN fleet ("SilverSea — xe nội bộ") — the trigger labelled
  // "Nhà xe" (id dispatch-carrier-*), never the Phân loại combobox.
  await page.locator('[id^="dispatch-carrier"]').click();
  await page.waitForTimeout(500);
  const ownOption = page.locator('[role="option"]:visible', { hasText: 'SilverSea' }).first();
  await ownOption.click();
  await page.waitForTimeout(400);

  // Vehicle: 60C-12345.
  const vehicleTrigger = page.locator('[id^="dispatch-vehicle"]').first();
  await vehicleTrigger.click();
  await page.waitForTimeout(400);
  await page.keyboard.type('60C-12345');
  await page.waitForTimeout(700);
  const plate = page.locator('[role="option"]:visible', { hasText: '60C-12345' }).first();
  await plate.click();
  // SIL-644 — the issue-time price backstop demands the container weight;
  // a weightless lot 409s "Thiếu trọng tải" (loud by law). Seed 15.000 kg.
  const weight = page.locator('input[id^="dispatch-weight"]');
  if (await weight.count()) {
    await weight.fill('15000');
    await page.waitForTimeout(200);
  }
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/sil798-03-assigned.png` });

  // Save the plan. A rig-window overlap warns via the shared confirm —
  // accept it (the SIL-638 confirmable-retry contract) and let the same save
  // ride the confirm flag.
  await page.locator('[role="dialog"] button:has-text("Lưu thay đổi")').click();
  const overlapConfirm = page.locator('[aria-label="Xác nhận thao tác"] button.btn--primary');
  try {
    await overlapConfirm.waitFor({ state: 'visible', timeout: 6000 });
    await overlapConfirm.click();
    log('overlap confirm accepted');
  } catch { /* no warning — straight save */ }
  await page.waitForTimeout(2000);
  log('after save: dialog open? ' + await page.locator('[role="dialog"]').count());
  log('save-block reason: ' + (await page.evaluate(() => {
    const dlg = document.querySelector('[role="dialog"]');
    if (!dlg) return 'dialog closed';
    const err = dlg.querySelector('[role="alert"], .dispatch-assignment-dialog__error');
    const saveBtn = [...dlg.querySelectorAll('button')].find((b) => b.textContent.includes('Lưu thay đổi'));
    const runField = dlg.querySelector('input[id*="dispatch-run"]');
    return JSON.stringify({ err: err?.textContent?.slice(0, 140) ?? null, saveDisabled: saveBtn ? saveBtn.disabled || saveBtn.getAttribute('aria-disabled') : 'no-btn', runValue: runField ? runField.value : null });
  })));
  log('after save body signals: ' + (await page.evaluate(() => {
    const toast = document.querySelector('[role="status"], .toast');
    const dlg = document.querySelector('[role="dialog"]');
    return JSON.stringify({ toast: toast?.textContent?.slice(0, 120) ?? null, dialogStill: dlg ? dlg.textContent.slice(0, 120) : null });
  })));

  // Issue (Phát lệnh) — the compact primary in the pinned Thao tác rail.
  await page.waitForTimeout(1200);
  log('rail after save: ' + (await page.evaluate(() => JSON.stringify(
    [...document.querySelectorAll('[class*="row-actions"] button, [class*="cell--actions"] button')].map((b) => ({ label: b.getAttribute('aria-label') ?? b.textContent.trim().slice(0, 26), visible: !!(b.offsetWidth || b.offsetHeight) })),
  ))));
  const issue = page.locator("button[aria-label^='Phát lệnh']:visible").first();
  await issue.waitFor({ state: 'visible', timeout: 15000 });
  await issue.click();
  await page.waitForTimeout(600);
  log('api tail: ' + JSON.stringify(apiCalls.slice(-6)));
  log('after issue click body: ' + (await page.evaluate(() => {
    const dlg = document.querySelector('[role="dialog"], [role="alertdialog"]');
    const toast = document.querySelector('[role="status"], [class*="toast"], [class*="Toast"]');
    return JSON.stringify({ dlg: dlg?.textContent?.replace(/\s+/g, ' ').slice(0, 200) ?? null, toast: toast?.textContent?.slice(0, 160) ?? null });
  })));
  await page.screenshot({ path: `${OUT}/sil798-04-issue-confirm.png` });
  log('issue dialog: ' + (await page.evaluate(() => {
    const dlg = document.querySelector('[role="dialog"], [role="alertdialog"]');
    if (!dlg) return 'none';
    return JSON.stringify({
      text: dlg.textContent.replace(/\s+/g, ' ').slice(0, 160),
      buttons: [...dlg.querySelectorAll('button')].map((b) => b.textContent.trim() || b.getAttribute('aria-label')),
    });
  })));
  const confirmYes = page.locator('[role="dialog"] button:has-text("Phát lệnh"), [role="alertdialog"] button:has-text("Phát lệnh"), [role="dialog"] button:has-text("Xác nhận")').first();
  if (await confirmYes.count()) await confirmYes.click();
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${OUT}/sil798-05-issued.png` });
  log('after issue: ' + (await page.evaluate(() => {
    const toast = document.querySelector('[role="status"], [class*="toast"]');
    return JSON.stringify({ toast: toast?.textContent?.slice(0, 140) ?? null });
  })));
  log('dispatcher leg done');
  await ctx.close();

  // ── 2. Driver: accept → 409 → banner ──────────────────────────────────
  const dctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const dpage = await dctx.newPage();
  const api409s = [];
  dpage.on('response', (r) => { if (r.status() === 409) api409s.push(`${r.status()} ${r.url().slice(0, 120)}`); });
  await login(dpage, 'laixe');
  await dpage.goto(`${FE}/my-trips`, { waitUntil: 'networkidle' });
  await dpage.waitForTimeout(1500);
  await dpage.screenshot({ path: `${OUT}/sil798-06-driver-board.png` });
  const href = await dpage.evaluate(() => {
    const links = [...document.querySelectorAll('a[href^="/my-trips/"]')];
    return links.map((a) => a.getAttribute('href')).find((h) => /\/my-trips\/\d+$/.test(h)) ?? null;
  });
  log(`driver order: ${href}`);
  if (!href) throw new Error('no order card for laixe — the issue leg failed');
  await dpage.goto(`${FE}${href}`, { waitUntil: 'networkidle' });
  await dpage.waitForTimeout(1200);
  const accept = dpage.locator('[data-testid="accept-sticky-bar"] button');
  await accept.click();
  await dpage.waitForTimeout(3000);
  await dpage.screenshot({ path: `${OUT}/sil798-07-after-accept-409.png` });

  const banner = dpage.locator('[data-testid="blocking-trip-banner"]');
  const bannerState = (await banner.count())
    ? await banner.evaluate((el) => ({
        text: el.textContent.replace(/\s+/g, ' ').slice(0, 200),
        links: [...el.querySelectorAll('a')].map((a) => ({ href: a.getAttribute('href'), label: a.textContent.trim() })),
        leakedTrpCode: /TRP-/.test(el.textContent),
      }))
    : { absent: true };
  log('BANNER ' + JSON.stringify(bannerState));
  log('API409 ' + JSON.stringify(api409s));
  const btnFace = await dpage.evaluate(() => {
    const el = document.querySelector('[data-testid="accept-sticky-bar"] button');
    if (!el) return { gone: true };
    const cs = getComputedStyle(el);
    return { bg: cs.backgroundColor, hasCheck: el.querySelector('svg')?.innerHTML.includes('M9 12l2 2 4-4') ?? false };
  });
  log('BUTTON ' + JSON.stringify(btnFace));
  if (bannerState.links?.[0]) {
    await banner.locator('a').first().click();
    await dpage.waitForTimeout(1500);
    log(`banner link lands on: ${dpage.url()}`);
    await dpage.screenshot({ path: `${OUT}/sil798-08-blocking-trip-opened.png` });
  }
  await dctx.close();
} finally {
  await browser.close();
}
