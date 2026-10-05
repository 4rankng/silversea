// Card 360 QA rung — the container-parameters quick-edit ("Chỉnh sửa thông số
// container") hydrates the weight input without PG's dead decimals, and a
// genuine decimal keeps its significant digit. Staging, build 19ed100f only.
// ONE driver run; real trusted taps; full-page state matrix.
import fs from 'node:fs';
import { launch, goto, shot, matrix, setViewport, withAborted, tapAt, health, writeJson, http, OUT_360, sleep } from './_rung-cus-common-20261005.mjs';

const seed = JSON.parse(fs.readFileSync(new URL('../evidence/2026-10-05_360-trong-luong-bo-2-so-0-thap-phan/seed.json', import.meta.url).pathname, 'utf8'));
const TOM = seed.tomorrow;
const results = [];
const rec = (claim, ok, detail) => { results.push({ claim, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'} — ${claim} — ${detail}`); };

const h = await health();
console.log('health', JSON.stringify(h));
if (h.buildHash !== '19ed100f') { console.log('BUILD MISMATCH — aborting rung'); process.exit(2); }

const { browser, page, token, errors } = await launch({ width: 1440 });

// DB truth for the fixtures (what the wire actually carries into the editor).
const apiContainers = await http('GET', '/api/shipments/cus-workspace/containers?searchSuffix=QA360&limit=50', { token });
const wire = (apiContainers.body.items || []).filter((i) => String(i.containerNumber || '').startsWith('QA360'));
console.log('wire weights:', JSON.stringify(wire.map((w) => ({ n: w.containerNumber, id: w.id, w: w.raw?.cargoWeightKg, v: w.raw?.cargoVolumeCbm }))));
const byNumber = (n) => wire.find((w) => w.containerNumber === n);

const editorState = () => page.evaluate(() => {
  const grid = document.querySelector('.shipment-container-ledger__cell-editor[data-mode="container"] .shipment-container-ledger__editor-grid');
  if (!grid) return null;
  const labels = Array.from(grid.querySelectorAll('label'));
  const field = (needle) => labels.find((l) => (l.textContent || '').includes(needle))?.querySelector('input');
  return {
    purpose: (document.querySelector('.shipment-container-ledger__edit-purpose')?.textContent || '').trim().slice(0, 120),
    weight: field('Trọng lượng')?.value ?? null,
    volume: field('Thể tích')?.value ?? null,
    containerNumber: field('Số container')?.value ?? null,
  };
});
const closeEditor = async () => {
  const el = await page.$('button[aria-label^="Hủy thông số container"]');
  if (!el) return false;
  const b = await el.boundingBox();
  if (!b) return false;
  await tapAt(page, b.x + b.width / 2, b.y + b.height / 2, { label: 'Hủy editor' });
  await sleep(600);
  return true;
};
const openEditor = async (containerId) => {
  const sel = `#shipment-detail-edit-container-${containerId}`;
  const el = await page.$(sel);
  if (!el) return { ok: false, error: 'no trigger ' + sel };
  await el.scrollIntoView().catch(() => {});
  await sleep(400);
  const b = await el.boundingBox();
  if (!b) return { ok: false, error: 'no box ' + sel };
  await tapAt(page, b.x + b.width / 2, b.y + b.height / 2, { label: sel });
  await sleep(900);
  return { ok: true, state: await editorState() };
};

// ── With-data board (no editor open) → state matrix ─────────────────────────
await goto(page, `/shipments-detail?searchSuffix=QA360FCLW&transportDateFrom=${TOM}&transportDateTo=${TOM}`);
{
  const rows = await page.evaluate(() => Array.from(document.querySelectorAll('.shipment-container-ledger table tbody tr')).map((r) => (r.innerText || '').replace(/\s+/g, ' ').trim()));
  rec('Lô QA360FCLW render 1 dòng/container (2 container → 2 dòng)', rows.length === 2, `rows=${rows.length}`);
  await shot(page, OUT_360, '360_detail_board_1440.png');
  await matrix(page, OUT_360, '360_detail_board');
}

// ── Criterion: integer weight 10000.00 must hydrate "10000" ────────────────
const ct1 = byNumber('QA360CT1');
if (!ct1) throw new Error('QA360CT1 not found on the wire');
{
  const open = await openEditor(ct1.id);
  console.log('editor CT1', JSON.stringify(open));
  rec('Popup "Chỉnh sửa thông số container" mở được cho QA360CT1 bằng tap thật', open.ok === true, JSON.stringify(open.state));
  const v = open.state?.weight;
  rec('Trọng lượng 10000.00 hydrate thành "10000" (không có ",00"/".00")', v === '10000', `input="${v}" wire="${ct1.raw?.cargoWeightKg}"`);
  rec('Không hiển thị "10000,00" hay "10000.00" trong ô', v !== '10000,00' && v !== '10000.00', `input="${v}"`);
  await shot(page, OUT_360, '360_editor_ct1_1440.png');
  const ed = await page.$('.shipment-container-ledger__cell-editor[data-mode="container"]');
  if (ed) { fs.mkdirSync(OUT_360, { recursive: true }); await ed.screenshot({ path: `${OUT_360}/360_editor_ct1_crop.png` }); }
  // Full-page state matrix with the popup OPEN (state class: editor-open).
  for (const w of [1280, 1440, 1920, 2560]) {
    await setViewport(page, w, w >= 1920 ? 1080 : 960);
    if (!(await page.$('.shipment-container-ledger__cell-editor[data-mode="container"]'))) await openEditor(ct1.id);
    const st = await editorState();
    console.log(`matrix CT1 @${w}`, JSON.stringify(st));
    await shot(page, OUT_360, `360_editor_ct1_open_${w}.png`);
    await closeEditor();
  }
  await setViewport(page, 1440, 960);
}

// ── Criterion: genuine decimal 100.50 must read "100.5" ────────────────────
const ct2 = byNumber('QA360CT2');
if (!ct2) throw new Error('QA360CT2 not found on the wire');
{
  const open = await openEditor(ct2.id);
  console.log('editor CT2', JSON.stringify(open));
  const v = open.state?.weight;
  rec('Trọng lượng 100.50 hydrate thành "100.5" (giữ chữ số có nghĩa)', v === '100.5', `input="${v}" wire="${ct2.raw?.cargoWeightKg}"`);
  await shot(page, OUT_360, '360_editor_ct2_1440.png');
  const ed = await page.$('.shipment-container-ledger__cell-editor[data-mode="container"]');
  if (ed) { fs.mkdirSync(OUT_360, { recursive: true }); await ed.screenshot({ path: `${OUT_360}/360_editor_ct2_crop.png` }); }
  await closeEditor();
}

// ── Secondary surface: CUS quick-edit modal "Tổng quan hàng hóa" on /shipments
// (same card's second fixed surface: buildQuickEditDraft cargoWeightKg).
await goto(page, `/shipments?searchSuffix=QA365LCL01`);
const lclWire = await http('GET', '/api/shipments/cus-workspace?searchSuffix=QA365LCL01&limit=5', { token });
const lclRaw = (lclWire.body.items || [])[0];
console.log('LCL lot wire weight:', JSON.stringify(lclRaw?.raw?.cargoWeightKg));
{
  const id = seed.lcl.id;
  const el = await page.$(`#cus-inline-cargo-${id}`);
  if (!el) { rec('CUS quick-edit "Tổng quan hàng hóa" mở được cho lô LCL (mặt thứ hai của 360)', false, 'trigger #cus-inline-cargo-' + id + ' not found'); }
  else {
    const b = await el.boundingBox();
    await tapAt(page, b.x + b.width / 2, b.y + b.height / 2, { label: 'cargo cell' });
    await sleep(900);
    const qs = await page.evaluate(() => {
      const dlg = document.querySelector('[role="dialog"], .cus-quick-edit-modal');
      if (!dlg) return null;
      const labels = Array.from(dlg.querySelectorAll('label'));
      const w = labels.find((l) => (l.textContent || '').includes('Trọng lượng'))?.querySelector('input');
      const title = (dlg.querySelector('.cus-quick-edit-modal__title, h2, [class*="title"]')?.textContent || '').trim().slice(0, 80);
      return { title, weight: w?.value ?? null, labelTexts: labels.map((l) => (l.textContent || '').trim().slice(0, 30)) };
    });
    console.log('quick-edit state', JSON.stringify(qs));
    const okQ = qs && qs.weight === '10000';
    rec('Mặt CUS quick-edit: Trọng lượng lô LCL hydrate "10000" (wire ' + (lclRaw?.raw?.cargoWeightKg ?? '?') + ')', Boolean(okQ), JSON.stringify(qs));
    await shot(page, OUT_360, '360_cus_quickedit_cargo_1440.png');
    await matrix(page, OUT_360, '360_cus_quickedit_cargo');
    // Non-mutating close.
    const cancel = await page.$('.cus-quick-edit-modal__action');
    if (cancel) { const cb = await cancel.boundingBox(); await tapAt(page, cb.x + cb.width / 2, cb.y + cb.height / 2, { label: 'Hủy quick-edit' }); await sleep(800); }
  }
}

// ── State classes on the touched screen ────────────────────────────────────
// no-selection (board, nothing open) already captured above.
// empty
await goto(page, `/shipments-detail?searchSuffix=QA360NOPE9&transportDateFrom=${TOM}&transportDateTo=${TOM}`);
{
  const body = await page.evaluate(() => (document.querySelector('main') || document.body).innerText);
  rec('Trạng thái rỗng của màn Chi tiết hiển thị đúng thông báo', body.includes('Không có container phù hợp'), body.slice(0, 120).replace(/\s+/g, ' '));
  await shot(page, OUT_360, '360_detail_empty_1440.png');
  await matrix(page, OUT_360, '360_detail_empty');
}
// error (abort the containers feed during navigation)
await withAborted(page, '/api/shipments/cus-workspace/containers', () => goto(page, `/shipments-detail?searchSuffix=QA360FCLW&transportDateFrom=${TOM}&transportDateTo=${TOM}`, 2500));
{
  const txt = await page.evaluate(() => (document.querySelector('main') || document.body).innerText);
  console.log('ERROR-STATE 360 text:', JSON.stringify(txt.slice(0, 300).replace(/\s+/g, ' ')));
  await shot(page, OUT_360, '360_detail_error_1440.png');
  await matrix(page, OUT_360, '360_detail_error');
}

writeJson(OUT_360, 'rung-360-result.json', { buildHash: h.buildHash, wire: wire.map((w) => ({ n: w.containerNumber, id: w.id, w: w.raw?.cargoWeightKg })), results, consoleErrors: errors.slice(0, 30) });
console.log('\nSUMMARY', JSON.stringify(results.map((r) => ({ c: r.claim.slice(0, 60), ok: r.ok }))));
await browser.close();
process.exit(results.every((r) => r.ok) ? 0 : 1);
