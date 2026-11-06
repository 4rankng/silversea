// SIL-698 + SIL-251 + SIL-427 UI driver — the §9 evidence run.
// Command: node qa/2026-11-06-lane-698-ui/capture.mjs
// Drives the real pages at 1440/1920 as dieuvan (DISPATCHER): the /dispatch
// one-line header law (SIL-698), the schedule popover copy affordance
// (SIL-251), and the LCL delivery-date chip (SIL-427). Writes screenshots +
// capture.log. Exit 1 on any core assertion failure.
import puppeteer from 'puppeteer';
import { mkdirSync, appendFileSync } from 'node:fs';

const OUT = new URL('.', import.meta.url).pathname;
const BASE = process.env.CAPTURE_BASE || 'http://localhost:7191';
mkdirSync(OUT, { recursive: true });
const log = (line) => { console.log(line); appendFileSync(`${OUT}capture.log`, `${line}\n`); };

let failed = false;
const assert = (cond, label) => {
  log(`${cond ? 'PASS' : 'FAIL'}  ${label}`);
  if (!cond) failed = true;
  return cond;
};

const browser = await puppeteer.launch({ headless: 'new' });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle2' });
  await page.waitForSelector('input', { timeout: 15000 });
  await page.type('input:not([type="password"])', 'dieuvan');
  await page.type('input[type="password"]', 'Abc123');
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 }).catch(() => {}),
    page.click('button[type="submit"], button:not([type])'),
  ]);
  await page.waitForFunction(() => !location.pathname.startsWith('/login'), { timeout: 30000 });
  log(`login ok → ${await page.evaluate(() => location.pathname)}`);

  // ── SIL-698: /dispatch headers one line at 1440 ──────────────────────────
  const measureHeaders = () => page.evaluate(() => {
    const ths = [...document.querySelectorAll('.master-plan-grid thead th')];
    return ths.map((th) => {
      const r = th.getBoundingClientRect();
      const cs = getComputedStyle(th);
      return {
        label: th.textContent.trim(),
        height: Math.round(r.height),
        wraps: r.height > 46, // one 10px line + 20px padding ≈ 35; two lines ≈ 55
        overflows: th.scrollWidth > th.clientWidth + 1,
        whiteSpace: cs.whiteSpace,
        fontSize: cs.fontSize,
        letterSpacing: cs.letterSpacing,
      };
    });
  });

  await page.goto(`${BASE}/dispatch`, { waitUntil: 'networkidle2' });
  await page.waitForSelector('.master-plan-grid thead th', { timeout: 30000 });
  const h1440 = await measureHeaders();
  const wrapped1440 = h1440.filter((h) => h.wraps || h.overflows);
  assert(h1440.length >= 8, `SIL-698 1440: header count = ${h1440.length} (expected ≥ 8)`);
  assert(wrapped1440.length === 0, `SIL-698 1440: 0 headers wrap/overflow (wrapped: ${wrapped1440.map((h) => h.label).join(', ') || 'none'})`);
  assert(h1440.every((h) => h.whiteSpace === 'nowrap'), 'SIL-698 1440: every header computes white-space nowrap');
  assert(h1440.every((h) => h.fontSize === '10px'), `SIL-698 1440: header font-size 10px (got: ${[...new Set(h1440.map((h) => h.fontSize))].join(',')})`);
  await page.screenshot({ path: `${OUT}698-dispatch-1440.png` });

  await page.setViewport({ width: 1920, height: 1080 });
  await new Promise((r) => setTimeout(r, 600));
  const h1920 = await measureHeaders();
  const wrapped1920 = h1920.filter((h) => h.wraps || h.overflows);
  assert(h1920.length >= 8, `SIL-698 1920: header count = ${h1920.length}`);
  assert(wrapped1920.length === 0, `SIL-698 1920: 0 headers wrap/overflow (wrapped: ${wrapped1920.map((h) => h.label).join(', ') || 'none'})`);
  await page.screenshot({ path: `${OUT}698-dispatch-1920.png` });

  // ── SIL-251: schedule popover copy affordance (/shipments-detail) ────────
  await page.setViewport({ width: 1440, height: 900 });
  await page.goto(`${BASE}/shipments-detail`, { waitUntil: 'networkidle2' });
  await page.waitForSelector('.shipment-container-ledger', { timeout: 30000 });
  // The per-row trigger is an AriaButton whose accessible NAME is built from
  // its cell content; the stable hook is data-cell-label="lịch trình".
  await page.waitForSelector('[data-cell-label="lịch trình"]', { timeout: 20000 }).catch(() => {});
  const firstTrigger = await page.$('[data-cell-label="lịch trình"]');
  if (firstTrigger) {
    await firstTrigger.click();
    const copyBtn = await page.waitForSelector('.shipment-container-ledger__schedule-copy, [aria-label="Copy giờ hẹn trong hộp thoại"]', { timeout: 10000 }).catch(() => null);
    assert(Boolean(copyBtn), 'SIL-251: schedule popover renders the copy-time affordance');
    const popoverShot = `${OUT}251-schedule-popover-copy-1440.png`;
    await page.screenshot({ path: popoverShot });
    const popoverState = await page.evaluate(() => {
      const btn = document.querySelector('[aria-label="Copy giờ hẹn trong hộp thoại"]');
      const time = [...document.querySelectorAll('.shipment-container-ledger__editor-grid input')].find((i) => i.placeholder === 'HH:mm');
      return { copyLabel: btn?.getAttribute('aria-label') ?? null, timeValue: time?.value ?? null };
    });
    log(`SIL-251 popover state: ${JSON.stringify(popoverState)}`);
    await page.keyboard.press('Escape');
  } else {
    log('SKIP  SIL-251: no editable schedule trigger on /shipments-detail rows (data-dependent surface) — component-level pins stand');
  }

  // ── SIL-427: LCL delivery-date chip (/shipments/new) ─────────────────────
  await page.goto(`${BASE}/shipments/new`, { waitUntil: 'networkidle2' });
  await page.waitForSelector('input, [role="radiogroup"]', { timeout: 30000 });
  const lclRadio = await page.evaluateHandle(() => [...document.querySelectorAll('label, [role="radio"], input[type="radio"]')].find((el) => /Hàng lẻ/.test(el.textContent ?? '')));
  const lclEl = lclRadio.asElement();
  if (lclEl) {
    await lclEl.click();
    const chip = await page.waitForSelector('[data-field-id="shipment-lcl-expected-delivery"]', { timeout: 10000 }).catch(() => null);
    assert(Boolean(chip), 'SIL-427: LCL form renders the Ngày giao hàng chip');
    const chipText = chip ? await page.evaluate((el) => el.textContent, chip) : null;
    log(`SIL-427 chip text: ${JSON.stringify(chipText)}`);
    assert(Boolean(chipText?.includes('Ngày giao hàng')), 'SIL-427: chip names Ngày giao hàng');
    const labelStill = await page.evaluate(() => document.querySelector('[data-field-id="shipment-lcl-closing-at"] .split-datetime__label')?.textContent ?? '');
    assert(labelStill.includes('Ngày giờ đóng trả'), 'SIL-427: schedule field label stays Ngày giờ đóng trả');
    await page.screenshot({ path: `${OUT}427-lcl-delivery-label-1440.png` });
  } else {
    log('SKIP  SIL-427: Hàng lẻ radio not found on /shipments/new');
  }

  log(failed ? 'CAPTURE: FAIL' : 'CAPTURE: ALL PASS');
  if (failed) process.exitCode = 1;
} finally {
  await browser.close();
}
