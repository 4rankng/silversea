// Card 101026163020 (FB-051) — LOCAL UI rung: saving an edit on
// /config/penalty-reasons must raise the success toast at COMMIT time.
// Round 13 lost it because the cache refresh ran before the toast and could
// reject (raced refetch) — the write still landed, silently.
// Role ADMIN (admin, local seed). The amount is bumped +1 and RESTORED, so
// the shared local fixture ends exactly where it started (verified via API).
//
//   AC1 edit + save        → success toast "Đã cập nhật cấu hình." appears
//   AC2 persistence        → GET /penalty-reasons shows the new amount
//   AC3 restore            → original amount re-saved, toast again, API back
//                            to the original value (net-zero mutation)
//
// Design provenance: house toast primitive (Toast container role=log /
// .toast__message) + house config modal; Untitled UI PRO consulted earlier
// for feedback patterns — the in-repo success-toast contract (useCRUD) is the
// ruling implementation, no catalog component adopted.
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer';
import { appendFileSync, writeFileSync } from 'node:fs';

const BASE = 'http://localhost:7175';
const API = 'http://localhost:3002/api';
const QA = '/Volumes/LexarSSD/projects/silversea-prod/qa';
const DRIVER_LOG = `${QA}/2026-10-10_card101026163020_ui-driver.log`;
writeFileSync(DRIVER_LOG, '');
const step = (s, o = {}) => {
  const line = JSON.stringify({ at: new Date().toISOString(), step: s, ...o });
  appendFileSync(DRIVER_LOG, line + '\n');
  console.log(line);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const login = await fetch(`${API}/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ identifier: 'admin', password: 'Abc123' }),
});
if (!login.ok) throw new Error(`login admin failed: ${login.status}`);
const token = (await login.json()).token;
step('login', { user: 'admin (ADMIN)', gotToken: Boolean(token) });
const authHeaders = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

const listReasons = async () => {
  const r = await fetch(`${API}/penalty-reasons`, { headers: authHeaders });
  if (!r.ok) throw new Error(`list penalty-reasons failed: ${r.status}`);
  const j = await r.json();
  return Array.isArray(j) ? j : (j.items || j.data || []);
};
const reasons = await listReasons();
const target = reasons.find((r) => r.defaultAmount != null && Number.isFinite(Number(r.defaultAmount)));
assert.ok(target, 'a penalty reason with a default amount exists');
const original = Number(target.defaultAmount);
const bumped = original + 1;
step('fixture', { id: target.id, reason: target.reasonText, original, bumped });

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
const waitForToast = async (page, expect) => {
  for (let i = 0; i < 20; i += 1) {
    const text = await page.evaluate(() => [...document.querySelectorAll('.toast__message, .toast')]
      .map((n) => (n.textContent || '').trim()).find(Boolean) || null);
    if (text && text.includes(expect)) return text;
    await sleep(400);
  }
  return null;
};
const openEdit = async (page, name) => {
  const btn = await page.evaluateHandle((n) => {
    const edit = [...document.querySelectorAll('button[aria-label^="Chỉnh sửa"]')]
      .find((b) => (b.getAttribute('aria-label') === `Chỉnh sửa ${n}`))
      || document.querySelector('button[aria-label^="Chỉnh sửa"]');
    return edit || null;
  }, name);
  const el = btn.asElement();
  assert.ok(el, 'edit action found');
  await el.click();
  await sleep(700);
};
const setAmount = async (page, value) => {
  const input = await page.$('[role="dialog"] input[type="number"], .modal input[type="number"]');
  assert.ok(input, 'amount input present in the edit modal');
  // React-controlled number input: triple-click selection proved unreliable
  // (the keystrokes appended instead of replacing — first run wrote
  // "100000100001"). Drive the value through the native setter + input event.
  const seen = await input.evaluate((el, v) => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(el, v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return el.value;
  }, String(value));
  assert.equal(seen, String(value), 'amount input holds the intended value');
};
const save = async (page) => {
  const btn = await page.evaluateHandle(() => [...document.querySelectorAll('button')]
    .find((b) => (b.innerText || '').trim() === 'Lưu thay đổi'));
  const el = btn.asElement();
  assert.ok(el, 'Lưu thay đổi button present');
  await el.click();
};

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 1000 });
  await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);
  await page.goto(`${BASE}/config/penalty-reasons`, { waitUntil: 'networkidle0', timeout: 90000 })
    .catch(() => step('goto', { note: 'networkidle timeout — continue' }));
  // NB: the card labels render through text-transform, so innerText uppercases
  // them — wait on the (untransformed) page heading instead.
  await page.waitForFunction(() => document.body.innerText.includes('Danh mục lỗi vi phạm'), { timeout: 60000 });
  step('page-loaded');
  await page.screenshot({ path: `${QA}/2026-10-10_card101026163020_ui-1-page.png` });

  // AC1 — edit + save raises the success toast at commit time.
  await openEdit(page, target.reasonText);
  await setAmount(page, bumped);
  await page.screenshot({ path: `${QA}/2026-10-10_card101026163020_ui-2-edit.png` });
  await save(page);
  const toast1 = await waitForToast(page, 'Đã cập nhật cấu hình');
  step('AC1-save-toast', { toast: toast1 });
  await page.screenshot({ path: `${QA}/2026-10-10_card101026163020_ui-3-toast.png` });
  assert.ok(toast1, `AC1: success toast fired after save (got: ${toast1})`);

  // AC2 — the write persisted.
  let persisted = null;
  for (let i = 0; i < 12 && persisted == null; i += 1) {
    await sleep(500);
    const rows = await listReasons();
    const row = rows.find((r) => r.id === target.id);
    if (row && Number(row.defaultAmount) === bumped) persisted = Number(row.defaultAmount);
  }
  step('AC2-persisted', { persisted });
  assert.equal(persisted, bumped, 'AC2: the new amount is readable from the API');

  // AC3 — restore the original value (net-zero) and toast again.
  await sleep(1200); // let the first toast retire
  await openEdit(page, target.reasonText);
  await setAmount(page, original);
  await save(page);
  const toast2 = await waitForToast(page, 'Đã cập nhật cấu hình');
  step('AC3-restore-toast', { toast: toast2 });
  assert.ok(toast2, `AC3: restore save also toasts (got: ${toast2})`);
  let restored = null;
  for (let i = 0; i < 12 && restored == null; i += 1) {
    await sleep(500);
    const rows = await listReasons();
    const row = rows.find((r) => r.id === target.id);
    if (row && Number(row.defaultAmount) === original) restored = Number(row.defaultAmount);
  }
  step('AC3-restored', { restored });
  assert.equal(restored, original, 'AC3: fixture restored to the original amount');
  await page.screenshot({ path: `${QA}/2026-10-10_card101026163020_ui-4-restored.png` });

  step('done', { note: 'amount bumped +1 then restored — net-zero local fixture change' });
} catch (err) {
  step('FATAL', { error: String((err && err.message) || err) });
  throw err;
} finally {
  await browser.close();
}
appendFileSync(DRIVER_LOG, 'RUNG PASS\nDRIVER OK\n');
console.log('RUNG PASS');
console.log('DRIVER OK');
