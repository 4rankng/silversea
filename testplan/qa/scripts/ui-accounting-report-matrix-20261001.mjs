// QA-AUDIT-UI-05: real report-scope clicks, monetary parity and horizontal reach.
// Run: node testplan/qa/scripts/ui-accounting-report-matrix-20261001.mjs
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
const output = path.resolve('qa/2026-10-01_comprehensive-audit_report-matrix');
await fs.mkdir(output, { recursive: true });
const evidence = [];
for (const role of ['ACCOUNTANT', 'ADMIN']) {
  const ctx = await createSession({ env, role, evidenceDir: output, runId: `report-matrix-${role}` });
  const writes = [];
  const reportResponses = [];
  ctx.page.on('request', (request) => {
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method())) writes.push({ method: request.method(), url: request.url() });
  });
  ctx.page.on('response', async (response) => {
    if (new URL(response.url()).pathname.endsWith('/phoi-phieu/report')) {
      reportResponses.push({ url: response.url(), status: response.status(), body: await response.json().catch(() => null) });
    }
  });
  try {
    for (const width of [390, 768, 1440]) {
      await ctx.page.setViewport({ width, height: 900 });
      await ctx.goto('/accounting/phoi-phieu');
      const scopeHandle = await ctx.page.evaluateHandle(() => [...document.querySelectorAll('button')]
        .find((button) => button.innerText.includes('Mặc định (của tôi với kế toán)')));
      const scope = scopeHandle.asElement();
      assert.ok(scope, 'actual report-scope control required');
      await scope.click();
      await ctx.page.waitForSelector('[role="option"]', { visible: true });
      const optionHandle = await ctx.page.evaluateHandle(() => [...document.querySelectorAll('[role="option"]')]
        .find((option) => option.innerText.trim() === 'Tất cả'));
      const option = optionHandle.asElement();
      assert.ok(option, 'all-scope option required');
      const responses = ['THU', 'TRA'].map((kind) => ctx.page.waitForResponse((response) => {
        const url = new URL(response.url());
        return url.pathname.endsWith('/phoi-phieu/report') && url.searchParams.get('kind') === kind
          && url.searchParams.get('scope') === 'ALL'
          && (response.status() === 200 || response.status() === 304);
      }, { timeout: 30000 }));
      await option.click();
      let reports;
      try { reports = await Promise.all(responses); }
      catch (error) {
        console.log(JSON.stringify({ role, width, reportResponses, errors: ctx.errors }));
        await ctx.screenshot(`${role.toLowerCase()}-${width}-scope-error`);
        throw error;
      }
      await ctx.settle(300);
      for (let index = 0; index < reports.length; index += 1) {
        const kind = index === 0 ? 'THU' : 'TRA';
        const response = reports[index];
        const data = await response.json();
        const tables = await ctx.page.$$('.ppc-report');
        assert.equal(tables.length, 2);
        const table = tables[index];
        await table.evaluate((element) => element.scrollIntoView({ block: 'center' }));
        const measured = await table.evaluate((element) => {
          const wrapper = element.parentElement;
          const box = (node) => {
            const rect = node.getBoundingClientRect();
            return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: rect.width, height: rect.height };
          };
          const textRects = (node) => {
            const range = document.createRange(); range.selectNodeContents(node);
            return [...range.getClientRects()].filter((rect) => rect.width > 0).map((rect) => ({ left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom }));
          };
          return {
            caption: element.caption.innerText, groupHeaders: [...element.querySelectorAll('thead th[colspan]')].map((head) => ({ text: head.innerText, colspan: head.colSpan })),
            wrapper: box(wrapper), scrollWidth: wrapper.scrollWidth, clientWidth: wrapper.clientWidth,
            headers: [...element.querySelectorAll('thead th')].map((cell) => ({ text: cell.innerText, cell: box(cell), content: textRects(cell) })),
            rows: [...element.querySelectorAll('tbody tr')].map((row) => ({
              party: row.cells[row.cells[0].colSpan === 2 ? 0 : 1].innerText,
              amounts: [...row.querySelectorAll('td.ppc-report__money')].map((cell) => ({ text: cell.querySelector('.money__num').innerText,
                cell: box(cell), content: textRects(cell.querySelector('.money__num')) })),
            })),
          };
        });
        assert.deepEqual(measured.groupHeaders, [{ text: kind === 'THU' ? 'PHẢI THU' : 'PHẢI TRẢ', colspan: 3 }]);
        const apiRows = [...data.rows, data.grand];
        assert.equal(measured.rows.length, apiRows.length);
        const fields = ['tienNang', 'tienHa', 'psKhac', 'tongPhaiThuTra', 'daThuTra', 'conLai'];
        for (let rowIndex = 0; rowIndex < apiRows.length; rowIndex += 1) {
          const amounts = measured.rows[rowIndex].amounts;
          assert.equal(amounts.length, fields.length);
          for (let column = 0; column < fields.length; column += 1) {
            const expected = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 0 }).format(Number(apiRows[rowIndex][fields[column]]));
            assert.equal(amounts[column].text, expected, `${kind} row${rowIndex} ${fields[column]}`);
            assert.equal(amounts[column].content.length, 1, 'money digits must remain one atomic line');
          }
        }
        for (const cell of [...measured.headers, ...measured.rows.flatMap((row) => row.amounts)]) {
          for (const content of cell.content) {
            assert.ok(content.left >= cell.cell.left - 0.5 && content.right <= cell.cell.right + 0.5,
              `${kind} cell text must not overlap its neighboring column: ${cell.text}`);
          }
        }
        const leftScreenshot = await ctx.screenshot(`${role.toLowerCase()}-${kind.toLowerCase()}-${width}-left`);
        const reach = await table.evaluate((element) => {
          const wrapper = element.parentElement; wrapper.scrollLeft = wrapper.scrollWidth;
          const wrapperBox = wrapper.getBoundingClientRect();
          const final = element.querySelector('thead th:last-child');
          const finalBox = final.getBoundingClientRect();
          return { scrollLeft: wrapper.scrollLeft, maxScroll: wrapper.scrollWidth - wrapper.clientWidth,
            finalHeader: final.innerText, finalRight: finalBox.right, wrapperRight: wrapperBox.right };
        });
        assert.ok(reach.maxScroll > 0 ? reach.scrollLeft >= reach.maxScroll - 1 : reach.scrollLeft === 0);
        assert.ok(reach.finalRight <= reach.wrapperRight + 1, 'last report column must remain horizontally reachable');
        const rightScreenshot = await ctx.screenshot(`${role.toLowerCase()}-${kind.toLowerCase()}-${width}-right`);
        evidence.push({ role, account: ctx.username, width, kind, query: `GET ${response.url()}`, data, measured, reach, leftScreenshot, rightScreenshot });
      }
    }
    assert.equal(writes.length, 0, 'report controls must perform no business write');
  } finally {
    await fs.writeFile(path.join(output, 'driver-assertions.json'), JSON.stringify({ evidence, writes, reportResponses }, null, 2));
    let timeout;
    try {
      await Promise.race([ctx.close(), new Promise((resolve) => {
        timeout = setTimeout(() => { console.log('Cleanup recovery: stopped this driver\'s Chromium after10s.'); ctx.browser.process()?.kill('SIGKILL'); resolve(); }, 10000);
      })]);
    } finally { clearTimeout(timeout); }
  }
}
console.log(JSON.stringify({ reports: evidence.length, screenshots: evidence.length * 2, numericalParity: true, horizontalReach: true, businessWrites: 0 }));
