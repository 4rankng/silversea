// Card 365 QA rung — LCL lot parity between Tổng quan lô hàng (/shipments) and
// Chi tiết lô hàng (/shipments-detail). Staging, build 19ed100f only.
// ONE driver run; real trusted taps; full-page state matrix per screen.
import fs from 'node:fs';
import { launch, goto, shot, matrix, withAborted, tapAt, cropRowByText, health, writeJson, OUT_365, sleep } from './_rung-cus-common-20261005.mjs';

const seed = JSON.parse(fs.readFileSync(new URL('../evidence/2026-10-05_hang-le-lcl-365-tong-quan-chi-tiet/seed.json', import.meta.url).pathname, 'utf8'));
const TOM = seed.tomorrow;
const results = [];
const rec = (claim, ok, detail) => { results.push({ claim, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'} — ${claim} — ${detail}`); };

const h = await health();
console.log('health', JSON.stringify(h));
if (h.buildHash !== '19ed100f') { console.log('BUILD MISMATCH — aborting rung'); process.exit(2); }

const { browser, page, errors } = await launch({ width: 1440 });
const textOf = () => page.evaluate(() => (document.querySelector('main') || document.body).innerText);
const overviewRows = () => page.evaluate(() => Array.from(document.querySelectorAll('.cus-dashboard-table tbody tr')).map((r) => (r.innerText || '').replace(/\s+/g, ' ').trim()));
const detailRows = () => page.evaluate(() => Array.from(document.querySelectorAll('.shipment-container-ledger table tbody tr')).map((r) => (r.innerText || '').replace(/\s+/g, ' ').trim()));
const cropRow = (needle, name) => cropRowByText(page, OUT_365, name, needle);

// ── Screen 1: Tổng quan lô hàng (/shipments) ────────────────────────────────
// State WITH-DATA — same date window + search as the detail screen will use.
await goto(page, `/shipments?searchSuffix=QA365LCL01&transportDateFrom=${TOM}&transportDateTo=${TOM}`);
{
  const rows = await overviewRows();
  const row = rows.find((r) => r.includes('QA365LCL01')) || null;
  rec('AC1 Tổng quan hiển thị lô LCL QA365LCL01 trong cùng cửa sổ ngày ' + TOM, Boolean(row), row ? row.slice(0, 220) : `rows=${rows.length}`);
  await shot(page, OUT_365, '365_overview_withdata_1440.png');
  await cropRow('QA365LCL01', '365_overview_withdata_rowcrop');
  const m = await matrix(page, OUT_365, '365_overview_withdata');
  console.log('matrix overview withdata', m.length);
}
// State EMPTY (filters yield nothing)
await goto(page, `/shipments?searchSuffix=QA365NOPE99&transportDateFrom=${TOM}&transportDateTo=${TOM}`);
{
  const txt = await textOf();
  rec('Tổng quan — trạng thái rỗng nêu "Không có lô hàng phù hợp"', txt.includes('Không có lô hàng phù hợp'), txt.slice(0, 120).replace(/\s+/g, ' '));
  await shot(page, OUT_365, '365_overview_empty_1440.png');
  await matrix(page, OUT_365, '365_overview_empty');
}
// State ERROR (abort the workspace feed during navigation)
await withAborted(page, '/api/shipments/cus-workspace?', () => goto(page, `/shipments?searchSuffix=QA365LCL01&transportDateFrom=${TOM}&transportDateTo=${TOM}`, 2500));
{
  const txt = await textOf();
  console.log('ERROR-STATE overview text:', JSON.stringify(txt.slice(0, 300).replace(/\s+/g, ' ')));
  await shot(page, OUT_365, '365_overview_error_1440.png');
  await matrix(page, OUT_365, '365_overview_error');
}

// ── Screen 2: Chi tiết lô hàng (/shipments-detail) ──────────────────────────
// FCL-DATA state kept first so the 360 lane's screen is also covered here.
await goto(page, `/shipments-detail?searchSuffix=QA360FCLW&transportDateFrom=${TOM}&transportDateTo=${TOM}`);
{
  const rows = await detailRows();
  const c1 = rows.some((r) => r.includes('QA360CT1'));
  const c2 = rows.some((r) => r.includes('QA360CT2'));
  rec('AC3 pin — lô FCL QA360FCLW render đúng 1 dòng/container (2 container → 2 dòng)', rows.length === 2 && c1 && c2, `rows=${rows.length} CT1=${c1} CT2=${c2}`);
  await shot(page, OUT_365, '365_detail_fcl_withdata_1440.png');
  await matrix(page, OUT_365, '365_detail_fcl_withdata');
}
// WITH-DATA — the LCL lot under the SAME window + search as the overview.
await goto(page, `/shipments-detail?searchSuffix=QA365LCL01&transportDateFrom=${TOM}&transportDateTo=${TOM}`);
{
  const rows = await detailRows();
  const row = rows.find((r) => r.includes('QA365LCL01')) || rows[0] || '';
  const body = await textOf();
  const hasLot = rows.some((r) => r.includes('Lô hàng lẻ')) && rows.some((r) => r.includes('QA365LCL01'));
  rec('AC1 Chi tiết hiển thị cùng lô LCL QA365LCL01 (cùng cửa sổ ngày + tìm kiếm)', hasLot, `rows=${rows.length} :: ${row.slice(0, 240)}`);
  rec('AC2 dòng lô mang nhận diện lô (Bill/Booking, phân loại Lẻ, "Không có container")', /QA365LCL01/.test(row) && /Không có container/.test(row) && /Lẻ/.test(row), row.slice(0, 240));
  rec('AC1 KHÔNG còn chuỗi "Không có container phù hợp" cho lô LCL này', !body.includes('Không có container phù hợp'), `bodyHasEmpty=${body.includes('Không có container phù hợp')}`);
  // Read-only row: no container-mode edit trigger, no add/remove affordances.
  const afford = await page.evaluate(() => {
    const tr = Array.from(document.querySelectorAll('.shipment-container-ledger table tbody tr')).find((r) => (r.innerText || '').includes('QA365LCL01'));
    if (!tr) return { found: false };
    return {
      found: true,
      editTriggers: tr.querySelectorAll('button[id^="shipment-detail-edit-"]').length,
      addRemove: Array.from(tr.querySelectorAll('button')).filter((b) => /Thêm container|Xóa container/.test(b.getAttribute('aria-label') || '')).length,
      buttons: Array.from(tr.querySelectorAll('button')).map((b) => (b.getAttribute('aria-label') || b.textContent || '').trim().slice(0, 40)),
    };
  });
  rec('Dòng lô LCL là read-only trên workboard (không trigger sửa, không Thêm/Xóa container)', afford.found && afford.editTriggers === 0 && afford.addRemove === 0, JSON.stringify(afford));
  await shot(page, OUT_365, '365_detail_lcl_withdata_1440.png');
  await cropRow('QA365LCL01', '365_detail_lcl_withdata_rowcrop');
  await matrix(page, OUT_365, '365_detail_lcl_withdata');
}
// ALL-DATES reveal (dateScope=all clears the today default).
await goto(page, `/shipments-detail?searchSuffix=QA365LCL01&dateScope=all`);
{
  const rows = await detailRows();
  rec('Lô LCL xuất hiện khi mở "Tất cả" ngày (dateScope=all)', rows.some((r) => r.includes('QA365LCL01')), `rows=${rows.length}`);
  await shot(page, OUT_365, '365_detail_lcl_alldates_1440.png');
}
// Default window (no params) — documents the deliberate today-default behaviour.
await goto(page, `/shipments-detail?searchSuffix=QA365LCL01`);
{
  const rows = await detailRows();
  const body = await textOf();
  console.log('DEFAULT-WINDOW detail rows=', rows.length, 'emptyText=', body.includes('Không có container phù hợp'));
  await shot(page, OUT_365, '365_detail_lcl_defaultwindow_1440.png');
  // Real tap on the "Tất cả" quick chip, then re-measure.
  const chipTap = await (async () => {
    try {
      const box = await page.evaluate(() => {
        const b = Array.from(document.querySelectorAll('button,[role="button"]')).find((el) => (el.textContent || '').trim() === 'Tất cả');
        if (!b) return null;
        const r = b.getBoundingClientRect();
        return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
      });
      if (!box) return { ok: false, error: 'chip not visible' };
      await tapAt(page, box.x, box.y, { label: 'chip Tất cả' });
      await sleep(2200);
      const rows2 = await detailRows();
      return { ok: true, rowsAfter: rows2.length, hasLot: rows2.some((r) => r.includes('QA365LCL01')) };
    } catch (e) { return { ok: false, error: String(e.message).slice(0, 120) }; }
  })();
  console.log('chip Tất cả:', JSON.stringify(chipTap));
  await shot(page, OUT_365, '365_detail_lcl_after_chip_1440.png');
}
// State EMPTY (no match for the filter set)
await goto(page, `/shipments-detail?searchSuffix=QA365NOPE99&transportDateFrom=${TOM}&transportDateTo=${TOM}`);
{
  const body = await textOf();
  rec('Chi tiết — trạng thái rỗng với bộ lọc nêu "Không có container phù hợp"', body.includes('Không có container phù hợp'), body.slice(0, 140).replace(/\s+/g, ' '));
  await shot(page, OUT_365, '365_detail_empty_1440.png');
  await matrix(page, OUT_365, '365_detail_empty');
}
// State ERROR (abort the containers feed during navigation)
await withAborted(page, '/api/shipments/cus-workspace/containers', () => goto(page, `/shipments-detail?searchSuffix=QA365LCL01&transportDateFrom=${TOM}&transportDateTo=${TOM}`, 2500));
{
  const txt = await textOf();
  console.log('ERROR-STATE detail text:', JSON.stringify(txt.slice(0, 300).replace(/\s+/g, ' ')));
  await shot(page, OUT_365, '365_detail_error_1440.png');
  await matrix(page, OUT_365, '365_detail_error');
}

// ── AC3 pins ────────────────────────────────────────────────────────────────
// FCL lot WITHOUT containers must NOT appear on this workboard.
await goto(page, `/shipments-detail?searchSuffix=QA365FCLNC&dateScope=all`);
{
  const rows = await detailRows();
  const body = await textOf();
  rec('AC3 pin — lô FCL KHÔNG container (QA365FCLNC) vẫn KHÔNG xuất hiện trên workboard Chi tiết', rows.length === 0 && !body.includes('QA365FCLNC'), `rows=${rows.length} emptyText=${body.includes('Không có container phù hợp')}`);
  await shot(page, OUT_365, '365_detail_fcl_nocontainer_1440.png');
}
// …while the overview DOES show it (proving it exists and is visible there).
await goto(page, `/shipments?searchSuffix=QA365FCLNC`);
{
  const rows = await overviewRows();
  rec('Lô FCL không container vẫn hiện ở Tổng quan (đối chứng tồn tại)', rows.some((r) => r.includes('QA365FCLNC')), `rows=${rows.length}`);
  await shot(page, OUT_365, '365_overview_fcl_nocontainer_1440.png');
}

writeJson(OUT_365, 'rung-365-result.json', { buildHash: h.buildHash, today: seed.today, tomorrow: TOM, results, consoleErrors: errors.slice(0, 30) });
console.log('\nSUMMARY', JSON.stringify(results.map((r) => ({ c: r.claim.slice(0, 60), ok: r.ok }))));
await browser.close();
process.exit(results.every((r) => r.ok) ? 0 : 1);
