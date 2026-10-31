// SIL-621 (id 725) — popup "Sửa cước thu khách" (lô lẻ) — rung-3 UI drive (§9).
// Owner 30/10: the popup carries NO guidance text — the group-lock hint
// («Lô đã thuộc nhóm gộp xe (ghép cước trả ĐVVC)…») and the long auto-trace
// helpText («Nhập tay giá thỏa thuận…») are gone; the placeholder
// («Bỏ trống = tự tra bảng giá») stays and a grouped lot still LOCKS its
// fields (disabled, no text).
// Drives BOTH states on the shipment-detail ledger at 1307px:
//   A) ungrouped LCL lot  → fields enabled, no AUTO/lock/help text
//   B) cost-grouped lot   → fields disabled, no lock/help text (evidence case)
// House contract server pattern (card 20260928_192): defaults are the Makefile
// contract fe :7175 / be :3002 — override with QA_BASE/QA_API (a worktree lane
// serving offset ports points QA_BASE at its frontend origin and QA_API at
// `<origin>/api`).
// Artifacts: qa/2026-10-31_sil621_lcl-editor-ungrouped-1307.png
//            qa/2026-10-31_sil621_lcl-editor-costlocked-1307.png
//            qa/2026-10-31_sil621_lcl-editor-driver.log
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

const require2 = createRequire(import.meta.dirname + '/../../../package.json');
const puppeteer = require2('puppeteer-core');

const BASE = process.env.QA_BASE || 'http://localhost:7175';
const API = process.env.QA_API || 'http://localhost:3002/api';
// The popup lives on the Chi tiết lô hàng ledger (/shipments-detail) —
// /shipments/:id is the SIL-481 post-create review workspace (no ledger).
// Each case deep-links the ledger on the lot's Bill (searchSuffix ≥ 4 chars).
const CASES = [
  { key: 'ungrouped', shipmentId: Number(process.env.QA_UNGROUPED_ID || 669), bill: process.env.QA_UNGROUPED_BILL || 'SIL587-998894', expectLocked: false },
  { key: 'costlocked', shipmentId: Number(process.env.QA_COSTLOCKED_ID || 184), bill: process.env.QA_COSTLOCKED_BILL || 'R41B1-LCL01', expectLocked: true },
];
const OUT = path.resolve(import.meta.dirname, '../../../qa');
fs.mkdirSync(OUT, { recursive: true });
const LOG_PATH = path.join(OUT, '2026-10-31_sil621_lcl-editor-driver.log');
const LOG = [];
let exitCode = 0;
const log = (step, obj = {}) => {
  const e = { at: new Date().toISOString(), step, ...obj };
  LOG.push(e);
  console.log(JSON.stringify(e));
};

// In-page inspector: finds the rev editor card and reads its facts. Returns
// card:null when the popup is not open.
const readEditor = () => {
  const cards = [...document.querySelectorAll('.shipment-container-ledger__inline-editor')];
  const card = cards.find((c) => c.textContent.includes('Loại xe tính cước thu khách'));
  if (!card) return { card: false };
  const combo = card.querySelector('[role="combobox"], input[role="combobox"]');
  const price = card.querySelector('input[placeholder="Bỏ trống = tự tra bảng giá"]');
  const save = [...card.querySelectorAll('button[aria-label]')].find((b) => (b.getAttribute('aria-label') || '').includes('Lưu cước thu khách'));
  const text = card.textContent || '';
  const has = (re) => re.test(text);
  return {
    card: true,
    comboFound: !!combo,
    comboDisabled: combo ? (combo.disabled || combo.getAttribute('aria-disabled') === 'true' || !!combo.closest('[data-disabled], .is-disabled')) : null,
    priceFound: !!price,
    pricePlaceholder: price ? price.getAttribute('placeholder') : null,
    priceDisabled: price ? (price.disabled || !!price.closest('[data-disabled], .is-disabled')) : null,
    saveFound: !!save,
    saveDisabled: save ? save.disabled : null,
    // SIL-621 negative pins — NONE of these texts may render in the popup.
    hasLockCostText: has(/Lô đã thuộc nhóm gộp xe/),
    hasTachnhomText: has(/tách nhóm \(Hủy ghép\)/),
    hasHelpText: has(/Nhập tay giá thỏa thuận/),
    hasAutoHintText: has(/CƯỚC VẬN TẢI \(AUTO\) của lô/),
  };
};

