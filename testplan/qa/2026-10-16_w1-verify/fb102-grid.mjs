// FB-102 (card 141026230790) — ký hiệu xếp lệnh + "Mở bảng chấm công" cho kế
// toán. Resume run: month 2 (driver 11, 2099-12) already exists from the
// previous drive; driver 16 opens the board via the dialog this run.
// Fixture: 2099-12 months (namespaced for the sanctioned purge).
import {
  openAs, goto, shot, assertEval, api, finish, log,
} from './w1-lib.mjs';

const CARD = 'fb102';
const results = {};
const YEAR = 2099, MONTH = 12;
const DRIVER_ID = 11, DRIVER_NAME = 'Bùi Quang Hường';
const DRIVER2_ID = 16, DRIVER2_NAME = 'Bùi Tiến Dũng';

const tripsOf = { K: 1, Q: 2, 'Đ': 1, L: 0, N: 0, P: 0 };
const workdayOf = { K: 1, Q: 1, 'Đ': 1, L: 1, N: 0, P: 0 };
const symbols = { 1: 'K', 2: 'Q', 3: 'Đ', 4: 'L', 5: 'N', 6: 'P', 7: 'K' };
let expectedTrips = 0, expectedWorkdays = 0;
for (const [day, symbol] of Object.entries(symbols)) {
  const isSunday = new Date(Date.UTC(YEAR, MONTH - 1, Number(day))).getUTCDay() === 0;
  expectedTrips += tripsOf[symbol]; // Sunday trips record but never pay a workday
  if (!isSunday) expectedWorkdays += workdayOf[symbol];
}
results.expected = { symbols, trips: expectedTrips, workdays: expectedWorkdays };
log(`EXPECTED trips=${expectedTrips} workdays=${expectedWorkdays}`);

// UUI combobox sliver — click by coordinates, type, real-click the option.
async function pickDriver(page, driverName) {
  const spot = await page.evaluate(() => {
    const wrap = document.querySelector('.ts-driver-select');
    const r = wrap.getBoundingClientRect();
    return { x: r.x + Math.max(r.width / 2, 2), y: r.y + r.height / 2 };
  });
  await page.mouse.click(spot.x, spot.y);
  await new Promise((r) => setTimeout(r, 400));
  await page.keyboard.type(driverName.split(' ').slice(-2).join(' '), { delay: 40 });
  await new Promise((r) => setTimeout(r, 1200));
  const box = await page.evaluate((want) => {
    const opt = [...document.querySelectorAll('[role="option"]')]
      .find((o) => (o.textContent ?? '').trim() === want);
    if (!opt) return null;
    const r = opt.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  }, driverName);
  if (!box) return 'OPTION-NOT-FOUND';
  await page.mouse.click(box.x, box.y);
  await new Promise((r) => setTimeout(r, 1200));
  return driverName;
}

// ── 1. DISPATCHER: driver 16 has no month → hint WITHOUT the mở-bảng button ──
const dis = await openAs('dungnv');
await goto(dis, `/timesheet?m=12&y=2099`, { wait: 4500 });
results.dispatcherPick2 = await pickDriver(dis, DRIVER2_NAME);
results.dispatcherNoOpenBoard = await assertEval(dis, 'dungnv: hint, no mở-bảng button', () => {
  const text = document.body.innerText;
  return {
    hint: text.includes('chưa có bảng chấm công'),
    openBoardButton: [...document.querySelectorAll('button')].some((b) => b.textContent?.includes('Mở bảng chấm công')),
  };
});
await shot(dis, `${CARD}_01-dispatcher-no-button.png`);
await dis.close();

// ── 2. ACCOUNTANT: driver 16 → hint + button → dialog → Mở bảng ──
const acc = await openAs('hoapt');
await goto(acc, `/timesheet?m=${MONTH}&y=${YEAR}`, { wait: 4500 });
results.accountantPick2 = await pickDriver(acc, DRIVER2_NAME);
results.accountantSeesOpenBoard = await assertEval(acc, 'hoapt sees Mở bảng chấm công', () =>
  [...document.querySelectorAll('button')].some((b) => b.textContent?.includes('Mở bảng chấm công')));
