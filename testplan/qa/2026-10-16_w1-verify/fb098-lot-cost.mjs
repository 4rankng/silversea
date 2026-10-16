// FB-098 (card 141026230750) — "Khai chi phí" on lot detail header, drawer at
// lot level (tripId null), sổ chi phí invalidation. Rung 3 as hoapt (+ CUS
// negative check). The "chưa có thông tin lô" string investigation is
// code-read (testplan contract documents its absence from the current build).
import {
  openAs, goto, shot, assertEval, clickButtonByText, api, finish, log,
} from './w1-lib.mjs';

const CARD = 'fb098';
const results = {};
const page = await openAs('hoapt');

await goto(page, '/shipments/7', { wait: 4000 });
results.lotCode = await assertEval(page, 'lot code visible', () =>
  document.body.innerText.match(/SHP-\d{4}-\d{5}/)?.[0] ?? null);
await shot(page, `${CARD}_01-detail.png`);
results.khaiChiPhiButton = await assertEval(page, '"Khai chi phí" header button', () =>
  [...document.querySelectorAll('button')].some((b) => (b.textContent ?? '').includes('Khai chi phí')));
results.panelAddButton = await assertEval(page, 'panel "+ Thêm khoản chi" button', () =>
  [...document.querySelectorAll('button')].some((b) => (b.textContent ?? '').includes('Thêm khoản chi')));
if (!results.khaiChiPhiButton) { results.ABORT = 'Khai chi phí button not visible (locked lot or role gate)'; await finish(CARD, results); process.exit(1); }

// ── Open the drawer from the header ──
await clickButtonByText(page, 'Khai chi phí');
// Drawer renders after the expense catalog loads — poll up to 10s.
let drawerOpenRaw = null;
for (let attempt = 0; attempt < 20; attempt++) {
  await new Promise((r) => setTimeout(r, 500));
  drawerOpenRaw = await page.evaluate(() => {
    const drawer = [...document.querySelectorAll('[role="dialog"]')].find((d) => d.innerText.includes('Thêm khoản chi'));
    if (!drawer) return null;
    const subtitle = drawer.querySelector('[class*="subtitle"], [class*="drawer__sub"]')?.textContent ?? drawer.innerText.split('\n')[1] ?? '';
    return { open: true, subtitle: subtitle.trim().slice(0, 80) };
  });
  if (drawerOpenRaw) break;
}
results.drawerOpen = drawerOpenRaw;
log(`DRAWER -> ${JSON.stringify(drawerOpenRaw)}`);
await shot(page, `${CARD}_02-drawer.png`);

// ── Fill a QA-named lot-level DRIVER_SHIPMENT row ──
const setByLabelNorm = (page, labelText, value, type = 'input') => page.evaluate((lt, v, typ) => {
  const norm = (t) => (t ?? '').replace(/\s*\*\s*$/, '').trim();
  for (const label of document.querySelectorAll('[role="dialog"] label')) {
    if (norm(label.textContent) !== lt) continue;
    let input = null;
    if (label.htmlFor) input = document.getElementById(label.htmlFor);
    if (!input) {
      let ancestor = label.parentElement;
      for (let hop = 0; hop < 4 && ancestor && !input; hop++) {
        input = ancestor.querySelector(typ);
        ancestor = ancestor.parentElement;
      }
    }
    if (!input) return false;
    const proto = typ === 'select' ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
    setter.call(input, v);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }
  return false;
}, labelText, value, type);

// Loại chi phí lái xe = combobox: real typing + mouse-click the option.
const loai = await (async () => {
  const handle = await page.evaluateHandle(() => {
    const norm = (t) => (t ?? '').replace(/\s*\*\s*$/, '').trim();
    const labels = [...document.querySelectorAll('[role="dialog"] label')];
    const target = labels.find((l) => norm(l.textContent) === 'Loại chi phí lái xe');
    let node = target;
    for (let hop = 0; hop < 4 && node; hop++) {
      const found = node.querySelector?.('input[type="text"]');
      if (found && found.type === 'text') return found;
      node = node.parentElement;
    }
    return null;
  });
  const el = handle.asElement();
  if (!el) return 'INPUT-NOT-FOUND';
  await el.click();
  await el.type('Phí', { delay: 60 });
  await new Promise((r) => setTimeout(r, 900));
  const box = await page.evaluate(() => {
    const opt = [...document.querySelectorAll('[role="option"]')][0];
    if (!opt) return null;
    const r = opt.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2, text: opt.textContent?.trim() };
  });
  if (!box) return 'OPTION-NOT-FOUND';
  await page.mouse.click(box.x, box.y);
  await new Promise((r) => setTimeout(r, 600));
  return box.text;
})();
log(`PICK loại (lot-level) -> ${loai}`);
results.pickedLoai = loai;

await setByLabelNorm(page, 'Tên khoản chi', 'QA-W1 khai chi phí lô fixture');
await setByLabelNorm(page, 'Thực chi (VND)', '300000', 'input[type="number"]');
// DRIVER_SHIPMENT: make Thu = Trả so the required charge is satisfied.
await page.evaluate(() => {
  const check = [...document.querySelectorAll('[role="dialog"] input[type="checkbox"]')][0];
  if (check && !check.checked) check.click();
});
await new Promise((r) => setTimeout(r, 400));
await shot(page, `${CARD}_03-filled.png`);

await clickButtonByText(page, 'Lưu 1 khoản chi', { exact: true });
await new Promise((r) => setTimeout(r, 2500));
results.afterSave = await assertEval(page, 'after save state', () => {
  const drawer = [...document.querySelectorAll('[role="dialog"]')].find((d) => d.innerText.includes('Thêm khoản chi'));
  if (!drawer) return { drawerOpen: false };
  const text = drawer.innerText;
  return {
    drawerOpen: true,
    statusLine: text.includes('Đã lưu khoản chi.'),
    error: drawer.querySelector('[role="alert"]')?.textContent?.trim() ?? null,
  };
});
await clickButtonByText(page, 'Đóng', { exact: true });
await new Promise((r) => setTimeout(r, 1200));
await shot(page, `${CARD}_04-after-save.png`);

// ── Sổ chi phí invalidation: panel lists the QA row without reload ──
results.panelShowsRow = await assertEval(page, 'panel shows QA row', () =>
  document.body.innerText.includes('QA-W1 khai chi phí lô fixture'));

// ── Persisted proof ──
const entries = await api({ user: 'hoapt', path: '/api/expense-accounting/entries?shipmentId=7' });
const hits = JSON.stringify(entries.json ?? []).match(/QA-W1[^"]*/g) ?? [];
results.persistedQaW1Refs = hits.slice(0, 5);
results.persistedViaApi = hits.length > 0;

// ── Role gate: CUS must not see the header button ──
const cusPage = await openAs('tiepvv');
await goto(cusPage, '/shipments/7', { wait: 3500 });
results.cusSeesKhaiChiPhi = await assertEval(cusPage, 'CUS sees "Khai chi phí"?', () =>
  [...document.querySelectorAll('button')].some((b) => (b.textContent ?? '').includes('Khai chi phí')));
await shot(cusPage, `${CARD}_05-cus-no-button.png`);
await cusPage.close();

await finish(CARD, results);
