// Green-run probe — TiepVu22Oct-3: diacritics normalization on the real UI,
// a REAL pick committing the GLC id after retyping over a pick, and a 390px
// spot-check of the G→GL→GLC contract.
import { chromium } from '@playwright/test';
import { mkdirSync, appendFileSync } from 'node:fs';

const BASE = process.env.BASE || 'http://localhost:7176';
const TAG = process.env.TAG || 'sau';
const OUT = process.env.OUT || '../../2026-10-23-search-glc-race';
mkdirSync(OUT, { recursive: true });
const LOG = `${OUT}/qa-search-glc-${TAG}-green.log`;
appendFileSync(LOG, `\n=== green run ${new Date().toISOString()} BASE=${BASE} ===\n`);

const browser = await chromium.launch({ headless: true });

async function newPage(w, h) {
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle', timeout: 30000 });
  await page.fill('input[name="username"]', 'cus');
  await page.fill('input[name="password"]', 'Abc123');
  await page.click('button[type="submit"]');
  await page.waitForTimeout(2500);
  await page.goto(`${BASE}/shipments/new`, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(1500);
  const customerInput = page.locator('#shipment-customer input, [data-field-id="shipment-customer"] input').first();
  await customerInput.click();
  await page.waitForTimeout(700);
  await page.locator('[role="option"]', { hasText: 'LONG MINH' }).first().click();
  await page.waitForTimeout(900);
  const dirSelect = page.locator('[data-field-id="shipment-trade-direction"] select').first();
  await dirSelect.selectOption('IMPORT').catch(async () => {
    const btn = page.locator('[data-field-id="shipment-trade-direction"] button').first();
    await btn.click(); await page.waitForTimeout(400);
    await page.locator('[role="option"]', { hasText: 'Nhập khẩu' }).first().click();
  });
  await page.waitForTimeout(500);
  const lclSwitch = page.locator('button:has-text("lẻ"), [role="radio"]:has-text("lẻ"), label:has-text("Hàng lẻ")').first();
  if (await lclSwitch.count()) { await lclSwitch.scrollIntoViewIfNeeded(); await lclSwitch.click(); await page.waitForTimeout(700); }
  const khoInput = page.locator('[data-field-id="shipment-pickup-warehouse"] input[role="combobox"]').first();
  await khoInput.scrollIntoViewIfNeeded();
  await khoInput.click();
  await page.waitForTimeout(700);
  return { page, khoInput };
}

async function state(page, label) {
  const s = await page.evaluate(() => {
    const input = document.querySelector('[data-field-id="shipment-pickup-warehouse"] input[role="combobox"]');
    return {
      expanded: input?.getAttribute('aria-expanded') ?? null,
      value: input?.value ?? null,
      visible: Array.from(document.querySelectorAll('[role="option"]'))
        .filter((o) => o.getBoundingClientRect().height > 0)
        .map((o) => (o.textContent || '').trim().slice(0, 40)),
    };
  });
  appendFileSync(LOG, `${label}: ${JSON.stringify(s)}\n`);
  return s;
}

try {
  // ── 1440: diacritics + real pick ─────────────────────────────────────────
  const { page, khoInput } = await newPage(1440, 900);
  for (const [typed, expectSub] of [['Bãi', 'GLC'], ['Đà Nẵng', 'Đà Nẵng']]) {
    await khoInput.fill('');
    await khoInput.click();
    await khoInput.pressSequentially(typed, { delay: 90 });
    await page.waitForTimeout(500);
    const s = await state(page, `diacritics "${typed}"`);
    if (!s.visible.some((t) => t.includes(expectSub))) throw new Error(`diacritics "${typed}" did not surface ${expectSub}: ${JSON.stringify(s.visible)}`);
  }
  await page.screenshot({ path: `${OUT}/qa-${TAG}-diacritics-danang.png` });

  // Retype over an existing pick, then REALLY click the GLC option.
  await khoInput.fill('');
  await khoInput.click();
  await page.waitForTimeout(400);
  await page.locator('[role="option"]', { hasText: 'Kho ST' }).first().click();
  await page.waitForTimeout(600);
  await state(page, 'picked Kho ST');
  await khoInput.click();
  await page.keyboard.down('Meta'); await page.keyboard.press('a'); await page.keyboard.up('Meta');
  for (const ch of ['G', 'L', 'C']) { await khoInput.press(ch); await page.waitForTimeout(140); }
  await state(page, 're-typed GLC over pick');
  // Bare-Enter commit of the unique match (20260922_4 + session-end law).
  await khoInput.press('Enter');
  await page.waitForTimeout(500);
  const entered = await state(page, 'bare-Enter over re-typed GLC');
  if (!(entered.expanded === 'false' && entered.value === 'GLC')) throw new Error(`bare-Enter commit failed: ${JSON.stringify(entered)}`);
  await page.screenshot({ path: `${OUT}/qa-${TAG}-enter-commit-GLC.png` });

  // Fresh cycle: click the GLC option for the pick-commit proof.
  await khoInput.fill('');
  await khoInput.click();
  await page.waitForTimeout(400);
  for (const ch of ['G', 'L', 'C']) { await khoInput.press(ch); await page.waitForTimeout(140); }
  await state(page, 'fresh re-typed GLC');
  await page.locator('[role="option"]', { hasText: 'GLC' }).first().click();
  await page.waitForTimeout(700);
  const after = await state(page, 'after clicking GLC option');
  if (after.value !== 'GLC') throw new Error(`pick did not commit GLC label: ${JSON.stringify(after)}`);
  await page.screenshot({ path: `${OUT}/qa-${TAG}-picked-glc-over-retype.png` });
  await page.close();

  // ── 390: the G→GL→GLC contract at mobile width ──────────────────────────
  const m = await newPage(390, 900);
  for (const ch of ['G', 'L', 'C']) { await m.khoInput.press(ch); await m.page.waitForTimeout(140); }
  const ms = await state(m.page, '390 typed GLC');
  if (!(ms.expanded === 'true' && ms.visible.some((t) => t.includes('GLC')))) throw new Error(`390 GLC contract failed: ${JSON.stringify(ms)}`);
  await m.page.screenshot({ path: `${OUT}/qa-${TAG}-390-typed-GLC.png` });
  await m.page.close();

  appendFileSync(LOG, `GREEN-OK exit 0\n`);
  console.log('GREEN OK');
} catch (e) {
  appendFileSync(LOG, `GREEN-FAIL: ${e?.message ?? e}\n`);
  console.log(`GREEN FAIL ${e?.message ?? e}`);
  process.exitCode = 1;
} finally {
  await browser.close();
}
