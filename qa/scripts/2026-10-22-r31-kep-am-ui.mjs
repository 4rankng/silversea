// R31 cards 211026152138 (kẹp missing-capacity soft warn) + 211026213838
// (Ops/phơi money inputs reject negatives) — verify-first UI driver.
// LOCAL dev only — FE :7185 / BE :3012 of THIS worktree. Never staging.
//
//   node qa/scripts/2026-10-22-r31-kep-am-ui.mjs
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const FE = 'http://localhost:7185';
const API = 'http://localhost:3012/api';
const OUT = path.resolve('qa/2026-10-22-r31-kep-am');
fs.mkdirSync(OUT, { recursive: true });
const LOG = path.join(OUT, 'ui-driver.log');
fs.writeFileSync(LOG, '');
const log = (line) => { console.log(line); fs.appendFileSync(LOG, line + '\n'); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const check = (name, ok, detail = '') => {
  log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
};
const shot = (page, name) => page.screenshot({ path: path.join(OUT, `ui-${name}.png`) });

async function login(identifier) {
  const res = await fetch(`${API}/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier, password: 'Abc123' }),
  });
  if (res.status !== 200) throw new Error(`login ${identifier} -> ${res.status}`);
  const body = await res.json();
  return body.token ?? body.accessToken;
}
const send = async (token, apiPath, method = 'GET', payload, extraHeaders = {}) => {
  const res = await fetch(`${API}${apiPath}`, {
    method,
    headers: {
      'Content-Type': 'application/json', Authorization: `Bearer ${token}`,
      ...(payload ? { 'Idempotency-Key': crypto.randomUUID() } : {}),
      ...extraHeaders,
    },
    body: payload ? JSON.stringify(payload) : undefined,
  });
  const text = await res.text();
  let body; try { body = JSON.parse(text); } catch { body = text; }
  return { status: res.status, body };
};

/** DB evidence straight from the dev container (read-only queries only). */
function psql(query) {
  return execFileSync('docker', ['exec', 'ss-prod-db', 'psql', '-U', 'postgres', '-d', 'silversea', '-At', '-c', query], { encoding: 'utf8' }).trim();
}

const day = new Date(Date.now() + 24 * 3600e3).toISOString().slice(0, 10);
// Two same-day, non-overlapping shifts starting 30min from now (KEP needs the
// same departure day, not the same window).
const windows = [win(30, 90), win(120, 180)];
function win(fromMin, toMin) {
  return {
    start: new Date(Date.now() + fromMin * 60_000).toISOString(),
    end: new Date(Date.now() + toMin * 60_000).toISOString(),
  };
}
const freeWithin = (column, id) => `NOT EXISTS (
  SELECT 1 FROM trips t WHERE t.${column} = ${id} AND t.deleted_at IS NULL AND t.status IN ('CREATED','IN_TRANSIT')
    AND t.planned_start_at < '${new Date(windows[1].end).toISOString()}'::timestamptz
    AND coalesce(t.planned_end_at, t.planned_start_at + interval '8 hours') > '${new Date(windows[0].start).toISOString()}'::timestamptz)`;

(async () => {
  const runStartIso = new Date().toISOString();
  const admin = await login('admin');
  const dispatch = await login('dieuvan');
  const ops = await login('giaonhan');
  const kt = await login('ketoan');
  log('logged in admin/dieuvan/giaonhan/ketoan');

  // ── Setup: a rig whose moóc has NO type → issued trips carry NULL capacity
  // (the exact card-211026152138 state; `inferredVehicleCapacityKg(null)`). ──
  // Housekeeping: cancel THIS driver's earlier QA trips (BK-R31KEP lots) —
  // their windows hog every tractor/driver and hard-block a re-issue.
  const stale = psql(`SELECT t.id, t.version FROM trips t
    JOIN shipment_fulfillments sf ON sf.id = t.fulfillment_id
    JOIN shipments sh ON sh.id = sf.shipment_id
    WHERE sh.bl_number LIKE 'BK-R31KEP-%' AND t.deleted_at IS NULL
      AND t.status IN ('CREATED','IN_TRANSIT') ORDER BY t.id`).split('\n').filter(Boolean);
  for (const entry of stale) {
    const [tripId, version] = entry.split('|').map(Number);
    const cancel = await send(admin, `/trips/${tripId}/cancel`, 'POST', { expectedVersion: version, reason: 'R31 driver housekeeping' });
    log(`housekeeping: cancel trip ${tripId} → ${cancel.status}`);
  }

  const plate = `RS-R31-${Date.now() % 100000}`;
  const trailer = await send(admin, '/trailers', 'POST', { licensePlate: plate, type: null });
  check('setup: created type-null trailer', trailer.status === 201, JSON.stringify(trailer.body).slice(0, 120));
  const trailerId = trailer.body?.id;
  const freeTruckId = Number(psql(`SELECT tk.id FROM trucks tk WHERE tk.deleted_at IS NULL AND tk.status = 'ACTIVE' AND ${freeWithin('truck_id', 'tk.id')} ORDER BY tk.id LIMIT 1`));
  check('setup: free tractor found', Number.isInteger(freeTruckId) && freeTruckId > 0, `truckId=${freeTruckId}`);
  const freeDriverId = Number(psql(`SELECT d.id FROM drivers d JOIN users u ON u.id = d.user_id
    WHERE d.deleted_at IS NULL AND d.status = 'ACTIVE' AND u.deleted_at IS NULL AND u.status = 'ACTIVE' AND u.role = 'DRIVER'
      AND ${freeWithin('driver_id', 'd.id')} ORDER BY d.id LIMIT 1`));
  check('setup: free driver found', Number.isInteger(freeDriverId) && freeDriverId > 0, `driverId=${freeDriverId}`);
  const truck = await send(admin, `/trucks/${freeTruckId}`);
  const put = await send(admin, `/trucks/${freeTruckId}`, 'PUT', { licensePlate: truck.body.licensePlate, currentTrailerId: trailerId, status: 'ACTIVE' }, { 'If-Unmodified-Since': String(truck.body.updatedAt) });
  check('setup: coupled type-null trailer to the tractor', put.status === 200 || put.status === 201, JSON.stringify(put.body).slice(0, 160));

  // A FRESH lot (CUS contract via admin) with TWO 20' containers, submitted
  // for dispatch — nothing else touches it.
  const [routesRes, ctypesRes, portsRes, customersRes] = await Promise.all([
    send(admin, '/routes?limit=50'),
    send(admin, '/container-types?limit=50'),
    send(admin, '/ports?limit=50'),
    send(admin, '/customers?limit=100'),
  ]);
  const route = (routesRes.body?.items ?? []).find((r) => /KCN|TUYẾN|M57|HN|HCM/i.test(`${r.code ?? ''} ${r.name ?? ''}`)) ?? routesRes.body?.items?.[0];
  const type20 = (ctypesRes.body?.items ?? []).find((t) => /^20/.test(t.code ?? ''));
  const ports = portsRes.body?.items ?? [];
  const customer = (customersRes.body?.items ?? []).find((c) => c.status === 'ACTIVE' && !c.isCarrier);
  let sites = await send(admin, `/shipments/operational-sites?customerId=${customer.id}`);
  sites = { body: { items: (sites.body?.items ?? []).filter((x) => x.siteType === 'FACTORY' && (x.routeId == null || x.routeId === route.id)) } };
  if (!sites.body.items.length) {
    const made = await send(admin, '/shipments/operational-sites', 'POST', {
      customerId: customer.id, code: `R31KEP-${Date.now() % 100000}`,
      name: `Nhà máy R31 kẹp QA ${Date.now() % 100000}`, siteType: 'FACTORY',
      routeId: route.id, address: 'Khu công nghiệp QA, Việt Nam',
    });
    sites = { body: { items: made.status === 201 ? [made.body] : [] } };
  }
  const site = sites.body.items.at(-1);
  check('setup: reference data', Boolean(route && type20 && ports.length >= 1 && customer && site), `route=${route?.id} type20=${type20?.id} site=${site?.id}`);
  const bl = `BK-R31KEP-${Date.now()}`;
  const created = await send(admin, '/shipments', 'POST', {
    customerId: customer.id, tradeDirection: 'IMPORT', cargoMode: 'FCL',
    blNumber: bl, expectedDeliveryDate: day, cargoWeightKg: 14000,
  });
  check('setup: lot created', created.status === 201, JSON.stringify(created.body).slice(0, 120));
  const shipmentId = created.body?.shipment?.id ?? created.body?.id;
  const cur = await send(admin, `/shipments/${shipmentId}`);
  const curVersion = cur.body?.version ?? cur.body?.shipment?.version ?? 0;
  const serialBase = Number(String(Date.now()).slice(-6));
  const check10 = (prefix10) => {
    const MAP = { A: 10, B: 12, C: 13, D: 14, E: 15, F: 16, G: 18, H: 19, I: 20, J: 21, K: 22, L: 23, M: 24, N: 25, O: 26, P: 27, Q: 28, R: 29, S: 30, T: 31, U: 32, V: 34, W: 35, X: 36, Y: 37, Z: 38 };
    let sum = 0; const POW = [1, 2, 4, 8, 16, 32, 64, 128, 256, 512];
    [...prefix10].forEach((ch, i) => { sum += (/\d/.test(ch) ? Number(ch) : MAP[ch]) * POW[i]; });
    return `${prefix10}${sum % 11 === 10 ? 0 : sum % 11}`;
  };
  const conts = await send(admin, `/shipments/${shipmentId}/containers`, 'PUT', {
    expectedVersion: curVersion,
    containers: [0, 1].map((i) => ({
      containerNumber: check10(`TSTU${String(serialBase + i).padStart(6, '0')}`),
      containerTypeId: type20.id, routeId: route.id, operationalSiteId: site.id,
      pickupPortId: (ports[0] ?? ports[1]).id, dropoffPortId: (ports[1] ?? ports[0]).id,
      cargoWeightKg: 14000,
    })),
  });
  check('setup: two 20\' containers declared', conts.status === 200 || conts.status === 201, JSON.stringify(conts.body).slice(0, 120));
  const after = await send(admin, `/shipments/${shipmentId}`);
  const submitted = await send(admin, `/shipments/${shipmentId}/submit-for-dispatch`, 'POST', { expectedVersion: after.body?.version ?? after.body?.shipment?.version ?? curVersion });
  check('setup: lot submitted for dispatch', submitted.status === 200 || submitted.status === 201, JSON.stringify(submitted.body).slice(0, 100));

  const rows = await send(dispatch, `/shipments/dispatch-detail-plan-rows?q=${encodeURIComponent(bl)}&limit=50`);
  const candidates = (rows.body?.items ?? []).filter((r) => r.dispatch?.tripId == null && r.dispatch?.carrierType !== 'EXTERNAL').slice(0, 2);
  check('setup: two unissued 20\' rows found', candidates.length === 2, `got ${candidates.length}`);
  const trips = [];
  for (const [i, row] of candidates.entries()) {
    const issued = await send(dispatch, `/shipments/${shipmentId}/dispatch`, 'POST', {
      fulfillmentId: row.fulfillmentId, expectedVersion: row.version,
      plannedStartAt: windows[i].start, plannedEndAt: windows[i].end,
      endTimeConfirmed: true, carrierType: 'OWN',
      truckId: freeTruckId, driverId: freeDriverId, trailerId,
    });
    check(`setup: issued leg ${i + 1} (fulfillment ${row.fulfillmentId})`, issued.status === 201 || issued.status === 200, JSON.stringify(issued.body).slice(0, 140));
    trips.push(issued.body?.trip?.id);
  }
  // Seed one real DRIVER tiền-đường row on leg 1 (the driver's own app
  // contract) so the phoi-phieu tiền đường dialog has live data to drive.
  const driverUsername = psql(`SELECT u.username FROM drivers d JOIN users u ON u.id = d.user_id WHERE d.id = ${freeDriverId}`);
  const drv = await login(driverUsername);
  const inc = await send(drv, `/driver/me/trips/${trips[0]}/incidental-costs`, 'POST', {
    costType: 'PARKING', amount: 50000, occurredAt: day,
    feeName: 'R31 QA tiền đường', note: 'R31 driver seed',
  });
  check('setup: driver incidental cost recorded', inc.status === 201 || inc.status === 200, JSON.stringify(inc.body).slice(0, 120));
  const capA = psql(`SELECT vehicle_capacity_kg FROM trips WHERE id = ${trips[0]}`);
  const capB = psql(`SELECT vehicle_capacity_kg FROM trips WHERE id = ${trips[1]}`);
  check('setup: BOTH legs carry NULL capacity (the card state)', capA === '' && capB === '', `cap A='${capA}' cap B='${capB}'`);

  const browser = await puppeteer.launch({ headless: true, defaultViewport: { width: 1440, height: 900 } });
  try {
    const context = await browser.createBrowserContext();

    // ── UI 1: the pairing dialog must WARN and save, never block. ──
    const page = await context.newPage();
    await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), dispatch);
    await page.goto(`${FE}/dispatch-detail?q=${encodeURIComponent(bl)}`, { waitUntil: 'networkidle2', timeout: 60000 });
    await page.waitForSelector('button[aria-label="Ghép chuyến"]', { timeout: 30000 });
    const pairButtons = await page.$$('button[aria-label="Ghép chuyến"]');
    check('ui1: Ghép action rendered on the issued unpaired row', pairButtons.length >= 1, `count=${pairButtons.length}`);
    await shot(page, '01-grid-before-pair');
    await pairButtons[0].click();
    await page.waitForFunction(() => document.querySelectorAll('[role="dialog"] button[aria-haspopup="listbox"]').length >= 2, { timeout: 15000 });
    await page.screenshot({ path: path.join(OUT, 'ui-02-pair-dialog-open.png') });
    const pickFromDialog = async (index, optionText) => {
      const triggers = await page.$$('[role="dialog"] button[aria-haspopup="listbox"]');
      await triggers[index].click();
      await page.waitForFunction((txt) => [...document.querySelectorAll('[role="option"]')].some((o) => o.textContent.includes(txt)), { timeout: 10000 }, optionText);
      return page.evaluate((txt) => {
        const opt = [...document.querySelectorAll('[role="option"]')].find((o) => o.textContent.includes(txt) && o.getAttribute('aria-disabled') !== 'true');
        if (!opt) return null;
        const label = opt.textContent;
        opt.click();
        return label;
      }, optionText);
    };
    const kindPicked = await pickFromDialog(0, 'Kẹp — 2 cont');
    check('ui1: Kẹp kind picked', kindPicked === "Kẹp — 2 cont 20' chạy cùng lúc", String(kindPicked));
    await sleep(500);
    const triggers2 = await page.$$('[role="dialog"] button[aria-haspopup="listbox"]');
    await triggers2[1].click();
    await page.waitForFunction(() => [...document.querySelectorAll('[role="option"]')].filter((o) => o.getAttribute('aria-disabled') !== 'true' && !o.textContent.includes('Chọn lệnh ghép')).length > 0, { timeout: 10000 });
    const partnerPicked = await page.evaluate(() => {
      const options = [...document.querySelectorAll('[role="option"]')].filter((o) => o.getAttribute('aria-disabled') !== 'true' && !o.textContent.includes('Chọn lệnh ghép'));
      const target = options[0];
      if (!target) return null;
      const label = target.textContent;
      target.click();
      return label;
    });
    check('ui1: partner selected', Boolean(partnerPicked), String(partnerPicked).slice(0, 80));
    await shot(page, '03-pair-dialog-filled');
    await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => (b.textContent ?? '').trim() === 'Ghép chuyến').click());
    // THE assertion: no MISSING_CAPACITY block; the soft advisory appears.
    const outcome = await page.waitForFunction(() => {
      const text = document.body.innerText;
      if (text.includes('Thiếu thông tin tải trọng xe')) return { bad: true };
      if (text.includes('chưa khai tải trọng')) return { good: true, text };
      return null;
    }, { timeout: 20000, polling: 250 });
    const verdict = await outcome.jsonValue();
    await shot(page, '04-pair-after-submit');
    if (verdict.bad) {
      check('ui1: pair NOT blocked by missing capacity', false, 'Thiếu thông tin tải trọng xe still shown');
    } else {
      check('ui1: pair saved with the soft advisory', true, verdict.text.split('\n').find((l) => l.includes('chưa khai tải trọng'))?.slice(0, 140));
      check('ui1: warning names the dispatcher responsibility', verdict.text.includes('Điều vận chịu trách nhiệm kiểm tra tải'));
    }
    const pairRow = psql(`SELECT id, status, pair_kind, first_trip_id, second_trip_id FROM trip_pairs WHERE first_trip_id IN (${trips[0]},${trips[1]}) AND second_trip_id IN (${trips[0]},${trips[1]}) ORDER BY id DESC LIMIT 1`);
    check('ui1: trip_pairs row ACTIVE KEP', /ACTIVE\|KEP/.test(pairRow), pairRow || 'NO ROW');
    const linked = psql(`SELECT count(*) FROM trips WHERE id IN (${trips[0]},${trips[1]}) AND active_trip_pair_id IS NOT NULL`);
    check('ui1: both trips linked to the pair', linked === '2', `linked=${linked}`);

    // ── UI 2b: phoi-phieu tiền đường — the minus never enters the field. ──
    const td = await send(kt, `/expense-accounting/phoi-phieu/${trips[0]}/tien-duong`);
    const hasRows = (td.body?.rows ?? []).length > 0;
    check('ui2: tiền đường rows exist for the seeded trip', hasRows, `tripId=${trips[0]}`);
    if (hasRows) {
      const page2 = await context.newPage();
      await page2.evaluateOnNewDocument((t) => localStorage.setItem('token', t), kt);
      await page2.goto(`${FE}/accounting/phoi-phieu`, { waitUntil: 'networkidle2', timeout: 60000 });
      await sleep(3000);
      const billRef = String(bl);
      await page2.waitForFunction((bill) => [...document.querySelectorAll('tr')].some((tr) => tr.textContent?.includes(bill) && [...tr.querySelectorAll('button')].some((b) => (b.textContent ?? '').trim() === 'Xem chi tiết')), { timeout: 30000 }, billRef);
      // The lot's two legs share one Bill — open each row's detail until the
      // editable Thực chi input appears (only the seeded leg has one).
      let moneyBox = null;
      for (let attempt = 0; attempt < 2 && !moneyBox; attempt += 1) {
        await page2.evaluate((bill, nth) => {
          const tr = [...document.querySelectorAll('tr')].filter((row) => row.textContent?.includes(bill) && [...row.querySelectorAll('button')].some((b) => (b.textContent ?? '').trim() === 'Xem chi tiết'))[nth];
          const btn = tr && [...tr.querySelectorAll('button')].find((b) => (b.textContent ?? '').trim() === 'Xem chi tiết');
          btn?.click();
        }, billRef, attempt);
        moneyBox = await page2.waitForFunction(() => {
          const input = [...document.querySelectorAll('input')].find((el) => (el.getAttribute('aria-label') ?? '').includes('Thực chi dòng'));
          return input ?? null;
        }, { timeout: 8000 }).then((h) => h.asElement()).catch(() => null);
        if (!moneyBox && attempt === 0) {
          await page2.evaluate(() => [...document.querySelectorAll('[role="dialog"] button')].find((b) => (b.textContent ?? '').trim() === 'Hủy')?.click());
          await sleep(800);
        }
      }
      if (moneyBox) {
        await moneyBox.evaluate((el) => el.select());
        await page2.keyboard.press('Backspace');
        await sleep(200);
        await moneyBox.type('-5000', { delay: 40 });
        const value = await page2.evaluate((el) => el.value, moneyBox);
        check('ui2: tiền đường "Thực chi" typed "-5000" — minus stripped, digits kept', !value.includes('-') && value.replace(/\D/g, '') === '5000', `value="${value}"`);
        await shot(page2, '06-tienduong-minus-stripped');
      } else {
        check('ui2: tiền đường dialog money input located', false, 'no editable row opened');
      }
    }

    // ── UI 2a: Ops "Khai báo chi phí" — the card's primary surface. ──
    const page3 = await context.newPage();
    await page3.evaluateOnNewDocument((t) => localStorage.setItem('token', t), ops);
    await page3.goto(`${FE}/ops/orders`, { waitUntil: 'networkidle2', timeout: 60000 });
    const khaiBtn = await page3.waitForFunction(() => {
      const el = [...document.querySelectorAll('button')].find((b) => (b.textContent ?? '').includes('Khai chi phí'));
      return el ?? null;
    }, { timeout: 30000 });
    check('ui2: Ops orders list offers Khai chi phí', Boolean(khaiBtn));
    await (await khaiBtn.asElement()).click();
    await page3.waitForFunction(() => document.body.innerText.includes('Khai báo chi phí'), { timeout: 15000 });
    await sleep(600);
    // A real no-invoice fee type from THIS env's catalog.
    const feeTypes = await send(ops, '/ops/expense-types');
    const feeType = (feeTypes.body?.items ?? []).find((t) => t.requiresInvoice === false && (t.name ?? '').length <= 30) ?? (feeTypes.body?.items ?? []).find((t) => t.requiresInvoice === false);
    check('ui2: a no-invoice fee type exists', Boolean(feeType), feeType ? `${feeType.code}:${feeType.name}` : 'none');
    // 182 catalog options flip the Loại phí control into its SEARCHABLE
    // ComboBox variant — an input, not a button trigger. Real keystrokes drive
    // React Aria's filtering; ArrowDown + Enter commits the highlighted match.
    const comboHandle = await page3.evaluateHandle(() => {
      const row = [...document.querySelectorAll('.ops-fee-row')].find((el) => el.querySelector('input'));
      return row?.querySelector('input[role="combobox"]') ?? null;
    });
    const comboEl = comboHandle.asElement();
    check('ui2: Loại phí combobox located', Boolean(comboEl));
    await comboEl.click();
    await comboEl.type(feeType.name, { delay: 40 });
    await sleep(600);
    await page3.keyboard.press('ArrowDown');
    await page3.keyboard.press('Enter');
    await sleep(500);
    const comboValue = await page3.evaluate((el) => el.value, comboEl);
    check('ui2: fee type committed', comboValue.includes(feeType.name), `value="${comboValue}"`);
    const amountBox = await page3.waitForFunction(() => {
      const input = [...document.querySelectorAll('input')].find((el) => (el.labels ?? [])[0]?.textContent?.includes('Thực chi') || (el.getAttribute('aria-label') ?? '').includes('Thực chi'));
      return input ?? null;
    }, { timeout: 10000 }).then((h) => h.asElement()).catch(() => null);
    check('ui2: Thực chi money input located', Boolean(amountBox));
    await amountBox.type('-123000', { delay: 30 });
    const amountValue = await page3.evaluate((el) => el.value, amountBox);
    check('ui2: typed "-123000" — minus stripped to the positive 123.000', amountValue === '123.000', `value="${amountValue}"`);
    await shot(page3, '07-ops-expense-minus-stripped');
    // The no-invoice row charges nothing → the Ghi-chú gate applies. Real
    // keystrokes: the DOM-setter trick does not reliably reach React state.
    const noteHandle = await page3.evaluateHandle(() => {
      const note = [...document.querySelectorAll('textarea')].find((el) => (el.labels ?? [])[0]?.textContent?.includes('Ghi chú'));
      return note ?? null;
    });
    const noteEl = noteHandle.asElement();
    check('ui2: Ghi chú textarea located', Boolean(noteEl));
    await noteEl.click();
    await noteEl.type('R31 QA — phí không hóa đơn', { delay: 20 });
    await sleep(300);
    // Save, confirming through the duplicate heads-up (409) when it appears.
    for (let saveAttempt = 0; saveAttempt < 3; saveAttempt += 1) {
      const saveEnabled = await page3.waitForFunction(() => {
        const save = [...document.querySelectorAll('button')].find((b) => (b.textContent ?? '').trim() === 'Lưu');
        return save != null && !save.disabled;
      }, { timeout: 10000 }).then(() => true).catch(async () => {
        const errs = await page3.evaluate(() => [...document.querySelectorAll('[role="alert"], .form-error, p[style*="danger"]')].map((el) => el.textContent?.trim()).filter(Boolean));
        log(`ui2: Lưu still disabled — errors: ${errs.join(' | ').slice(0, 400) || '(none rendered)'}`);
        return false;
      });
      if (!saveEnabled) break;
      await page3.evaluate(() => [...document.querySelectorAll('button')].find((b) => (b.textContent ?? '').trim() === 'Lưu')?.click());
      const step = await page3.waitForFunction(() => {
        if (document.body.innerText.includes('Đã ghi nhận')) return 'saved';
        const confirm = [...document.querySelectorAll('button')].find((b) => (b.textContent ?? '').trim() === 'Tiếp tục lưu');
        return confirm != null ? 'duplicate' : null;
      }, { timeout: 12000, polling: 250 }).then((h) => h.jsonValue()).catch(() => null);
      if (step === 'saved') break;
      if (step === 'duplicate') {
        await page3.evaluate(() => [...document.querySelectorAll('button')].find((b) => (b.textContent ?? '').trim() === 'Tiếp tục lưu')?.click());
        continue;
      }
      const bodyText = await page3.evaluate(() => document.body.innerText).catch(() => '');
      log(`ui2: save attempt ${saveAttempt} stalled — text: ${bodyText.split('\n').filter((l) => l.trim()).slice(0, 20).join(' | ').slice(0, 500)}`);
      break;
    }
    const savedToast = await page3.waitForFunction(() => document.body.innerText.includes('Đã ghi nhận'), { timeout: 8000, polling: 250 }).then((h) => h.jsonValue()).catch(() => null);
    log(`ui2: toast seen = ${Boolean(savedToast)} (the DB row below is the side-effect proof)`);
    await shot(page3, '08-ops-expense-saved');
    const runStartNaiveUtc = new Date(runStartIso).toISOString().slice(0, 19).replace('T', ' ');
    const row = psql(`SELECT id, amount FROM ops_expense_entries WHERE paid_by_id = (SELECT id FROM users WHERE username = 'giaonhan') AND amount = 123000 AND created_at > '${runStartNaiveUtc}' ORDER BY id DESC LIMIT 1`);
    check('ui2: DB row amount=123000 (positive landed)', /\d+\|123000/.test(row), row || 'NO ROW');

    // ── API 2: the BE rule — a negative ops expense is refused BY NAME. ──
    const neg = await send(ops, '/ops/expenses', 'POST', {
      shipmentId, expenseTypeCode: feeType.code, amount: -50000, paidAt: day, note: 'R31 BE negative probe',
    });
    check('api2: POST /ops/expenses amount=-50000 → 400 with the named message', neg.status === 400 && JSON.stringify(neg.body).includes('không được âm'), `${neg.status} ${JSON.stringify(neg.body).slice(0, 140)}`);
    const zero = await send(ops, '/ops/expenses', 'POST', {
      shipmentId, expenseTypeCode: feeType.code, amount: 0, paidAt: day, note: 'R31 BE zero probe',
    });
    check('api2: amount=0 still refused', zero.status === 400 && JSON.stringify(zero.body).includes('không được bằng 0'), `${zero.status} ${JSON.stringify(zero.body).slice(0, 120)}`);
  } finally {
    await browser.close();
  }

  log(failures === 0 ? 'ALL GREEN' : `${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((error) => {
  log(`DRIVER ERROR: ${error?.stack ?? error}`);
  process.exit(2);
});
