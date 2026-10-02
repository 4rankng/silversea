// Local-only actual controls, unsaved drafts and read parity for UI24/27/28/30.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { loadEnv, preflight } from '../lib/env.mjs';
import { createSession } from '../lib/harness.mjs';

const env = await loadEnv();
for (const url of [env.baseUrl, env.api]) assert.ok(['localhost', '127.0.0.1'].includes(new URL(url).hostname));
await preflight(env);
const out = path.resolve(process.env.QA_WORKBENCH_EVIDENCE_DIR ?? 'qa/2026-10-01_comprehensive-audit_house-workbenches');
await fs.mkdir(out, { recursive: true });
const proofs = [];
const roles = process.env.QA_WORKBENCH_ROLES?.split(',') ?? ['ADMIN', 'ACCOUNTANT', 'DISPATCHER', 'DRIVER'];

async function click(ctx, pattern, scope = 'body') {
  const handle = await ctx.page.evaluateHandle((rx, selector) => [...document.querySelector(selector).querySelectorAll('button,a,[role=option],summary')].find(element => {
    const box = element.getBoundingClientRect();
    return box.width > 0 && box.height > 0 && !element.disabled && (new RegExp(rx).test(element.innerText.trim()) || new RegExp(rx).test(element.getAttribute('aria-label') ?? ''));
  }), pattern, scope);
  const element = handle.asElement();
  assert.ok(element, `Actual visible control required: ${pattern}`);
  await element.click(); await ctx.settle(300);
  console.log('ACTUAL CLICK', ctx.role, pattern);
}
async function capture(ctx, name) {
  const dom = await ctx.page.evaluate(() => ({
    route: location.pathname, text: document.body.innerText, title: document.querySelector('.topbar__context strong')?.textContent ?? document.title.split(' · ')[0], heading: document.querySelector('h1')?.textContent,
    overflow: document.documentElement.scrollWidth - innerWidth,
    controls: [...document.querySelectorAll('button,input,textarea,summary')].filter(element => element.getBoundingClientRect().width > 0).map(element => {
      const box = element.getBoundingClientRect(), style = getComputedStyle(element);
      return { text: element.innerText, aria: element.getAttribute('aria-label'), id: element.id, disabled: element.disabled, value: element.value, focused: document.activeElement === element, x: box.x, y: box.y, width: box.width, height: box.height, fieldHeight: element.closest('.penalty-month-select')?.getBoundingClientRect().height, background: style.backgroundColor };
    }),
    panels: [...document.querySelectorAll('.ttp-panel,.ledger-record .panel,.ttp-dialog')].filter(element => element.getBoundingClientRect().width > 0).map(element => ({ className: element.className, background: getComputedStyle(element).backgroundColor })),
    records: [...document.querySelectorAll('.ledger-record')].map(element => ({ name: element.getAttribute('aria-label'), text: element.innerText, selected: element.dataset.selected === 'true', expanded: element.querySelector('details')?.open, facts: [...element.querySelectorAll('dt')].map(fact => fact.innerText) })),
  }));
  assert.equal(dom.overflow, 0, `${name} page containment`);
  assert.ok(dom.text.trim().length > 30, `${name} must capture resolved visible page content`);
  const screenshot = await ctx.screenshot(`${ctx.role.toLowerCase()}-${name}`);
  const domPath = screenshot.replace(/\.png$/, '-dom.json');
  await fs.writeFile(domPath, JSON.stringify(dom, null, 2) + '\n');
  proofs.push({ account: ctx.username, role: ctx.role, name, screenshot, domPath, dom });
  await fs.writeFile(path.join(out, 'assertions.json'), JSON.stringify(proofs, null, 2) + '\n');
  return dom;
}
async function parity(ctx, queries, work) {
  const before = await Promise.all(queries.map(query => ctx.apiGet(query)));
  before.forEach((read, index) => assert.equal(read.status, 200, queries[index]));
  await work();
  const after = await Promise.all(queries.map(query => ctx.apiGet(query)));
  assert.deepEqual(after, before, `Unchanged persisted source: ${queries.join(', ')}`);
  proofs.push({ role: ctx.role, queries, before, after });
  await fs.writeFile(path.join(out, 'assertions.json'), JSON.stringify(proofs, null, 2) + '\n');
}
for (const role of roles) {
  const ctx = await createSession({ env, role, evidenceDir: out, runId: `house-workbenches-${role}` });
  assert.equal(ctx.user.role, role);
  const blocked = [], responses = [];
  ctx.page.on('response', response => { if (response.url().includes('/api/')) responses.push({ url: response.url(), status: response.status(), method: response.request().method() }); });
  await ctx.page.setRequestInterception(true);
  ctx.page.on('request', request => {
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method())) { blocked.push({ method: request.method(), url: request.url() }); void request.abort('blockedbyclient'); }
    else void request.continue();
  });
  try {
    for (const width of [390, 768, 1440]) {
      await ctx.page.setViewport({ width, height: 900, hasTouch: width < 900 });
      if (role === 'ADMIN') {
        for (const route of ['/fleet/1/tires', '/fleet/trailers/1/tires']) await parity(ctx, ['/fleet/tires?limit=1000', '/tire-positions'], async () => {
          await ctx.goto(route); await ctx.page.waitForSelector('#tire-serial');
          await ctx.page.click('#tire-serial'); await ctx.page.type('#tire-serial', 'QA-AUDIT-UI27-UNSAVED');
          const base = await capture(ctx, `tires-${route.includes('trailers') ? 'trailer' : 'truck'}-${width}-focused`);
          assert.ok(base.panels.length >= 2 && base.panels.every(panel => panel.background === 'rgb(255, 255, 255)'));
          assert.ok(base.controls.find(control => control.id === 'tire-serial')?.focused);
          await click(ctx, '^Chọn vị trí lốp$');
          await ctx.page.waitForSelector('.ttp-position-picker-menu');
          await capture(ctx, `tires-${route.includes('trailers') ? 'trailer' : 'truck'}-${width}-picker`);
          await ctx.page.keyboard.press('Escape'); await ctx.settle(250);
          assert.equal(new URL(ctx.page.url()).pathname, route, 'Escape must close only the picker');
          assert.equal(await ctx.page.$eval('#tire-serial', element => element.value), 'QA-AUDIT-UI27-UNSAVED');
          await ctx.page.click('input[aria-label="Tìm nhà cung cấp lốp"]'); await ctx.settle(200);
          await ctx.page.keyboard.press('Escape'); await ctx.settle(200);
          assert.equal(new URL(ctx.page.url()).pathname, route);
          await ctx.page.click('.ttp-tool-btn'); await ctx.settle(300); console.log('ACTUAL CLICK', role, '.ttp-tool-btn');
          await ctx.page.waitForSelector('[role=dialog][aria-labelledby=ttp-position-manager-title]');
          await capture(ctx, `tires-${route.includes('trailers') ? 'trailer' : 'truck'}-${width}-manager`);
          await click(ctx, '^Đóng$', '[role=dialog][aria-labelledby=ttp-position-manager-title]');
          await click(ctx, 'Quay lại đội xe');
          assert.equal(new URL(ctx.page.url()).pathname, '/fleet');
        });
        await parity(ctx, ['/quotations'], async () => {
          await ctx.goto('/config/quotations'); await click(ctx, 'Tạo báo giá$');
          await ctx.page.waitForSelector('[role=dialog]');
          const dom = await capture(ctx, `quotation-title-${width}`);
          assert.equal(dom.title, 'Báo giá');
          await click(ctx, '^Hủy$', '[role=dialog]');
        });
      } else if (role === 'ACCOUNTANT') {
        await parity(ctx, ['/advance-settlements/25'], async () => {
          await ctx.goto('/settlements/25');
          const response = ctx.page.waitForResponse(response => response.url().includes('/advance-settlements/25/export?format=xlsx'));
          await click(ctx, '^Excel$'); assert.equal((await response).status(), 200);
          const dom = await capture(ctx, `settlement-title-${width}`);
          assert.equal(dom.title, 'Chi tiết phiếu thanh toán'); assert.ok(dom.text.includes('PT-2610-0001'));
        });
        await parity(ctx, ['/accounting/debit-board', '/accounting/debit-board/settlement-rounds'], async () => {
          await ctx.goto('/accounting/chot-debit');
          await ctx.page.waitForSelector(width === 390 ? '.ledger-record' : '.debit-board tbody tr');
          if (width === 390) {
            const source = (await ctx.apiGet('/accounting/debit-board')).body.items;
            assert.ok(source.length > 20, 'Actual multi-page board required');
            await click(ctx, '^Chi tiết$', '.ledger-record');
            let dom = await capture(ctx, `debit-${width}-expanded`);
            assert.equal(dom.records.length, 20); assert.equal(dom.records[0].expanded, true); assert.equal(dom.records[0].selected, false);
            assert.ok(dom.records[0].text.includes(source[0].customerName ?? ''));
            for (const key of ['Tổng thu', 'Tổng 1', 'Lợi nhuận', 'Đối soát']) assert.ok(dom.records[0].facts.includes(key));
            assert.ok(!dom.records[0].text.includes(source[0].code ?? 'SHP-'));
            await ctx.page.$eval('.ledger-record details', element => element.scrollIntoView({ block: 'center' }));
            await capture(ctx, `debit-${width}-expanded-lower`);
            await ctx.page.$eval('.ledger-record-list__pager', element => element.scrollIntoView({ block: 'center' }));
            await click(ctx, '^Trang sau$'); dom = await capture(ctx, `debit-${width}-page2`);
            assert.ok(dom.text.includes(`21–${Math.min(40, source.length)} / ${source.length}`));
            await ctx.page.$eval('.ledger-record-list__pager', element => element.scrollIntoView({ block: 'center' }));
            await click(ctx, '^Trang trước$');
            const checkbox = await ctx.page.$('.ledger-record input[type=checkbox]'); assert.ok(checkbox);
            await checkbox.click(); await ctx.settle(150);
            await click(ctx, '^Chọn Debit \\(1 dòng\\)$');
            await capture(ctx, `debit-${width}-dialog`);
            await click(ctx, '^Hủy$', '[role=dialog]');
            dom = await capture(ctx, `debit-${width}-cancelled`);
            assert.equal(dom.records.filter(record => record.selected).length, 1);
          } else {
            const row = await ctx.page.$('.debit-row--pickable'); assert.ok(row); await row.click(); await ctx.settle(200);
            await click(ctx, '^Chọn Debit \\(1 dòng\\)$');
            await capture(ctx, `debit-${width}-dialog`); await click(ctx, '^Hủy$', '[role=dialog]');
            const dom = await capture(ctx, `debit-${width}-matrix`); assert.equal(dom.records.length, 0);
          }
        });
      } else if (role === 'DISPATCHER') {
        await parity(ctx, ['/shipments/dispatch-detail-plan-rows?dateFrom=2026-10-01&dateTo=2026-10-31&page=1&limit=20'], async () => {
          await ctx.goto('/dispatch-detail'); await click(ctx, '^Xóa lọc$');
          const dom = await capture(ctx, `dispatch-title-${width}`);
          assert.ok(dom.title && dom.title !== 'TransTing');
        });
      } else {
        await parity(ctx, ['/driver/me/penalties'], async () => {
          await ctx.goto('/my-penalties'); await ctx.page.waitForSelector('#penalty-month-filter');
          await ctx.page.click('#penalty-month-filter'); await ctx.settle(250);
          await click(ctx, '^Tháng 9/2026$');
          const dom = await capture(ctx, `penalty-month-${width}`);
          assert.equal(dom.controls.find(control => control.id === 'penalty-month-filter')?.value, 'Tháng 9/2026');
          const control = dom.controls.find(control => control.id === 'penalty-month-filter');
          assert.ok(control.fieldHeight <= 40.5 && control.fieldHeight >= (width === 390 ? 39.5 : 24));
        });
      }
    }
    assert.equal(blocked.length, 0, 'No incidental material requests'); assert.equal(ctx.apiCalls.length, 0);
    assert.deepEqual(ctx.errors, []); assert.ok(responses.every(response => response.status < 400));
    await fs.writeFile(path.join(out, `${role.toLowerCase()}-requests.json`), JSON.stringify({ blocked, responses, errors: ctx.errors }, null, 2) + '\n');
    console.log('ROLE COMPLETE', role);
  } catch (error) {
    await capture(ctx, 'failure').catch(() => {});
    await fs.writeFile(path.join(out, `${role.toLowerCase()}-failure.json`), JSON.stringify({ error: error.stack, blocked, responses, errors: ctx.errors }, null, 2) + '\n');
    throw error;
  } finally {
    const browserProcess = ctx.browser.process();
    await Promise.race([ctx.browser.close(), new Promise(resolve => setTimeout(() => { browserProcess?.kill('SIGKILL'); resolve(); }, 10000))]);
    ctx.browser.disconnect();
  }
}
