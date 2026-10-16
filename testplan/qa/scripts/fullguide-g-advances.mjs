// Full-guide Driver G — B.6 (Tạm ứng & hoàn ứng, role hoapt + ops hoangnh):
//   (a) "Phê duyệt tạm ứng" button on the Yêu cầu tạm ứng tab (PENDING rows).
//   (b) "Xác nhận hoàn ứng" confirmation tick on the Phiếu hoàn ứng — per the
//       FB-100 F-W1-1 ruling the live submit surface must carry the mandatory
//       tick; current build is expected FAIL (tick shipped DRAFT-only, dead).
//   (c) "Báo cáo hoàn ứng" formula ĐNTT − ĐÃ ỨNG with NEGATIVE remaining +
//       "Đề nghị thu tiền ứng" warning (operator advanced more than costs).
// Fixtures: one QA advance request (200.000₫) by hoangnh; cleanup nets the
// balance back via a full-refund settlement (rows stay QA-registered).
import {
  BASE, PIN, sleep, uuid, makeLogger, healthGate, login, api, psql, boot, tap, setInput, waitText, bodyText,
} from './fullguide-lib.mjs';
import { writeFileSync } from 'node:fs';

const logger = makeLogger('g-advances');
const { step } = logger;
const results = {};
const record = (id, verdict, note) => { results[id] = { verdict, note }; step('VERDICT', { id, verdict, note }); };

await healthGate(logger);
const ops = await login('hoangnh');
const acct = await login('hoapt');
step('logins', { hoangnh: !!ops.token, hoapt: !!acct.token });
if (!ops.token || !acct.token) throw new Error('logins failed');

const REASON = `QA fullguide B6 tạm ứng ${uuid().slice(0, 6)}`;

// ── fixture: hoangnh requests a 200.000₫ advance (PENDING, KP-148 at approve) ─
const created = await api(ops.token, 'POST', '/ops/wallet/advance-requests', { amount: 200000, reason: REASON });
const advanceId = created.json?.id ?? null;
step('g-advance-create', { status: created.status, id: advanceId, statusField: created.json?.status });
if (created.status !== 201 || !advanceId) throw new Error('advance request not created: ' + created.text?.slice(0, 200));

