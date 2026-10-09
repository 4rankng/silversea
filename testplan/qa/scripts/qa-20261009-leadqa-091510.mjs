// Lead QA rung — card 091026091510 (schedule lock) on staging build 45993f90.
// Flow on the reported row TEST-LCL-362: set date → save → clear → save → set → save.
// AC: every save succeeds; no optimistic-concurrency false guard; row ends where the reporter needs it.
import { launch, login, step, tap, evidenceDir, BASE } from './lead-qa-harness.mjs';
const dir = evidenceDir('2026-10-09_round8-leadqa');
const log = `${dir}/driver-leadqa-091510.log`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const shot = (page, name) => page.screenshot({ path: `${dir}/${name}.png` });

const { browser, page } = await launch({ width: 1440, height: 900 });
await page.goto(`${BASE}/api/health`, { waitUntil: 'networkidle2', timeout: 60000 });
const health = await page.evaluate(() => document.body.innerText);
if (!health.includes('8f2791f8')) throw new Error(`stale build: ${health.slice(0, 120)}`);
step(log, { step: 'build-currency', buildHash: '8f2791f8' });

await login(page, 'dungnv');
// open the lot detail of TEST-LCL-362 via the list filter + its Chi tiết action
await page.goto(`${BASE}/shipments`, { waitUntil: 'networkidle2', timeout: 60000 });
await sleep(2500);
const filter = await page.$('input[placeholder*="Bill, Book"]');
if (filter) {
  await filter.type('TEST-LCL-362', { delay: 20 });
  await sleep(2200);
  step(log, { step: 'filtered', term: 'TEST-LCL-362' });
} else {
  step(log, { step: 'no-filter-input-found' });
}
await shot(page, 's1510-list-after-search');
// open the row detail via its Chi tiết action
const rowBtn = await page.evaluateHandle(() => {
  const tr = [...document.querySelectorAll('tr')].find((n) => n.textContent.includes('TEST-LCL-362'));
  if (!tr) return null;
  return [...tr.querySelectorAll('button, a')].find((b) => /Chi tiết/i.test(b.textContent || '')) || tr.querySelector('a, button');
});
const rowEl = rowBtn.asElement();
if (!rowEl) throw new Error('TEST-LCL-362 row not found');
// deterministic navigation: resolve the shipment id via the list API, then
// goto /shipments/:id (route per App.tsx:375). The AC under test is the SAVE
// cycle; nav is transport, not criterion.
const lotId = await page.evaluate(async () => {
  const token = localStorage.getItem('token') || localStorage.getItem('auth_token') || '';
  const keys = Object.keys(localStorage);
  let tok = token;
  if (!tok) { for (const k of keys) { const v = localStorage.getItem(k); if (v && v.length > 40 && v.startsWith('ey')) { tok = v; break; } } }
  const res = await fetch('/api/v1/shipments?page=1&limit=5&q=TEST-LCL-362', { headers: { Authorization: `Bearer ${tok}` } });
  if (!res.ok) return { err: res.status };
  const body = await res.json();
  const rows = body.rows || body.data || body.items || [];
  const hit = rows.find((r) => (r.bookingCode || r.billCode || r.code || '').includes('TEST-LCL-362')) || rows[0];
  return hit ? { id: hit.id, code: hit.bookingCode || hit.billCode } : { err: 'no rows' };
});
step(log, { step: 'lot-id-resolved', ...lotId });
if (!lotId.id) throw new Error(`could not resolve TEST-LCL-362 id: ${JSON.stringify(lotId)}`);
await page.goto(`${BASE}/shipments/${lotId.id}`, { waitUntil: 'networkidle2', timeout: 60000 });
step(log, { step: 'tap-row', url: page.url() });
await sleep(3000);
await shot(page, 's1510-lot-detail');

const GUARD = 'vừa thay đổi';
const saveState = async () => page.evaluate(() => ({
  guard: document.body.innerText.includes('Dữ liệu hoặc quyền chỉnh sửa vừa thay đổi'),
  updated: document.body.innerText.includes('Đã cập nhật lịch'),
}));

