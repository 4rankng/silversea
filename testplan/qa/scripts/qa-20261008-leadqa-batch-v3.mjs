// QA batch rung v3 — allocation dialog instance of card _1: hover its disabled
// reasons ('Lưu phân bổ', 'Hủy', day-section 'Thêm nhà xe') inside the dialog
// opened from the detail-plan assignment cell.
import { launch, login, tap, hoverAndFocus, shot, step, evidenceDir, BASE } from './lead-qa-harness.mjs';

const dir = evidenceDir('2026-10-08-leadqa-batch');
const log = `${dir}/driver-v3.log`;
const reasons = [
  'Đang lưu',
  'Đang tải danh sách nhà xe',
  'Đã gán hết nhà xe khả dụng',
  'vượt số lượng',
  'Lưu thay đổi điều phối trước khi phát lệnh.',
];

const { browser, page } = await launch();
await login(page, 'dungnv');
await page.goto(`${BASE}/dispatch-detail`, { waitUntil: 'networkidle2', timeout: 60000 });
await new Promise((r) => setTimeout(r, 3500));
try {
  await tap(page, 'xpath///button[contains(., "Đã gán xe")]', log, 'chip-da-gan-xe');
  await new Promise((r) => setTimeout(r, 2500));
} catch (e) { step(log, { step: 'chip-miss', err: String(e).slice(0, 80) }); }
await tap(page, 'xpath///button[contains(normalize-space(.), "Sửa")]', log, 'row-sua');
await new Promise((r) => setTimeout(r, 2500));
await shot(page, `${dir}/C3-allocation-dialog-open.png`);
for (const label of ['Lưu phân bổ', 'Thêm nhà xe', 'Hủy']) {
  try { await hoverAndFocus(page, `xpath///button[contains(normalize-space(.), "${label}")]`, log, label); } catch (e) { step(log, { step: 'hover-miss', label }); }
  await new Promise((r) => setTimeout(r, 250));
}
const hit = await page.evaluate((rs) => rs.filter((r) => document.body.innerText.includes(r)), reasons);
step(log, { step: 'allocation-dialog-reasons', hit });
await shot(page, `${dir}/C3-allocation-dialog-reasons.png`);
await browser.close();
step(log, { step: 'DONE' });
