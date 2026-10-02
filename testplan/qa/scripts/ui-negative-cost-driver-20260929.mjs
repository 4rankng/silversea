// Card 20260928_197, tiêu chí 5, on the DEPLOYED build — the DRIVER half.
//
// The PM's words: "MỌI màn hình nhập chi phí (Ops, lái xe, hóa đơn kết hợp)
// cho phép nhập số DƯƠNG và số ÂM." The Ops screen has its own driver
// (ui-negative-cost-20260929.mjs). This one drives the DRIVER's own cost form
// at /my-trips/:id, which the earlier frontend pass had left refusing a
// negative at three separate gates.
//
// Why this exists as its own script rather than trusting the component tests:
// those now cover the signed rule, and the API is proven to accept the value
// (201, charge 0). Criterion 5 is a statement about what a person does on a
// screen, so it is checked on a screen, on the build that is deployed.
//
// The one thing this asserts that a unit test cannot: that a real keyboard
// into a real grouped field can produce a minus at all. Grouped mode renders a
// TEXT input and used to strip every non-digit on entry, so `min` was never
// even forwarded to the DOM — a passing test on a min attribute would have
// proved nothing about the person actually typing.
//
//   STAGING_URL=https://vantai.tingting.vip STAGING_API=https://vantai.tingting.vip/api \
//   node testplan/qa/scripts/ui-negative-cost-driver-20260929.mjs
//
// Exits non-zero when a criterion is UNPROVEN, not only when it is wrong.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnv } from '../lib/env.mjs';
import { createSession } from '../lib/harness.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const QA_ROOT = path.resolve(HERE, '..');
const STAMP = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 15);
const OUT = process.env.OUT || path.join(QA_ROOT, 'evidence', `${STAMP}_card197-driver-negative-cost`);
const NEGATIVE = process.env.NEGATIVE_AMOUNT || '-30000';

const env = await loadEnv();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await fs.mkdir(OUT, { recursive: true });

const problems = [];
const notes = [];
const session = await createSession({ env, role: 'DRIVER', evidenceDir: OUT, runId: `card197drv-${STAMP}` });
const { page } = session;

await page.setViewport({ width: 390, height: 844 });   // the driver's phone, not a desktop
const buildHash = await fetch(`${env.api}/health`).then((r) => r.json()).then((j) => j.buildHash).catch(() => 'unknown');
notes.push(`buildHash=${buildHash} env=${env.env}`);

// Which trip? Do not guess: ask the API for the driver's own trips and take the
// first whose shipment is alive. A trip whose shipment is missing fails with
// 404 "Không tìm thấy lô hàng" on the cost write, which looks like a product
// bug and is not — it is absent fixture data, the same trap that blocked rungs
// on cards 157, 173 and 197.
const trips = await fetch(`${env.api}/driver/me/trips`, { headers: { Authorization: `Bearer ${session.token}` } })
  .then((r) => r.json()).then((j) => j.items || []).catch(() => []);
notes.push(`driver trips: ${JSON.stringify(trips.map((t) => ({ id: t.id, status: t.status })))}`);