// ══ (a) approve button on /advances?view=requests — UI drive as hoapt ════════
{
  const { browser, page } = await boot({ token: acct.token });
  try {
    await page.goto(`${BASE}/advances?view=requests`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await sleep(4000);
    const ready = await waitText(page, 'Yêu cầu tạm ứng', 15000);
    await sleep(2500);
    // find the QA row + its approve button
    const rowState = await page.evaluate((reason) => {
      const rows = [...document.querySelectorAll('tr, [class*="card"], [class*="row"]')].filter(el => (el.innerText || '').includes(reason));
      const scope = rows[0] ?? document;
      const btn = [...scope.querySelectorAll('button')].find(b => /phê duyệt tạm ứng/i.test(b.textContent || ''));
      return {
        rowFound: rows.length > 0,
        approveBtn: Boolean(btn),
        btnDisabled: btn?.disabled ?? null,
        rowText: rows[0] ? rows[0].innerText.replace(/\s+/g, ' ').slice(0, 220) : null,
      };
    }, REASON);
    step('g-approve-pre', { ready, ...rowState });
    await page.screenshot({ path: 'qa/2026-10-16_fullguide_b6_requests-tab.png', fullPage: true });

    let clicked = false;
    if (rowState.approveBtn && !rowState.btnDisabled) {
      clicked = await page.evaluate((reason) => {
        const rows = [...document.querySelectorAll('tr, [class*="card"], [class*="row"]')].filter(el => (el.innerText || '').includes(reason));
        const scope = rows[0] ?? document;
        const btn = [...scope.querySelectorAll('button')].find(b => /phê duyệt tạm ứng/i.test(b.textContent || ''));
        if (!btn || btn.disabled) return false;
        btn.click();
        return true;
      }, REASON);
    }
    await sleep(3500);
    const afterText = await bodyText(page);
    const errBanner = /lỗi|thất bại|error/i.test(afterText) && /duyệt/.test(afterText);
    await page.screenshot({ path: 'qa/2026-10-16_fullguide_b6_after-approve.png', fullPage: true });
    // DB + API side-effect
    const dbRow = psql(`SELECT id, status, approved_by, approved_at IS NOT NULL AS approved, version FROM advance_requests WHERE id=${advanceId}`);
    step('g-approve-post', { clicked, errBanner, dbRow });
    const approved = /RECORDED/.test(dbRow);
    record('B.6a', rowState.approveBtn && clicked && approved ? 'PASS' : 'FAIL',
      `"Phê duyệt tạm ứng" button=${rowState.approveBtn}, clicked=${clicked}, DB=[${dbRow}]`);
  } catch (e) {
    step('g-a-error', { error: String(e.message ?? e) });
    await page.screenshot({ path: 'qa/2026-10-16_fullguide_g_a_error.png', fullPage: true }).catch(() => {});
    record('B.6a', 'FAIL', String(e.message ?? e));
  } finally { await browser.close(); }
}

// ══ (c) negative remaining on Báo cáo hoàn ứng — UI as hoapt ════════════════
{
  const { browser, page } = await boot({ token: acct.token });
  try {
    await page.goto(`${BASE}/accounting/hoan-ung`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await sleep(4500);
    const ready = await waitText(page, 'Còn phải hoàn ứng', 20000);
    await sleep(3000); // W1 lesson: table needs a beat to load
    const report = await page.evaluate(() => {
      const text = (document.body.innerText || '').replace(/\s+/g, ' ');
      const rows = [...document.querySelectorAll('tr')].filter(r => /Hoàng|hoangnh/i.test(r.innerText || ''));
      return {
        hasSignedCol: /Còn phải hoàn ứng \(có dấu\)/.test(text),
        hoangRows: rows.map(r => (r.innerText || '').replace(/\s+/g, ' ').slice(0, 300)),
        collectWarn: /Đề nghị thu tiền ứng/.test(text),
        negativeShown: /−200\.000|-200\.000/.test(text),
      };
    });
    await page.screenshot({ path: 'qa/2026-10-16_fullguide_b6_report.png', fullPage: true });
    const apiReport = await api(acct.token, 'GET', '/expense-accounting/reconciliation-report');
    const hoangRow = (apiReport.json?.rows ?? []).find(r => /hoangnh|Hoàng/i.test(r.staffName ?? ''));
    step('g-report', { ready, ...report, apiRow: hoangRow });
    const apiNegative = hoangRow != null && Number(hoangRow.remainingSigned) < 0 && hoangRow.needsCollection === true;
    record('B.6c', (report.hasSignedCol && report.negativeShown && report.collectWarn) || apiNegative ? 'PASS' : 'FAIL',
      `Báo cáo hoàn ứng: signedCol=${report.hasSignedCol}, −200.000 shown=${report.negativeShown}, warn=${report.collectWarn}, API row=${JSON.stringify(hoangRow)}`);
  } catch (e) {
    step('g-c-error', { error: String(e.message ?? e) });
    await page.screenshot({ path: 'qa/2026-10-16_fullguide_g_c_error.png', fullPage: true }).catch(() => {});
    record('B.6c', 'FAIL', String(e.message ?? e));
  } finally { await browser.close(); }
}

// ══ (b) confirmation tick on Phiếu hoàn ứng — expected FAIL (F-W1-1) ════════
{
  const { browser, page } = await boot({ token: ops.token });
  try {
    // live submit surface (Ops files the phiếu)
    await page.goto(`${BASE}/my-settlements/new`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await sleep(4500);
    const createForm = await page.evaluate(() => {
      const text = (document.body.innerText || '').replace(/\s+/g, ' ');
      return {
        pageLoaded: text.length > 200,
        hasTick: /xác nhận hoàn ứng/i.test(text),
        submitBtn: [...document.querySelectorAll('button')].find(b => /ghi nhận phiếu/i.test(b.textContent || ''))?.textContent?.trim() ?? null,
        snippet: text.slice(-600),
      };
    });
    await page.screenshot({ path: 'qa/2026-10-16_fullguide_b6_live-submit.png', fullPage: true });
    step('g-b-live-submit', createForm);
    record('B.6b', createForm.hasTick ? 'PASS' : 'FAIL',
      `live submit (/my-settlements/new): tick "Xác nhận hoàn ứng" present=${createForm.hasTick}, submit="${createForm.submitBtn}" — F-W1-1: tick shipped DRAFT-only (dead block), unreachable in live flow`);
  } catch (e) {
    step('g-b-error', { error: String(e.message ?? e) });
    await page.screenshot({ path: 'qa/2026-10-16_fullguide_g_b_error.png', fullPage: true }).catch(() => {});
    record('B.6b', 'FAIL', String(e.message ?? e));
  } finally { await browser.close(); }
}

// ══ cleanup: full-refund settlement nets hoangnh's balance to 0 ═════════════
try {
  const settlement = await api(ops.token, 'POST', '/forwarder/me/advance-settlements', {
    advanceRequestIds: [advanceId],
    refundAmount: 200000,
    note: `QA fullguide B6 — hoàn đủ tạm ứng ${REASON}`,
  });
  step('g-cleanup-settlement', { status: settlement.status, id: settlement.json?.id, code: settlement.json?.code, body: settlement.text?.slice(0, 160) });
  const fundBook = await api(ops.token, 'GET', '/ops/wallet/fund-book');
  step('g-cleanup-balance', { status: fundBook.status, outstanding: fundBook.json?.summary?.outstandingAdvanceBalance ?? fundBook.json?.outstandingAdvanceBalance ?? fundBook.text?.slice(0, 200) });
} catch (e) {
  step('g-cleanup-error', { error: String(e.message ?? e) });
}

writeFileSync('qa/2026-10-16_fullguide_g-results.json', JSON.stringify({ pin: PIN, date: new Date().toISOString(), results, advanceId, reason: REASON }, null, 2));
step('SUMMARY', results);
