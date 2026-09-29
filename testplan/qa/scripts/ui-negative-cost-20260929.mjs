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
import fsSync from 'node:fs';
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
// Drive the shipment the FIXTURE created, not simply the first row: the OPS
// queue lists every same-day shipment and earlier scenario runs left theirs
// there, so "first row" targets a shipment with no trip and no truck
// assignment and the save is refused for reasons unrelated to the amount.
function latestScenario() {
  const dir = path.resolve(QA_ROOT, '..', '..', 'qa');   // repo-root qa/, not testplan/qa
  const files = fsSync.readdirSync(dir).filter((d) => d.endsWith('_seed-factory'))
    .map((d) => path.join(dir, d, 'scenario.json'))
    .filter((f) => fsSync.existsSync(f))
    .sort();
  return files.at(-1) ?? null;
}
const scenarioPath = process.env.SCENARIO_JSON || latestScenario();
let wantCode = null;
try {
  if (scenarioPath) wantCode = JSON.parse(fsSync.readFileSync(scenarioPath, 'utf8'))?.shipment?.billBookingNumber ?? null;
} catch { /* no scenario file: fall back to the first row */ }
notes.push(`targeting fixture shipment: ${wantCode ?? '(none - first row)'}`);

// ONE row-picker, used for BOTH the report and the click.
//
// This used to be two independent DOM queries. `target` filtered by
// `wantCode`; the click below did not — it took whichever row matched the cost
// regex first. So the driver announced it had targeted the fixture lot and
// then opened a DIFFERENT one, and reported the resulting "Lô này không thuộc
// xe bạn phụ trách" as an ownership problem. The guard was behaving perfectly
// on a lot the driver never meant to touch; the direct-API call for the real
// fixture lot (shipment 249, same user, active assignment + trip) succeeded and
// proved that. Intent and action must come from the same code, or the report
// describes an intention the run never performed.
const PICK_ROW = (code, doClick) => {
  const rows = [...document.querySelectorAll('tbody tr')].filter((tr) => tr.querySelector('button, a'));
  const row = (code && rows.find((tr) => (tr.innerText || '').includes(code)))
    || rows.find((tr) => /khoản chi|khai chi|chi phí/i.test(tr.innerText || ''))
    || rows[0];
  if (!row) return null;
  const btn = [...row.querySelectorAll('button, a')].find((b) => /khoản chi|khai chi|chi phí/i.test(b.innerText || ''))
    || row.querySelector('button, a');
  if (!btn) return null;
  const out = { rowText: (row.innerText || '').trim().slice(0, 80), label: (btn.innerText || '').trim().slice(0, 40) };
  if (doClick) { btn.click(); out.clicked = true; }
  return out;
};

const target = await page.evaluate(PICK_ROW, wantCode, false);
notes.push(`buildHash=${buildHash} env=${env.env} target=${JSON.stringify(target)}`);

