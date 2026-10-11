// Card 101026043000 (FB-038/072, round 14) — LOCAL UI repro (rung 3):
// does "Chỉnh sửa điều phối" surface the duplicate-vehicle-time warning?
// Two DOM rows sharing a displayed slot get the SAME truck through the real
// dialog (carrier → vehicle → Lưu thay đổi). The second save must WARN
// (RIG_OVERLAP_COMPLETED confirm) instead of saving silently.
// Net-zero: every row plated by this run is cleared via the API afterwards.
//
// Evidence: qa/2026-10-11_card101026043000_ui-driver.log + qa/…_ui-*.png
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer';
import { appendFileSync, writeFileSync } from 'node:fs';

const BASE = 'http://localhost:7175';
const API = 'http://localhost:3002/api';
const EV = '/Volumes/LexarSSD/projects/silversea-prod/qa';
const DRIVER_LOG = `${EV}/2026-10-11_card101026043000_ui-driver.log`;
writeFileSync(DRIVER_LOG, '');
const step = (s, o = {}) => {
  const line = JSON.stringify({ at: new Date().toISOString(), step: s, ...o });
  appendFileSync(DRIVER_LOG, line + '\n');
  console.log(line);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const login = await fetch(`${API}/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ identifier: 'dungnv', password: 'Abc123' }),
});
if (!login.ok) throw new Error(`login failed: ${login.status}`);
const token = (await login.json()).token;
const h = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

const monthStamp = new Date().toISOString().slice(0, 7);
const rowsQuery = `${API}/shipments/dispatch-detail-plan-rows?limit=50&dateFrom=${monthStamp}-01&dateTo=${monthStamp}-31`;
const trucks = await (await fetch(`${API}/shipments/dispatch-fleet?resource=TRUCK&limit=5`, { headers: h })).json();
const truckItems = trucks.items ?? trucks.data ?? (Array.isArray(trucks) ? trucks : []);
assert.ok(Array.isArray(truckItems) && truckItems.length > 0, 'fixture: truck list readable');
const plate = String((truckItems.find((t) => t.licensePlate) ?? truckItems[0])?.licensePlate ?? '').trim();
assert.ok(plate, 'fixture: an own-fleet truck plate');

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
let warned = false;
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 1000 });
  await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);
  await page.goto(`${BASE}/dispatch-detail`, { waitUntil: 'networkidle0', timeout: 90000 }).catch(() => {});
  await sleep(3500);

  // Two DOM rows sharing a displayed slot (same-slot pair adjacent after the
  // run-time bundle sort), each with its own editor trigger.
  const pair = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('tbody tr')];
    const tagged = rows.map((tr) => ({
      slot: (tr.querySelector('td, th')?.innerText || '').trim().slice(0, 24),
      hasEditor: Boolean(tr.querySelector('[title^="Chỉnh sửa điều phối"]')),
    }));
    for (let i = 1; i < rows.length; i += 1) {
      const a = tagged[i - 1];
      const b = tagged[i];
      if (a.hasEditor && b.hasEditor && a.slot && a.slot === b.slot) {
        return { slot: a.slot, indexA: i - 1, indexB: i };
      }
    }
    return null;
  });
  step('pair', pair);
  assert.ok(pair, 'fixture: two editor rows sharing a displayed slot');

  // Target by row INDEX — the grid re-renders after each save, so DOM markers
  // set earlier do not survive; the sort order does.
  const saveRow = async (rowIndex) => {
    const opened = await page.evaluate((idx) => {
      const row = document.querySelectorAll('tbody tr')[idx];
      const btn = row?.querySelector('[title^="Chỉnh sửa điều phối"]');
      if (!btn) return false;
      btn.click();
      return true;
    }, rowIndex);
    await sleep(1300);
    if (!opened) return { opened: false };
    // Carrier: the first searchable trigger; pick its first option.
    await page.evaluate(() => {
      const dlg = document.querySelector('[role="dialog"]');
      const trig = dlg?.querySelector('.searchable-select__trigger');
      trig?.click();
    });
    await sleep(700);
    await page.evaluate(() => {
      const opt = [...document.querySelectorAll('[role="option"]')][0];
      if (opt) opt.click();
    });
    await sleep(600);
    // Vehicle: the second searchable trigger — type the plate, pick its option.
    await page.evaluate(() => {
      const dlg = document.querySelector('[role="dialog"]');
      const trigs = [...(dlg?.querySelectorAll('.searchable-select__trigger') ?? [])];
      trigs[1]?.click();
    });
    await sleep(700);
    await page.keyboard.type(plate);
    await sleep(1100);
    await page.evaluate((p) => {
      const opts = [...document.querySelectorAll('[role="option"]')];
      const hit = opts.find((o) => (o.textContent || '').includes(p)) ?? opts[0];
      if (hit) hit.click();
    }, plate);
    await sleep(700);
    const saved = await page.evaluate(() => {
      const dlg = document.querySelector('[role="dialog"]');
      const btn = [...(dlg?.querySelectorAll('button') ?? [])].find((b) => /^Lưu/.test((b.innerText || '').trim()));
      if (btn) { btn.click(); return true; }
      return false;
    });
    await sleep(2600);
    const state = await page.evaluate(() => ({
      dialogs: [...document.querySelectorAll('[role="dialog"]')].map((d) => (d.innerText || '').replace(/\s+/g, ' ').slice(0, 260)),
      alerts: [...document.querySelectorAll('[role="alert"]')].map((d) => (d.innerText || '').replace(/\s+/g, ' ').slice(0, 200)),
    }));
    return { opened, saved, state };
  };

  const first = await saveRow(pair.indexA);
  step('save-A', first);
  await page.screenshot({ path: `${EV}/2026-10-11_card101026043000_ui-1-after-save-a.png` });
  await page.keyboard.press('Escape');
  await sleep(700);

  const second = await saveRow(pair.indexB);
  step('save-B', second);
  await page.screenshot({ path: `${EV}/2026-10-11_card101026043000_ui-2-after-save-b.png` });
  warned = /trùng|Vẫn lưu|khung giờ|RIG_OVERLAP/i.test(JSON.stringify(second.state ?? {}));
  step('verdict', { warned, firstWarned: /trùng|Vẫn lưu|khung giờ/i.test(JSON.stringify(first.state ?? {})) });

  // Decline the confirm if it is open (row B stays unassigned).
  await page.evaluate(() => {
    const btns = [...document.querySelectorAll('[role="dialog"] button')];
    const no = btns.find((b) => /^(Không|Hủy|Huỷ)$/.test((b.innerText || '').trim()));
    if (no) no.click();
  });
  await sleep(600);
} finally {
  await browser.close();
  // Net-zero: clear every row this run plated.
  const fresh = await (await fetch(rowsQuery, { headers: h })).json();
  const list = fresh.items || fresh.data || fresh;
  for (const r of list) {
    if ((r.dispatch?.assignedPlate ?? '') === plate) {
      const cleared = await fetch(`${API}/shipments/dispatch-detail-plan-rows/${r.fulfillmentId}/plate`, {
        method: 'PATCH', headers: { ...h, 'Idempotency-Key': crypto.randomUUID() },
        body: JSON.stringify({ expectedVersion: r.version, clear: true }),
      });
      step('cleanup', { ful: r.fulfillmentId, cleared: cleared.status });
    }
  }
}

assert.ok(warned, 'the duplicate-vehicle-time save must surface the overlap warning');
step('RUNG PASS');
