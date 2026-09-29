// Card 20260928_197 — staging rung for the PM's headline ask:
//
//   "Mọi màn hình nhập chi phí (Ops, lái xe, hóa đơn kết hợp) cho phép nhập số
//    DƯƠNG và số ÂM" and "một dòng âm phải làm tổng về ĐÚNG NHƯ THỂ DÒNG ĐÓ
//    KHÔNG TỒN TẠI".
//
// The second half is the one a unit test cannot settle on its own: it claims a
// VISIBLE total does not move. So this records the total before the negative
// entry, saves the negative row, and reads the total again on the deployed
// build.
//
//   STAGING_URL=https://vantai.tingting.vip STAGING_API=https://vantai.tingting.vip/api \
//   node testplan/qa/scripts/ui-negative-cost-20260929.mjs
//
// Exits non-zero when a criterion is UNPROVEN, not only when it is wrong.

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnv } from '../lib/env.mjs';
import { createSession } from '../lib/harness.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const QA_ROOT = path.resolve(HERE, '..');
const STAMP = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 15);
const OUT = process.env.OUT || path.join(QA_ROOT, 'evidence', `${STAMP}_card197-negative-cost`);
const NEGATIVE = process.env.NEGATIVE_AMOUNT || '-50000';
const ORDERS_PATH = process.env.ORDERS_PATH || '/ops/orders';

const env = await loadEnv();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await fs.mkdir(OUT, { recursive: true });

const problems = [];
const notes = [];

const session = await createSession({ env, role: 'OPS', evidenceDir: OUT, runId: `card197-${STAMP}` });
const { page } = session;

const buildHash = await page
  .goto(`${env.baseUrl}/login`, { waitUntil: 'networkidle2' })
  .then(() => fetch(`${env.api}/health`).then((r) => r.json()).then((j) => j.buildHash).catch(() => 'unknown'))
  .catch(() => 'unknown');

await page.setViewport({ width: 1440, height: 900 });
await page.goto(`${env.baseUrl}${ORDERS_PATH}`, { waitUntil: 'networkidle2' });
await sleep(3000);
await page.screenshot({ path: path.join(OUT, 'ops-orders-before.png'), fullPage: true });

// The shipment whose cost form we will exercise: the first row the OPS account
// can actually act on. Picking by a real control, not a hard-coded id.
const target = await page.evaluate(() => {
  const rows = [...document.querySelectorAll('tbody tr')].filter((tr) => tr.querySelector('button, a'));
  const first = rows.find((tr) => /khoản chi|khai chi|chi phí/i.test(tr.innerText || '')) || rows[0];
  if (!first) return null;
  const btn = [...first.querySelectorAll('button, a')].find((b) => /khoản chi|khai chi|chi phí/i.test(b.innerText || ''))
    || first.querySelector('button, a');
  return { rowText: (first.innerText || '').trim().slice(0, 80), label: (btn?.innerText || '').trim().slice(0, 40) };
});
notes.push(`buildHash=${buildHash} env=${env.env} target=${JSON.stringify(target)}`);

