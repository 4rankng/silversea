// Card 191026160000 — rung-3 AFTER drive over the dev-port contract stack
// (:7175/:3002; QA_BASE/QA_API override).
// Covers: §2a bounded board + working select-all; §2c selected-row accent +
// tick; §2d per-date ticks in the Chọn Debit dialog (untick shrinks the đợt);
// §2e export refusal surfaces verbatim (mixed-customer selection) and the
// selection survives a real chốt đợt; §3b DUYỆT PHIẾU HOÀN ỨNG (settlement
// PT-2610-0001 seeded via the real service path); §3c Chi phí Ops duyệt axis.
import { login, launch, makeLogger, tokenPage, sleep, BASE, API } from './2026-10-19_chiphi2b-lib.mjs';
import { writeFileSync, mkdirSync } from 'node:fs';

const log = makeLogger('2026-10-19_chiphi2-b_after');

const api = async (token, path, init = {}) => {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...(init.headers ?? {}) },
  });
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
};

const kt = await login('ketoan');
log('login ketoan OK');
const browser = await launch();
const domFacts = {};
try {
  // ════ §2a/§2c — bounded board + select-all + highlight ════
  const page = await tokenPage(browser, kt, `${BASE}/accounting/chot-debit`);
  await sleep(5000);
  const board = await page.evaluate(() => ({
    selectAllLabel: [...document.querySelectorAll('button')].map((b) => b.textContent.trim()).find((t) => t.includes('Chọn tất cả')) ?? null,
    rows: document.querySelectorAll('table.debit-board tbody tr').length,
    dateInputs: (document.getElementById('debit-board-date-range')?.value ?? '') + '→' + (document.getElementById('debit-board-date-range-to')?.value ?? ''),
  }));
  log(`§2a board: ${JSON.stringify(board)}`);
  domFacts.board = board;

  // select-all completes quickly now (§2a)
  const t0 = Date.now();
  await page.evaluate(() => {
    [...document.querySelectorAll('button')].find((b) => b.textContent.includes('Chọn tất cả')).click();
  });
  await sleep(1500);
  const afterSelectAll = await page.evaluate(() => ({
    selected: document.querySelectorAll('tr[data-selected]').length,
    line: [...document.querySelectorAll('.debit-note')].map((e) => e.textContent.trim()).find((t) => t.includes('Đã chọn')) ?? null,
  }));
  log(`§2a select-all (${Date.now() - t0}ms): ${JSON.stringify(afterSelectAll)}`);
  domFacts.selectAll = afterSelectAll;

  // §2c — selected row accent + tick
  const highlight = await page.evaluate(() => {
    const tr = document.querySelector('tr[data-selected]');
    if (!tr) return null;
    const td = tr.querySelector('td');
    const tick = tr.querySelector('.debit-row-tick');
    return {
      bg: getComputedStyle(td).backgroundColor,
      tickText: tick?.textContent ?? null,
      unselectedTick: document.querySelector('tr:not([data-selected]) .debit-row-tick')?.textContent ?? null,
    };
  });
  log(`§2c highlight: ${JSON.stringify(highlight)}`);
  domFacts.highlight = highlight;
  await log.shot(page, '01-board-selectall-highlight.png');

  // clear the select-all set, then §2d — one-customer selection → dialog date
  // ticks. B77AP2: 5/5 October rows have tongThu and none PENDING — chốt-able.
  await page.evaluate(() => {
    [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Bỏ chọn')?.click();
  });
  await sleep(700);
  const pick = 'B77AP2';
  log(`§2d narrowing to customer: ${pick}`);
  if (pick) {
    const search = await page.$('input[placeholder*="Mã lô"]');
    await search.click({ clickCount: 3 });
    await search.type(pick, { delay: 10 });
    await sleep(2000);
  }
  const narrowCount = await page.evaluate(() => document.querySelectorAll('table.debit-board tbody tr').length);
  log(`§2d narrowed rows: ${narrowCount}`);
  await page.evaluate(() => {
    [...document.querySelectorAll('button')].find((b) => b.textContent.includes('Chọn tất cả')).click();
  });
  await sleep(1200);
  const dialogOpen = await page.evaluate(() => {
    const hit = [...document.querySelectorAll('button')].find((b) => b.textContent.includes('Chọn Debit (') && !b.disabled);
    if (!hit) return null;
    hit.click();
    return hit.textContent.trim();
  });
  log(`§2d open dialog via: ${dialogOpen}`);
  await sleep(1000);
  const dialogState = await page.evaluate(() => {
    const dialog = document.querySelector('[role="dialog"]');
    if (!dialog) return null;
    return {
      header: dialog.querySelector('p')?.textContent.trim(),
      dateTicks: [...dialog.querySelectorAll('input[type="checkbox"]')].map((c) => c.closest('label')?.textContent.trim()),
    };
  });
  log(`§2d dialog: ${JSON.stringify(dialogState)}`);
  domFacts.dialog = dialogState;
  await log.shot(page, '02-dialog-date-ticks.png');

  if (dialogState && dialogState.dateTicks.length > 1) {
    // untick the FIRST date group → the đợt count shrinks
    const shrunk = await page.evaluate(() => {
      const dialog = document.querySelector('[role="dialog"]');
      const boxes = [...dialog.querySelectorAll('input[type="checkbox"]')];
      const first = boxes.find((b) => b.closest('label')?.textContent.includes('lô'));
      if (!first) return null;
      first.click();
      return first.closest('label')?.textContent.trim();
    });
    await sleep(600);
    const afterUntick = await page.evaluate(() => document.querySelector('[role="dialog"] p')?.textContent.trim());
    log(`§2d untick ${JSON.stringify(shrunk)} → ${afterUntick}`);
    domFacts.dialogAfterUntick = afterUntick;
    await log.shot(page, '03-dialog-after-untick.png');
    // re-tick to restore all-dates for the real chốt below
    await page.evaluate(() => {
      const dialog = document.querySelector('[role="dialog"]');
      [...dialog.querySelectorAll('input[type="checkbox"]')].find((b) => b.closest('label')?.textContent.includes('lô'))?.click();
    });
    await sleep(500);
  }

  // §2e — chốt đợt for real, then the selection must survive → Xuất attempt
  const chotOk = await page.evaluate(() => {
    const dialog = document.querySelector('[role="dialog"]');
    if (!dialog) return null;
    const thu = [...dialog.querySelectorAll('input[type="radio"]')].find((r) => r.closest('label')?.textContent.includes('Phải thu (từ khách hàng)'));
    if (!thu) return 'no-thu-radio';
    thu.click();
    return 'thu-ticked';
  });
  await sleep(400);
  const vatOk = await page.evaluate(() => {
    const dialog = document.querySelector('[role="dialog"]');
    const vat = [...dialog.querySelectorAll('input[type="radio"]')].find((r) => r.closest('label')?.textContent.trim() === '0%');
    if (!vat) return null;
    vat.click();
    return '0%-ticked';
  });
  log(`§2e direction=${chotOk} vat=${vatOk}`);
  await log.shot(page, '04-dialog-ready-to-chot.png');
  const respRound = page.waitForResponse((r) => r.url().includes('settlement-rounds'), { timeout: 20000 }).catch(() => null);
  const chotClicked = await page.evaluate(() => {
    const dialog = document.querySelector('[role="dialog"]');
    if (!dialog) return null;
    const btn = [...dialog.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Chốt đợt' && !b.disabled);
    if (!btn) return 'chot-disabled';
    btn.click();
    return 'chot-clicked';
  });
  const roundResp = await respRound;
  await sleep(2500);
  log(`§2e chốt: ${chotClicked} → API ${roundResp ? roundResp.status() : 'no-response'}`);
  domFacts.chot = { clicked: chotClicked, apiStatus: roundResp?.status() ?? null };
  const afterChot = await page.evaluate(() => ({
    stillSelected: document.querySelectorAll('tr[data-selected]').length,
    exportEnabled: ![...document.querySelectorAll('button')].find((b) => b.textContent.includes('Xuất Debit Note'))?.disabled,
    banner: [...document.querySelectorAll('.debit-note')].map((e) => e.textContent.trim()).join(' | ').slice(0, 200),
  }));
  log(`§2e after chốt: ${JSON.stringify(afterChot)}`);
  domFacts.afterChot = afterChot;
  await log.shot(page, '05-after-chot-selection-kept.png');

  // §2e — Xuất Debit Note over the KEPT selection (mixed/unlocked lots here
  // must surface the server's refusal verbatim, no file).
  const respNote = page.waitForResponse((r) => r.url().includes('debit-note'), { timeout: 20000 }).catch(() => null);
  await page.evaluate(() => {
    [...document.querySelectorAll('button')].find((b) => b.textContent.includes('Xuất Debit Note') && !b.disabled)?.click();
  });
  const noteResp = await respNote;
  await sleep(1500);
  const exportBanner = await page.evaluate(() => [...document.querySelectorAll('[role="alert"], [role="status"]')].map((e) => e.textContent.trim()).filter(Boolean)[0] ?? null);
  log(`§2e export API: ${noteResp ? `${noteResp.status()}` : 'none'} banner=${JSON.stringify(exportBanner)}`);
  domFacts.export = { apiStatus: noteResp?.status() ?? null, banner: exportBanner };
  await log.shot(page, '06-export-refusal-surfaced.png');
  await page.close();

  // ════ §3b — DUYỆT PHIẾU HOÀN ỨNG on /advances?view=settlements ════
  const before = await api(kt, '/advance-settlements?limit=50');
  const target = (before.body?.items ?? []).find((x) => x.code === 'PT-2610-0001');
  log(`§3b target settlement: ${JSON.stringify({ id: target?.id, checkedBy: target?.checkedBy, version: target?.version })}`);

  const page2 = await tokenPage(browser, kt, `${BASE}/advances?view=settlements`);
  await sleep(3000);
  const duyệtState = await page2.evaluate(() => {
    const text = document.body.innerText;
    const btn = [...document.querySelectorAll('button')].find((b) => b.textContent.includes('DUYỆT PHIẾU HOÀN ỨNG') && !b.disabled);
    return { hasCode: text.includes('PT-2610-0001'), hasButton: Boolean(btn), ktLine: text.includes('Đã duyệt (KT)'), btnDisabled: btn?.disabled ?? null };
  });
  log(`§3b tab state: ${JSON.stringify(duyệtState)}`);
  await log.shot(page2, '07-settlement-duyet-button.png');
  const respCheck = page2.waitForResponse((r) => r.url().includes('/check'), { timeout: 20000 }).catch(() => null);
  await page2.evaluate(() => {
    [...document.querySelectorAll('button')].find((b) => b.textContent.includes('DUYỆT PHIẾU HOÀN ỨNG'))?.click();
  });
  const checkResp = await respCheck;
  await sleep(2500);
  const afterDuyet = await page2.evaluate(() => {
    const text = document.body.innerText;
    return { ktLine: text.includes('Đã duyệt (KT)'), buttonGone: ![...document.querySelectorAll('button')].some((b) => b.textContent.includes('DUYỆT PHIẾU HOÀN ỨNG') && !b.disabled) };
  });
  // First run (fresh phiếu): API 200 + line appears. Re-runs (already
  // duyệt-ed): no click possible — the persisted state itself is the fact.
  log(`§3b duyệt API ${checkResp ? checkResp.status() : 'not-clicked(already-duyệt)'} → ${JSON.stringify(afterDuyet)}`);
  domFacts.duyet = { apiStatus: checkResp?.status() ?? 'not-clicked(already-duyệt)', ...afterDuyet };
  await log.shot(page2, '08-settlement-after-duyet.png');

  // DB side-effect proof
  const after = await api(kt, '/advance-settlements?limit=50');
  const targetAfter = (after.body?.items ?? []).find((x) => x.code === 'PT-2610-0001');
  log(`§3b DB state: checkedBy=${targetAfter?.checkedBy} checkedAt=${targetAfter?.checkedAt} checkerName=${targetAfter?.checkerName} version=${targetAfter?.version}`);
  domFacts.duyetDb = { checkedBy: targetAfter?.checkedBy, checkedAt: targetAfter?.checkedAt, checkerName: targetAfter?.checkerName };
  await page2.close();

  // ════ §3c — Chi phí Ops duyệt axis ════
  const page3 = await tokenPage(browser, kt, `${BASE}/advances?view=ops-expenses`);
  await sleep(3000);
  const opsState = await page3.evaluate(() => {
    const text = document.body.innerText;
    return {
      hasColumn: text.includes('Duyệt KT'),
      confirmedRow: text.includes('Đã duyệt 19/10/2026'),
      duyetButtons: [...document.querySelectorAll('button')].filter((b) => b.textContent.trim() === 'Duyệt' && !b.disabled).length,
    };
  });
  log(`§3c tab state: ${JSON.stringify(opsState)}`);
  domFacts.opsTab = opsState;
  await log.shot(page3, '09-ops-expenses-duyet-axis.png');

  // Click the first Duyệt (QA expense 29148 — invoice-required → REAL refusal
  // expected, surfaces through the toast).
  const respConfirm = page3.waitForResponse((r) => r.url().includes('/expense-accounting/confirm'), { timeout: 20000 }).catch(() => null);
  await page3.evaluate(() => {
    [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Duyệt' && !b.disabled)?.click();
  });
  const confirmResp = await respConfirm;
  await sleep(1500);
  const toastText = await page3.evaluate(() => [...document.querySelectorAll('[role="status"], .toast, [role="alert"]')].map((e) => e.textContent.trim()).filter(Boolean).slice(0, 2).join(' | '));
  log(`§3c confirm API ${confirmResp ? confirmResp.status() : 'none'} toast=${JSON.stringify(toastText)}`);
  domFacts.opsConfirm = { apiStatus: confirmResp?.status() ?? null, toast: toastText };
  await log.shot(page3, '10-ops-confirm-refusal.png');
  await page3.close();

  mkdirSync('qa/2026-10-19_chiphi2-b_after', { recursive: true });
  writeFileSync('qa/2026-10-19_chiphi2-b_after/dom-facts.json', JSON.stringify(domFacts, null, 2));
  log('AFTER DRIVE DONE');
} finally {
  await browser.close();
}
