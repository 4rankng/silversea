// QA-AUDIT-UI-09: real row selection and detail clicks on the workflow matrix.
// Run: node testplan/qa/scripts/ui-accounting-operational-board-20261001.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { loadEnv, preflight } from '../lib/env.mjs';
import { createSession } from '../lib/harness.mjs';

const env = await loadEnv();
for (const url of [env.baseUrl, env.api]) {
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(new URL(url).hostname), 'local target required');
}
await preflight(env);
const output = path.resolve('qa/2026-10-01_comprehensive-audit_operational-board-final');
await fs.mkdir(output, { recursive: true });
const evidence = [];
for (const role of ['ACCOUNTANT', 'ADMIN']) {
  const ctx = await createSession({ env, role, evidenceDir: output, runId: `operational-board-${role}` });
  const writes = [];
  ctx.page.on('request', (request) => {
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method())) writes.push({ method: request.method(), url: request.url() });
  });
  try {
    for (const width of [390, 768, 1440]) {
      await ctx.page.setViewport({ width, height: 900 });
      await ctx.goto('/accounting/phoi-phieu');
      const table = await ctx.page.$('.ppc-board');
      assert.ok(table, 'actual operational board required');
      const before = await ctx.apiGet('/expense-accounting/phoi-phieu/rows?sortBy=grouped');
      assert.equal(before.status, 200);
      const measured = await table.evaluate((element) => {
        const box = (node) => {
          const r = node.getBoundingClientRect();
          return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height };
        };
        const content = (node) => {
          const range = document.createRange(); range.selectNodeContents(node);
          return [...range.getClientRects()].filter((r) => r.width > 0).map((r) => ({ left: r.left, right: r.right, top: r.top, bottom: r.bottom }));
        };
        return {
          wrapper: box(element.parentElement), tableLayout: getComputedStyle(element).tableLayout,
          headers: [...element.querySelectorAll('th')].map((cell) => ({ text: cell.innerText, cell: box(cell), content: content(cell) })),
          rows: [...element.querySelectorAll('tbody tr')].map((row) => ({
            trip: row.querySelector('.ppc-col--lich-trinh .ppc-identity').innerText,
            locked: row.classList.contains('ppc-row--locked'),
            cells: [...row.cells].map((cell) => ({ text: cell.innerText, cell: box(cell), content: content(cell) })),
            identities: [...row.querySelectorAll('.ppc-identity')].filter((node) => node.innerText).map((node) => ({ text: node.innerText, content: content(node) })),
            buttons: [...row.querySelectorAll('button')].map((button) => ({ label: button.getAttribute('aria-label') ?? button.innerText, rect: box(button) })),
          })),
        };
      });
      assert.equal(measured.tableLayout, 'auto');
      assert.equal(measured.headers.length, 12);
      assert.equal(measured.rows.length, before.body.items.length);
      for (const cell of [...measured.headers, ...measured.rows.flatMap((row) => row.cells)]) {
        for (const text of cell.content) {
          assert.ok(text.left >= cell.cell.left - 0.5 && text.right <= cell.cell.right + 0.5,
            `cell content must remain inside its column: ${cell.text}`);
        }
      }
      for (const row of measured.rows) {
        for (const identity of row.identities) assert.equal(identity.content.length, 1, `identity must stay atomic: ${identity.text}`);
        for (const button of row.buttons) {
          assert.ok(button.rect.height >= (width < 768 ? 40 : 32), `house action target floor: ${width} ${button.label} ${button.rect.height}px`);
          assert.ok(button.rect.height <= 40.5, 'house control ceiling');
        }
      }
      const locked = await ctx.page.$('.ppc-board tbody tr.ppc-row--locked .ppc-col--lich-trinh .ppc-identity');
      assert.ok(locked, 'real locked row required');
      await locked.click();
      assert.equal(await ctx.page.$('.ppc-board tr[data-selected="true"]'), null, 'locked row stays inert');
      const eligible = await ctx.page.$('.ppc-board tbody tr.ppc-row--pickable .ppc-col--lich-trinh .ppc-identity');
      assert.ok(eligible, 'real eligible row required');
      const eligibleTrip = await eligible.evaluate((node) => node.innerText);
      const eligibleIndex = await eligible.evaluate((node) => [...node.closest('tbody').rows].indexOf(node.closest('tr')));
      await eligible.click();
      await ctx.page.waitForSelector('.ppc-board tr[data-selected="true"]');
      const selection = await ctx.page.$eval('.ppc-selection-hint', (node) => node.innerText);
      assert.equal(selection, 'Đã chọn 1 dòng');
      const selectedScreenshot = await ctx.screenshot(`${role.toLowerCase()}-${width}-row-selected`);
      await eligible.click();
      assert.equal(await ctx.page.$('.ppc-board tr[data-selected="true"]'), null);
      const reach = await table.evaluate((element) => {
        const wrapper = element.parentElement; wrapper.scrollLeft = wrapper.scrollWidth;
        const final = element.querySelector('thead th:last-child');
        return { scrollLeft: wrapper.scrollLeft, maxScroll: wrapper.scrollWidth - wrapper.clientWidth,
          finalHeader: final.innerText, finalRight: final.getBoundingClientRect().right,
          wrapperRight: wrapper.getBoundingClientRect().right,
          stickyIdentity: element.querySelector('tbody td:first-child').getBoundingClientRect().left,
          wrapperLeft: wrapper.getBoundingClientRect().left };
      });
      assert.ok(reach.maxScroll > 0 && reach.scrollLeft >= reach.maxScroll - 1);
      assert.ok(reach.finalRight <= reach.wrapperRight + 1);
      assert.ok(width > 640 ? Math.abs(reach.stickyIdentity - reach.wrapperLeft) <= 1
        : reach.stickyIdentity < reach.wrapperLeft,
      'identity stays pinned on wider canvases and releases phone space for other columns');
      const rightScreenshot = await ctx.screenshot(`${role.toLowerCase()}-${width}-right`);
      const noteReach = await table.evaluate((element, viewportWidth) => {
        const wrapper = element.parentElement;
        const heads = element.querySelectorAll('thead th');
        const proof = [];
        for (const index of [9, 10, 11]) {
          const wrapperBox = wrapper.getBoundingClientRect();
          const safeLeft = wrapperBox.left + (viewportWidth > 640 ? heads[0].getBoundingClientRect().width : 0);
          const cell = heads[index];
          const maxScroll = wrapper.scrollWidth - wrapper.clientWidth;
          wrapper.scrollLeft = Math.max(0, Math.min(maxScroll, wrapper.scrollLeft + cell.getBoundingClientRect().left - safeLeft));
          const cellBox = cell.getBoundingClientRect();
          proof.push({ text: cell.innerText, scrollLeft: wrapper.scrollLeft, safeLeft,
            left: cellBox.left, right: cellBox.right, wrapperRight: wrapperBox.right });
        }
        return proof;
      }, width);
      for (const note of noteReach) assert.ok(note.left >= note.safeLeft - 1 && note.right <= note.wrapperRight + 1,
        `every final note track is fully reachable beyond the sticky identity: ${note.text}`);
      await table.evaluate((element) => { element.parentElement.scrollLeft = 0; });
      const chosen = before.body.items[eligibleIndex];
      assert.equal(eligibleTrip, chosen.billOrBooking?.trim() || 'Chưa có số Bill/Booking');
      assert.ok(chosen, 'chosen real trip API record required');
      const detailProof = [];
      for (const detail of [
        { suffix: 'chi-ho', selector: 'button[aria-label^="Chi tiết chi hộ"]', label: 'Chi tiết chi hộ' },
        { suffix: 'tien-duong', selector: '.ppc-col--money button', label: 'Chi tiết tiền đường' },
      ]) {
        const query = `/expense-accounting/phoi-phieu/${chosen.tripId}/${detail.suffix}`;
        const initial = await ctx.apiGet(query);
        assert.equal(initial.status, 200);
        const rowHandle = await ctx.page.evaluateHandle((index) => document.querySelectorAll('.ppc-board tbody tr')[index], eligibleIndex);
        const trigger = await rowHandle.asElement().$(detail.selector);
        assert.ok(trigger, 'actual detail trigger required');
        await trigger.evaluate((button) => button.scrollIntoView({ block: 'center', inline: 'end' }));
        await trigger.click();
        await ctx.page.waitForSelector('[role="dialog"][aria-modal="true"]', { visible: true });
        await ctx.settle(300);
        const dialogText = await ctx.page.$eval('[role="dialog"]', (node) => node.innerText);
        assert.ok(dialogText.includes(`${detail.label} ${eligibleTrip}`));
        assert.ok(!dialogText.includes(chosen.tripCode), 'detail never displays an internal trip code');
        assert.equal(await ctx.page.$$eval('[role="dialog"][aria-modal="true"]', (nodes) => nodes.length), 1);
        const matrix = await ctx.page.$('[role="dialog"] .phoi-detail-matrix');
        assert.ok(matrix, 'shared expense matrix required');
        const geometry = await matrix.evaluate((element) => {
          const box = (node) => { const r = node.getBoundingClientRect(); return { left: r.left, right: r.right, width: r.width }; };
          const textRects = (node) => { const r = document.createRange(); r.selectNodeContents(node); return [...r.getClientRects()].filter((x) => x.width > 0).map((x) => ({ left: x.left, right: x.right })); };
          return { layout: getComputedStyle(element).tableLayout,
            heads: [...element.querySelectorAll('th')].map((cell) => ({ text: cell.innerText, box: box(cell), content: textRects(cell) })),
            money: [...element.querySelectorAll('.money__num')].map((num) => ({ text: num.innerText, cell: box(num.closest('td')), content: textRects(num) })),
            inputs: [...element.querySelectorAll('input')].map((input) => {
              const style = getComputedStyle(input); const canvas = document.createElement('canvas'); const context = canvas.getContext('2d');
              context.font = style.font; return { label: input.getAttribute('aria-label'), value: input.value, box: box(input),
                contentWidth: input.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight), textWidth: context.measureText(input.value).width };
            }),
          };
        });
        assert.equal(geometry.layout, 'auto');
        for (const head of geometry.heads) for (const text of head.content) {
          assert.ok(text.left >= head.box.left - 0.5 && text.right <= head.box.right + 0.5, 'dialog heading stays in its cell');
        }
        for (const money of geometry.money) {
          assert.equal(money.content.length, 1, 'dialog money stays atomic');
          assert.ok(money.content[0].left >= money.cell.left - 0.5 && money.content[0].right <= money.cell.right + 0.5);
        }
        for (const input of geometry.inputs) assert.ok(input.textWidth <= input.contentWidth, `editable money stays fully readable: ${input.label}`);
        const edit = await ctx.page.$('[role="dialog"] .phoi-detail-matrix input:not([disabled])');
        assert.ok(edit, 'real editable expense row required');
        await edit.evaluate((input) => input.scrollIntoView({ block: 'center', inline: 'end' }));
        const original = await edit.evaluate((input) => input.value);
        const draft = String(Number(original.replace(/\D/g, '')) + 1);
        async function replace(value) {
          await edit.click();
          await edit.evaluate((input) => { input.focus(); input.select(); });
          const selection = await edit.evaluate((input) => [input.selectionStart, input.selectionEnd, input.value.length]);
          assert.deepEqual(selection, [0, selection[2], selection[2]], 'native full-value selection required');
          await ctx.page.keyboard.press('Backspace'); await edit.type(value);
          await ctx.settle(100);
        }
        await replace(draft);
        const draftValue = await edit.evaluate((input) => input.value);
        assert.equal(Number(draftValue.replace(/\D/g, '')), Number(draft));
        const draftScreenshot = await ctx.screenshot(`${role.toLowerCase()}-${width}-${detail.suffix}-draft`);
        await replace(original.replace(/\D/g, ''));
        assert.equal(await edit.evaluate((input) => input.value), original);
        const dialogReach = await matrix.evaluate((element) => {
          const wrapper = element.parentElement; wrapper.scrollLeft = wrapper.scrollWidth;
          return { left: wrapper.scrollLeft, max: wrapper.scrollWidth - wrapper.clientWidth,
            lastRight: element.querySelector('thead th:last-child').getBoundingClientRect().right, wrapperRight: wrapper.getBoundingClientRect().right };
        });
        assert.ok(dialogReach.left >= dialogReach.max - 1 && dialogReach.lastRight <= dialogReach.wrapperRight + 1);
        const screenshot = await ctx.screenshot(`${role.toLowerCase()}-${width}-${detail.suffix}-restored-right`);
        const close = await ctx.page.$('[role="dialog"] button[aria-label="Đóng"]');
        assert.ok(close, 'actual modal close control required');
        await close.click();
        await ctx.page.waitForSelector('[role="dialog"][aria-modal="true"]', { hidden: true });
        const final = await ctx.apiGet(query);
        assert.deepEqual(final, initial, 'opening/closing detail leaves persisted financial state unchanged');
        detailProof.push({ query, before: initial, after: final, dialogText, screenshot, geometry, original, draftValue, draftScreenshot, dialogReach });
      }
      assert.equal(writes.length, 0, 'selection and detail navigation perform no business write');
      evidence.push({ role, account: ctx.username, width, query: 'GET /expense-accounting/phoi-phieu/rows?sortBy=grouped', before,
        measured, selection, eligibleTrip, selectedScreenshot, reach, rightScreenshot, noteReach, detailProof });
    }
  } finally {
    await fs.writeFile(path.join(output, 'driver-assertions.json'), JSON.stringify({ evidence, writes, errors: ctx.errors }, null, 2));
    let timeout;
    try { await Promise.race([ctx.close(), new Promise((resolve) => {
      timeout = setTimeout(() => { console.log('Cleanup recovery: stopped this driver\'s owned Chromium after10s.'); ctx.browser.process()?.kill('SIGKILL'); resolve(); }, 10000);
    })]); } finally { clearTimeout(timeout); }
  }
}
console.log(JSON.stringify({ states: evidence.length, detailDialogs: evidence.length * 2, selectionClicks: evidence.length * 3,
  horizontalReach: true, businessWrites: 0 }));
