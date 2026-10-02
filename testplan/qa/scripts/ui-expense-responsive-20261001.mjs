// QA-AUDIT-UI-12 reopened: real detail/record/edit/validation/Cancel controls.
// Run from repo root: node testplan/qa/scripts/ui-expense-responsive-20261001.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { loadEnv, preflight } from '../lib/env.mjs';
import { createSession } from '../lib/harness.mjs';

const env = await loadEnv();
for (const url of [env.baseUrl, env.api]) assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(new URL(url).hostname));
await preflight(env);
const output = path.resolve('qa/2026-10-01_comprehensive-audit_ui12-responsive-final');
await fs.mkdir(output, { recursive: true });
const evidence = [];
const writes = [];
const details = [
  { suffix: 'chi-ho', label: 'Chi tiết chi hộ', selector: 'button[aria-label^="Chi tiết chi hộ"]' },
  { suffix: 'tien-duong', label: 'Chi tiết tiền đường', selector: '.ppc-col--money button' },
];
for (const role of ['ADMIN', 'ACCOUNTANT']) {
  const ctx = await createSession({ env, role, evidenceDir: output, runId: `ui12-responsive-${role}` });
  assert.equal(ctx.user.role, role);
  await ctx.page.setRequestInterception(true);
  ctx.page.on('request', request => {
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method())) {
      writes.push({ role, method: request.method(), url: request.url() }); void request.abort();
    } else void request.continue();
  });
  try {
    const board = await ctx.apiGet('/expense-accounting/phoi-phieu/rows?sortBy=grouped');
    assert.equal(board.status, 200);
    const populated = board.body.items.find(row => row.tripId === 196);
    assert.ok(populated, 'existing populated Bill required');
    let empty;
    for (const row of board.body.items.filter(row => row.chiHoThu == null && row.tienDuong == null).slice(0, 20)) {
      const snapshots = await Promise.all(details.map(detail => ctx.apiGet(`/expense-accounting/phoi-phieu/${row.tripId}/${detail.suffix}`)));
      if (snapshots.every(snapshot => snapshot.status === 200 && snapshot.body.rows.length === 0)) { empty = row; break; }
    }
    assert.ok(empty, 'real empty detail population required; no invented IDs');
    for (const width of [390, 768, 1440]) {
      await ctx.page.setViewport({ width, height: 900, hasTouch: width < 768 });
      await ctx.goto('/accounting/phoi-phieu');
      for (const item of [{ record: populated, filled: true }, { record: empty, filled: false }]) {
        const rowIndex = board.body.items.findIndex(row => row.tripId === item.record.tripId);
        for (const detail of details) {
          const query = `/expense-accounting/phoi-phieu/${item.record.tripId}/${detail.suffix}`;
          const before = await ctx.apiGet(query);
          assert.equal(before.status, 200);
          const row = await ctx.page.evaluateHandle(index => document.querySelectorAll('.ppc-board tbody tr')[index], rowIndex);
          const trigger = await row.asElement().$(detail.selector);
          assert.ok(trigger);
          await trigger.evaluate(button => button.scrollIntoView({ block: 'center', inline: 'end' }));
          await trigger.click();
          await ctx.page.waitForSelector('[role="dialog"][aria-modal="true"]', { visible: true });
          await ctx.settle(150);
          const text = await ctx.page.$eval('[role="dialog"]', node => node.innerText);
          assert.ok(text.includes(`${detail.label} ${item.record.billOrBooking?.trim() || 'Chưa có số Bill/Booking'}`));
          assert.ok(!text.includes(item.record.tripCode), 'internal trip code never displayed');
          const prefix = `${role.toLowerCase()}-${width}-${detail.suffix}-${item.filled ? 'filled' : 'empty'}`;
          const screenshots = [await ctx.screenshot(`${prefix}-opened`)];
          let geometry;
          let draftValue;
          let validation;
          let keyboardFocus;
          if (item.filled) {
            await ctx.page.keyboard.press('Tab');
            keyboardFocus = await ctx.page.evaluate(() => ({ tag: document.activeElement.tagName, label: document.activeElement.getAttribute('aria-label'), id: document.activeElement.id }));
            assert.equal(keyboardFocus.tag, 'INPUT', 'real Tab reaches the first editable amount');
            screenshots.push(await ctx.screenshot(`${prefix}-keyboard-focus`));
            geometry = await ctx.page.$eval('[role="dialog"] .record-table', table => {
              const rect = node => { const r = node.getBoundingClientRect(); return { left: r.left, right: r.right, width: r.width, height: r.height }; };
              const rangeRects = node => { const r = document.createRange(); r.selectNodeContents(node); return [...r.getClientRects()].filter(x => x.width > 0).map(x => ({ left: x.left, right: x.right })); };
              return {
                wrapper: rect(table.parentElement), scrollWidth: table.parentElement.scrollWidth, clientWidth: table.parentElement.clientWidth,
                rowDisplay: getComputedStyle(table.tBodies[0].rows[0]).display,
                rows: [...table.tBodies[0].rows].map(row => ({ background: getComputedStyle(row).backgroundColor, cells: [...row.cells].map(cell => ({ label: cell.dataset.label, text: cell.innerText, rect: rect(cell) })) })),
                money: [...document.querySelectorAll('[role="dialog"] .money__num')].map(num => ({ text: num.innerText, rects: rangeRects(num), owner: rect(num.closest('td') ?? num.closest('dd')) })),
                inputs: [...table.querySelectorAll('input')].map(input => {
                  const style = getComputedStyle(input); const canvas = document.createElement('canvas'); const context = canvas.getContext('2d'); context.font = style.font;
                  return { label: input.getAttribute('aria-label'), value: input.value, rect: rect(input), contentWidth: input.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight), textWidth: context.measureText(input.value).width };
                }),
              };
            });
            assert.ok(geometry.scrollWidth <= geometry.clientWidth + 1, 'every editable fact fits without horizontal panning');
            assert.equal(geometry.rowDisplay, geometry.clientWidth > 1100 ? 'table-row' : geometry.clientWidth <= 360 ? 'block' : 'grid');
            for (const row of geometry.rows) for (const cell of row.cells) {
              assert.ok(cell.label, 'every phone fact keeps a visible label');
              assert.ok(cell.rect.left >= geometry.wrapper.left - 1 && cell.rect.right <= geometry.wrapper.right + 1);
            }
            for (const input of geometry.inputs) assert.ok(input.textWidth <= input.contentWidth, `amount fully visible: ${input.label}`);
            for (const money of geometry.money) {
              assert.equal(money.rects.length, 1, 'Money remains atomic');
              assert.ok(money.rects[0].left >= money.owner.left - 1 && money.rects[0].right <= money.owner.right + 1);
            }
            const edit = await ctx.page.$('[role="dialog"] .record-table input:not([disabled])');
            const original = await edit.evaluate(input => input.value);
            async function replace(value) {
              await edit.click(); await edit.evaluate(input => { input.focus(); input.select(); });
              await ctx.page.keyboard.press('Backspace'); await edit.type(value); await ctx.settle(100);
            }
            await replace(String(Number(original.replace(/\D/g, '')) + 1));
            draftValue = await edit.evaluate(input => input.value);
            assert.ok(await ctx.page.$eval('[role="dialog"]', node => node.innerText.includes('Có thay đổi chưa lưu')));
            screenshots.push(await ctx.screenshot(`${prefix}-draft`));
            await replace(original.replace(/\D/g, ''));
            assert.equal(await edit.evaluate(input => input.value), original);
            assert.ok(await ctx.page.$eval('[role="dialog"]', node => !node.innerText.includes('Có thay đổi chưa lưu')));
            await ctx.page.$eval('[role="dialog"] .modal__body', body => { body.scrollTop = body.scrollHeight; });
            screenshots.push(await ctx.screenshot(`${prefix}-totals-restored`));
            const add = await ctx.page.evaluateHandle(() => [...document.querySelectorAll('[role="dialog"] button')].find(button => button.innerText === '＋ Thêm dòng'));
            await add.asElement().click();
            await ctx.page.waitForFunction(() => [...document.querySelectorAll('[role="dialog"]')].some(node => node.innerText.includes('Lưu khoản chi')));
            await ctx.settle(350);
            assert.equal(await ctx.page.$$eval('[role="dialog"][aria-modal="true"]', nodes => nodes.length), 1);
            const save = await ctx.page.evaluateHandle(() => [...document.querySelectorAll('[role="dialog"] button')].find(button => button.innerText === 'Lưu khoản chi'));
            await save.asElement().click();
            await ctx.settle(100);
            validation = await ctx.page.evaluate(() => ({ invalidInputs: [...document.querySelectorAll('[role="dialog"] input:invalid')].map(input => ({ id: input.id, required: input.required, missing: input.validity.valueMissing })), focusedId: document.activeElement.id }));
            assert.ok(validation.invalidInputs.some(input => input.missing), 'actual required-field validation blocks empty add');
            screenshots.push(await ctx.screenshot(`${prefix}-add-validation`));
            const closeDrawer = await ctx.page.$('[role="dialog"] button[aria-label="Đóng"]');
            assert.ok(closeDrawer); await closeDrawer.click();
            await ctx.page.waitForSelector('[role="dialog"] .record-table', { visible: true });
          } else {
            assert.ok(text.includes(detail.suffix === 'chi-ho' ? 'Chưa có khoản chi hộ' : 'Chưa có khoản tiền đường'));
            assert.equal(await ctx.page.$('[role="dialog"] .record-table'), null);
          }
          const cancel = await ctx.page.evaluateHandle(() => [...document.querySelectorAll('[role="dialog"] button')].find(button => button.innerText === 'Hủy'));
          assert.ok(cancel.asElement()); await cancel.asElement().click();
          await ctx.page.waitForSelector('[role="dialog"][aria-modal="true"]', { hidden: true });
          screenshots.push(await ctx.screenshot(`${prefix}-cancelled`));
          const after = await ctx.apiGet(query);
          assert.deepEqual(after, before, 'actual Cancel/add validation leaves persisted detail unchanged');
          assert.equal(writes.length, 0, 'no material write requested');
          evidence.push({ role, account: ctx.username, width, tripId: item.record.tripId, bill: item.record.billOrBooking, filled: item.filled, detail: detail.suffix, query, before, after, text, geometry, draftValue, validation, keyboardFocus, screenshots });
          console.log(`${prefix}: context, amounts, Cancel, API parity; writes0`);
        }
      }
    }
  } finally {
    await fs.writeFile(path.join(output, 'driver-assertions.json'), JSON.stringify({ evidence, writes, errors: ctx.errors }, null, 2));
    await ctx.close();
  }
}
console.log(JSON.stringify({ states: evidence.length, writes: writes.length }));
