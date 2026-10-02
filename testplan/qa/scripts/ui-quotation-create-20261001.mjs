import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { loadEnv, preflight } from '../lib/env.mjs';
import { createSession } from '../lib/harness.mjs';

const env = await loadEnv();
assert.ok(['localhost', '127.0.0.1'].includes(new URL(env.baseUrl).hostname), 'Local quotation audit only');
await preflight(env);
const output = path.resolve(process.env.QA_UI29_OUTPUT_DIR || 'qa/2026-10-01_comprehensive-audit_ui29-final');
await fs.mkdir(output, { recursive: true });
const createdPath = path.resolve('qa/2026-10-01_comprehensive-audit_ui29-final/created-record.json');
let created = await fs.readFile(createdPath, 'utf8').then(JSON.parse).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
const ctx = await createSession({ env, role: 'ADMIN', evidenceDir: output, runId: 'UI29' });
const proof = { role: 'ADMIN', account: ctx.username, states: [], writes: [], httpErrors: [] };
const templateName = 'QA-AUDIT-UI29 — LONG MINH — 02/10/2026';
let allowCreate = false;
let sequence = 0;
const validationOnly = process.env.QA_UI29_VALIDATION_ONLY === '1';
const save = () => fs.writeFile(path.join(output, 'driver-assertions.json'), JSON.stringify({ ...proof, created, errors: ctx.errors }, null, 2) + '\n');
async function click(text, scope = '') {
  const handle = await ctx.page.evaluateHandle((text, scope) => [...(scope ? document.querySelector(scope) : document).querySelectorAll('button')].find(element => element.textContent.trim() === text), text, scope);
  const element = handle.asElement(); assert.ok(element, `Button ${text}`); await element.click(); await ctx.settle(200);
}
async function field(label) {
  const handle = await ctx.page.evaluateHandle(label => [...document.querySelectorAll('[role="dialog"] label')].find(element => element.textContent.replaceAll('*', '').trim() === label)?.control, label);
  const element = handle.asElement(); assert.ok(element, `Field ${label}`); return element;
}
async function fill(element, value) {
  await element.click(); const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
  await ctx.page.keyboard.down(modifier); await ctx.page.keyboard.press('A'); await ctx.page.keyboard.up(modifier);
  await ctx.page.keyboard.type(value, { delay: 20 });
}
async function capture(width, state) {
  const shot = await ctx.screenshot(`${String(++sequence).padStart(2, '0')}_${width}-${state}`);
  const dom = await ctx.page.evaluate(() => ({ url: location.pathname, text: document.body.innerText, documentWidth: document.documentElement.scrollWidth, width: innerWidth,
    focus: { tag: document.activeElement?.tagName, invalid: document.activeElement?.getAttribute('aria-invalid') },
    fields: [...document.querySelectorAll('[role="dialog"] input')].map(element => ({ label: element.getAttribute('aria-label'), value: element.value, invalid: element.getAttribute('aria-invalid') })),
    dialogs: [...document.querySelectorAll('[role="dialog"]')].map(element => ({ text: element.innerText, rect: element.getBoundingClientRect().toJSON(), scrollWidth: element.scrollWidth, clientWidth: element.clientWidth })) }));
  const domPath = shot.replace(/\.png$/, '-dom.json'); await fs.writeFile(domPath, JSON.stringify(dom, null, 2) + '\n');
  assert.ok(dom.documentWidth <= width + 1); for (const dialog of dom.dialogs) assert.ok(dialog.scrollWidth <= dialog.clientWidth + 1);
  proof.states.push({ width, state, shot, domPath, dom }); await save(); return dom;
}
async function fillDraft(customer) {
  const customerInput = await field('Khách hàng'); await fill(customerInput, customer.name); await ctx.settle(300);
  const optionHandle = await ctx.page.evaluateHandle(name => [...document.querySelectorAll('[role="option"]')].find(element => element.textContent.trim() === name), customer.name);
  const option = optionHandle.asElement(); assert.ok(option, 'Exact real customer option'); await option.click(); await ctx.settle(150);
  await fill(await field('Tên mẫu báo giá'), templateName);
  for (const [segment, value] of [['dd', '02'], ['mm2', '10'], ['yyyy', '2026']]) {
    const input = await ctx.page.$(`[role="dialog"] [data-seg="${segment}"]`); assert.ok(input); await fill(input, value);
  }
  await ctx.page.keyboard.press('Escape'); await fill(await field('Ghi chú'), 'QA local: kiểm tra luồng tạo báo giá cho khách hàng hiện hữu; không thay giá, hệ số hoặc chi phí.');
  await ctx.page.keyboard.press('Tab'); await ctx.settle(150);
}

