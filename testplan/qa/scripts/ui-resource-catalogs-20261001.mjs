import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { loadEnv, preflight } from '../lib/env.mjs';
import { createSession } from '../lib/harness.mjs';

const env = await loadEnv(); await preflight(env);
const output = path.resolve(process.env.QA_UI34_OUTPUT_DIR || 'qa/2026-10-01_comprehensive-audit_ui34-final-green'); await fs.mkdir(output, { recursive: true });
const ctx = await createSession({ env, role: 'DISPATCHER', evidenceDir: output, runId: 'UI34' });
const proof = { role: 'DISPATCHER', account: ctx.username, states: [], writes: [], httpErrors: [] };
const save = () => fs.writeFile(path.join(output, 'driver-assertions.json'), JSON.stringify({ ...proof, errors: ctx.errors }, null, 2) + '\n');
async function capture(route, width, label) {
  const shot = await ctx.screenshot(`${route.replaceAll('/', '-')}-${width}-${label}`);
  const dom = await ctx.page.evaluate(() => ({ url: location.pathname, text: document.body.innerText, width: innerWidth, documentWidth: document.documentElement.scrollWidth,
    panels: [...document.querySelectorAll('.dispatch-catalogs .panel')].map(element => { const css = getComputedStyle(element); return { background: css.backgroundColor, borderWidth: css.borderTopWidth, borderStyle: css.borderTopStyle, radius: css.borderTopLeftRadius, overflow: css.overflow, rect: element.getBoundingClientRect().toJSON() }; }),
    headings: [...document.querySelectorAll('.dispatch-catalogs h1')].map(element => ({ text: element.textContent, rect: element.getBoundingClientRect().toJSON() })),
    records: [...document.querySelectorAll('.dispatch-catalogs__table tbody tr')].map(element => ({ text: element.innerText, labels: [...element.querySelectorAll('[data-label]')].map(cell => cell.dataset.label), rect: element.getBoundingClientRect().toJSON() })),
    dialogs: [...document.querySelectorAll('[role="dialog"]')].map(element => ({ text: element.innerText, width: element.scrollWidth, clientWidth: element.clientWidth })),
    inputs: [...document.querySelectorAll('[role=dialog] input')].map(element=>({label:[...(element.labels||[])].map(label=>label.textContent.trim()).join(' '),placeholder:element.placeholder,value:element.value})),
    focus: { tag: document.activeElement?.tagName, label: document.activeElement?.getAttribute('aria-label') } }));
  const domPath = shot.replace(/\.png$/, '-dom.json'); await fs.writeFile(domPath, JSON.stringify(dom, null, 2) + '\n'); assert.ok(dom.documentWidth <= width + 1);
  for (const panel of dom.panels) { assert.equal(panel.background, 'rgb(255, 255, 255)'); assert.equal(panel.borderStyle, 'solid'); assert.equal(panel.borderWidth, '1px'); assert.ok(parseFloat(panel.radius) > 0); }
  for (const dialog of dom.dialogs) assert.ok(dialog.width <= dialog.clientWidth + 1);
  if (width === 390) assert.ok(dom.headings.every(heading => heading.rect.width <= 1 && heading.rect.height <= 1), 'Phone heading follows house topbar policy');
  proof.states.push({ route, width, label, shot, domPath, dom }); await save(); return dom;
}
async function button(text, selector = '') {
  const handle = await ctx.page.evaluateHandle((text, selector) => [...(selector ? document.querySelector(selector) : document).querySelectorAll('button')].find(element => element.textContent.trim() === text), text, selector);
  const element = handle.asElement(); assert.ok(element, `Button ${text}`); await element.click(); await ctx.settle(300);
}
const queries = ['/trucks?limit=1000', '/drivers?limit=1000', '/trailers?limit=1000', '/shipments/carrier-fleet-vehicles/all', '/shipments/dispatch-fleet?resource=EXTERNAL_CARRIER&limit=100'];
async function snapshot() { const rows = []; for (const query of queries) { const result = await ctx.apiGet(query); assert.equal(result.status, 200, query); rows.push({ query, ...result }); } return rows; }
try {
  await ctx.page.setCacheEnabled(false); await ctx.page.setRequestInterception(true);
  ctx.page.on('request', request => { if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method())) { proof.writes.push({ method: request.method(), url: request.url() }); void request.abort('blockedbyclient'); } else void request.continue(); });
  ctx.page.on('response', response => { if (response.status() >= 400) proof.httpErrors.push({ url: response.url(), status: response.status() }); });
  for (const route of (process.env.QA_RESOURCE_ROUTE ? [process.env.QA_RESOURCE_ROUTE] : ['/fleet/vehicles', '/fleet/drivers', '/fleet/external'])) for (const width of (process.env.QA_RESOURCE_WIDTH ? [Number(process.env.QA_RESOURCE_WIDTH)] : [390, 768, 1440])) {
    console.log(JSON.stringify({ route, width, step: 'start' })); const before = await snapshot(); await ctx.page.setViewport({ width, height: 900, hasTouch: width < 900 }); await ctx.goto(route); const top = await capture(route, width, 'top'); assert.ok(top.records.length > 0, 'Existing populated real resource catalog');
    await ctx.page.evaluate(() => { const scroller = document.querySelector('.main-scroll') || document.querySelector('.app-body'); if (scroller) scroller.scrollTo({top:scroller.scrollHeight,behavior:'instant'}); }); await ctx.settle(200); await capture(route, width, 'lower');
    await ctx.page.evaluate(() => { const scroller = document.querySelector('.main-scroll') || document.querySelector('.app-body'); if (scroller) scroller.scrollTo({top:0,behavior:'instant'}); }); await ctx.settle(300);
    if (route === '/fleet/vehicles') await button('Phân công lái xe', '.dispatch-catalogs__table tbody tr');
    else if (route === '/fleet/drivers') { const element = await ctx.page.$('.dispatch-catalogs__table tbody tr:first-child button.dispatch-catalogs__edit'); assert.ok(element); await element.click(); await ctx.settle(300); }
    else await button('Thêm xe ngoài');
    await ctx.page.waitForSelector('[role="dialog"]'); const opened = await capture(route, width, 'dialog-open'); assert.equal(opened.dialogs.length, 1);if(route==='/fleet/external')assert.ok(opened.inputs.some(input=>input.label==='Biển số'&&input.placeholder==='Ví dụ: 29A-12.34'),'Current sentence-case plate hint');
    const input = await ctx.page.$('[role="dialog"] input:not([type="hidden"])'); assert.ok(input); await input.click(); await ctx.settle(450); await capture(route, width, 'dialog-focused');
    if(route==='/fleet/external'){
      const picker=await ctx.page.$('[role=dialog] [role=combobox]');assert.ok(picker,'Carrier combobox');await picker.click();await ctx.page.waitForSelector('[role=option]');await ctx.settle(450);await capture(route,width,'carrier-picker');
      const carrier=before.find(r=>r.query==='/shipments/carrier-fleet-vehicles/all').body.catalog[0];
      const carrierResource=before.find(r=>r.query==='/shipments/dispatch-fleet?resource=EXTERNAL_CARRIER&limit=100').body.items.find(c=>c.id===carrier.carrierId);assert.ok(carrierResource,'Exact existing carrier resource');
      const optionHandle=await ctx.page.evaluateHandle(name=>[...document.querySelectorAll('[role=option]')].find(e=>e.textContent.includes(name)),carrierResource.name);
      const option=optionHandle.asElement();assert.ok(option,'Real carrier option');await option.click();await ctx.settle(200);
      const plateHandle=await ctx.page.evaluateHandle(()=>[...document.querySelectorAll('[role=dialog] label')].find(e=>e.textContent.trim()==='Biển số')?.control);const plate=plateHandle.asElement();assert.ok(plate);await plate.click();await ctx.page.keyboard.type(carrier.licensePlate);await ctx.settle(150);await capture(route,width,'existing-carrier-unsaved-draft');
    }
    await ctx.page.keyboard.press('Escape'); await ctx.settle(250);
    if (await ctx.page.$('[role="dialog"]')) await button('Hủy', '[role="dialog"]');
    const closed = await capture(route, width, 'cancelled'); assert.equal(closed.dialogs.length, 0);
    const after = await snapshot(); assert.deepEqual(after, before); proof.states.at(-1).readParity = { before, after }; assert.equal(proof.writes.length, 0); await save();
    console.log(JSON.stringify({ route, width, panelWhite: true, existingRecords: top.records.length, dialogCancel: true, parity: true, writes: 0 }));
  }
  assert.equal(proof.httpErrors.length, 0); assert.equal(ctx.errors.length, 0); proof.complete = true; await save(); console.log(JSON.stringify({ complete: true, states: proof.states.length, widths: [...new Set(proof.states.map(state => state.width))], routes: new Set(proof.states.map(state => state.route)).size }));
} finally { await save(); await ctx.browser.close(); }
