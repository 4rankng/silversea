// FB-104 (card 141026230810) — "Tổng hợp xếp lệnh tháng" report mapping,
// verified against the 2099-12 fixture symbols (K,Q,Đ,L,N,P,K on driver 11).
// The build's "Excel" is an on-screen report styled after the customer's
// Excel template (no .xlsx download exists — recorded as a finding/limit).
// Rung 3 read-only.
import {
  openAs, goto, shot, assertEval, api, finish, log,
} from './w1-lib.mjs';

const CARD = 'fb104';
const results = {};
const YEAR = 2099, MONTH = 12;

const page = await openAs('hoapt');
await goto(page, `/timesheet/bao-cao?m=${MONTH}&y=${YEAR}`, { wait: 6000 });
await shot(page, `${CARD}_01-report.png`);

results.template = await assertEval(page, 'report template', () => {
  const text = document.body.innerText;
  const table = document.querySelector('table.ts-report');
  const headers = [...(table?.querySelectorAll('thead th') ?? [])].map((th) => th.textContent?.trim());
  const dayHeaders = headers.filter((h) => /^\d+$/.test(h));
  const row1 = [...(table?.querySelectorAll('tbody tr') ?? [])].map((tr) =>
    [...tr.querySelectorAll('td')].map((td) => ({ t: td.textContent?.trim(), cls: td.className })));
  return {
    title: text.includes('TỔNG HỢP XẾP LỆNH THÁNG 12/2099'),
    legend: /K\s+kẹp|K\s/.test(text) && text.includes('quay đầu') && text.includes('lưu ca'),
    headers,
    dayHeaderCount: dayHeaders.length,
    firstDayHeader: dayHeaders[0],
    rowCount: row1.length,
    row1,
    footerRows: [...(table?.querySelectorAll('tfoot tr') ?? [])].map((tr) => tr.innerText.replace(/\n+/g, ' | ').slice(0, 80)),
  };
});
log(`TEMPLATE ${JSON.stringify(results.template).slice(0, 900)}`);

// ── API truth for the mapping assertions ──
const months = await api({ user: 'hoapt', path: `/api/timesheet/months?year=${YEAR}&month=${MONTH}` });
const m = (months.json?.items ?? []).find((row) => row.driverId === 11);
const savedSymbols = Object.fromEntries((m?.days ?? []).filter((d) => d.symbol).map((d) => [Number(d.workDate.slice(8, 10)), d.symbol]));
results.fixtureSymbols = savedSymbols;
const don = Object.values(savedSymbols).filter((s) => s === 'Đ').length;
const kep = Object.values(savedSymbols).filter((s) => s === 'K').length;
const quayDau = Object.values(savedSymbols).filter((s) => s === 'Q').length * 2;

results.mapping = await assertEval(page, 'row mapping vs fixture', () => {
  const table = document.querySelector('table.ts-report');
  const tr = [...(table?.querySelectorAll('tbody tr') ?? [])].find((r) => r.innerText.includes('Bùi Quang Hường'));
  if (!tr) return { found: false };
  const cells = [...tr.querySelectorAll('td')];
  const val = (label) => cells.find((c) => c.dataset.label === label)?.textContent?.trim();
  const dayCell = (n) => cells.find((c) => c.dataset.label === `Ngày ${n}`);
  return {
    stt: val('STT'),
    loaiXe: val('Loại xe'),
    bienSo: val('Biển kiểm soát'),
    hinhThucLuong: val('Hình thức lương'),
    laiXe: val('Lái xe'),
    day1: { symbol: dayCell(1)?.textContent?.trim(), cls: dayCell(1)?.className },
    day2: { symbol: dayCell(2)?.textContent?.trim(), cls: dayCell(2)?.className },
    day3: { symbol: dayCell(3)?.textContent?.trim(), cls: dayCell(3)?.className },
    day4: { symbol: dayCell(4)?.textContent?.trim(), cls: dayCell(4)?.className },
    day5: { symbol: dayCell(5)?.textContent?.trim(), cls: dayCell(5)?.className },
    day6: { symbol: dayCell(6)?.textContent?.trim(), cls: dayCell(6)?.className },
    day7: { symbol: dayCell(7)?.textContent?.trim(), cls: dayCell(7)?.className },
    tongDon: val('Tổng lệnh đơn'),
    tongKep: val('Tổng lệnh kẹp'),
    quayDau: val('Số chuyến quay đầu'),
    tongChuyen: val('Tổng số chuyến'),
    ngayCong: val('Số ngày công'),
  };
});
results.expectedMapping = {
  don, kep, quayDau,
  tongChuyen: m?.salary?.trips, ngayCong: m?.salary?.workdays,
  colorLaw: 'K/Q/Đ green (trip), L yellow (standby), N/P red (off), Sunday yellow, off wins on Sunday',
};
results.mappingMatches = typeof results.mapping === 'object' && results.mapping?.found !== false
  && Number(results.mapping?.tongDon) === don
  && Number(results.mapping?.tongKep) === kep
  && Number(results.mapping?.quayDau) === quayDau
  && Number(results.mapping?.tongChuyen) === (m?.salary?.trips ?? -1)
  && Number(results.mapping?.ngayCong) === (m?.salary?.workdays ?? -1);
log(`MAPPING ${JSON.stringify(results.mapping).slice(0, 700)}`);

// ── Footer per-day: kẹp/ngày + tỷ lệ % (kẹp / (K+Q+Đ) of that day) ──
results.perDay = await assertEval(page, 'per-day footer', () => {
  const table = document.querySelector('table.ts-report');
  const foots = [...(table?.querySelectorAll('tfoot tr') ?? [])];
  const kepRow = foots[0] ? [...foots[0].querySelectorAll('td')].map((td) => td.textContent?.trim()) : [];
  const pctRow = foots[1] ? [...foots[1].querySelectorAll('td')].map((td) => td.textContent?.trim()) : [];
  return {
    kepByDay: kepRow.slice(0, 10),
    pctByDay: pctRow.slice(0, 10),
  };
});
// Day1 K → 1 kẹp /1 lệnh = 100%; day2 Q → 0/1 = 0%; day3 Đ → 0/1 = 0%; day7 K → 1/1 = 100%.
const pct = results.perDay?.pctByDay ?? [];
results.perDayMatches = Array.isArray(pct)
  && pct[0] === '100%' && pct[1] === '0%' && pct[2] === '0%' && pct[6] === '100%';
log(`PERDAY ${JSON.stringify(results.perDay)}`);

// ── Color classes law ──
const cls = (n) => results.mapping?.[`day${n}`]?.cls ?? '';
results.colors = {
  day1_K_green: cls(1).includes('ts-report__cell--trip'),
  day2_Q_green: cls(2).includes('ts-report__cell--trip'),
  day3_D_green: cls(3).includes('ts-report__cell--trip'),
  day4_L_yellow: cls(4).includes('ts-report__cell--standby'),
  day5_N_red: cls(5).includes('ts-report__cell--off'),
  day6_P_sunday_red: cls(6).includes('ts-report__cell--off'),
  day7_K_green: cls(7).includes('ts-report__cell--trip'),
};

// ── Export surface probe: the build has no file download ──
results.exportSurface = await assertEval(page, 'export/download surface', () => {
  const buttons = [...document.querySelectorAll('button, a')].map((b) => b.textContent?.trim());
  return {
    downloadLike: buttons.filter((t) => t && /xuất|excel|download|\.xlsx/i.test(t)),
    note: 'FB-104 delivers the report as an on-screen Excel-template table; no .xlsx endpoint exists in this build.',
  };
});

await finish(CARD, results);