async function driveCase(browser, token, kase) {
  const { shipmentId, bill, expectLocked, key } = kase;
  const page = await browser.newPage();
  await page.setViewport({ width: 1307, height: 900 });
  await page.evaluateOnNewDocument((t) => { localStorage.setItem('token', t); }, token);
  await page.goto(`${BASE}/shipments-detail?searchSuffix=${encodeURIComponent(bill.slice(0, 8))}&dateScope=all`, { waitUntil: 'networkidle2', timeout: 60000 });
  // Wait for THIS lot row's rev trigger (aria-label from ShipmentContainerLedger).
  const triggerLabel = `Sửa cước thu khách cho lô ${bill}`;
  await page.waitForFunction((label) => {
    return [...document.querySelectorAll('button[aria-label]')]
      .some((b) => b.getAttribute('aria-label') === label);
  }, { timeout: 45000 }, triggerLabel);
  log('trigger', { shipmentId, bill, triggerLabel, verdict: 'PASS' });

  await page.evaluate((label) => {
    [...document.querySelectorAll('button[aria-label]')]
      .find((b) => b.getAttribute('aria-label') === label)
      .click();
  }, triggerLabel);
  await page.waitForFunction(() => {
    const cards = [...document.querySelectorAll('.shipment-container-ledger__inline-editor')];
    return cards.some((c) => c.textContent.includes('Loại xe tính cước thu khách'));
  }, { timeout: 20000 });

  const facts = await page.evaluate(readEditor);
  const shot = path.join(OUT, expectLocked
    ? '2026-10-31_sil621_lcl-editor-costlocked-1307.png'
    : '2026-10-31_sil621_lcl-editor-ungrouped-1307.png');
  await page.screenshot({ path: shot });
  log('popup-facts', { key, shipmentId, bill, expectLocked, ...facts });

  // AC (SIL-621): no guidance text of any of the removed kinds; the fields
  // and actions still exist; the placeholder survives.
  const acNoTexts = !facts.hasLockCostText && !facts.hasTachnhomText && !facts.hasHelpText && !facts.hasAutoHintText;
  const acStructure = facts.card && facts.comboFound && facts.priceFound && facts.saveFound
    && facts.pricePlaceholder === 'Bỏ trống = tự tra bảng giá';
  const acLock = expectLocked
    ? facts.comboDisabled === true && facts.priceDisabled === true && facts.saveDisabled === true
    : facts.comboDisabled !== true && facts.priceDisabled !== true;
  const ac = acNoTexts && acStructure && acLock;
  log(`AC-${key}`, {
    key, shipmentId, bill, acNoTexts, acStructure, acLock, verdict: ac ? 'PASS' : 'FAIL',
  });
  if (!ac) exitCode = 1;
  await page.close();
  return ac;
}

(async () => {
  log('start', { base: BASE, api: API, cases: CASES });
  let browser;
  try {
    const loginRes = await fetch(`${API}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: 'dieuvan', password: 'Abc123' }),
    });
    const token = (await loginRes.json().catch(() => ({}))).token;
    if (!token) { log('login', { verdict: 'FAIL', status: loginRes.status }); throw new Error('no token'); }
    log('login', { verdict: 'PASS' });

    browser = await puppeteer.launch({
      headless: true,
      executablePath: process.env.QA_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      args: ['--no-sandbox'],
    });

    for (const kase of CASES) {
      const ok = await driveCase(browser, token, kase);
      if (!ok) exitCode = 1;
    }
  } catch (err) {
    log('fatal', { verdict: 'FAIL', message: String(err) });
    exitCode = 1;
  } finally {
    await browser?.close();
  }
  fs.writeFileSync(LOG_PATH, LOG.map((e) => JSON.stringify(e)).join('\n') + '\n');
  log('done', { exitCode });
  process.exit(exitCode);
})();
