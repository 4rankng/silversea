// Full-guide Driver D — B.1 (Lái xe bqhuong xem chi phí khi kết thúc lô hàng):
//   /my-trips → a COMPLETED trip → detail → section "Chi phí lô hàng &
//   tiền đường" rendering the two tables (Chi phí lô hàng / Tiền đường —
//   card 141026230700 redesign). Read-only.
import {
  BASE, PIN, sleep, makeLogger, healthGate, login, api, psql, boot, tap, waitText, bodyText,
} from './fullguide-lib.mjs';
import { writeFileSync } from 'node:fs';

const logger = makeLogger('d-driver-costs');
const { step } = logger;
const results = {};
const record = (id, verdict, note) => { results[id] = { verdict, note }; step('VERDICT', { id, verdict, note }); };

await healthGate(logger);
const drv = await login('bqhuong');
if (!drv.token) throw new Error('bqhuong login failed');

// find a COMPLETED trip (prefer one with shipment costs)
const trips = await api(drv.token, 'GET', '/driver/me/trips');
const tripItems = trips.json?.items ?? trips.json ?? [];
step('d-trips', { count: tripItems.length, statuses: [...new Set(tripItems.map(t => t.status))].slice(0, 8) });
const done = tripItems.filter(t => /COMPLETED|HOAN_THANH|DONE/i.test(String(t.status)));
const target = done.find(t => t.shipmentId || t.lotId) ?? done[0] ?? tripItems[0];
step('d-target', { id: target?.id, status: target?.status, shipmentId: target?.shipmentId ?? null });
if (!target) throw new Error('no trips visible for bqhuong');

const { browser, page } = await boot({ token: drv.token, width: 768, height: 1000 });
try {
  await page.goto(`${BASE}/my-trips/${target.id}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(4000);
  const ready = await waitText(page, 'Chi phí', 20000);
  await sleep(2500);
  const text = await bodyText(page);
  await page.screenshot({ path: 'qa/2026-10-16_fullguide_b1_driver-trip-costs.png', fullPage: true });

  const sectionHeader = /chi phí lô hàng (&|và)? ?tiền đường/i.test(text) || (/chi phí lô hàng/i.test(text) && /tiền đường/i.test(text));
  const twoTables = /chi phí lô hàng/i.test(text) && /tiền đường/i.test(text);
  const buttons = {
    addCost: await page.evaluate(() => [...document.querySelectorAll('button, a')].some(b => /thêm chi phí/i.test(b.textContent || ''))),
    receipt: await page.evaluate(() => [...document.querySelectorAll('button, a')].some(b => /chứng từ|xem.*chứng từ/i.test(b.textContent || ''))),
    note: await page.evaluate(() => [...document.querySelectorAll('button, a')].some(b => /ghi chú cho kế toán|thêm ghi chú/i.test(b.textContent || ''))),
  };
  const costRows = await page.evaluate(() => {
    const tables = [...document.querySelectorAll('table')];
    return tables.map(t => ({ cap: t.caption?.textContent ?? t.closest('section, div')?.querySelector('h3, h4, legend')?.textContent ?? null, rows: t.querySelectorAll('tbody tr').length }));
  });
  step('d-detail', { url: page.url(), ready, sectionHeader, twoTables, buttons, costRows, snippet: text.slice(Math.max(0, text.search(/chi phí/i)), Math.max(0, text.search(/chi phí/i)) + 400) });
  record('B.1', ready && twoTables ? 'PASS' : 'FAIL', `trip ${target.id} detail: section=${sectionHeader}, twoTables=${twoTables}, buttons=${JSON.stringify(buttons)}, tables=${JSON.stringify(costRows)}`);
} catch (e) {
  step('driver-d-error', { error: String(e.message ?? e) });
  await page.screenshot({ path: 'qa/2026-10-16_fullguide_d_error.png', fullPage: true }).catch(() => {});
  record('B.1', 'FAIL', String(e.message ?? e));
} finally { await browser.close(); }

writeFileSync('qa/2026-10-16_fullguide_d-results.json', JSON.stringify({ pin: PIN, date: new Date().toISOString(), results }, null, 2));
step('SUMMARY', results);