try {
  await ctx.page.setCacheEnabled(false); await ctx.page.setRequestInterception(true);
  ctx.page.on('request', request => {
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method())) { void request.continue(); return; }
    const body = JSON.parse(request.postData() || '{}');
    const permitted = allowCreate && request.method() === 'POST' && new URL(request.url()).pathname === '/api/quotations' && body.customerId === 1 && body.templateName === templateName && body.effectiveDate === '2026-10-02' && body.cells.length === 0 && body.fees.length === 0;
    proof.writes.push({ method: request.method(), url: request.url(), body, permitted, idempotencyKeyPresent: Boolean(request.headers()['idempotency-key']) });
    allowCreate = false; if (permitted) void request.continue(); else void request.abort('blockedbyclient');
  });
  ctx.page.on('response', response => { if (response.status() >= 400) proof.httpErrors.push({ url: response.url(), status: response.status() }); });
  const customerResponse = await ctx.apiGet('/customers/1'); assert.equal(customerResponse.status, 200);
  const customer = customerResponse.body; assert.equal(customer.id, 1); proof.customer = { id: customer.id, name: customer.name };
  for (const width of [390, 768, 1440]) {
    await ctx.page.setViewport({ width, height: 900, hasTouch: width < 900 }); await ctx.goto('/config/quotations');
    const before = await ctx.apiGet('/quotations'); assert.equal(before.status, 200);
    await click('＋ Tạo báo giá'); await capture(width, 'empty-open');
    await click('Tạo báo giá', '[role="dialog"]'); const invalid = await capture(width, 'required-validation');
    for (const message of ['Chọn khách hàng.', 'Nhập tên mẫu báo giá.', 'Chọn ngày hiệu lực hợp lệ.']) assert.ok(invalid.text.includes(message), message);
    assert.equal(invalid.focus.invalid, 'true'); assert.equal(proof.writes.length, 0);
    await ctx.page.keyboard.press('Escape'); await ctx.settle(450); const settledValidation = await capture(width, 'required-validation-picker-closed'); assert.equal(settledValidation.dialogs.length, 1);
    if (validationOnly) {
      await click('Hủy', '[role="dialog"]'); assert.deepEqual(await ctx.apiGet('/quotations'), before); await capture(width, 'validation-cancelled'); continue;
    }
    await fillDraft(customer); await capture(width, 'filled-draft');
    const year = await ctx.page.$('[role="dialog"] [data-seg="yyyy"]'); await fill(year, '202'); await ctx.page.keyboard.press('Escape');
    await click('Tạo báo giá', '[role="dialog"]'); const partial = await capture(width, 'partial-date-validation'); assert.ok(partial.text.includes('Nhập ngày hợp lệ theo DD/MM/YYYY.')); assert.equal(partial.focus.invalid, 'true'); assert.equal(proof.writes.length, 0);
    await fill(year, '2026'); await ctx.page.keyboard.press('Escape'); await click('Hủy', '[role="dialog"]');
    const cancelled = await capture(width, 'cancelled'); assert.equal(cancelled.dialogs.length, 0);
    const after = await ctx.apiGet('/quotations'); assert.deepEqual(after, before); proof.states.at(-1).parity = { before, after }; await save();
  }
  if (!validationOnly) {
  const beforeCreate = await ctx.apiGet('/quotations'); const activeFeesBefore = await ctx.apiGet('/quotations/fees/active?customerId=1');
  if (!created) {
    assert.ok(!beforeCreate.body.some(frame => frame.templateName === templateName), 'Prior unknown quotation exists; refuse duplicate');
    await ctx.page.setViewport({ width: 390, height: 900, hasTouch: true }); await ctx.goto('/config/quotations'); await click('＋ Tạo báo giá'); await fillDraft(customer); await capture(390, 'valid-submit-ready');
    allowCreate = true; const responsePromise = ctx.page.waitForResponse(response => response.request().method() === 'POST' && new URL(response.url()).pathname === '/api/quotations');
    await click('Tạo báo giá', '[role="dialog"]'); const response = await responsePromise; assert.equal(response.status(), 201);
    const result = await response.json(); assert.ok(Number.isInteger(result.id)); created = { id: result.id, templateName, customerId: 1, effectiveDate: '2026-10-02', responseStatus: response.status(), beforeCreate, submitted: proof.writes.at(-1) };
    await fs.writeFile(createdPath, JSON.stringify(created, null, 2) + '\n'); await save();
    await ctx.page.waitForSelector('[role="dialog"]', { hidden: true }); await ctx.settle(350); await capture(390, 'created-selected');
  }
  const afterCreate = await ctx.apiGet('/quotations'); const detail = await ctx.apiGet(`/quotations/${created.id}`); const versions = await ctx.apiGet(`/quotations/${created.id}/versions`); const activeFeesAfter = await ctx.apiGet('/quotations/fees/active?customerId=1');
  assert.equal(detail.status, 200); assert.equal(detail.body.templateName, templateName); assert.equal(detail.body.customerId, 1); assert.equal(detail.body.effectiveDate, '2026-10-02'); assert.equal(detail.body.surchargeRoundingMode, 'NONE'); assert.equal(detail.body.fees.length, 0);
  assert.equal(versions.status, 200); assert.equal(versions.body.items.length, 1); assert.equal(versions.body.items[0].version, 1); assert.deepEqual(activeFeesAfter, activeFeesBefore);
  assert.equal(afterCreate.body.filter(frame => frame.templateName === templateName).length, 1);
  proof.persisted = { afterCreate, detail, versions, activeFeesBefore, activeFeesAfter }; await save();
  for (const width of [390, 768, 1440]) {
    await ctx.page.setViewport({ width, height: 900, hasTouch: width < 900 }); await ctx.goto('/config/quotations');
    const handle = await ctx.page.evaluateHandle(name => [...document.querySelectorAll('.quotation-frames tbody tr')].find(row => row.textContent.includes(name)), templateName); const row = handle.asElement(); assert.ok(row); await row.click(); await ctx.settle(350);
    const selected = await capture(width, 'persisted-selected'); assert.ok(selected.text.includes(templateName));
    assert.equal(await ctx.page.$eval('.quotation-frames .is-selected', row => row.textContent.includes('QA-AUDIT-UI29')), true);
    assert.deepEqual(await ctx.apiGet(`/quotations/${created.id}`), detail);
  }
  }
  assert.equal(proof.writes.filter(write => !write.permitted).length, 0); assert.ok(proof.writes.length <= 1); assert.ok(proof.writes.every(write => write.idempotencyKeyPresent)); assert.equal(proof.httpErrors.length, 0); assert.equal(ctx.errors.length, 0);
  proof.complete = true; await save(); console.log(JSON.stringify({ complete: true, states: proof.states.length, createdId: created.id, widths: [390, 768, 1440], materialWrites: proof.writes.length, version: 1 }));
} finally { await save(); await ctx.browser.close(); }