// helper: open the lich-trinh editor
const openEditor = async () => {
  const btn = await page.evaluateHandle(() => [...document.querySelectorAll('button')].find((b) => /Chỉnh sửa.*Lịch trình|Lịch trình/i.test(b.textContent || '') && /Chỉnh sửa|Sửa/i.test(b.textContent || '')));
  const el = btn.asElement();
  if (!el) throw new Error('schedule edit trigger not found');
  await el.evaluate((n) => n.scrollIntoView({ block: 'center' }));
  await sleep(300);
  const bb = await el.boundingBox();
  await page.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2); await page.mouse.down(); await page.mouse.up();
  await sleep(1200);
  step(log, { step: 'editor-opened' });
};
// helper: set a date into the combined field via keyboard (segments)
const setSchedule = async (hhmm, ddmmyyyy) => {
  const hh = await page.$('[data-seg="hh"]');
  if (!hh) throw new Error('hh segment not found in editor');
  await hh.click().catch(() => {});
  const seg = await page.$('[data-seg="hh"]');
  const bb = await seg.boundingBox();
  await page.mouse.move(bb.x + 6, bb.y + bb.height / 2); await page.mouse.down(); await page.mouse.up();
  await sleep(300);
  await page.keyboard.type(hhmm, { delay: 60 });
  await page.keyboard.type(ddmmyyyy, { delay: 60 });
  await sleep(300);
  step(log, { step: 'schedule-typed', hhmm, ddmmyyyy });
};
// helper: clear the schedule (empty the segments with Delete/Backspace)
const clearSchedule = async () => {
  const seg = await page.$('[data-seg="hh"]');
  const bb = await seg.boundingBox();
  await page.mouse.move(bb.x + 6, bb.y + bb.height / 2); await page.mouse.down(); await page.mouse.up();
  await sleep(200);
  for (let i = 0; i < 3; i++) { await page.keyboard.press('Backspace'); await sleep(120); }
  await page.keyboard.press('Delete');
  await sleep(200);
  const dd = await page.$('[data-seg="dd"]');
  if (dd) { const b2 = await dd.boundingBox(); await page.mouse.move(b2.x + 6, b2.y + b2.height / 2); await page.mouse.down(); await page.mouse.up(); await sleep(150); for (let i = 0; i < 3; i++) { await page.keyboard.press('Backspace'); await sleep(100); } }
  await sleep(200);
  step(log, { step: 'schedule-cleared' });
};
// helper: press the editor save button and wait for toast/guard
const saveEditor = async (label) => {
  const btn = await page.evaluateHandle(() => [...document.querySelectorAll('button')].find((b) => /Lưu thay đổi|Lưu/i.test(b.textContent || '')));
  const el = btn.asElement();
  if (!el) throw new Error('save button not found');
  await el.evaluate((n) => n.scrollIntoView({ block: 'center' }));
  await sleep(250);
  const bb = await el.boundingBox();
  await page.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2); await page.mouse.down(); await page.mouse.up();
  const res = await page.waitForFunction(() => {
    const t = document.body.innerText;
    if (t.includes('Dữ liệu hoặc quyền chỉnh sửa vừa thay đổi')) return 'guard';
    if (t.includes('Đã cập nhật lịch') || t.includes('Đã lưu')) return 'saved';
    return null;
  }, { timeout: 15000 }).then((h) => h.jsonValue()).catch(() => 'timeout');
  step(log, { step: 'save', label, result: res });
  await shot(page, `s1510-after-${label}`);
  return res;
};
// helper: close editor dialog if open
const closeEditor = async () => {
  await page.keyboard.press('Escape');
  await sleep(600);
  const dlg = await page.$('[role="dialog"]');
  if (dlg) { const huy = await page.evaluateHandle(() => [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Hủy')); const h = huy.asElement(); if (h) { const bb = await h.boundingBox(); await page.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2); await page.mouse.down(); await page.mouse.up(); await sleep(600); } }
  step(log, { step: 'editor-closed' });
};

// CYCLE 1: set → save (expect saved)
await openEditor();
await setSchedule('0800', '12102026');
const r1 = await saveEditor('set1');
await closeEditor();

// CYCLE 2: clear → save (expect saved — this was the reported lock)
await openEditor();
await clearSchedule();
const r2 = await saveEditor('clear');
await closeEditor();

// CYCLE 3: set again → save (expect saved — second-consecutive-save class)
await openEditor();
await setSchedule('0900', '12102026');
const r3 = await saveEditor('set2');
await closeEditor();

// CYCLE 4: save again with no change (no-op save — the reported "luu no-op" case)
await openEditor();
const r4 = await saveEditor('noop');
await closeEditor();

// final: clear back to the reporter's original state ('Chưa chốt ngày')
await openEditor();
await clearSchedule();
const r5 = await saveEditor('restore');
await closeEditor();

const fails = [r1, r2, r3, r4, r5].filter((x) => x !== 'saved');
step(log, { step: 'CYCLE-RESULTS', r1, r2, r3, r4, r5, pass: fails.length === 0 });
if (fails.length) throw new Error(`guard/false-fail encountered: ${JSON.stringify({ r1, r2, r3, r4, r5 })}`);
step(log, { step: 'DONE', verdict: 'ALL-SAVES-PASS' });
await browser.close();
console.log('SCHEDULE LOCK RUNG PASS — 5/5 saves');
