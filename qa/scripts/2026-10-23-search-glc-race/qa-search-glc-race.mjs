// QA repro driver — TiepVu22Oct-3: search kho "GLC" race.
// Types G→GL→GLC into the shared-catalog kho combobox on the shipment create
// form and captures, AFTER EACH KEYSTROKE: aria-expanded, input.value, the
// rendered option texts, plus every network request touching operational-sites
// (to confirm/deny a server-side search path). Control: type "LC" only.
//
//   BASE=http://localhost:7175 TAG=truoc node qa/scripts/2026-10-23-search-glc-race/qa-search-glc-race.mjs
import { chromium } from '@playwright/test';
import { mkdirSync, appendFileSync, writeFileSync } from 'node:fs';

const BASE = process.env.BASE || 'http://localhost:7175';
const TAG = process.env.TAG || 'run';
const DELAY = Number(process.env.DELAY ?? 120); // ms between keystrokes
const OUT = process.env.OUT || '../../2026-10-23-search-glc-race';
mkdirSync(OUT, { recursive: true });
const LOG = `${OUT}/qa-search-glc-${TAG}-driver.log`;
const JSON_OUT = `${OUT}/qa-search-glc-${TAG}-probe.json`;
appendFileSync(LOG, `\n=== run ${new Date().toISOString()} BASE=${BASE} TAG=${TAG} DELAY=${DELAY} ===\n`);

const report = { base: BASE, tag: TAG, delay: DELAY, net: [], scenarios: [] };
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

page.on('request', (r) => {
  const u = r.url();
  if (u.includes('operational-sites')) report.net.push(`${r.method()} ${u}`);
});
page.on('response', (r) => {
  const u = r.url();
  if (u.includes('operational-sites')) report.net.push(`<= ${r.status()} ${u}`);
});

async function login() {
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle', timeout: 30000 });
  await page.fill('input[name="username"]', 'cus');
  await page.fill('input[name="password"]', 'Abc123');
  await page.click('button[type="submit"]');
  await page.waitForTimeout(2500);
  if (page.url().includes('/login')) throw new Error('cus login failed');
}

async function snapshot(label) {
  const state = await page.evaluate(() => {
    const input = document.querySelector('[data-field-id="shipment-pickup-warehouse"] input[role="combobox"]');
    const options = Array.from(document.querySelectorAll('[role="option"]')).map((o) => {
      const rect = o.getBoundingClientRect();
      return {
        text: (o.textContent || '').trim().slice(0, 60),
        visible: rect.width > 0 && rect.height > 0,
        inKhoPopover: Boolean(o.closest('[data-radix-popover], [data-rac-popover]')) || Boolean(o.closest('[id^="react-aria"]')) || true,
      };
    });
    // The popover that hosts the kho listbox: react-aria renders the input's
    // aria-controls → listbox id when the menu is open.
    const controlsId = input?.getAttribute('aria-controls');
    const listbox = controlsId ? document.getElementById(controlsId) : null;
    const popover = listbox?.closest('[data-rac-popover], [data-state], [data-radix-popper-content-wrapper]') ?? null;
    return {
      expanded: input?.getAttribute('aria-expanded') ?? null,
      value: input?.value ?? null,
      controlsId: controlsId ?? null,
      listboxMounted: Boolean(listbox),
      popoverAttr: popover ? (popover.getAttribute('data-state') ?? popover.tagName.toLowerCase()) : null,
      popoverVisible: popover ? popover.getBoundingClientRect().height > 0 : false,
      options,
      visibleOptionTexts: options.filter((o) => o.visible).map((o) => o.text),
    };
  });
  report.scenarios.push({ label, ...state });
  appendFileSync(LOG, `${label}: exp=${state.expanded} value=${JSON.stringify(state.value)} popover=${state.popoverAttr}/${state.popoverVisible} visible=[${state.visibleOptionTexts.join(' | ')}] mounted=[${state.options.map((o) => o.text).join(' | ')}]\n`);
  return state;
}

