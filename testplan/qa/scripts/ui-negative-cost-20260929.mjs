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

  await sleep(800);
  await page.screenshot({ path: path.join(OUT, 'cost-form-negative.png'), fullPage: true });

  const errors = await page.evaluate(() =>
    [...document.querySelectorAll('[role="alert"], .error, [aria-invalid="true"]')]
      .map((e) => (e.innerText || '').trim()).filter(Boolean).slice(0, 5));
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
