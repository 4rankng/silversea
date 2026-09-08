// Round-9: data-driven verification of items 2, 3, 6-13, 19.
import { chromium } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
const env = yaml.load(fs.readFileSync(path.resolve('../prompts/qa-credentials.yaml'), 'utf8').split('staging:')[0]).local;
const OUT = path.resolve('../qa/2026-08-24_silver-feedback-r2');
const SCREEN = path.join(OUT, 'screens');
const results = {};
const log = (...a) => console.log(...a);
async function login(page, u, p) {
  await page.goto(`${env.baseUrl}/login`, { waitUntil: 'networkidle' });
  await page.fill('input[name="username"], input[type="text"]:not([readonly])', u);
  await page.fill('input[type="password"]', p);
  await Promise.all([page.waitForLoadState('networkidle'), page.click('button[type="submit"]')]);
  await page.waitForTimeout(1000);
}
async function apiGet(page, url) {
  return page.evaluate(async (u) => {
    const token = localStorage.getItem('token');
    const res = await fetch(u, { credentials: 'include', headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) return { __error: res.status };
    return await res.json();
  }, url);
}
(async () => {
  const browser = await chromium.launch();
  // ---------- CUS ----------
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const p = await ctx.newPage();
  await login(p, env.users.cus.username, env.users.cus.password);

  const all = await apiGet(p, '/api/shipments/cus-workspace?limit=200&page=1');
  const items = all?.items ?? [];
  log('list total:', all?.total, 'page items:', items.length);
  if (items[0]) log('keys:', Object.keys(items[0]).join(',').slice(0, 600));

  // item 2: mixed types
  const mixed = items.filter((it) => /\d+x\S+\s*\+/.test(it.containerSummary ?? ''))
    .slice(0, 5).map((it) => ({ id: it.id, bill: it.billOrBookNumber, s: it.containerSummary }));
  results.item2_mixed = mixed;
  log('mixed-type bills:', mixed.length);

  // item 3: multi-day bills (appointmentGroups with 2+ distinct localDate)
  const multiDay = [];
  for (const it of items) {
    const days = [...new Set((it.appointmentGroups ?? []).map((g) => g.localDate).filter(Boolean))];
    if (days.length >= 2) multiDay.push({ id: it.id, bill: it.billOrBookNumber, days, s: it.containerSummary, edd: it.expectedDeliveryDate });
    if (multiDay.length >= 5) break;
  }
  results.item3_multi_day = multiDay;
  log('multi-day bills:', JSON.stringify(multiDay).slice(0, 400));

  // scoped re-fetch for each multi-day bill's first day
  results.item3_scoped = [];
  for (const b of multiDay.slice(0, 3)) {
    const d = b.days[0];
    const m = d.match(/^(\d{4})-(\d{2})-(\d{2})/);
    const iso = m ? m[0] : d;
    const r = await apiGet(p, `/api/shipments/cus-workspace?limit=200&transportDateFrom=${iso}&transportDateTo=${iso}`);
    const row = (r?.items ?? []).find((x) => x.id === b.id);
    results.item3_scoped.push({ iso, bill: b.bill, full: b.s, scoped: row?.containerSummary ?? '(absent)', groupsScoped: (row?.appointmentGroups ?? []).map((g) => `${g.localDate}:${g.containerSummary}`) });
  }
  log('scoped comparisons:', JSON.stringify(results.item3_scoped, null, 1).slice(0, 800));

  // items 6-13: ledger with dateScope=all
  await p.goto(`${env.baseUrl}/shipments-detail?dateScope=all`, { waitUntil: 'networkidle' });
  await p.waitForSelector('table', { timeout: 20000 });
  await p.waitForTimeout(2000);
  results.ledger_columns = await p.evaluate(() => {
    const table = document.querySelector('table');
    const ths = Array.from(table.querySelectorAll('thead th'));
    const rows = Array.from(table.querySelectorAll('tbody tr'));
    return {
      headers: ths.map((th) => (th.innerText || '').replace(/\s+/g, ' ').trim()),
      widths: ths.map((th) => Math.round(th.getBoundingClientRect().width)),
      rowCount: rows.length,
      vehicleSamples: ths.findIndex((h) => (h.innerText || '').toLowerCase().includes('phân xe')) >= 0
        ? rows.slice(0, 12).map((r) => {
          const idx = ths.findIndex((h) => (h.innerText || '').toLowerCase().includes('phân xe'));
          return (r.querySelectorAll('td')[idx]?.innerText || '').replace(/\s+/g, ' ').trim();
        }).filter(Boolean)
        : [],
    };
  });
  await p.screenshot({ path: path.join(SCREEN, 'cus-10-detail-all-dates.png') });
  log('ledger rows:', results.ledger_columns.rowCount, 'headers:', results.ledger_columns.headers.join(' | '));
  log('vehicle cells:', JSON.stringify(results.ledger_columns.vehicleSamples.slice(0, 6)));

  // item 11: click first vehicle cell → editor
  const headers = results.ledger_columns.headers;
  const vIdx = headers.findIndex((h) => h.toLowerCase().includes('phân xe'));
  if (vIdx >= 0 && results.ledger_columns.rowCount > 0) {
    const cell = p.locator('table tbody tr').first().locator('td').nth(vIdx);
    await cell.click();
    await p.waitForTimeout(1200);
    const probe = await p.evaluate(() => {
      const pop = document.querySelector('[role="dialog"], [class*="editor"], [class*="popover"], [class*="overlay"]');
      return {
        popoverText: pop ? pop.innerText.replace(/\s+/g, ' ').trim().slice(0, 400) : null,
        hasSelect: document.querySelectorAll('select, .ds-uui-select').length,
      };
    });
    results.item11_editor = probe;
    await p.screenshot({ path: path.join(SCREEN, 'cus-11-vehicle-editor.png') });
    await p.keyboard.press('Escape');
    log('editor probe:', JSON.stringify(probe).slice(0, 300));
  }
  await ctx.close();

  // ---------- ĐIỀU VẬN: item 19 via API ----------
  const ctx2 = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const p2 = await ctx2.newPage();
  await login(p2, env.users.dieuvan.username, env.users.dieuvan.password);
  const un = await apiGet(p2, '/api/shipments?limit=5&status=READY_FOR_DISPATCH&includeDispatchSummary=true');
  results.item19_unscoped_summary = un?.dispatchSummary;
  const finding = {};
  for (const it of (un?.items ?? [])) {
    const edd = it.expectedDeliveryDate;
    if (edd) { finding[edd] = true; }
  }
  const day = Object.keys(finding)[0];
  if (day) {
    const sc = await apiGet(p2, `/api/shipments?limit=5&status=READY_FOR_DISPATCH&includeDispatchSummary=true&deliveryDateFrom=${day}&deliveryDateTo=${day}`);
    results.item19_day = day;
    results.item19_scoped_summary = sc?.dispatchSummary;
    results.item19_scoped_rows = (sc?.items ?? []).slice(0, 5).map((r) => ({ id: r.id, edd: r.expectedDeliveryDate, cargo: r.containerSummary ?? r.cargoSummary }));
  }
  log('dispatch summary unscoped:', JSON.stringify(un?.dispatchSummary));
  log('dispatch summary scoped', day ? `${day}:` : '(none)', JSON.stringify(results.item19_scoped_summary));
  await ctx2.close();

  fs.writeFileSync(path.join(OUT, 'round9-results.json'), JSON.stringify(results, null, 2));
  log('DONE');
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
