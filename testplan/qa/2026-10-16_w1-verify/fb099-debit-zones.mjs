// FB-099 (card 141026230760) — chốt debit: ba vùng rõ. Read-only rung-3
// structure check as hoapt (the fix is layout-only per TC-COSTUX-05).
import {
  openAs, goto, shot, assertEval, finish, log,
} from './w1-lib.mjs';

const CARD = 'fb099';
const results = {};
const page = await openAs('hoapt');

await goto(page, '/accounting/chot-debit', { wait: 5000 });
await shot(page, `${CARD}_01-zones.png`);

results.zones = await assertEval(page, 'three-zone structure', () => {
  const text = document.body.innerText;
  const summary = !!document.querySelector('[aria-label="Tổng hợp chốt debit"]');
  const pendingWrap = document.querySelector('[role="region"][aria-label="Bảng chờ xác nhận điều chỉnh cước"]');
  const pendingTable = pendingWrap?.querySelector('table');
  const planWrap = document.querySelector('[role="region"][aria-label="Bảng kế hoạch điều động tổng hợp"]');
  const planTable = planWrap?.querySelector('table');
  const pendingHeading = [...document.querySelectorAll('h2')].some((h) => h.textContent?.trim() === 'Chờ xác nhận');
  const rounds = !!document.querySelector('[aria-label="Tổng hợp công nợ khách hàng"]');
  const pendingRowCount = pendingTable ? pendingTable.querySelectorAll('tbody tr').length : -1;
  const planRowCount = planTable ? planTable.querySelectorAll('tbody tr').length : -1;
  // PENDING rows must not leak into the kế hoạch board (status "Chờ xác nhận").
  const planRowsWithPendingText = planTable
    ? [...planTable.querySelectorAll('tbody tr')].filter((tr) => tr.innerText.includes('Chờ xác nhận')).length
    : -1;
  // Status cells stay text-only (no pill/badge/chip chrome in the boards).
  const chromeCells = [...document.querySelectorAll('table[aria-label] .pill, table[aria-label] [class*="badge"], table[aria-label] [class*="chip"]')].length;
  const summaryChip = text.match(/Chờ xác nhận\s*\n?\s*(\d+)/)?.[1] ?? null;
  return {
    summaryRail: summary,
    pendingHeading,
    pendingCaption: text.includes('Chờ xác nhận — lô có yêu cầu điều chỉnh cước đang chờ'),
    pendingTablePresent: !!pendingTable,
    pendingRowCount,
    planTablePresent: !!planTable,
    planRowCount,
    planRowsWithPendingText,
    roundsSection: rounds,
    chromeCells,
    summaryChip,
  };
});
log(`ZONES ${JSON.stringify(results.zones)}`);

// Column parity between the two zones (same DebitBoardTable component).
results.columnParity = await assertEval(page, 'column parity pending vs plan', () => {
  const pend = document.querySelector('[role="region"][aria-label="Bảng chờ xác nhận điều chỉnh cước"] table');
  const plan = document.querySelector('[role="region"][aria-label="Bảng kế hoạch điều động tổng hợp"] table');
  if (!pend || !plan) return 'missing-table';
  const heads = (t) => [...t.querySelectorAll('thead th')].map((th) => th.textContent?.trim());
  return JSON.stringify(heads(pend)) === JSON.stringify(heads(plan));
});

await shot(page, `${CARD}_02-full.png`);
await finish(CARD, results);
