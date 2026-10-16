// FB-100 (card 141026230770) — tạm ứng: nút "Phê duyệt tạm ứng" cho PENDING;
// hoàn ứng: tick "Xác nhận hoàn ứng" bắt buộc + refundAmount có dấu.
// Chain: OPS creates request → kế toán approves (UI) → OPS creates phiếu →
// kế toán records with NEGATIVE refund (UI) → API proofs. Idempotency-Key on
// all writes. Fixtures: reason/note 'QA-W1 …' (purge classes + registry
// additions recorded in the run record).
import {
  openAs, goto, shot, assertEval, clickButtonByText, api, finish, log,
} from './w1-lib.mjs';

const CARD = 'fb100';
const results = {};
const STAMP = `QA-W1-${Date.now().toString(36)}`;

// ── 1. OPS creates (or reuses) the PENDING advance request ──
// CPB-03: the OPS wallet route is the PENDING path; /forwarder/me is the
// legacy direct-apply (RECORDED-at-create, no UI approval) door.
const existingList = await api({ user: 'hoapt', path: '/api/advance-requests?status=PENDING&limit=200' });
const existing = (existingList.json?.items ?? []).find((row) => String(row.reason ?? '').startsWith('QA-W1-'));
let requestId;
if (existing) {
  requestId = existing.id;
  results.createdRequest = { reused: true, id: requestId, status: existing.status };
  log(`REUSE REQUEST id=${requestId} status=${existing.status}`);
} else {
  const created = await api({
    user: 'hoangnh', method: 'POST', path: '/api/ops/wallet/advance-requests',
    body: { amount: 2000000, reason: `${STAMP} tạm ứng fixture` },
  });
  results.createdRequest = created.json ?? { status: created.status };
  requestId = created.json?.id;
  if (!requestId) { results.ABORT = `request create failed: ${created.status}`; await finish(CARD, results); process.exit(1); }
  log(`REQUEST id=${requestId} status=${created.json?.status}`);
}

// ── 2. Kế toán sees + clicks "Phê duyệt tạm ứng" on that row ──
const page = await openAs('hoapt');
await goto(page, '/advances?view=requests', { wait: 4500 });
await shot(page, `${CARD}_01-requests.png`);
const rowState1 = await assertEval(page, 'QA-W1 row before approve', () => {
  const rows = [...document.querySelectorAll('.adv-grid-row, table tbody tr, [role="row"]')];
  const row = rows.find((tr) => tr.innerText.includes('QA-W1') && [...tr.querySelectorAll('button')].some((b) => b.textContent?.includes('Phê duyệt tạm ứng')));
  if (!row) return { found: false };
  return {
    found: true,
    text: row.innerText.replace(/\n+/g, ' | ').slice(0, 160),
    hasApproveButton: [...row.querySelectorAll('button')].some((b) => b.textContent?.includes('Phê duyệt tạm ứng')),
  };
});
results.rowBeforeApprove = rowState1;
if (!rowState1?.found || !rowState1?.hasApproveButton) {
  results.ABORT = 'QA-W1 PENDING row without an approve button not found';
  await finish(CARD, results); process.exit(1);
}

// Click the QA-W1 row's own approve button (not another row's).
await page.evaluate(() => {
  const rows = [...document.querySelectorAll('.adv-grid-row, table tbody tr, [role="row"]')];
  const row = rows.find((tr) => tr.innerText.includes('QA-W1') && [...tr.querySelectorAll('button')].some((b) => b.textContent?.includes('Phê duyệt tạm ứng')));
  if (!row) throw new Error('QA-W1 approvable row disappeared');
  const btn = [...row.querySelectorAll('button')].find((b) => b.textContent?.includes('Phê duyệt tạm ứng'));
  btn.scrollIntoView({ block: 'center' });
  btn.click();
});
log('CLICK Phê duyệt tạm ứng');
await new Promise((r) => setTimeout(r, 3500));
await shot(page, `${CARD}_02-after-approve.png`);
results.rowAfterApprove = await assertEval(page, 'QA-W1 row after approve', () => {
  const rows = [...document.querySelectorAll('.adv-grid-row, table tbody tr, [role="row"]')];
  const row = rows.find((tr) => tr.innerText.includes('QA-W1'));
  return row ? { found: true, text: row.innerText.replace(/\n+/g, ' | ').slice(0, 160) } : { found: false };
});
results.approveError = await assertEval(page, 'approve error banner', () =>
  document.body.innerText.match(/Không phê duyệt được[^\n]*|Chưa có tài khoản quỹ[^\n]*/)?.[0] ?? null);

// ── 3. API proof: request RECORDED + funding ──
const reqAfter = await api({ user: 'hoapt', path: '/api/advance-requests?limit=200' });
const reqRow = (reqAfter.json?.items ?? []).find((row) => row.id === requestId);
results.requestAfterApprove = reqRow
  ? { id: reqRow.id, status: reqRow.status, approvedBy: reqRow.approvedBy ?? null, approvedAt: reqRow.approvedAt ?? null, version: reqRow.version }
  : `row ${requestId} not in admin list`;
results.persistedApprove = reqRow?.status === 'RECORDED' && reqRow?.approvedAt != null;

