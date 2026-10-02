// QA-AUDIT-UI-02/04: actual read-only view/selection clicks on local data.
// Run: node testplan/qa/scripts/ui-workspace-tabs-20261001.mjs [--baseline]
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { loadEnv, preflight } from '../lib/env.mjs';
import { createSession } from '../lib/harness.mjs';

const baseline = process.argv.includes('--baseline');
const phase = baseline ? 'baseline' : 'after';
const output = path.resolve(`qa/2026-10-01_comprehensive-audit_workspace-tabs-${phase}`);
const env = await loadEnv();
for (const url of [env.baseUrl, env.api]) {
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(new URL(url).hostname), 'local target required');
}
await preflight(env);
await fs.mkdir(output, { recursive: true });
const entries = [];
const sessions = [];
const issues = [];
async function closeSession(ctx) {
  let timeout;
  try {
    await Promise.race([
      ctx.close(),
      new Promise((resolve) => {
        timeout = setTimeout(() => {
          console.log('Cleanup recovery: stopped this driver\'s Chromium after a 10s shutdown hang.');
          ctx.browser.process()?.kill('SIGKILL');
          resolve();
        }, 10000);
      }),
    ]);
  } finally { clearTimeout(timeout); }
}
const routes = [
  { path: '/accounting', selector: '.accounting-tabs', views: ['work', 'overview', 'transport'],
    headings: ['Công việc kế toán', 'Tổng quan kế toán', 'Đối chiếu vận tải'] },
  { path: '/advances', selector: '.advance-workspace__views', views: ['requests', 'settlements', 'ops-expenses'],
    headings: ['Yêu cầu tạm ứng', 'Phiếu hoàn ứng', 'Chi phí Ops'] },
];
try {
  for (const role of ['ACCOUNTANT', 'ADMIN']) {
    const ctx = await createSession({ env, role, evidenceDir: output, runId: `workspace-tabs-${phase}-${role}` });
    sessions.push(ctx);
    const settlementList = await ctx.apiGet('/advance-settlements?limit=1');
    assert.equal(settlementList.status, 200);
    const settlementId = settlementList.body.items?.[0]?.id;
    const proofPath = settlementId == null ? '/advance-settlements?limit=1' : `/advance-settlements/${settlementId}`;
    const before = await ctx.apiGet(proofPath);
    assert.equal(before.status, 200);
    const writeRequests = [];
    ctx.page.on('request', (request) => {
      if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method())) {
        writeRequests.push({ method: request.method(), url: request.url() });
      }
    });
    for (const width of [320, 390, 768]) {
      await ctx.page.setViewport({ width, height: 900 });
      for (const route of routes) {
        await ctx.goto(route.path);
        await ctx.page.waitForSelector(`${route.selector} [role="tab"]`);
        for (let index = 0; index < route.views.length; index += 1) {
          const buttons = await ctx.page.$$(`${route.selector} [role="tab"]`);
          assert.equal(buttons.length, route.views.length);
          await buttons[index].evaluate((button) => button.scrollIntoView({ block: 'nearest', inline: 'nearest' }));
          await buttons[index].click();
          await ctx.settle(200);
          const measured = await ctx.page.evaluate((selector) => {
            const group = document.querySelector(selector);
            const box = (element) => {
              const rect = element.getBoundingClientRect();
              return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom,
                width: rect.width, height: rect.height };
            };
            return {
              group: box(group), groupScrollWidth: group.scrollWidth, groupClientWidth: group.clientWidth,
              overflowX: getComputedStyle(group).overflowX,
              buttons: [...group.querySelectorAll('[role="tab"]')].map((button) => ({
                text: button.innerText, selected: button.getAttribute('aria-selected'), button: box(button),
                label: box(button.querySelector('.ds-tabs__label')), height: box(button).height,
                flexShrink: getComputedStyle(button).flexShrink,
              })),
              heading: document.querySelector('.advance-workspace__section-heading h2')?.innerText
                ?? document.querySelector('.accounting-page h1')?.innerText,
            };
          }, route.selector);
          const selected = measured.buttons.filter((button) => button.selected === 'true');
          assert.equal(selected.length, 1);
          assert.equal(selected[0].text, measured.buttons[index].text);
          const url = new URL(ctx.page.url());
          assert.equal(url.pathname, route.path);
          assert.equal(url.searchParams.get('view'), route.path === '/accounting' && index === 0 ? null : route.views[index]);
          assert.equal(measured.heading, route.headings[index]);
          const screenshot = await ctx.screenshot(`${role.toLowerCase()}-${route.path.slice(1)}-${width}-${route.views[index]}`);
          const entry = { role, account: ctx.username, width, route: route.path, view: route.views[index],
            url: url.pathname + url.search, screenshot, ...measured };
          entries.push(entry);
          for (const button of measured.buttons) {
            const label = button.label; const container = button.button;
            if (button.height > 40.5) issues.push({ ...entry, issue: 'height exceeds 40px', text: button.text, height: button.height });
            if (label.left < container.left - 0.5 || label.right > container.right + 0.5
              || label.top < container.top - 0.5 || label.bottom > container.bottom + 0.5) {
              issues.push({ ...entry, issue: 'label outside button', text: button.text });
            }
          }
          if (measured.groupScrollWidth > measured.groupClientWidth + 1
            && (route.path !== '/accounting' || measured.overflowX !== 'auto')) {
            issues.push({ ...entry, issue: 'horizontal group overflow without an owned scroll surface' });
          }
          const current = selected[0].button;
          assert.ok(current.left >= measured.group.left - 1 && current.right <= measured.group.right + 1,
            'selected tab must be visible inside its own scroll group');
        }
      }
    }
    const after = await ctx.apiGet(proofPath);
    assert.deepEqual(after, before, 'view switching must preserve the selected real financial record');
    assert.equal(writeRequests.length, 0, 'tabs must perform no business write');
    await fs.writeFile(path.join(output, `${role.toLowerCase()}-read-only-proof.json`), JSON.stringify({
      role, account: ctx.username, query: `GET ${env.api}${proofPath}`, before, after, writeRequests,
    }, null, 2));
    if (!baseline) {
      const assignmentPath = '/expense-accounting/phoi-phieu/truck-assignments';
      const assignmentBefore = await ctx.apiGet(assignmentPath);
      assert.equal(assignmentBefore.status, 200);
      assert.ok(assignmentBefore.body.unassignedTrucks?.length > 0, 'real unassigned vehicle required');
      const selections = [];
      for (const width of [320, 390, 768]) {
        await ctx.page.setViewport({ width, height: 900 });
        await ctx.goto('/accounting/phoi-phieu');
        const summary = await ctx.page.$('details:has(.ppc-assign-batch) > summary');
        assert.ok(summary, 'vehicle-assignment section required');
        await summary.click();
        await ctx.page.waitForSelector('.ppc-assign-batch__list label span', { visible: true });
        const labelText = await ctx.page.$('.ppc-assign-batch__list label span');
        await labelText.click();
        await ctx.settle(150);
        const selected = await ctx.page.evaluate(() => {
          const label = document.querySelector('.ppc-assign-batch__list label');
          return { plate: label.innerText, height: label.getBoundingClientRect().height,
            checked: label.querySelector('input').checked,
            status: document.querySelector('.ppc-assign-batch__count').innerText,
            coarsePointer: matchMedia('(pointer: coarse)').matches };
        });
        assert.equal(selected.checked, true);
        assert.match(selected.status, /Đã chọn 1\//);
        const expectedHeight = width < 768 || selected.coarsePointer ? 40 : 32;
        assert.equal(selected.height, expectedHeight);
        const screenshot = await ctx.screenshot(`${role.toLowerCase()}-vehicle-label-${width}-selected`);
        await labelText.click();
        await ctx.settle(150);
        const restored = await ctx.page.evaluate(() => ({
          checked: document.querySelector('.ppc-assign-batch__list input').checked,
          status: document.querySelector('.ppc-assign-batch__count').innerText,
        }));
        assert.equal(restored.checked, false);
        assert.match(restored.status, /Đã chọn 0\//);
        selections.push({ role, account: ctx.username, width, screenshot, selected, restored });
      }
      const assignmentAfter = await ctx.apiGet(assignmentPath);
      const selectedPlates = new Set(selections.map((selection) => selection.selected.plate));
      const selectedVehicleState = (snapshot) => ({
        status: snapshot.status,
        assignments: snapshot.body.assignments.filter((row) => selectedPlates.has(row.plate)),
        unassignedTrucks: snapshot.body.unassignedTrucks.filter((row) => selectedPlates.has(row.plate)),
      });
      assert.deepEqual(selectedVehicleState(assignmentAfter), selectedVehicleState(assignmentBefore),
        'picking a vehicle must preserve that vehicle\'s persisted assignment state');
      assert.equal(writeRequests.length, 0);
      await fs.writeFile(path.join(output, `${role.toLowerCase()}-vehicle-selection-proof.json`), JSON.stringify({
        query: `GET ${env.api}${assignmentPath}`, before: assignmentBefore, after: assignmentAfter, selections, writeRequests,
      }, null, 2));
    }
    await closeSession(ctx);
    sessions.splice(sessions.indexOf(ctx), 1);
  }
  await fs.writeFile(path.join(output, 'dom-assertions.json'), JSON.stringify({ entries, issues }, null, 2));
  console.log(JSON.stringify({ phase, clicks: entries.length, issues: issues.map(({ role, width, route, view, issue, text, height }) => ({ role, width, route, view, issue, text, height })) }, null, 2));
  if (!baseline) assert.equal(issues.length, 0, 'workspace tab geometry must satisfy the shared contract');
} finally {
  for (const ctx of sessions) await closeSession(ctx);
  await fs.writeFile(path.join(output, 'dom-assertions.json'), JSON.stringify({ entries, issues }, null, 2));
}
