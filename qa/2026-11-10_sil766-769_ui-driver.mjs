// QA driver — SIL-766/767/768/769 UI DRIVEN verification (rung 3)
// Surface: app lái xe /my-trips/779100 (bqhuong, DRIVER) — FE :7185 (lane r9a-glm) → BE :3003 (lane r9a-glm)
// Runs headless Chrome via puppeteer-core; token pre-injected per puppeteer-spa-auth skill.
import puppeteer from 'puppeteer-core';
import { readFileSync, writeFileSync } from 'node:fs';

const BASE = 'http://localhost:7185';
const API = 'http://localhost:3004';
const TRIP = 779100;
const QA = new URL('.', import.meta.url).pathname; // qa/
const results = [];
const log = (...a) => { console.log(...a); results.push(a.join(' ')); };

const login = await fetch(`${API}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier: 'bqhuong', password: 'Abc123' }) });
const { token, user } = await login.json();
log('STEP login: status', login.status, '| role', user?.role, '| token len', token?.length);
if (!token) { log('FATAL no token'); process.exit(1); }

const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', args: ['--no-sandbox', '--window-size=768,1100'] });
const page = await browser.newPage();
await page.setViewport({ width: 768, height: 1100 });
await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);
page.setDefaultTimeout(20000);

page.on('console', (m) => { if (m.type() === 'error') console.log('CONSOLE_ERR:', m.text().slice(0, 160)); });
page.on('response', (r) => { if (r.status() >= 400) console.log('HTTP', r.status(), r.url().slice(0, 140)); });
await page.goto(`${BASE}/my-trips/${TRIP}`, { waitUntil: 'networkidle2', timeout: 45000 });
await page.waitForSelector('.driver-task-screen', { timeout: 20000 });
await page.waitForSelector('.driver-task-section', { timeout: 20000 });
log('STEP open /my-trips/' + TRIP + ': driver-task-screen rendered');

// ── SIL-766 — invoice block right below Địa chỉ giao hàng + Gọi kho, expanded, read-only ──
const s766 = await page.evaluate(() => {
  const order = (a, b) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
  const infoSection = document.querySelector('[data-testid="task-section-toggle-driver-task-info-grid"]')?.closest('section');
  const callBar = document.querySelector('.driver-task-call-bar');
  const invoiceGrid = document.getElementById('driver-task-invoice-grid');
  const invoiceSection = invoiceGrid?.closest('section');
  const toggle = document.querySelector('[data-testid="task-section-toggle-driver-task-invoice-grid"]');
  const costSection = document.querySelector('.shipment-cost-entry');
  const contSection = document.querySelector('.dcc-section');
  const longMinh = [...invoiceGrid?.querySelectorAll('*') ?? []].some((el) => el.childElementCount === 0 && /LONG MINH/.test(el.textContent || ''));
  const mst = [...invoiceGrid?.querySelectorAll('.driver-task-fact') ?? []].some((el) => (el.querySelector('.driver-task-fact__label')?.textContent) === 'MST' && /2300540419/.test(el.textContent || ''));
  const buttons = invoiceSection ? [...invoiceSection.querySelectorAll('button')].map((b) => b.getAttribute('aria-label') || b.textContent?.trim()) : [];
  const infoGrid = document.getElementById('driver-task-info-grid');
  return {
    infoGridFound: !!infoGrid,
    orderInfoBeforeInvoice: infoSection && invoiceSection ? order(infoSection, invoiceSection) : null,
    orderCallBarBeforeInvoice: callBar && invoiceSection ? order(callBar, invoiceSection) : (callBar === null ? 'n/a-no-kho-phone' : null),
    orderInvoiceBeforeContCard: invoiceSection && contSection ? order(invoiceSection, contSection) : null,
    orderInvoiceBeforeCostSection: invoiceSection && costSection ? order(invoiceSection, costSection) : null,
    expanded: toggle?.getAttribute('aria-expanded'),
    gridHidden: invoiceGrid?.hidden,
    longMinhVisible: longMinh,
    mstVisible: mst,
    buttonsInBlock: buttons,
  };
});
log('ASSERT SIL-766:', JSON.stringify(s766));
const s766Pass = s766.infoGridFound && s766.orderInfoBeforeInvoice && s766.orderInvoiceBeforeContCard && s766.orderInvoiceBeforeCostSection
  && s766.expanded === 'true' && s766.gridHidden === false && s766.longMinhVisible && s766.mstVisible
  && s766.buttonsInBlock.every((b) => (b || '').includes('Copy') || (b || '').includes('Thu gọn') || (b || '').includes('Thông tin hóa đơn'));
log('VERDICT SIL-766:', s766Pass ? 'PASS' : 'FAIL');
await page.screenshot({ path: `${QA}2026-11-10_sil766-768_driver-detail-top.png` });
log('SHOT qa/2026-11-10_sil766-768_driver-detail-top.png (768px, top of page)');

// Scroll to invoice block for a focused shot
await page.evaluate(() => document.getElementById('driver-task-invoice-grid')?.scrollIntoView({ block: 'center' }));
await new Promise((r) => setTimeout(r, 400));
await page.screenshot({ path: `${QA}2026-11-10_sil766_invoice-block-focus.png` });
log('SHOT qa/2026-11-10_sil766_invoice-block-focus.png');

// ── SIL-767 + SIL-768 — absent blocks ──
const s767_768 = await page.evaluate(() => {
  const byText = (t) => [...document.querySelectorAll('.driver-task-screen *')].filter((el) => el.childElementCount === 0 && el.textContent?.trim() === t).length;
  return {
    tacVuHead: byText('Tác vụ'),
    khongCoTacVu: byText('Không có tác vụ'),
    operationChips: document.querySelectorAll('[data-testid="operation-chips"]').length,
    operationChip: document.querySelectorAll('[data-testid="operation-chip"]').length,
    ghiChuHead: byText('Ghi chú'),
    fuelSection: document.querySelectorAll('[data-testid="fuel-section"]').length,
    fuelToggle: document.querySelectorAll('[data-testid="fuel-section-toggle"]').length,
    anhNhienLieu: byText('Ảnh nhiên liệu'),
    chupManHinhBom: byText('Chụp màn hình bơm gần nhất'),
    khac: byText('Quy định tại điểm làm hàng'),
    soContSeal: document.querySelectorAll('.dcc-section').length,
    epodFooter: document.querySelectorAll('.driver-task-footer').length,
  };
});
log('ASSERT SIL-767/768:', JSON.stringify(s767_768));
const s767Pass = s767_768.tacVuHead === 0 && s767_768.khongCoTacVu === 0 && s767_768.operationChips === 0 && s767_768.operationChip === 0 && s767_768.ghiChuHead > 0;
const s768Pass = s767_768.fuelSection === 0 && s767_768.fuelToggle === 0 && s767_768.anhNhienLieu === 0 && s767_768.chupManHinhBom === 0;
const s1115Pass = s767_768.khac > 0 && s767_768.soContSeal > 0 && s767_768.epodFooter > 0;
log('VERDICT SIL-767:', s767Pass ? 'PASS' : 'FAIL', '| VERDICT SIL-768:', s768Pass ? 'PASS' : 'FAIL', '| VERDICT Task1.1.5 (khối chuẩn giữ nguyên):', s1115Pass ? 'PASS' : 'FAIL');

// ── 390 spot check ──
await page.setViewport({ width: 390, height: 844 });
await page.evaluate(() => window.scrollTo(0, 0));
await new Promise((r) => setTimeout(r, 400));
const overflow390 = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
await page.screenshot({ path: `${QA}2026-11-10_sil766-768_driver-detail-390.png` });
log('SHOT qa/2026-11-10_sil766-768_driver-detail-390.png | horizontal overflow px:', overflow390);

// ── SIL-769 — cost form: mandatory fee blocked without photo, named message ──
await page.setViewport({ width: 768, height: 1100 });
await page.evaluate(() => document.querySelector('[data-testid="shipment-cost-entry-form"]')?.scrollIntoView({ block: 'start' }));
await new Promise((r) => setTimeout(r, 300));
await page.evaluate(() => {
  const btn = [...document.querySelectorAll('button')].find((b) => b.textContent?.includes('Thêm chi phí'));
  btn?.click();
});
await page.waitForSelector('[role="combobox"]', { timeout: 15000 });
log('STEP open cost form (Thêm chi phí)');
// Select "Phí lưu bãi" from the Loại chi phí combobox
await page.evaluate(() => {
  const cb = document.querySelector('[role="combobox"]');
  cb?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
  cb?.click();
});
await page.waitForFunction(() => [...document.querySelectorAll('[role="option"]')].some((o) => o.textContent?.includes('Phí lưu bãi')), { timeout: 15000 });
await page.evaluate(() => {
  const opt = [...document.querySelectorAll('[role="option"]')].find((o) => o.textContent?.includes('Phí lưu bãi'));
  opt?.click();
});
await page.waitForFunction(() => document.body.textContent?.includes('Phí lưu bãi (theo danh mục phí)'), { timeout: 10000 });
log('STEP pick Phí lưu bãi');
const setAmount = async (value) => {
  const marked = await page.evaluate(() => {
    const row = [...document.querySelectorAll('.shipment-cost-entry__draft-row')].at(-1);
    // The amount field is the FIRST plain text input of the row: the picker's
    // trigger carries aria-labelledby (react-aria), the date input carries a
    // dd/mm/yyyy value, the note sits after the date in DOM order.
    const input = [...(row?.querySelectorAll('input') ?? [])].find((i) => i.type === 'text' && !i.getAttribute('aria-labelledby'));
    if (!input) return false;
    input.dataset.qaAmount = '1';
    return true;
  });
  if (!marked) throw new Error('amount input not found (structural locator)');
  const input = await page.$('input[data-qa-amount="1"]');
  await input.click({ clickCount: 3 });
  await input.type(value);
  const typed = await page.evaluate(() => document.querySelector('input[data-qa-amount="1"]')?.value);
  if (!typed || !/250|50/.test(typed)) throw new Error(`amount typing did not stick (value=${typed})`);
  await page.evaluate(() => { delete document.querySelector('input[data-qa-amount="1"]').dataset.qaAmount; });
  log('STEP typed amount → display:', typed);
};
await setAmount('250000');
await new Promise((r) => setTimeout(r, 300));
const s769blocked = await page.evaluate(() => {
  const save = [...document.querySelectorAll('button')].find((b) => /^Lưu tất cả/.test(b.textContent?.trim() || ''));
  const msg = document.querySelector('[data-testid="shipment-cost-receipt-required"]');
  const camera = [...document.querySelectorAll('.shipment-cost-entry__camera-btn')].map((l) => l.textContent?.trim());
  return { saveDisabled: save?.disabled, message: msg?.textContent, cameraLabel: camera[0] };
});
log('ASSERT SIL-769 blocked (Phí lưu bãi, chưa có ảnh):', JSON.stringify(s769blocked));
const s769a1Pass = s769blocked.saveDisabled === true && s769blocked.message === 'Phí lưu bãi phải kèm ảnh biên lai trước khi lưu.';
log('VERDICT SIL-769 A1:', s769a1Pass ? 'PASS' : 'FAIL');
await page.evaluate(() => document.querySelector('[data-testid="shipment-cost-receipt-required"]')?.scrollIntoView({ block: 'center' }));
await new Promise((r) => setTimeout(r, 300));
await page.screenshot({ path: `${QA}2026-11-10_sil769_luu-bai-blocked-no-photo.png` });
log('SHOT qa/2026-11-10_sil769_luu-bai-blocked-no-photo.png');

// Upload the biên lai → save opens → save
const fileInput = await page.$('input[aria-label="Chọn ảnh biên lai"]');
await fileInput.uploadFile('/tmp/bien-lai-qa.png');
await page.waitForFunction(() => document.body.textContent?.includes('Ảnh sẽ gắn với khoản chi này'), { timeout: 20000 });
log('STEP upload bien lai (1x1 PNG) — preview rendered');
const s769upload = await page.evaluate(() => {
  const save = [...document.querySelectorAll('button')].find((b) => /^Lưu tất cả/.test(b.textContent?.trim() || ''));
  return { saveDisabled: save?.disabled, saveLabel: save?.textContent?.trim() };
});
log('ASSERT SIL-769 after upload:', JSON.stringify(s769upload));
await page.evaluate(() => {
  const save = [...document.querySelectorAll('button')].find((b) => /^Lưu tất cả/.test(b.textContent?.trim() || ''));
  save?.click();
});
await page.waitForFunction(() => document.body.textContent?.includes('Phí lưu bãi') && document.body.textContent?.includes('250.000') && !document.querySelector('[data-testid="shipment-cost-receipt-required"]'), { timeout: 20000 });
log('STEP saved Phí lưu bãi + photo (batch closed)');
await page.screenshot({ path: `${QA}2026-11-10_sil769_luu-bai-saved-with-photo.png` });
log('SHOT qa/2026-11-10_sil769_luu-bai-saved-with-photo.png');

// A2 — Phí vệ sinh without photo saves freely
await page.evaluate(() => {
  const btn = [...document.querySelectorAll('button')].find((b) => b.textContent?.includes('Thêm chi phí'));
  btn?.click();
});
await page.waitForSelector('[role="combobox"]', { timeout: 15000 });
await page.evaluate(() => {
  const cb = document.querySelector('[role="combobox"]');
  cb?.click();
});
await page.waitForFunction(() => [...document.querySelectorAll('[role="option"]')].some((o) => o.textContent?.includes('Phí vệ sinh')), { timeout: 15000 });
await page.evaluate(() => {
  const opt = [...document.querySelectorAll('[role="option"]')].find((o) => o.textContent?.includes('Phí vệ sinh'));
  opt?.click();
});
await page.waitForFunction(() => document.body.textContent?.includes('Phí vệ sinh (theo danh mục phí)'), { timeout: 10000 });
await setAmount('50000');
await new Promise((r) => setTimeout(r, 300));
const s769a2 = await page.evaluate(() => {
  const save = [...document.querySelectorAll('button')].find((b) => /^Lưu tất cả/.test(b.textContent?.trim() || ''));
  const msg = document.querySelector('[data-testid="shipment-cost-receipt-required"]');
  return { saveDisabled: save?.disabled, saveLabel: save?.textContent?.trim(), messagePresent: msg?.textContent ?? null };
});
log('ASSERT SIL-769 A2 (Phí vệ sinh, chưa có ảnh):', JSON.stringify(s769a2));
const s769a2Pass = s769a2.saveDisabled === false && s769a2.messagePresent === null;
log('VERDICT SIL-769 A2:', s769a2Pass ? 'PASS' : 'FAIL');
await page.screenshot({ path: `${QA}2026-11-10_sil769_ve-sinh-optional-save-open.png` });
log('SHOT qa/2026-11-10_sil769_ve-sinh-optional-save-open.png');
await page.evaluate(() => {
  const save = [...document.querySelectorAll('button')].find((b) => /^Lưu tất cả/.test(b.textContent?.trim() || ''));
  save?.click();
});
await page.waitForFunction(() => !document.body.textContent?.includes('Lưu tất cả (2'), { timeout: 20000 });
log('STEP saved Phí vệ sinh WITHOUT photo (batch closed)');
await page.screenshot({ path: `${QA}2026-11-10_sil769_ve-sinh-saved-no-photo.png` });
log('SHOT qa/2026-11-10_sil769_ve-sinh-saved-no-photo.png');

writeFileSync(`${QA}2026-11-10_sil766-769_ui-driver-results.json`, JSON.stringify(results, null, 2));
log('DONE');
await browser.close();
if (!s766Pass || !s767Pass || !s768Pass || !s769a1Pass || !s769a2Pass) process.exit(2);
process.exit(0);
