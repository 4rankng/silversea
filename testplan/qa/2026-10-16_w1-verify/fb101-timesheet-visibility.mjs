// FB-101 (card 141026230780) — chấm công không còn ẩn với kế toán; lưới
// read-only cho vai trò không ghi; Đối chiếu chấm công giữ nguyên. Rung 3
// role matrix: hoapt (ACCOUNTANT), dungnv (DISPATCHER), admin, tiepvv (CUS).
import {
  openAs, goto, shot, assertEval, api, finish,
} from './w1-lib.mjs';

const CARD = 'fb101';
const results = {};

async function navState(page) {
  // The sidebar renders labels (no plain anchors) — assert on nav text.
  return page.evaluate(() => {
    const navText = (document.querySelector('nav, aside, [class*="sidebar"]')?.innerText ?? '')
      || [...document.querySelectorAll('a, button')].map((n) => n.textContent?.trim()).join('\n');
    return {
      grid: navText.includes('Chấm công lái xe'),
      report: navText.includes('Tổng hợp xếp lệnh tháng'),
      doiChieu: navText.includes('Đối chiếu chấm công'),
    };
  });
}

// ── ACCOUNTANT: nav shows the grid + report; grid page loads read-only ──
const acc = await openAs('hoapt');
await goto(acc, '/dashboard', { wait: 3000 });
results.accountantNav = await navState(acc);
await goto(acc, '/timesheet', { wait: 4000 });
results.accountantGridPage = await assertEval(acc, 'hoapt /timesheet page state', () => {
  const text = document.body.innerText;
  return {
    heading: text.includes('Chấm công lái xe'),
    saveGridButton: [...document.querySelectorAll('button')].some((b) => b.textContent?.includes('Lưu lưới')),
    driverPicker: !!document.querySelector('select'),
    legendWhenMonth: null,
  };
});
await shot(acc, `${CARD}_01-accountant-grid.png`);
await goto(acc, '/timesheet/doi-chieu', { wait: 4000 });
results.accountantDoiChieu = await assertEval(acc, 'hoapt /timesheet/doi-chieu loads', () => {
  const text = document.body.innerText;
  return { denied: text.includes('Không có quyền') || document.body.innerText.includes('403'), heading: text.slice(0, 300) };
});
await goto(acc, '/timesheet/bao-cao', { wait: 4000 });
results.accountantReportPage = await assertEval(acc, 'hoapt /timesheet/bao-cao loads', () =>
  document.body.innerText.includes('Tổng hợp xếp lệnh tháng'));
await shot(acc, `${CARD}_02-accountant-report.png`);
await acc.close();

// ── DISPATCHER: grid nav yes, report nav no; grid writable when month exists ──
const dis = await openAs('dungnv');
await goto(dis, '/dashboard', { wait: 3000 });
results.dispatcherNav = await navState(dis);
await goto(dis, '/timesheet', { wait: 4000 });
results.dispatcherGridPage = await assertEval(dis, 'dungnv /timesheet loads', () => ({
  heading: document.body.innerText.includes('Chấm công lái xe'),
}));
await shot(dis, `${CARD}_03-dispatcher-grid.png`);
await dis.close();

// ── ADMIN: everything ──
const adm = await openAs('admin');
await goto(adm, '/dashboard', { wait: 3000 });
results.adminNav = await navState(adm);
await adm.close();

// ── CUS: timesheet must deny (route guard) ──
const cus = await openAs('tiepvv');
await goto(cus, '/timesheet', { wait: 3500 });
results.cusDenied = await assertEval(cus, 'tiepvv /timesheet denied', () => {
  return {
    onGridPage: document.body.innerText.includes('Chấm công lái xe'),
    redirectPath: location.pathname,
  };
});
await cus.close();

// ── Backend role law (API truth): ACCOUNTANT writes grid → 403 ──
const gridProbe = await api({
  user: 'hoapt', method: 'PUT', path: '/api/timesheet/months/999999/days',
  body: { days: [{ workDate: '2099-12-01', symbol: 'K' }] },
});
results.apiAccountantGridWrite = { status: gridProbe.status, body: String(gridProbe.json?.error ?? gridProbe.text).slice(0, 80) };
// Accountant may create months (accountantOnly) — with an impossible driver to stay inert.
const monthProbe = await api({
  user: 'hoapt', method: 'POST', path: '/api/timesheet/months',
  body: { driverId: 999999999, year: 2099, month: 12 },
});
// 404 here = 'driver not found' — proves the accountantOnly route itself is reachable for hoapt (not 403).
results.apiAccountantMonthCreate = { status: monthProbe.status, body: String(monthProbe.json?.error ?? monthProbe.text).slice(0, 80) };

await finish(CARD, results);
