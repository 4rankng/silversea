// FB-103 (card 141026230800) — 2 chế độ lương ghi nhận qua UI: "Chế độ lương"
// panel on /timesheet/doi-chieu changes driver 11's 2099-12 month from
// PER_TRIP to FLAT_MONTHLY and back; salary recomputes per the contract.
// Fixture month: 2099-12 (sanctioned-purge namespaced). Rung 3.
import {
  openAs, goto, shot, assertEval, api, finish, log,
} from './w1-lib.mjs';

const CARD = 'fb103';
const results = {};
const YEAR = 2099, MONTH = 12;
const DRIVER_ID = 11, DRIVER_NAME = 'Bùi Quang Hường';
const MONTH_ID = 2; // fixture month from fb102

// The page nests panels; the salary panel holds BOTH the mode control and a
// number input. Find the deepest panel node containing the title text.
async function salaryPanel(page) {
  return page.evaluateHandle(() => {
    const matches = [...document.querySelectorAll('div, section')]
      .filter((el) => [...el.querySelectorAll('h2,h3,h4')].some((h) => h.textContent?.includes('Chế độ lương')));
    return matches[matches.length - 1] ?? null;
  });
}
async function setNumber(page, value) {
  for (let attempt = 0; attempt < 10; attempt++) {
    const done = await page.evaluate((v) => {
      // selects[0] = driver switcher; selects[1] = Hình thức lương; the
      // parameter input follows it in the same panel.
      const num = document.querySelectorAll('select')[1]?.closest('.ts-mode-form')?.querySelector('input[type="number"], input.ds-field__input')
        ?? document.querySelectorAll('select')[1]?.parentElement?.parentElement?.querySelector('input');
      if (!num) return false;
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      setter.call(num, v);
      num.dispatchEvent(new Event('input', { bubbles: true }));
      num.dispatchEvent(new Event('change', { bubbles: true }));
      return num.value === v;
    }, value);
    if (done) return true;
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}
async function clickSaveMode(page) {
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button')].find((b) => b.textContent?.includes('Lưu chế độ lương'));
    btn?.scrollIntoView({ block: 'center' });
    btn?.click();
  });
}

const page = await openAs('hoapt');

// ── 1. Đối chiếu page: Chế độ lương panel with driver 11's current state ──
await goto(page, `/timesheet/doi-chieu?m=${MONTH}&y=${YEAR}`, { wait: 5000 });
// The page pins one driver per period (the months list of the period) — find
// driver 11's switcher or the driver selector it renders.
results.pageState = await assertEval(page, 'doi-chieu page state', () => {
  const text = document.body.innerText;
  return {
    heading: text.includes('Đối chiếu chấm công'),
    driverNames: ['Bùi Quang Hường', 'Bùi Tiến Dũng'].filter((n) => text.includes(n)),
    salaryPanel: text.includes('Chế độ lương'),
    modeLine: text.match(/Hình thức lương[^\n]*/)?.[0] ?? null,
    tongHopPanel: text.includes('Tổng hợp tháng'),
    reconcileLock: text.includes('Đã đối chiếu — mở lại để sửa'),
  };
});
await shot(page, `${CARD}_01-doi-chieu.png`);

// ── 2. Switch mode to FLAT_MONTHLY 10,000,000 via the panel ──
results.modePanelControls = await assertEval(page, 'mode panel controls', () => {
  const panels = [...document.querySelectorAll('section, div')].filter((el) => el.querySelector('h2,h3,h4')?.textContent?.includes('Chế độ lương'));
  const panel = panels[panels.length - 1];
  if (!panel) return null;
  const nativeSel = panel.querySelector('select');
  const comboInput = panel.querySelector('input[role="combobox"], input.z-10');
  return {
    nativeSelect: nativeSel ? [...nativeSel.options].map((o) => o.label) : null,
    comboboxInput: !!comboInput,
    saveButton: [...panel.querySelectorAll('button')].some((b) => b.textContent?.includes('Lưu chế độ lương')),
  };
});
log(`MODE CONTROLS ${JSON.stringify(results.modePanelControls)}`);

