// Actual local inbox refresh and record navigation; persisted sources unchanged.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { loadEnv, preflight } from '../lib/env.mjs';
import { createSession } from '../lib/harness.mjs';

const env = await loadEnv();
for (const url of [env.baseUrl, env.api]) assert.ok(['localhost', '127.0.0.1'].includes(new URL(url).hostname));
await preflight(env);
const output = path.resolve(process.env.QA_INBOX_EVIDENCE_DIR ?? 'qa/2026-10-01_comprehensive-audit_inbox-surfaces');
await fs.mkdir(output, { recursive: true });
const evidence = [];
const save = () => fs.writeFile(path.join(output, 'assertions.json'), JSON.stringify(evidence, null, 2) + '\n');
for (const role of process.env.QA_INBOX_ROLES?.split(',') ?? ['OPS', 'CUSTOMER']) {
  const ctx = await createSession({ env, role, evidenceDir: output, runId: `inbox-surfaces-${role}` });
  const material = [], requests = [];
  ctx.page.on('response', response => {
    if (response.url().includes('/api/')) requests.push({ url: response.url(), status: response.status(), method: response.request().method() });
  });
  await ctx.page.setRequestInterception(true);
  ctx.page.on('request', request => {
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method())) { material.push({ method: request.method(), url: request.url() }); void request.abort('blockedbyclient'); }
    else void request.continue();
  });
  const capture = async name => {
    const dom = await ctx.page.evaluate(() => ({
      url: location.pathname + location.search, text: document.body.innerText, overflow: document.documentElement.scrollWidth - innerWidth,
      records: [...document.querySelectorAll('.role-work-inbox__table tbody > tr[data-row-key]')].map(row => {
        const style = getComputedStyle(row), box = row.getBoundingClientRect();
        return { key: row.dataset.rowKey, text: row.innerText, background: style.backgroundColor, radius: style.borderRadius, border: style.borderLeftWidth, box: { x: box.x, width: box.width }, facts: [...row.querySelectorAll('dt')].map(field => field.innerText) };
      }),
      buttons: [...document.querySelectorAll('.role-work-inbox button')].filter(button => button.getBoundingClientRect().width > 0).map(button => ({ text: button.innerText, height: button.getBoundingClientRect().height, background: getComputedStyle(button).backgroundColor })),
    }));
    assert.equal(dom.overflow, 0, 'Inbox and destination must remain inside the viewport');
    const screenshot = await ctx.screenshot(`${role.toLowerCase()}-${name}`);
    const domPath = screenshot.replace(/\.png$/, '-dom.json');
    await fs.writeFile(domPath, JSON.stringify(dom, null, 2) + '\n');
    evidence.push({ role, account: ctx.username, name, screenshot, domPath, dom }); await save();
    return dom;
  };
  try {
    const prefix = role === 'OPS' ? '/forwarder/me/work-inbox' : '/portal/work-inbox';
    const states = ['ACTION', 'WAITING', 'DONE'];
    const sources = await Promise.all(states.map(view => ctx.apiGet(`${prefix}?view=${view}&page=1&limit=100`)));
    sources.forEach(source => assert.equal(source.status, 200));
    evidence.push({ role, account: ctx.username, queries: states.map(view => `${prefix}?view=${view}&page=1&limit=100`), sources }); await save();
    let index = sources.findIndex(source => source.body.items.some(item => role !== 'OPS' || item.title.includes('QA-ID02-OPS-130955')));
    if (index < 0) index = sources.findIndex(source => source.body.items.length > 0);
    if (index < 0) {
      assert.equal(role, 'CUSTOMER', 'A real populated operations queue is required');
      for (const width of [390, 768, 1440]) {
        await ctx.page.setViewport({ width, height: 900, hasTouch: width < 900 });
        await ctx.goto('/portal/shipments'); await ctx.page.waitForSelector('.role-work-inbox__refresh');
        const refreshed = ctx.page.waitForResponse(response => response.url().includes(prefix) && response.request().method() === 'GET');
        await ctx.page.click('.role-work-inbox__refresh'); assert.equal((await refreshed).status(), 200); await ctx.settle(450);
        const dom = await capture(`empty-queue-${width}-refreshed`); assert.ok(dom.text.includes('Không có việc trong nhóm này.'));
        assert.equal(dom.records.length, 0);
      }
      evidence.push({ role, notCovered: 'All three actual queues are empty for this linked customer; populated customer card/navigation is not covered.' }); await save();
      assert.equal(material.length, 0); assert.equal(ctx.errors.length, 0); assert.ok(requests.every(request => request.status < 400));
      continue;
    }
    const source = sources[index];
    const item = source.body.items.find(item => role !== 'OPS' || item.title.includes('QA-ID02-OPS-130955')) ?? source.body.items[0];
    const query = `${prefix}?view=${states[index]}&page=1&limit=100`;
    const suffix = index ? `?tab=${index}` : '';
    for (const route of role === 'OPS' ? ['/my-orders', '/my-forwarder-trips'] : ['/portal/shipments']) for (const width of [390, 768, 1440]) {
      await ctx.page.setViewport({ width, height: 900, hasTouch: width < 900 });
      const before = await ctx.apiGet(query); assert.equal(before.status, 200);
      await ctx.goto(route + suffix); await ctx.page.waitForSelector('.role-work-inbox__table'); await ctx.settle(450);
      const refreshed = ctx.page.waitForResponse(response => response.url().includes(prefix) && response.request().method() === 'GET');
      await ctx.page.click('.role-work-inbox__refresh'); assert.equal((await refreshed).status(), 200); await ctx.settle(450);
      const dom = await capture(`${route.replaceAll('/', '-')}-${width}-refreshed`);
      assert.ok(dom.records.some(record => record.key === item.id && record.text.includes(item.title)), 'Actual persisted title must appear');
      if (width < 1146) for (const record of dom.records) {
        assert.equal(record.background, 'rgb(255, 255, 255)'); assert.equal(record.radius, '12px'); assert.equal(record.border, '1px');
        assert.ok(record.box.x >= 0 && record.box.x + record.box.width <= width);
      }
      if (width === 390) assert.ok(dom.buttons.every(button => button.height >= 40), 'Canonical phone touch geometry');
      const row = await ctx.page.$(`[data-row-key=${JSON.stringify(item.id)}]`); assert.ok(row);
      await row.evaluate(element => element.scrollIntoView({ block: 'center' })); await row.focus();
      await capture(`${route.replaceAll('/', '-')}-${width}-keyboard-focused`);
      await ctx.page.keyboard.press('Enter'); await ctx.settle(700);
      const destination = item.nextAction?.targetRoute ?? item.targetRoute;
      assert.equal(new URL(ctx.page.url()).pathname, new URL(destination, env.baseUrl).pathname, 'Actual row navigation must use its existing target');
      await capture(`${route.replaceAll('/', '-')}-${width}-detail`);
      const after = await ctx.apiGet(query);
      // asOf is the read timestamp, not persisted product state. Retain both
      // raw reads but compare all other fields, including freshness/version.
      const { asOf: beforeReadTime, ...beforeState } = before.body;
      const { asOf: afterReadTime, ...afterState } = after.body;
      assert.equal(after.status, before.status); assert.deepEqual(afterState, beforeState, 'Persisted work inbox must remain unchanged');
      evidence.push({ role, route, width, object: { title: item.title, target: destination }, query, before, after, beforeReadTime, afterReadTime }); await save();
      console.log('UI DRIVEN', role, route, width, item.title, 'refresh + keyboard detail + read parity');
    }
    assert.equal(material.length, 0); assert.equal(ctx.errors.length, 0); assert.ok(requests.every(request => request.status < 400));
  } catch (error) {
    evidence.push({ role, failure: error.stack }); await save();
    await capture('failure').catch(() => {});
    throw error;
  } finally {
    evidence.push({ role, account: ctx.username, material, requests, errors: ctx.errors }); await save();
    const browserProcess = ctx.browser.process();
    await Promise.race([ctx.browser.close(), new Promise(resolve => setTimeout(() => { browserProcess?.kill('SIGKILL'); resolve(); }, 10000))]);
    ctx.browser.disconnect();
  }
}