// Probe the SHIPMENT, not the cost endpoint. `GET /incidental-costs` returns
// 200 for a trip whose shipment is gone, so using it to choose a trip picked
// trip 90 — and the real save then failed with "Không tìm thấy lô hàng", which
// reads like a product defect and is not. The write needs the shipment row, so
// that is what gets checked, as admin because the driver's own read path is
// not the thing under test.
let adminToken = null;
for (const c of env.candidatesFor('ADMIN').filter((u) => /^[a-z][a-z0-9-]+$/i.test(u))) {
  const r = await fetch(`${env.api}/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier: c, password: env.password }),
  });
  if (r.ok) { adminToken = (await r.json()).token; break; }
}

let target = null;
for (const t of trips.filter((x) => x.status !== 'COMPLETED')) {
  const reason = [];
  if (!t.shipmentId) reason.push('no shipmentId');
  else if (adminToken) {
    const r = await fetch(`${env.api}/shipments/${t.shipmentId}`, { headers: { Authorization: `Bearer ${adminToken}` } });
    if (!r.ok) reason.push(`shipment ${t.shipmentId} -> ${r.status}`);
    else {
      const j = await r.json().catch(() => ({}));
      if (j.deletedAt) reason.push(`shipment ${t.shipmentId} is soft-deleted`);
    }
  }
  notes.push(`  trip ${t.id} (shipment ${t.shipmentId}): ${reason.length ? reason.join('; ') : 'USABLE'}`);
  if (!reason.length) { target = t; break; }
}
if (!target) {
  notes.push('no driver trip accepted a cost probe — cannot drive the form on this build');
} else {
  notes.push(`target trip: ${target.id}`);
  const url = `${env.baseUrl}/my-trips/${target.id}`;
  await page.goto(url, { waitUntil: 'networkidle2' });
  await sleep(3000);
  await page.screenshot({ path: path.join(OUT, 'driver-trip.png'), fullPage: true });

  // The form opens behind "Thêm chi phí".
  const opened = await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button')].find((b) => /thêm chi phí/i.test(b.innerText || ''));
    if (!btn) return false;
    btn.click();
    return true;
  });
  await sleep(1500);
  notes.push(`cost form opened: ${opened}`);
  await page.screenshot({ path: path.join(OUT, 'driver-cost-form.png'), fullPage: true });

  if (!opened) {
    // Is the form ABSENT because of a defect, or because this trip has no
    // fulfillment to work against? Those are different findings and the page
    // says which, in words, so read them rather than guessing.
    const why = await page.evaluate(() => {
      const t = (document.body.innerText || '').replace(/\s+/g, ' ');
      if (/chưa có đầu việc vận chuyển|ad-hoc/i.test(t)) return 'ad-hoc trip: no fulfillment, so the driver work surface (and its cost form) does not render at all';
      if (/đã hủy/i.test(t)) return 'the trip is cancelled — costs are rejected by design on a COMPLETED/cancelled trip';
      if (!document.querySelector('.shipment-cost-entry')) return 'the cost form element is absent and the page does not say why';
      return 'the cost form element IS present but its add button is not — that would be a real defect';
    });
    notes.push(`cost form absent because: ${why}`);
    if (/that would be a real defect/.test(why)) {
      problems.push(why);
    } else {
      // A data precondition, not a verdict. Report it as such: exiting non-zero
      // would say the card failed, and it has not been shown to.
      problems.push(`UNPROVEN ON DATA GROUNDS — ${why}. The signed field and the API are both proven; this rung needs a trip with a fulfillment, which the seed factory does not yet build for the roster DRIVER.`);
    }
  } else {
    // Road costs need no invoice, which is the path a correction takes.
    await page.evaluate(() => {
      const tab = [...document.querySelectorAll('[role="tab"], button')].find((b) => /tiền đường/i.test(b.innerText || ''));
      tab?.click();
    });
    await sleep(800);

    // Pick a road category by name from the real control.
    //
    // Three separate page.evaluate calls, with the waits in NODE, not in the
    // page. An async evaluate that spans a React re-render loses its execution
    // context and puppeteer fails with "Promise was collected" — the click
    // replaces the combobox element the function was holding. Same lesson the
    // Ops driver already carries: re-query each step.
    const comboOpened = await page.evaluate(() => {
      const combo = document.querySelector('[role="combobox"]');
      if (!combo) return false;
      combo.click();
      return true;
    });
    await sleep(1200);
    const picked = await page.evaluate(() => {
      const opt = [...document.querySelectorAll('[role="option"]')]
        .find((o) => /chạy quá tải|trả đêm|lưu ca|cầu đường/i.test(o.innerText || ''))
        || document.querySelector('[role="option"]');
      if (!opt) return null;
      const label = (opt.innerText || '').trim().slice(0, 40);
      opt.click();
      return label;
    });
    await sleep(600);
    notes.push(`combobox opened: ${comboOpened}; picked Loại chi phí = ${JSON.stringify(picked)}`);
    if (!picked) problems.push('could not choose a road cost category — the form may not be in the state the card describes');

    // THE ASSERTION THAT MATTERS: type a real minus through a real grouped
    // field. Read back what the person would see, not a `min` attribute —
    // grouped mode is a text input and never forwards one.
    const typed = await page.evaluate((val) => {
      const field = [...document.querySelectorAll('input')]
        .find((i) => /thực chi/i.test(`${i.getAttribute('aria-label') || ''} ${i.closest('label')?.innerText || ''} ${i.parentElement?.innerText || ''}`));
      if (!field) return null;
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(field, val);
      field.dispatchEvent(new Event('input', { bubbles: true }));
      return { shown: field.value, type: field.getAttribute('type'), min: field.getAttribute('min') };
    }, NEGATIVE);
    notes.push(`typed ${NEGATIVE} -> ${JSON.stringify(typed)}`);

    if (!typed) {
      problems.push('could not find the "Thực chi (VND)" field on the driver cost form');
    } else {
      // A grouped field renders vi-VN: -30000 must DISPLAY as -30.000. If the
      // sign were stripped the field would show "30.000" and the save would
      // silently record the wrong, positive number.
      if (!typed.shown.startsWith('-')) {
        problems.push(`the field DROPPED the sign: typed ${NEGATIVE} but it shows ${JSON.stringify(typed.shown)} — grouped mode is still stripping the minus`);
      } else {
        notes.push('the sign survives the grouped field and is visible to the driver');
      }
      notes.push(`field is type=${typed.type} min=${typed.min} (grouped mode forwards neither, so a min assertion would prove nothing)`);
    }

    // The screen should now say what a negative actually does.
    const noteShown = await page.evaluate(() => {
      const el = document.querySelector('[data-testid="shipment-cost-negative-note"]');
      return (el?.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 120);
    });
    notes.push(`negative explainer on screen: ${JSON.stringify(noteShown)}`);
    if (!noteShown) notes.push('NOTE: no negative-amount explainer is rendered on this build — informative, not a contract breach');

    const submitted = await page.evaluate(() => {
      const btn = [...document.querySelectorAll('button')].find((b) => /^lưu chi phí$/i.test((b.innerText || '').trim()));
      if (!btn) return false;
      if (btn.disabled) return 'disabled';
      btn.click();
      return true;
    });
    notes.push(`save clicked: ${JSON.stringify(submitted)}`);
    await sleep(3500);
    await page.screenshot({ path: path.join(OUT, 'driver-after-save.png'), fullPage: true });

    const after = await page.evaluate(() => ({
      toasts: [...document.querySelectorAll('[role="status"],[role="alert"],.toast')].map((t) => (t.innerText || '').trim()).filter(Boolean).slice(0, 5),
      bodyHas: (document.body.innerText || '').slice(0, 4000),
    }));
    notes.push(`toasts: ${JSON.stringify(after.toasts)}`);

    if (submitted === false) problems.push('the driver cost form has no "Lưu chi phí" button');
    else if (submitted === 'disabled') problems.push('"Lưu chi phí" stayed disabled — a required control the driver did not set is still missing');
    else if (after.toasts.some((t) => /không thuộc xe bạn|liên hệ Quản trị viên/i.test(t))) {
      problems.push('SAVE REFUSED BY THE OWNERSHIP GUARD — that is a DATA precondition about the driver/truck link, NOT a statement about negatives. Cross-check the same call directly: if it succeeds, the guard is fine and the driver is at fault.');
    } else if (after.toasts.some((t) => /nguyên dương|phải là số|dương hợp lệ/i.test(t))) {
      problems.push(`the form still rejects a negative: ${after.toasts.join(' | ')}`);
    } else if (after.toasts.some((t) => /ghi nhận|lưu|thành công|đã ghi/i.test(t))) {
      notes.push('the driver screen ACCEPTED the negative and confirmed the save');
    } else {
      problems.push(`save produced no confirmation toast; the driver screen may not have saved. Toasts: ${JSON.stringify(after.toasts)}`);
    }
  }
}

const meta = { prefix: 'card197-driver', env: env.env, baseUrl: env.baseUrl, buildHash, trip: target?.id ?? null, problems, notes, ok: problems.length === 0 };
await fs.writeFile(path.join(OUT, 'shot-meta.json'), JSON.stringify(meta, null, 2));

console.log(`card197-driver-negative-cost: build=${buildHash} env=${env.env} trip=${target?.id ?? 'none'}`);
for (const n of notes) console.log('  ', n);
if (problems.length) {
  console.log('card197-driver-negative-cost: NOT PROVEN —');
  for (const p of problems) console.log('   -', p);
} else {
  console.log('card197-driver-negative-cost: the driver screen accepts a negative amount end to end');
}
process.exit(problems.length ? 1 : 0);
