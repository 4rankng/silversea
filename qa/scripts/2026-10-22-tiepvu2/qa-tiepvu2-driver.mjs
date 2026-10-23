// QA driver — TiepVu 22/10-2 (cards 261022213755a/b/c). BEFORE/GREEN parameterized:
//   BASE=http://localhost:7175 TAG=truoc node qa/scripts/2026-10-22-tiepvu2/qa-tiepvu2-driver.mjs
// BASE=7175 = main checkout (pre-fix), BASE=7176 = worktree stack (fixed).
// Covers: (a) driver nhận lệnh → e-POD gate; (b) CUS nhập lẻ kho GLC search;
// (c) badge Nhập lẻ/Xuất lẻ. Screenshots + DOM assertions + network log.
import { chromium } from '@playwright/test';
import { mkdirSync, appendFileSync } from 'node:fs';

const BASE = process.env.BASE || 'http://localhost:7176';
const TAG = process.env.TAG || 'run';
const TRIP_ID = process.env.TRIP_ID || '58';
const OUT = process.env.OUT || `../../2026-10-22-tiepvu2`;
mkdirSync(OUT, { recursive: true });
const LOG = `${OUT}/qa-tiepvu2-${TAG}-driver.log`;
appendFileSync(LOG, `\n=== run ${new Date().toISOString()} BASE=${BASE} TAG=${TAG} TRIP=${TRIP_ID} ===\n`);

const browser = await chromium.launch({ headless: true });
const netLog = [];

async function login(page, username) {
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle', timeout: 30000 });
  await page.fill('input[name="username"]', username);
  await page.fill('input[name="password"]', 'Abc123');
  await page.click('button[type="submit"]');
  await page.waitForTimeout(2500);
  const token = await page.evaluate(() => localStorage.getItem('token') || localStorage.getItem('authToken') || '');
  appendFileSync(LOG, `login ${username}: token=${token ? 'present' : 'MISSING'} url=${page.url()}\n`);
  return Boolean(token);
}

function shot(page, name) {
  return page.screenshot({ path: `${OUT}/${name}` });
}