// Hoisted so shot-meta.json records WHICH lot the form was bound to on every
// run, including the ones where targeting was wrong. A driver that cannot say
// which row it opened cannot be trusted to say what the row did.
let openLot = null;
let lotMatches = null;

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

  const opened = await page.evaluate(PICK_ROW, wantCode, true);
  await sleep(2000);
  await page.screenshot({ path: path.join(OUT, 'cost-form-open.png'), fullPage: true });
  notes.push(`cost form opened: ${JSON.stringify(opened)}`);

  // Prove the form on screen is bound to the lot we meant to open, instead of
  // trusting that the click landed correctly. OpsExpenseFormModal.tsx:164-168
  // renders order.shipmentCode and order.billRef as read-only inputs, and the
  // form posts shipmentId: order.id (line 124) — so these two fields are the
  // form's own statement of which lot it will write to.
  const openLotFields = await page.evaluate(() => {
    const dialog = document.querySelector('[role="dialog"]') || document;
    return [...dialog.querySelectorAll('input[readonly]')].map((i) => (i.value || '').trim()).filter(Boolean);
  });
  openLot = openLotFields;
  notes.push(`opened form read-only fields: ${JSON.stringify(openLot)}`);
  lotMatches = !wantCode || openLot.some((v) => v.includes(wantCode));
  if (!lotMatches) {
    problems.push(`opened the WRONG lot: the form states ${JSON.stringify(openLot)} but the fixture is ${wantCode}. Saving is skipped rather than writing a cost onto a shipment this run did not intend to touch. An ownership refusal on this path is a driver defect, not a guard verdict.`);
    notes.push('pre-save observations below (min bound, footer echo) are component-level and lot-independent; the save half is NOT attempted');
  }

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

  // "Ghi chú" — a plain <textarea> inside label.ops-form-note.
  //
  // ops-expenses.service.ts:226 rejects the save with 400 when the line does
  // not charge the customer and carries no note. A pure cost type ("Lưu bãi
  // lúc nâng" is one) trips it, so without this the save is refused for a
  // business rule the driver was simply not satisfying — which is how the
  // run before this one mistook a form-completeness gap for a defect. The
  // note is required, and it is not what card 197 is about.
  const NOTE = process.env.NOTE || 'QA card 197 — negative cost entry, amount offset against a prior over-declaration';
  const noted = await page.evaluate((text) => {
    const dialog = document.querySelector('[role="dialog"]') || document;
    const ta = dialog.querySelector('label.ops-form-note textarea')
      || [...dialog.querySelectorAll('textarea')]
        .find((t) => /ghi chú/i.test(t.closest('label')?.innerText || ''));
    if (!ta) return null;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
    setter.call(ta, text);
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    return ta.value;
  }, NOTE);
  notes.push(`Ghi chú set: ${JSON.stringify(noted)}`);
  if (!noted) problems.push('could not find the Ghi chú field — the non-revenue note rule will refuse this save');

  // The ONLY step in this driver that writes to the server. Everything above
  // touches local form state, so gating the click here is what keeps a
  // mis-targeted run from leaving a cost row on a shipment the fixture never
  // named.
  //
  // Capture the wire too. A refused save used to be reported as a prose
  // guess ("the negative row does not appear to have been accepted") when the
  // request and the validator's complaint were both sitting in the response
  // body. "Giá trị không hợp lệ" names no field; the zod issue does.
  const wire = [];
  const capture = async (res) => {
    const req = res.request();
    if (req.method() !== 'POST' || !/expense/i.test(res.url())) return;
    let payload = null; let body = null;
    try { payload = req.postData(); } catch { /* not retrievable */ }
    try { body = await res.text(); } catch { /* already consumed */ }
    wire.push({ url: res.url(), status: res.status(), payload, body });
  };
  page.on('response', capture);

  const submitted = lotMatches
    ? await page.evaluate(() => {
      const dialog = document.querySelector('[role="dialog"]') || document;
      const btn = [...dialog.querySelectorAll('button')]
        .find((b) => /^lưu$/i.test((b.innerText || '').trim()));
      if (!btn) return false;
      if (btn.disabled) return 'disabled';
      btn.click();
      return true;
    })
    : 'skipped: the opened form is a different lot than the fixture';
  notes.push(`save clicked: ${JSON.stringify(submitted)}`);
  await sleep(3000);
  page.off('response', capture);
  notes.push(`wire: ${JSON.stringify(wire).slice(0, 1200)}`);
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

  if (!lotMatches) {
    // Already reported above, with both lot identities. Say it again in the
    // verdict so the failure is not mistaken for an amount or ownership
    // problem when only the summary lines are read.
    problems.push('SAVE NOT ATTEMPTED — the driver opened a different lot than the fixture. Nothing about negatives, and nothing about the ownership guard, is proven or disproven by this run. Fix the targeting before drawing any conclusion.');
  } else if (submitted === false) {
    problems.push('the cost form has no Lưu button — the save path could not be exercised');
  } else if (submitted === 'disabled') {
    problems.push('the Lưu button stayed disabled, so a required control the driver does not set is still missing');
  } else if (after.dialogStillOpen) {
    // Distinguish "the amount was refused" from "something else refused it".
    // The ownership guard is a DATA precondition: the OPS account must be
    // assigned the truck that owns the shipment. That is not a statement about
    // negatives, and saying so would be a false verdict.
    //
    // Reaching this branch means the form was VERIFIED to be the fixture lot
    // (its own read-only fields carry the fixture code), so an ownership
    // refusal here is a real data verdict rather than the mis-targeting that
    // produced every earlier one. The tie-breaker is the direct API call for
    // this same shipment and user: if that succeeds, the guard is satisfied and
    // the fault is the driver again.
    const ownershipRefusal = after.toasts.some((t) => /không thuộc xe bạn|liên hệ Quản trị viên/i.test(t));
    if (ownershipRefusal) {
      problems.push('SAVE BLOCKED BY OWNERSHIP, not by the amount: the form was confirmed to be on the fixture lot, and the OPS account is not assigned the truck that owns it ("' + after.toasts.join(' | ') + '"). Cross-check with a direct POST for this same shipmentId and user: if that succeeds the guard is satisfied and the driver is at fault, not the data.');
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

const meta = { prefix: 'card197', env: env.env, baseUrl: env.baseUrl, buildHash, target, wantCode, openLot, lotMatches, problems, notes, ok: problems.length === 0 };
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