// ── 4. OPS creates the hoàn ứng phiếu linking that request ──
// Balance law (assertSettlementBalanced): tạm ứng − chi phí(thực) − hoàn lại = 0
// with chi phí counted from REAL trip-expense rows — a negative refund needs
// expenses exceeding the advance, which staging has no eligible fixtures for
// (recorded as a coverage limit). Balanced zero-expense phiếu: refund +2,000,000.
const phieu = await api({
  user: 'hoangnh', method: 'POST', path: '/api/forwarder/me/advance-settlements',
  body: { advanceRequestIds: [requestId], refundAmount: 2000000, note: `${STAMP} phiếu hoàn ứng fixture` },
});
results.createdPhieu = phieu.json ?? { status: phieu.status };
const phieuId = phieu.json?.id;
if (!phieuId) { results.ABORT = `phieu create failed: ${phieu.status} ${JSON.stringify(phieu.json)?.slice(0, 200)}`; await finish(CARD, results); process.exit(1); }
log(`PHIEU id=${phieuId} code=${phieu.json?.code} status=${phieu.json?.status}`);

// ── 5. Kế toán's record block on the phiếu ──
await goto(page, `/settlements/${phieuId}`, { wait: 4500 });
await shot(page, `${CARD}_03-phieu.png`);
results.phiếuPageState = await assertEval(page, 'phiếu page state', () => {
  const text = document.body.innerText;
  const tick = [...document.querySelectorAll('label')].find((l) => l.textContent?.includes('Xác nhận hoàn ứng'));
  const btn = [...document.querySelectorAll('button')].find((b) => b.textContent?.includes('Ghi nhận phiếu'));
  const refundLabel = [...document.querySelectorAll('label')].find((l) => l.textContent?.includes('Tiền hoàn lại'));
  let refundInput = null;
  let node = refundLabel;
  for (let hop = 0; hop < 4 && node && !refundInput; hop++) {
    refundInput = node.querySelector?.('input[type="number"]');
    node = node.parentElement;
  }
  return {
    phiếuStatus: text.match(/Đã ghi nhận|Nháp|Đã đảo ghi sổ|RECORDED|DRAFT/)?.[0] ?? null,
    tickPresent: !!tick,
    buttonPresent: !!btn,
    refundInputPresent: !!refundInput,
    refundInputMinAttr: refundInput?.getAttribute('min'),
    note: text.includes('QA-W1') ? 'QA-W1 phiếu visible' : null,
  };
});
results.recordBlockFinding = !results.phiếuPageState?.tickPresent
  ? 'FINDING F-W1-1: the tick/Ghi nhận record block is DRAFT-gated (canEditExpenses = canManageSettlements && status DRAFT, SettlementPrintPage.tsx) but advance settlements are born RECORDED (advance-settlement.service.ts createAdvanceSettlement) and no backend writer produces a DRAFT advance settlement — the FB-100 tick gate is unit-pinned (SettlementPrintPage.test.tsx FB-100 case sets status DRAFT) yet unreachable in the live flow; zero DRAFT phiếu exist on staging.'
  : null;
if (results.phiếuPageState?.tickPresent) {
  // (reachable path — drive the gate, signed input, and record)
  await page.evaluate(() => {
    const tick = [...document.querySelectorAll('label')].find((l) => l.textContent?.includes('Xác nhận hoàn ứng'));
    tick?.querySelector('input[type="checkbox"]')?.click();
  });
  await new Promise((r) => setTimeout(r, 700));
  results.recordGateAfterTick = await assertEval(page, 'gate after tick', () => {
    const btn = [...document.querySelectorAll('button')].find((b) => b.textContent?.includes('Ghi nhận phiếu'));
    return { buttonDisabled: btn?.disabled ?? null };
  });
  await shot(page, `${CARD}_05-ticked.png`);
  await clickButtonByText(page, 'Ghi nhận phiếu');
  await new Promise((r) => setTimeout(r, 3500));
  await shot(page, `${CARD}_06-after-record.png`);
} else {
  log('RECORD BLOCK NOT REACHABLE (DRAFT-gated, zero DRAFT phiếu) — finding F-W1-1 recorded');
}

// ── 7. Report surface: signed remainder + thu tiền ứng note ──
await goto(page, '/accounting/hoan-ung', { wait: 9000 });
await shot(page, `${CARD}_07-report.png`);
results.report = await assertEval(page, 'hoàn ứng report surface', () => {
  const text = document.body.innerText;
  return {
    signedColumn: text.includes('Còn phải hoàn ứng (có dấu)'),
    thuTienUngNote: text.includes('Đề nghị thu tiền ứng'),
  };
});

// ── 8. Sanctioned undo: reverse the phiếu (ACCOUNTANT) ──
if (phieuId) {
  const phieuAfter = await api({ user: 'hoapt', path: `/api/advance-settlements/${phieuId}` });
  results.phieuAfterRecord = phieuAfter.json
    ? { id: phieuAfter.json.id, status: phieuAfter.json.status, refundAmount: phieuAfter.json.refundAmount, checkedBy: phieuAfter.json.checkedBy ?? null, version: phieuAfter.json.version }
    : { status: phieuAfter.status };
  results.persistedBalancedRefund = Number(phieuAfter.json?.refundAmount) === 2000000;
  const reversal = await api({
    user: 'hoapt', method: 'POST', path: `/api/advance-settlements/${phieuId}/reversal`,
    body: { expectedVersion: phieuAfter.json?.version ?? 1, reason: `${STAMP} QA reversal` },
  });
  results.reversal = { status: reversal.status, reversedStatus: reversal.json?.status ?? null };
}

// Ledger of fixtures for the registry-purge phase.
results.fixtures = {
  advanceRequestId: requestId,
  advanceSettlementId: phieuId,
  note: 'ledger note "Phê duyệt tạm ứng: QA-W1-*" + treasury movement link the funding pair',
};
await finish(CARD, results);
