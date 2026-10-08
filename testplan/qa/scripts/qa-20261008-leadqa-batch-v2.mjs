// QA batch rung v2 — close the two gaps: debit export reason capture, and the
// plan-editor footer disabled reasons (drive the editor open first).
import { launch, login, tap, hoverAndFocus, shot, step, watchNet, evidenceDir, BASE } from './lead-qa-harness.mjs';

const dir = evidenceDir('2026-10-08-leadqa-batch');
const log = `${dir}/driver-v2.log`;
const reasons = [
  'Chọn khách hàng để xuất Debit Note.',
  'Chưa chọn lô khóa',
  'Đang xuất',
  'Lưu thay đổi điều phối trước khi phát lệnh.',
  'Đang lưu',
  'Chưa có dữ liệu',
];

// ── D2. thanhdc: debit export reason must be visible on hover/focus ─────────
{
  const { browser, page } = await launch();
  await login(page, 'thanhdc');
  await page.goto(`${BASE}/shipments-debit`, { waitUntil: 'networkidle2', timeout: 60000 });
  await new Promise((r) => setTimeout(r, 3000));
  await hoverAndFocus(page, 'xpath///button[contains(normalize-space(.), "Xuất Debit Note")]', log, 'Xuất Debit Note');
  await new Promise((r) => setTimeout(r, 400));
  const hit = await page.evaluate((rs) => rs.filter((r) => document.body.innerText.includes(r)), reasons);
  step(log, { step: 'debit-export-reason', hit });
  await shot(page, `${dir}/D2-debit-export-reason.png`);
  await browser.close();
}

// ── C2. dungnv: open a row editor on /dispatch-detail, hover footer reasons ─
{
  const { browser, page } = await launch();
  await login(page, 'dungnv');
  await page.goto(`${BASE}/dispatch-detail`, { waitUntil: 'networkidle2', timeout: 60000 });
  await new Promise((r) => setTimeout(r, 3500));
  // filter to assigned rows where an editor trigger exists
  try {
    await tap(page, 'xpath///button[contains(., "Đã gán xe")]', log, 'chip-da-gan-xe');
    await new Promise((r) => setTimeout(r, 2500));
  } catch (e) { step(log, { step: 'chip-miss', err: String(e).slice(0, 80) }); }
  // open the plan editor via the first 'Sửa' row action
  let opened = false;
  try {
    await tap(page, 'xpath///button[contains(normalize-space(.), "Sửa")]', log, 'row-sua');
    opened = true;
    await new Promise((r) => setTimeout(r, 2500));
  } catch (e) { step(log, { step: 'editor-miss', err: String(e).slice(0, 80) }); }
  await shot(page, `${dir}/C2-detailplan-editor-open.png`);
  for (const label of ['Phát lệnh', 'Lưu thay đổi', 'Hoàn thành']) {
    try { await hoverAndFocus(page, `xpath///button[contains(normalize-space(.), "${label}")]`, log, label); } catch (e) { step(log, { step: 'hover-miss', label }); }
    await new Promise((r) => setTimeout(r, 250));
  }
  const hit = await page.evaluate((rs) => rs.filter((r) => document.body.innerText.includes(r)), reasons);
  step(log, { step: 'editor-reasons-visible', opened, hit });
  await shot(page, `${dir}/C2-detailplan-footer-reasons.png`);
  await browser.close();
}
step(log, { step: 'DONE' });