async function setupCreateForm() {
  await page.goto(`${BASE}/shipments/new`, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(2000);
  // 1) customer LONG MINH
  const customerInput = page.locator('#shipment-customer input, [data-field-id="shipment-customer"] input').first();
  await customerInput.click();
  await page.waitForTimeout(700);
  await page.locator('[role="option"]', { hasText: 'LONG MINH' }).first().click();
  await page.waitForTimeout(900);
  // 2) trade direction = Nhập khẩu (kho lấy hàng)
  const dirSelect = page.locator('#shipment-trade-direction, [data-field-id="shipment-trade-direction"] select, [data-field-id="shipment-trade-direction"] button').first();
  await dirSelect.scrollIntoViewIfNeeded();
  const tag = await dirSelect.evaluate((el) => el.tagName.toLowerCase());
  if (tag === 'select') {
    await dirSelect.selectOption('IMPORT');
  } else {
    await dirSelect.click();
    await page.waitForTimeout(400);
    await page.locator('[role="option"]', { hasText: 'Nhập khẩu' }).first().click();
  }
  await page.waitForTimeout(600);
  // 3) cargo mode = Hàng lẻ (LCL)
  const lclSwitch = page.locator('button:has-text("lẻ"), [role="radio"]:has-text("lẻ"), label:has-text("Hàng lẻ")').first();
  if (await lclSwitch.count()) { await lclSwitch.scrollIntoViewIfNeeded(); await lclSwitch.click(); await page.waitForTimeout(700); }
  // 4) focus the kho field
  const khoInput = page.locator('#shipment-pickup-warehouse input, [data-field-id="shipment-pickup-warehouse"] input').first();
  await khoInput.scrollIntoViewIfNeeded();
  await khoInput.click();
  await page.waitForTimeout(800);
  return khoInput;
}

try {
  await login();
  const khoInput = await setupCreateForm();
  await snapshot('S0-open');

  // ── A) fresh field: G → GL → GLC ─────────────────────────────────────────
  for (const ch of ['G', 'L', 'C']) {
    await khoInput.press(ch);
    await page.waitForTimeout(DELAY);
    await snapshot(`A-typed-${['G', 'GL', 'GLC'][['G', 'L', 'C'].indexOf(ch)]}`);
  }
  await page.screenshot({ path: `${OUT}/qa-${TAG}-A-typed-GLC.png` });

  // ── B) control: clear, type "LC" only ────────────────────────────────────
  await khoInput.fill('');
  await khoInput.click();
  await page.waitForTimeout(400);
  for (const ch of ['L', 'C']) {
    await khoInput.press(ch);
    await page.waitForTimeout(DELAY);
    await snapshot(`B-typed-${ch === 'L' ? 'L' : 'LC'}`);
  }
  await page.screenshot({ path: `${OUT}/qa-${TAG}-B-typed-LC.png` });

  // ── C) retype over an existing pick: pick "Kho ST" (Sóng Thần), select-all, GLC ─
  await khoInput.fill('');
  await khoInput.click();
  await page.waitForTimeout(500);
  const stOption = page.locator('[role="option"]', { hasText: 'Kho ST' }).first();
  if (await stOption.count()) {
    await stOption.click();
    await page.waitForTimeout(700);
    await snapshot('C0-picked-song-than');
    await khoInput.click();
    await page.keyboard.down('Meta'); await page.keyboard.press('a'); await page.keyboard.up('Meta');
    await page.waitForTimeout(200);
    for (const ch of ['G', 'L', 'C']) {
      await khoInput.press(ch);
      await page.waitForTimeout(DELAY);
      await snapshot(`C-typed-${['G', 'GL', 'GLC'][['G', 'L', 'C'].indexOf(ch)]}`);
    }
    await page.screenshot({ path: `${OUT}/qa-${TAG}-C-typed-GLC-over-pick.png` });
  } else {
    appendFileSync(LOG, 'C: Sóng Thần option not found — skipped\n');
  }

  appendFileSync(LOG, `net operational-sites (${report.net.length}):\n${report.net.join('\n')}\n`);
  writeFileSync(JSON_OUT, JSON.stringify(report, null, 2));
  console.log(`OK [${TAG}] delay=${DELAY} — artifacts in ${OUT}`);
} catch (e) {
  appendFileSync(LOG, `FAIL: ${e?.message ?? e}\n${e?.stack ?? ''}\n`);
  writeFileSync(JSON_OUT, JSON.stringify(report, null, 2));
  console.log(`FAIL [${TAG}] ${e?.message ?? e}`);
} finally {
  await browser.close();
}