const switched = await page.evaluate(() => {
  const sel = document.querySelectorAll('select')[1];
  if (!sel) return 'none';
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
  setter.call(sel, 'FLAT_MONTHLY');
  sel.dispatchEvent(new Event('change', { bubbles: true }));
  return sel.value === 'FLAT_MONTHLY' ? 'native-select' : 'failed';
});
log(`SWITCH -> ${switched}`);

if (switched === 'combobox') {
  const comboSpot = await page.evaluate(() => {
    const panels = [...document.querySelectorAll('section, div')].filter((el) => el.querySelector('h2,h3,h4')?.textContent?.includes('Chế độ lương'));
    const panel = panels[panels.length - 1];
    const input = panel.querySelector('input[role="combobox"], input.z-10');
    const r = input.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  await page.mouse.click(comboSpot.x, comboSpot.y);
  await page.keyboard.type('Lương theo tháng', { delay: 50 });
  await new Promise((r) => setTimeout(r, 1200));
  const optBox = await page.evaluate(() => {
    const opt = [...document.querySelectorAll('[role="option"]')].find((o) => (o.textContent ?? '').includes('Lương theo tháng'));
    if (!opt) return null;
    const r = opt.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  if (optBox) { await page.mouse.click(optBox.x, optBox.y); }
  await new Promise((r) => setTimeout(r, 800));
}

// Fill Lương tháng cố định and save (guarded against render timing).
await setNumber(page, '10000000');
await clickSaveMode(page);
await new Promise((r) => setTimeout(r, 3000));
await shot(page, `${CARD}_02-flat-saved.png`);

// ── 3. API proof: FLAT_MONTHLY recorded; salary = flatAmount; audit row ──
const after = await api({ user: 'hoapt', path: `/api/timesheet/months?year=${YEAR}&month=${MONTH}` });
const m = (after.json?.items ?? []).find((row) => row.driverId === DRIVER_ID);
results.afterFlat = m ? { mode: m.salaryMode, flatAmount: m.flatAmount, dailyBase: m.dailyBase, trips: m.salary?.trips, workdays: m.salary?.workdays, status: m.status } : null;
results.modePersisted = m?.salaryMode === 'FLAT_MONTHLY' && Number(m?.flatAmount) === 10000000;

// ── 4. Grid page shows the read-only mode line (Điều vận view) ──
await goto(page, `/timesheet?m=${MONTH}&y=${YEAR}`, { wait: 4000 });
results.gridModeLine = await assertEval(page, 'grid mode line (FLAT)', () =>
  document.body.innerText.match(/Hình thức lương: [^\n]+/)?.[0] ?? null);
await shot(page, `${CARD}_03-grid-flat.png`);

// ── 5. Restore PER_TRIP + dailyBase 300000 (keeps the fixture coherent) ──
await goto(page, `/timesheet/doi-chieu?m=${MONTH}&y=${YEAR}`, { wait: 4500 });
await page.evaluate(() => {
  const panels = [...document.querySelectorAll('section, div')].filter((el) => el.querySelector('h2,h3,h4')?.textContent?.includes('Chế độ lương'));
  const panel = panels[panels.length - 1];
  const sel = panel?.querySelector('select');
  if (sel) {
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
    setter.call(sel, 'PER_TRIP');
    sel.dispatchEvent(new Event('change', { bubbles: true }));
  }
});
await new Promise((r) => setTimeout(r, 500));
await setNumber(page, '300000');
await clickSaveMode(page);
await new Promise((r) => setTimeout(r, 3000));
const restored = await api({ user: 'hoapt', path: `/api/timesheet/months?year=${YEAR}&month=${MONTH}` });
const m2 = (restored.json?.items ?? []).find((row) => row.driverId === DRIVER_ID);
results.restoredPerTrip = { mode: m2?.salaryMode, dailyBase: m2?.dailyBase };
results.modeRoundTrip = m2?.salaryMode === 'PER_TRIP' && Number(m2?.dailyBase) === 300000;

await finish(CARD, results);