await acc.evaluate(() => {
  const btn = [...document.querySelectorAll('button')].find((b) => b.textContent?.includes('Mở bảng chấm công'));
  btn?.scrollIntoView({ block: 'center' });
  btn?.click();
});
await new Promise((r) => setTimeout(r, 1500));
await shot(acc, `${CARD}_02-dialog.png`);
results.openBoardDialog = await assertEval(acc, 'Mở bảng dialog', () => {
  const dlg = document.querySelector('[role="dialog"]');
  if (!dlg) return null;
  const text = dlg.innerText;
  return {
    title: text.includes('Mở bảng chấm công'),
    modeHintText: text.match(/Hình thức lương[^\n]*/)?.[0] ?? null,
    dailyBaseField: text.includes('Lương ngày (VND)'),
    emptyOkHint: text.includes('Để trống nếu chưa có mức'),
  };
});
// The dialog's Hình thức lương is a UUI combobox; PER_TRIP is the default.
await acc.evaluate(() => {
  const dlg = document.querySelector('[role="dialog"]');
  const num = dlg.querySelector('input[type="number"]');
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  setter.call(num, '300000');
  num.dispatchEvent(new Event('input', { bubbles: true }));
  num.dispatchEvent(new Event('change', { bubbles: true }));
});
await new Promise((r) => setTimeout(r, 300));
await acc.evaluate(() => {
  const btn = [...document.querySelectorAll('[role="dialog"] button')].find((b) => b.textContent?.trim() === 'Mở bảng');
  btn?.click();
});
await new Promise((r) => setTimeout(r, 3000));
await shot(acc, `${CARD}_03-grid-opened.png`);
results.driver16Grid = await assertEval(acc, 'driver 16 grid after open', () => {
  const text = document.body.innerText;
  return {
    modeLine: text.match(/Hình thức lương: [^\n]+/)?.[0] ?? null,
    cellCount: document.querySelectorAll('.ts-grid input').length,
  };
});

// ── 3. DISPATCHER types the symbol week on driver 11 (month 2) ──
const dis2 = await openAs('dungnv');
await goto(dis2, `/timesheet?m=${MONTH}&y=${YEAR}`, { wait: 4500 });
results.dispatcherGridPick = await pickDriver(dis2, DRIVER_NAME);
const saveButtonVisible = await assertEval(dis2, 'dungnv sees Lưu lưới', () =>
  [...document.querySelectorAll('button')].some((b) => b.textContent?.includes('Lưu lưới')));
results.dispatcherSaveButton = saveButtonVisible;

for (const [day, symbol] of Object.entries(symbols)) {
  const workDate = `${YEAR}-${MONTH}-${String(day).padStart(2, '0')}`;
  const ok = await dis2.evaluate((wd) => {
    const td = document.querySelector(`.ts-grid td[data-label="${wd}"]`);
    if (!td) return 'NO-CELL';
    const input = td.querySelector('input');
    if (!input) return 'NO-INPUT';
    return input.readOnly ? 'READONLY' : 'OK';
  }, workDate);
  if (ok !== 'OK') { results[`cell${day}State`] = ok; continue; }
  const box = await dis2.evaluate((wd) => {
    const input = document.querySelector(`.ts-grid td[data-label="${wd}"] input`);
    const r = input.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  }, workDate);
  await dis2.mouse.click(box.x, box.y);
  await dis2.keyboard.type(symbol, { delay: 80 });
  await new Promise((r) => setTimeout(r, 250));
}
await shot(dis2, `${CARD}_04-typed.png`);
await dis2.evaluate(() => {
  const btn = [...document.querySelectorAll('button')].find((b) => b.textContent?.includes('Lưu lưới'));
  btn?.click();
});
await new Promise((r) => setTimeout(r, 3000));
await shot(dis2, `${CARD}_05-after-save.png`);
results.gridTotalsAfterSave = await assertEval(dis2, 'grid running totals', () => {
  const text = document.body.innerText;
  return {
    chuyen: text.match(/Chuyến\n?(\d+)/)?.[1] ?? null,
    summaryRail: text.includes('Tổng chấm công tháng'),
  };
});
await dis2.close();

// ── 4. Server-chốt proof ──
const after = await api({ user: 'hoapt', path: `/api/timesheet/months?year=${YEAR}&month=${MONTH}` });
const rows = after.json?.items ?? [];
results.months = rows.map((row) => ({ id: row.id, driverId: row.driverId, mode: row.salaryMode, trips: row.salary?.trips, workdays: row.salary?.workdays }));
const monthRow = rows.find((row) => row.driverId === DRIVER_ID);
results.monthIdDriver11 = monthRow?.id ?? null;
results.tripsMatchRules = monthRow?.salary?.trips === expectedTrips;
results.workdaysMatchRules = monthRow?.salary?.workdays === expectedWorkdays;
results.daysSaved = monthRow ? (monthRow.days ?? []).filter((d) => d.symbol).length : 0;

// ── 5. .strict() law: a smuggled trips field must 400 ──
const smuggle = await api({
  user: 'dungnv', method: 'PUT', path: `/api/timesheet/months/${monthRow?.id}/days`,
  body: { days: [{ workDate: `${YEAR}-${MONTH}-10`, symbol: 'K', trips: 99 }] },
});
results.smuggledTripsRejected = { status: smuggle.status, body: String(smuggle.json?.error ?? smuggle.text).slice(0, 100) };

await acc.close();
await finish(CARD, results);
