// Card 121026141030 (FB-069 verify-fail of 101026163030) — LOCAL UI rung:
// the trip EDIT form (/trips/:id/edit, admin) must hydrate its numeric
// inputs through the shared strip-decimal axis — storage strings carry two
// dead decimals ("22920.00"), which the inputs must not echo. The lot list
// and detail header already format correctly (card 101026163030); this is
// the edit-form side of the same axis.
//
//   AC1 weight input:        "Trọng lượng (kg)" shows 22920 (not 22920.00)
//   AC2 supplement liters:   "Số lít bổ sung" shows 0 (not 0.00)
//   AC3 sweep, same class:   no input on the edit form holds a dead ".00"
//                            tail; money grouping intact (804.344)
//   AC4 read-only identity:  storage still 22920.00 / "0.00" before and
//                            after — the rung never writes
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer';
import { appendFileSync, writeFileSync } from 'node:fs';

const BASE = 'http://localhost:7175';
const API = 'http://localhost:3002/api';
const TRIP = 194; // local CREATED trip: container EISU8877090 22920.00, supplement 0.00
const QA = '/Volumes/LexarSSD/projects/silversea/qa';
const DRIVER_LOG = `${QA}/2026-10-12_fb069-edit-form_ui-driver.log`;
writeFileSync(DRIVER_LOG, '');
const step = (s, o = {}) => {
  const line = JSON.stringify({ at: new Date().ISOString ? new Date().toISOString() : String(new Date()), step: s, ...o });
  appendFileSync(DRIVER_LOG, line + '\n');
  console.log(line);
};

const login = await fetch(`${API}/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ identifier: 'admin', password: 'Abc123' }),
});
if (!login.ok) throw new Error(`login admin failed: ${login.status}`);
const token = (await login.json()).token;
step('login', { user: 'admin (Admin)', gotToken: Boolean(token) });

const apiWithAuth = (path) =>
  fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${token}` } }).then((r) => r.json());

// Storage identity, before the rung touches the page (AC4 baseline).
const before = await apiWithAuth(`/trips/${TRIP}/containers`);
const beforeDetail = await apiWithAuth(`/trips/${TRIP}`);
const storedWeight = before.items[0].cargoWeightKg;
const storedLiters = beforeDetail.fuelSupplementLiters;
step('storage-before', { trip: TRIP, storedWeight, storedLiters, storedSalary: beforeDetail.driverSalary });
assert.equal(storedWeight, '22920.00', 'fixture precondition: storage weight carries two decimals');
assert.equal(storedLiters, '0.00', 'fixture precondition: storage liters carry two decimals');

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 1000 });
  await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);

  await page.goto(`${BASE}/trips/${TRIP}/edit`, { waitUntil: 'networkidle0', timeout: 90000 })
    .catch(() => step('goto', { note: 'networkidle timeout — continue' }));
  await page.waitForSelector('input', { timeout: 60000 });
  await new Promise((r) => setTimeout(r, 1500)); // populate effect settles one render after the query

  const read = () =>
    page.evaluate(() => {
      const byLabelText = (text) => {
        const labels = [...document.querySelectorAll('label')];
        const label = labels.find((l) => l.textContent.trim().startsWith(text));
        if (!label) return null;
        if (label.htmlFor) return document.getElementById(label.htmlFor);
        const field = label.closest('.field') || label.parentElement;
        return field ? field.querySelector('input') : null;
      };
      const weight = byLabelText('Trọng lượng (kg)');
      const liters = byLabelText('Số lít bổ sung');
      const salary = byLabelText('Tiền lương lái xe (đ)');
      const dirtyInputs = [...document.querySelectorAll('input')]
        .map((i) => i.value)
        .filter((v) => /^\d+\.0+$/.test(v));
      return {
        weight: weight ? weight.value : null,
        liters: liters ? liters.value : null,
        salary: salary ? salary.value : null,
        dirtyInputs,
      };
    });

  // AC3 sweep first (before any scroll): no numeric input keeps a dead tail.
  let seen = await read();
  step('form-read', seen);
  assert.deepEqual(seen.dirtyInputs, [], `AC3 sweep: no input holds a dead ".00" tail (got ${JSON.stringify(seen.dirtyInputs)})`);

  // AC1 — weight input on the container record.
  assert.equal(seen.weight, '22920', `AC1: weight input hydrates as "22920" (got ${seen.weight})`);

  // AC2 — supplement liters.
  assert.equal(seen.liters, '0', `AC2: supplement liters hydrate as "0" (got ${seen.liters})`);

  // AC3 money grouping intact on the salary money input.
  assert.equal(seen.salary, '804.344', `AC3: salary money input renders grouped "804.344" (got ${seen.salary})`);

  // Screenshots per criterion: container section, fuel section, salary field.
  await page.evaluate(() => {
    const label = [...document.querySelectorAll('label')].find((l) => l.textContent.trim().startsWith('Trọng lượng (kg)'));
    label?.scrollIntoView({ block: 'center' });
  });
  await new Promise((r) => setTimeout(r, 800));
  await page.screenshot({ path: `${QA}/2026-10-12_fb069-edit-form_ui-1-weight.png` });

  await page.evaluate(() => {
    const label = [...document.querySelectorAll('label')].find((l) => l.textContent.trim().startsWith('Số lít bổ sung'));
    label?.scrollIntoView({ block: 'center' });
  });
  await new Promise((r) => setTimeout(r, 800));
  await page.screenshot({ path: `${QA}/2026-10-12_fb069-edit-form_ui-2-liters.png` });

  await page.evaluate(() => {
    const label = [...document.querySelectorAll('label')].find((l) => l.textContent.trim().startsWith('Tiền lương lái xe (đ)'));
    label?.scrollIntoView({ block: 'center' });
  });
  await new Promise((r) => setTimeout(r, 800));
  await page.screenshot({ path: `${QA}/2026-10-12_fb069-edit-form_ui-3-money.png` });
  step('screenshots', { ac1: 'ui-1-weight.png', ac2: 'ui-2-liters.png', ac3: 'ui-3-money.png' });

  // AC4 — read-only rung: storage identity unchanged after the visit.
  const after = await apiWithAuth(`/trips/${TRIP}/containers`);
  const afterDetail = await apiWithAuth(`/trips/${TRIP}`);
  step('storage-after', { trip: TRIP, weight: after.items[0].cargoWeightKg, liters: afterDetail.fuelSupplementLiters });
  assert.equal(after.items[0].cargoWeightKg, storedWeight, 'AC4: storage weight untouched');
  assert.equal(afterDetail.fuelSupplementLiters, storedLiters, 'AC4: storage liters untouched');

  step('RUNG PASS', { trip: TRIP, acs: ['AC1', 'AC2', 'AC3', 'AC4'] });
} finally {
  await browser.close();
}