try {
  // ── (a) DRIVER: nhận lệnh → e-POD completion gate ─────────────────────────
  const dpage = await browser.newPage({ viewport: { width: 390, height: 900 } });
  try {
  await login(dpage, 'laixe');
  await dpage.goto(`${BASE}/my-trips/${TRIP_ID}`, { waitUntil: 'networkidle', timeout: 30000 });
  await dpage.waitForTimeout(1500);
  const acceptBar = await dpage.locator('[data-testid="accept-sticky-bar"]').count();
  const completeBar = await dpage.locator('[data-testid="complete-sticky-bar"]').count();
  const stickyStatus = completeBar
    ? await dpage.locator('[data-testid="complete-sticky-status"]').innerText().catch(() => '')
    : '';
  appendFileSync(LOG, `(a) accept-bar=${acceptBar} complete-bar=${completeBar} status="${stickyStatus}" url=${dpage.url()}\n`);
  await shot(dpage, `2026-10-22-tiepvu2_${TAG}_driver-a1-detail.png`);
  if (acceptBar > 0) {
    // Nhận lệnh KHÔNG yêu cầu ảnh — one tap, no upload step.
    await dpage.locator('[data-testid="accept-sticky-bar"] button').click();
    await dpage.waitForTimeout(3000);
    appendFileSync(LOG, `(a) accepted → ${dpage.url()}\n`);
    await shot(dpage, `2026-10-22-tiepvu2_${TAG}_driver-a2-sau-nhanlenh.png`);
  }
  // e-POD screen — the completion gate surface.
  await dpage.goto(`${BASE}/my-trips/${TRIP_ID}/pod`, { waitUntil: 'networkidle', timeout: 30000 });
  await dpage.waitForTimeout(2000);
  const completeBtn = dpage.locator('button:has-text("HOÀN THÀNH CHUYẾN")').first();
  const completeResp = dpage.waitForResponse((r) => r.url().includes('/complete') && r.request().method() === 'POST', { timeout: 20000 }).then(async (r) => ({ status: r.status(), body: await r.text().catch(() => '') })).catch(() => null);
  const btnState = await completeBtn.evaluate((el) => ({ disabled: el.disabled, text: el.textContent?.trim() }));
  const footerSummary = await dpage.locator('.driver-task-footer__summary').innerText().catch(() => '');
  const cardTitle = await dpage.locator('.trip-pod__title').innerText().catch(() => '');
  appendFileSync(LOG, `(a) ePOD card="${cardTitle}" button=${JSON.stringify(btnState)}\n(a) footer=${JSON.stringify(footerSummary)}\n`);
  await shot(dpage, `2026-10-22-tiepvu2_${TAG}_driver-a3-epod-gate.png`);
  if (process.env.COMPLETE === '1' && !btnState.disabled) {
    const respP = completeResp;
    await completeBtn.click();
    const resp = await respP;
    appendFileSync(LOG, `(a) complete POST → ${resp ? `${resp.status} ${resp.body.slice(0, 220)}` : 'no-response-captured'}\n`);
    await dpage.waitForTimeout(4000);
    appendFileSync(LOG, `(a) after complete → ${dpage.url()}\n`);
    await shot(dpage, `2026-10-22-tiepvu2_${TAG}_driver-a4-after-complete.png`);
  }
  } catch (eA) {
    appendFileSync(LOG, `FAIL-a: ${eA?.message ?? eA}\n`);
    console.log(`FAIL-a [${TAG}] ${eA?.message ?? eA}`);
    await shot(dpage, `2026-10-22-tiepvu2_${TAG}_driver-a-FAIL.png`).catch(() => {});
  }
  await dpage.close();

  // ── (b) CUS: nhập lẻ — kho lấy hàng search GLC ───────────────────────────
  const cpage = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  try {
  cpage.on('response', (r) => {
    const u = typeof r.url === 'function' ? r.url() : String(r.url);
    if (u.includes('operational-sites') || u.includes('/shipments')) {
      netLog.push(`${r.status()} ${r.request().method()} ${u.slice(0, 110)}`);
    }
  });
  await login(cpage, 'cus');
  // Create-form route for the LCL lot (nhập lẻ).
  await cpage.goto(`${BASE}/shipments/new`, { waitUntil: 'networkidle', timeout: 30000 });
  await cpage.waitForTimeout(2000);
  if (cpage.url().includes('/login')) throw new Error('cus login failed');
  await shot(cpage, `2026-10-22-tiepvu2_${TAG}_cus-b1-create-form.png`);
  // Pick customer (LONG MINH owns the QA GLC kho) then IMPORT + hàng lẻ mode.
  const customerInput = cpage.locator('#shipment-customer, [data-field-id="shipment-customer"] input').first();
  await customerInput.click();
  await cpage.waitForTimeout(800);
  const longMinh = cpage.locator('[role="option"]', { hasText: 'LONG MINH' }).first();
  await longMinh.click();
  await cpage.waitForTimeout(1000);
  // Direction IMPORT + cargo mode LCL (hàng lẻ) — button/segment labels vary;
  // click the control that switches to hàng lẻ.
  const lclSwitch = cpage.locator('button:has-text("lẻ"), [role="radio"]:has-text("lẻ"), label:has-text("hàng lẻ")').first();
  if (await lclSwitch.count()) { await lclSwitch.click(); await cpage.waitForTimeout(600); }
  await shot(cpage, `2026-10-22-tiepvu2_${TAG}_cus-b2-lcl-mode.png`);
  // Focus the kho field and type GLC char by char.
  const khoInput = cpage.locator('#shipment-pickup-warehouse input, [data-field-id="shipment-pickup-warehouse"] input').first();
  await khoInput.scrollIntoViewIfNeeded();
  await khoInput.click();
  await cpage.waitForTimeout(800);
  for (const ch of ['G', 'L', 'C']) {
    await khoInput.press(ch);
    await cpage.waitForTimeout(450);
  }
  await cpage.waitForTimeout(600);
  const khoState = await khoInput.evaluate((el) => ({ expanded: el.getAttribute('aria-expanded'), value: el.value }));
  const glcOptionVisible = await cpage.locator('[role="option"]:has-text("GLC")').count();
  appendFileSync(LOG, `(b) after typing GLC: input=${JSON.stringify(khoState)} glcOptions=${glcOptionVisible}\n`);
  await shot(cpage, `2026-10-22-tiepvu2_${TAG}_cus-b3-typed-GLC.png`);
  // Case variants on the fixed stack.
  if (TAG === 'sau') {
    for (const variant of ['Glc', 'glc', 'GL']) {
      await khoInput.fill('');
      await khoInput.click();
      await khoInput.pressSequentially(variant, { delay: 250 });
      await cpage.waitForTimeout(600);
      const count = await cpage.locator('[role="option"]:has-text("GLC")').count();
      const expanded = await khoInput.getAttribute('aria-expanded');
      appendFileSync(LOG, `(b) variant ${variant}: options=${count} expanded=${expanded}\n`);
      await shot(cpage, `2026-10-22-tiepvu2_${TAG}_cus-b4-variant-${variant}.png`);
    }
    // Real pick commits the catalog id.
    await khoInput.fill('');
    await khoInput.click();
    await khoInput.pressSequentially('GLC', { delay: 250 });
    await cpage.waitForTimeout(600);
    await cpage.locator('[role="option"]:has-text("GLC")').first().click();
    await cpage.waitForTimeout(600);
    const picked = await khoInput.evaluate((el) => el.value);
    appendFileSync(LOG, `(b) picked GLC → input value="${picked}"\n`);
    await shot(cpage, `2026-10-22-tiepvu2_${TAG}_cus-b5-picked-GLC.png`);
  }
  appendFileSync(LOG, `(b) net:\n${netLog.slice(0, 12).join('\n')}\n`);
  } catch (eB) {
    appendFileSync(LOG, `FAIL-b: ${eB?.message ?? eB}\n`);
    console.log(`FAIL-b [${TAG}] ${eB?.message ?? eB}`);
    await shot(cpage, `2026-10-22-tiepvu2_${TAG}_cus-b-FAIL.png`).catch(() => {});
  }
  await cpage.close();

  // ── (c) CUS list: badge Nhập lẻ/Xuất lẻ ──────────────────────────────────
  const lpage = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  try {
  await login(lpage, 'cus');
  await lpage.goto(`${BASE}/shipments`, { waitUntil: 'networkidle', timeout: 30000 });
  await lpage.waitForTimeout(2500);
  const badges = await lpage.locator('.cus-direction-badge').allInnerTexts();
  appendFileSync(LOG, `(c) direction badges on list: ${JSON.stringify(badges.slice(0, 12))}\n`);
  await shot(lpage, `2026-10-22-tiepvu2_${TAG}_cus-c1-list-badges.png`, { fullPage: false });
  // Detail of the first LCL lot: find an LCL row and open it.
  const lclRow = lpage.locator('tbody tr').filter({ hasText: /lẻ|LCL/i }).first();
  if (await lclRow.count()) {
    const rowText = (await lclRow.innerText()).slice(0, 160).replace(/\n/g, ' | ');
    appendFileSync(LOG, `(c) LCL row text: ${rowText}\n`);
    await lclRow.locator('button, [role="button"]').first().click({ trial: false }).catch(() => {});
    await lpage.waitForTimeout(1500);
    appendFileSync(LOG, `(c) navigated → ${lpage.url()}\n`);
    const xuNhap = await lpage.locator('dt:has-text("Xuất / Nhập") + dd').innerText().catch(() => '');
    appendFileSync(LOG, `(c) detail Xuất / Nhập = "${xuNhap}"\n`);
    await shot(lpage, `2026-10-22-tiepvu2_${TAG}_cus-c2-detail.png`);
  }
  } catch (eC) {
    appendFileSync(LOG, `FAIL-c: ${eC?.message ?? eC}\n`);
    console.log(`FAIL-c [${TAG}] ${eC?.message ?? eC}`);
    await shot(lpage, `2026-10-22-tiepvu2_${TAG}_cus-c-FAIL.png`).catch(() => {});
  }
  await lpage.close();

  console.log(`OK [${TAG}] artifacts in ${OUT}`);
} catch (err) {
  appendFileSync(LOG, `FAIL: ${err?.message ?? err}\n${err?.stack ?? ''}\n`);
  console.log(`FAIL [${TAG}] ${err?.message ?? err}`);
} finally {
  await browser.close();
}