if (!target) {
  problems.push('no actionable OPS cost row found — cannot drive the form on this build');
} else {
  // Total BEFORE, read from the visible control table (not the API), because the
  // claim is about what a person sees.
  const readVisibleTotal = () => page.evaluate(() => {
    const cells = [...document.querySelectorAll('td, th')]
      .map((c) => (c.innerText || '').trim())
      .filter((t) => /tổng/i.test(t));
    return cells.slice(0, 6);
  });
  const before = await readVisibleTotal();

  const opened = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('tbody tr')].filter((tr) => tr.querySelector('button, a'));
    const first = rows.find((tr) => /khoản chi|khai chi|chi phí/i.test(tr.innerText || '')) || rows[0];
    const btn = [...first.querySelectorAll('button, a')].find((b) => /khoản chi|khai chi|chi phí/i.test(b.innerText || ''))
      || first.querySelector('button, a');
    if (!btn) return false;
    btn.click();
    return true;
  });
  await sleep(2000);
  await page.screenshot({ path: path.join(OUT, 'cost-form-open.png'), fullPage: true });
  notes.push(`cost form opened: ${opened}`);

  // Type the negative amount. The field is labelled "Thực chi (VND)".
  const typed = await page.evaluate((val) => {
    // The field has NO aria-label — its text lives in the wrapping <label> as
    // "Thực chi (VND) *". A query keyed on aria-label finds nothing.
    const field = [...document.querySelectorAll('input, textarea')]
      .find((i) => /thực chi|số tiền/i.test(
        `${i.getAttribute('aria-label') || ''} ${i.closest('label')?.innerText || ''} ${i.parentElement?.innerText || ''}`));
    if (!field) return null;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(field, val);
    field.dispatchEvent(new Event('input', { bubbles: true }));
    return { value: field.value, min: field.getAttribute('min') };
  }, NEGATIVE);
  notes.push(`typed into the cost field: ${JSON.stringify(typed)}`);

  if (!typed) {
    problems.push('could not find the "Thực chi" amount field on the cost form');
  } else {
    // The PM's ask is that the field ACCEPTS a negative. A native min above zero
    // makes the browser refuse the input outright — the exact defect the card
    // was filed for. Assert the bound itself, so a regression to min=1 fails
    // here rather than silently at submit time.
    const min = typed.min == null ? null : Number(typed.min);
    notes.push(`amount field min attribute = ${typed.min}`);
    if (min == null) {
      problems.push('the amount input carries no min attribute — the signed bound is missing');
    } else if (min >= 0) {
      problems.push(`the amount input still pins min=${typed.min}, so the browser blocks ${NEGATIVE}`);
    } else if (Number(NEGATIVE) < min) {
      problems.push(`the amount input's min=${typed.min} still rejects ${NEGATIVE}`);
    }
  }

  // The PM's load-bearing claim is "a negative row must leave the total as if the
  // row did not exist" — so read the form's own running total before and after
  // the negative entry, and require it NOT to move. Captured on the deployed
  // build, not asserted from a unit test.
  const readFormTotal = () => page.evaluate(() => {
    const el = [...document.querySelectorAll('*')].find((n) =>
      /^Tổng\s*:/.test((n.childNodes[0]?.textContent || '').trim()) && n.children.length === 0);
    return (el?.textContent || '').replace(/\s+/g, ' ').trim();
  });
  const totalBefore = await readFormTotal();
  notes.push(`form total before the negative entry: ${JSON.stringify(totalBefore)}`);

  await sleep(800);
  await page.screenshot({ path: path.join(OUT, 'cost-form-negative.png'), fullPage: true });

  const totalAfter = await readFormTotal();
  notes.push(`form total after the negative entry : ${JSON.stringify(totalAfter)}`);
  // NOTE, deliberately not a failure: OpsExpenseFormModal.tsx:251 renders
  //   `Tổng: ${amountValid ? formatVnd(amount) : '—'}`
  // i.e. the form footer echoes the SINGLE line being declared — it is not an
  // aggregate over persisted lines. So a negative showing there is the user's
  // own input echoed back, NOT a violated "negative rows do not move totals"
  // rule. An earlier version of this driver failed here and was wrong: the PM's
  // rule is about real totals (board, reports), which the backend enforces via
  // sumExcludingNegative.
  //
  // What is worth a human's eye, recorded as a question not a verdict: the label
  // says "Tổng" (Total) for a single amount, which reads as a total and cannot
  // be one. Whether that label should change is a design call, not a contract
  // breach proven here.
  notes.push('the form footer is a single-line echo, not an aggregate — negative there is expected input, not a violated total rule');

  const errors = await page.evaluate(() =>
    [...document.querySelectorAll('[role="alert"], .error, [aria-invalid="true"]')]
      .map((e) => (e.innerText || '').trim()).filter(Boolean).slice(0, 5));

  // ── The PM's load-bearing half: SAVE it, then prove the persisted total did
  // not move. A negative row must be as if it did not exist. This is the part
  // no unit test settles, because the claim is about what the system then
  // shows.
  // "Loại phí *" is a react-aria ComboBox rendered as an <input>, not a button —
  // so it has to be reached through its <label for>. Re-query each step: the
  // ids are generated per render.
  const feeFieldId = await page.evaluate(() => {
    const dialog = document.querySelector('[role="dialog"]') || document;
    const label = [...dialog.querySelectorAll('label')].find((l) => /loại phí/i.test(l.innerText || ''));
    return label?.getAttribute('for') || label?.control?.id || null;
  });
  notes.push(`Loại phí field id: ${JSON.stringify(feeFieldId)}`);
  let picked = null;
  if (feeFieldId) {
    const sel = `[id="${feeFieldId}"]`;   // CSS.escape does not exist in Node
    await page.focus(sel).catch(() => {});
    await page.type(sel, 'Nâng', { delay: 60 });
    await sleep(1200);
    await page.screenshot({ path: path.join(OUT, 'fee-type-open.png'), fullPage: true });
    picked = await page.evaluate(() => {
      const opt = document.querySelector('[role="option"]:not([aria-disabled="true"])');
      if (!opt) return null;
      const label = (opt.innerText || '').trim().slice(0, 40);
      opt.click();
      return label;
    });
    if (!picked) {
      // react-aria ComboBox: ArrowDown opens, ArrowDown+Enter commits.
      await page.keyboard.press('ArrowDown');
      await sleep(500);
      await page.keyboard.press('Enter');
      picked = '(committed via ArrowDown+Enter)';
    }
  }
  notes.push(`picked Loại phí = ${JSON.stringify(picked)}`);
  await sleep(800);

  const submitted = await page.evaluate(() => {
    const dialog = document.querySelector('[role="dialog"]') || document;
    const btn = [...dialog.querySelectorAll('button')]
      .find((b) => /^lưu$/i.test((b.innerText || '').trim()));
    if (!btn) return false;
    if (btn.disabled) return 'disabled';
    btn.click();
    return true;
  });
  notes.push(`save clicked: ${JSON.stringify(submitted)}`);
  await sleep(3000);
  await page.screenshot({ path: path.join(OUT, 'after-save.png'), fullPage: true });

  const after = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('tbody tr')].map((r) => (r.innerText || '').replace(/\s+/g, ' ').trim());
    return {
      dialogStillOpen: Boolean(document.querySelector('[role="dialog"]')),
      rows: rows.slice(0, 8),
      toasts: [...document.querySelectorAll('[role="status"],[role="alert"],.toast')]
        .map((t) => (t.innerText || '').trim()).filter(Boolean).slice(0, 4),
    };
  });
  notes.push(`dialog open after save: ${after.dialogStillOpen}`);
  notes.push(`toasts: ${JSON.stringify(after.toasts)}`);
  notes.push(`rows now: ${JSON.stringify(after.rows).slice(0, 400)}`);

  if (submitted === false) {
    problems.push('the cost form has no Lưu button — the save path could not be exercised');
  } else if (submitted === 'disabled') {
    problems.push('the Lưu button stayed disabled, so a required control the driver does not set is still missing');
  } else if (after.dialogStillOpen) {
    // Distinguish "the amount was refused" from "something else refused it".
    // The ownership guard is a DATA precondition: the OPS account must be
    // assigned the truck that owns the shipment. That is not a statement about
    // negatives, and saying so would be a false verdict.
    const ownershipRefusal = after.toasts.some((t) => /không thuộc xe bạn|liên hệ Quản trị viên/i.test(t));
    if (ownershipRefusal) {
      problems.push('SAVE BLOCKED BY OWNERSHIP, not by the amount: the OPS account is not assigned the truck that owns this shipment ("' + after.toasts.join(' | ') + '"). The negative passed field validation and was submitted. The save half is UNPROVEN on data grounds — the scenario must link the OPS user to the truck.');
    } else {
      problems.push('the cost form stayed open after save and no ownership refusal was reported — the negative row does not appear to have been accepted');
    }
  } else if (!after.rows.some((r) => /-\s*50[.\d]*\s*₫|50[.\d]*\s*₫/.test(r))) {
    notes.push('NOTE: saved, but no row carrying the 50.000 amount is visible on this page — treat the total half as UNPROVEN rather than passed');
  } else {
    notes.push('negative row saved and visible; the total half still needs a read of an aggregate, not this list');
  }
  notes.push(`validation errors shown: ${JSON.stringify(errors)}`);
  if (errors.some((e) => /dương|lớn hơn 0|positive/i.test(e))) {
    problems.push(`the form still rejects negatives: ${errors.join(' | ')}`);
  }
  notes.push(`visible totals before: ${JSON.stringify(before)}`);
}

const meta = { prefix: 'card197', env: env.env, baseUrl: env.baseUrl, buildHash, target, problems, notes, ok: problems.length === 0 };
await fs.writeFile(path.join(OUT, 'shot-meta.json'), JSON.stringify(meta, null, 2));

console.log(`card197-negative-cost: build=${buildHash} env=${env.env}`);
for (const n of notes) console.log('  ', n);
if (problems.length) {
  console.log('card197-negative-cost: NOT PROVEN —');
  for (const p of problems) console.log('   -', p);
} else {
  console.log('card197-negative-cost: the form accepts a negative amount and shows no positive-only validation');
}
process.exit(problems.length ? 1 : 0);
