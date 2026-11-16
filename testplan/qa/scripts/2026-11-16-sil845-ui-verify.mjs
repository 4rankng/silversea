#!/usr/bin/env node
/** SIL-845 — /my-settlements/:id UI driver: flat 6-column phiếu on an OS- voucher. */
import { login, DEFAULT_FRONTEND, DEFAULT_BACKEND } from '../../../scripts/lib/http.mjs';
import { withSession, STANDARD_BROWSER_ARGS } from '../../../scripts/lib/ui-driver.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';

const DIR = 'qa/2026-11-16_sil845';
mkdirSync(DIR, { recursive: true });

const token = await login('hoangnh', { backend: DEFAULT_BACKEND, frontend: DEFAULT_FRONTEND });
await withSession(token, async (page, ctx) => {
  await page.setViewport({ width: 1440, height: 900 });
  await page.goto(`${DEFAULT_FRONTEND}/my-settlements/1009009`, { waitUntil: 'networkidle2' });
  await new Promise((r) => setTimeout(r, 1800));
  const m = await page.evaluate(() => {
    const text = document.body.textContent || '';
    const sheet = document.querySelector('.ops-settlement-sheet');
    const headers = [...document.querySelectorAll('.ops-settlement-sheet thead th')].map((e) => (e.textContent || '').trim());
    const totals = [...document.querySelectorAll('.ops-settlement-sheet__grand-row th, .ops-settlement-sheet__grand-row td')].map((e) => (e.textContent || '').trim());
    const sections = [...document.querySelectorAll('.ops-settlement-sheet [class*="section"], .ops-settlement-sheet tr, .ops-settlement-sheet p, .ops-settlement-sheet h4')].map((e) => (e.textContent || '').trim()).filter((t) => t.startsWith('A —') || t.startsWith('B —'));
    const oldGrid = document.querySelector('.settlement-expense-grid');
    return {
      pageTitle: document.querySelector('h1, h2')?.textContent?.trim() ?? null,
      sheetPresent: !!sheet,
      headers, totals, sections,
      oldGridPresent: !!oldGrid,
      rawFeeCodes: ['FEE_STEVEDORING', 'WAREHOUSE_LABOR', 'YARD_STORAGE', 'TIRE_WEIGH'].filter((c) => text.includes(c)),
      lotHeaders: (text.match(/Bill: R3M|· Bill:/g) || []).length,
      summaryCards: document.querySelectorAll('.settlement-detail__summary-card').length,
      threeTotals: ['Tổng có hóa đơn', 'Tổng không hóa đơn', 'TỔNG CỘNG QUYẾT TOÁN'].map((t) => text.includes(t)),
    };
  });
  console.log(JSON.stringify(m, null, 1));
  await page.screenshot({ path: `${DIR}/sil845-my-settlements-1009009.png`, fullPage: true });

  // In (HTML export through the session)
  const html = await page.evaluate(async () => {
    const res = await fetch('/api/forwarder/me/advance-settlements/1009009/export?format=html', { headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } });
    return { status: res.status, body: await res.text() };
  });
  const htmlOk = html.status === 200
    && html.body.includes('PHIẾU QUYẾT TOÁN OS-2611-W3FIX')
    && html.body.includes('TỔNG CỘNG QUYẾT TOÁN')
    && html.body.includes('Tên công ty')
    && !html.body.includes('FEE_');
  console.log('export html:', { status: html.status, ok: htmlOk, hasTotals: html.body.includes('780.000') });
  writeFileSync(`${DIR}/sil845-export.html`, html.body);

  // Excel export headers
  const xlsx = await page.evaluate(async () => {
    const res = await fetch('/api/forwarder/me/advance-settlements/1009009/export?format=xlsx', { headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } });
    return { status: res.status, type: res.headers.get('content-type'), len: (await res.blob()).size };
  });
  console.log('export xlsx:', xlsx);
  const pass = m.sheetPresent && !m.oldGridPresent && m.headers.length === 6
    && m.rawFeeCodes.length === 0 && m.lotHeaders === 0
    && m.threeTotals.every(Boolean) && m.pageTitle?.includes('PHIẾU QUYẾT TOÁN')
    && htmlOk && xlsx.status === 200;
  console.log(pass ? 'SIL-845 DRIVER PASS' : 'SIL-845 DRIVER FAIL');
  if (!pass) process.exitCode = 1;
  ctx.log.push(JSON.stringify({ m, html: { status: html.status, ok: htmlOk }, xlsx }));
}, { viewport: { width: 1440, height: 900 }, args: STANDARD_BROWSER_ARGS, artifactDir: 'qa', name: '2026-11-16_sil845-page' });
