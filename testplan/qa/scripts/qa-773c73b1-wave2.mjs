// Muse QA wave 2 — Cont SilverSea money jump (§2.2), spec-gap 92, spec-gap 86,
// cards 171026004331/171026004332, card 162f2d77, and CUS shadow-line toggle.
// STAGING only, pin c2288933.
// Usage: EXPECT_BUILD=c2288933 node testplan/qa/scripts/qa-773c73b1-wave2.mjs
import {
  BASE, API, PIN, sleep, uuid, makeLogger, healthGate, login, api, psql, boot, tap, bodyText,
} from './fullguide-lib.mjs';
import ExcelJS from '../../../backend/node_modules/exceljs/dist/exceljs.js';
import { writeFileSync } from 'node:fs';

const SCOPE = 'qa773c73b1-wave2';
const logger = makeLogger(SCOPE);
const { step, log } = logger;
const results = {};
const record = (id, verdict, note) => { results[id] = { verdict, note }; step('VERDICT', { id, verdict, note }); };
const shot = (page, name) => page.screenshot({ path: `qa/2026-10-17_${SCOPE}_${name}.png`, fullPage: true });

await healthGate(logger);
const admin = await login('admin');
const cus = await login('thanhdc');
const acct = await login('hoapt');
if (!admin.token || !cus.token || !acct.token) throw new Error('logins failed');
step('logins', { admin: !!admin.token, cus: !!cus.token, acct: !!acct.token });

const hex = uuid().slice(0, 6);
const today = new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);
const customers = await api(admin.token, 'GET', '/customers?limit=50');
const customerList = (customers.json?.items ?? customers.json ?? []).filter((c) => !c.deletedAt && c.status === 'ACTIVE');
const customer = customerList.find((c) => c.id === 1) ?? customerList[0];
const routes = await api(admin.token, 'GET', '/routes?limit=50');
const routeList = (routes.json?.items ?? routes.json ?? []).filter((r) => !r.deletedAt);
const route = routeList.find((r) => r.id === 11) ?? routeList[0];
const classes = await api(admin.token, 'GET', '/vehicle-size-classes?limit=50');
const classList = classes.json?.items ?? classes.json ?? [];
const cont20Class = classList.find((c) => c.code === 'CONT20') ?? classList.find((c) => c.isContainer);
const cls5t = classList.find((c) => c.code === '5T') ?? classList.find((c) => !c.isContainer);

step('catalog-facts', {
  customer: { id: customer.id, name: customer.name },
  route: { id: route.id, name: route.name },
  cont20Class: { id: cont20Class?.id, code: cont20Class?.code },
  cls5t: { id: cls5t?.id, code: cls5t?.code },
});

const cleanupShipmentIds = [];
const cleanupTripIds = [];
const cleanupPricingIds = [];

// ══ 1. Spec 2026.10.15 §2.2 Cont SilverSea money jump ═════════════════════════
// Cont 20'/40' SilverSea Xe nội bộ: Lô 1 keeps driver salary/road allowance, Lô 2..N = 0₫.
let lotContA = null;
let lotContB = null;
let tripContA = null;
let tripContB = null;
try {
  const refA = `QA-CONT22-A-${hex}`;
  const refB = `QA-CONT22-B-${hex}`;
  const rA = await api(cus.token, 'POST', '/shipments', {
    customerId: customer.id, bookingRef: refA, tradeDirection: 'EXPORT', cargoMode: 'LCL',
    expectedDeliveryDate: today, packageType: 'Pallet', quantity: '10', weightKg: '3000', volumeCbm: '5',
    routeId: route.id,
  });
  const rB = await api(cus.token, 'POST', '/shipments', {
    customerId: customer.id, bookingRef: refB, tradeDirection: 'EXPORT', cargoMode: 'LCL',
    expectedDeliveryDate: today, packageType: 'Pallet', quantity: '10', weightKg: '3000', volumeCbm: '5',
    routeId: route.id,
  });
  lotContA = rA.json?.id;
  lotContB = rB.json?.id;
  if (!lotContA || !lotContB) throw new Error(`create LCL cont lots failed: ${rA.text} / ${rB.text}`);
  cleanupShipmentIds.push(lotContA, lotContB);

  // Insert 2 live trips for these lots on staging DB
  const tripSql = psql(`
    INSERT INTO trips (trip_code, customer_id, route_id, departure_date, shipment_id, status)
    VALUES ('TRIP-QA-${hex}-1', ${customer.id}, ${route.id}, '${today}', ${lotContA}, 'CREATED'),
           ('TRIP-QA-${hex}-2', ${customer.id}, ${route.id}, '${today}', ${lotContB}, 'CREATED')
    RETURNING id;
  `);
  const tIds = tripSql.split('\n').map((l) => Number(l.trim())).filter(Boolean);
  tripContA = tIds[0];
  tripContB = tIds[1];
  cleanupTripIds.push(tripContA, tripContB);

  // Set initial driver money on both trips
  psql(`
    INSERT INTO trip_financial_state (trip_id, driver_salary, total_road_allowance, road_allowance_override)
    VALUES (${tripContA}, 500000, 300000, NULL),
           (${tripContB}, 500000, 300000, NULL)
    ON CONFLICT (trip_id) DO UPDATE SET driver_salary = EXCLUDED.driver_salary, total_road_allowance = EXCLUDED.total_road_allowance;
  `);

  step('trips-created', { tripContA, tripContB });

  // Call POST /api/shipments/lcl/cost-group as admin
  const costGroupRes = await api(admin.token, 'POST', '/shipments/lcl/cost-group', {
    shipmentIds: [lotContA, lotContB],
    vehicleSizeClassId: cont20Class.id,
    actualTruckNo: '15H-209.51',
    carrierType: 'OWN',
  });
  step('cost-group-res', { status: costGroupRes.status, body: costGroupRes.json });
  if (costGroupRes.status !== 201) throw new Error(`cost-group failed: ${costGroupRes.text}`);

  // Query DB financial state
  const finState = psql(`
    SELECT t.id, t.shipment_id, f.driver_salary, f.total_road_allowance, f.road_allowance_override
    FROM trips t
    JOIN trip_financial_state f ON t.id = f.trip_id
    WHERE t.id IN (${tripContA}, ${tripContB})
    ORDER BY t.id;
  `);
  step('fin-state-db', { finState });

  // Parse results
  const lines = finState.split('\n').map((l) => l.split('|').map((s) => s.trim()));
  const fA = lines.find((l) => Number(l[0]) === tripContA);
  const fB = lines.find((l) => Number(l[0]) === tripContB);

  const t1SalaryOk = fA && fA[2] === '500000';
  const t1RoadOk = fA && fA[3] === '300000';
  const t2SalaryOk = fB && fB[2] === '0';
  const t2RoadOk = fB && fB[3] === '0' && fB[4] === '0';

  const spec22Ok = t1SalaryOk && t1RoadOk && t2SalaryOk && t2RoadOk;
  record('SPEC-2.2-CONT-MONEY-JUMP', spec22Ok ? 'PASS' : 'FAIL',
    `Lô 1 keeps 100% (salary=${fA?.[2]}, road=${fA?.[3]}) :: Lô 2..N zeroed (salary=${fB?.[2]}, road=${fB?.[3]}, override=${fB?.[4]})`);
} catch (e) {
  record('SPEC-2.2-CONT-MONEY-JUMP', 'FAIL', String(e.message ?? e));
}

// ══ 2. Regression LCL spec-gap 92 (money conservation on unmerge + primary deletion)
try {
  // Test 2a: Unmerge Lô 1 from the COST group above
  const unmergeRes = await api(admin.token, 'POST', '/shipments/lcl/unmerge', {
    shipmentId: lotContA,
    dimension: 'COST',
  });
  step('unmerge-cost-res', { status: unmergeRes.status, json: unmergeRes.json });
  const transferred = unmergeRes.json?.transferredDriverMoney;
  const transferOk = transferred?.driverSalary === '500000' && transferred?.totalRoadAllowance === '300000';

  const finAfterUnmerge = psql(`
    SELECT t.id, t.shipment_id, f.driver_salary, f.total_road_allowance
    FROM trips t
    JOIN trip_financial_state f ON t.id = f.trip_id
    WHERE t.id IN (${tripContA}, ${tripContB})
    ORDER BY t.id;
  `);
  step('fin-after-unmerge-db', { finAfterUnmerge });
  const linesU = finAfterUnmerge.split('\n').map((l) => l.split('|').map((s) => s.trim()));
  const uA = linesU.find((l) => Number(l[0]) === tripContA);
  const uB = linesU.find((l) => Number(l[0]) === tripContB);
  const leaverZero = uA && uA[2] === '0' && uA[3] === '0';
  const survivorFull = uB && uB[2] === '500000' && uB[3] === '300000';

  // Test 2b: Primary lot deletion preserves money in REV group
  const refDel1 = `QA-DEL92-A-${hex}`;
  const refDel2 = `QA-DEL92-B-${hex}`;
  const rD1 = await api(cus.token, 'POST', '/shipments', {
    customerId: customer.id, bookingRef: refDel1, tradeDirection: 'EXPORT', cargoMode: 'LCL',
    expectedDeliveryDate: today, routeId: route.id,
  });
  const rD2 = await api(cus.token, 'POST', '/shipments', {
    customerId: customer.id, bookingRef: refDel2, tradeDirection: 'EXPORT', cargoMode: 'LCL',
    expectedDeliveryDate: today, routeId: route.id,
  });
  const lotD1 = rD1.json?.id;
  const lotD2 = rD2.json?.id;
  cleanupShipmentIds.push(lotD1, lotD2);

  // Set QA pricing table for 5T on customer
  const priceRes = await api(admin.token, 'POST', '/pricing-tables', {
    customerId: customer.id, routeId: route.id, vehicleSizeClassId: cls5t.id,
    price: 1500000, effectiveDate: today, note: `QA 92 ${hex}`,
  });
  cleanupPricingIds.push(priceRes.json?.id);

  // Group rev
  const revGroupRes = await api(cus.token, 'POST', '/shipments/lcl/rev-group', {
    shipmentIds: [lotD1, lotD2],
    vehicleSizeClassId: cls5t.id,
  });
  step('rev-group-res', { status: revGroupRes.status, body: revGroupRes.json });

  // Verify Lô 1 has 1.5M snapshot, Lô 2 has 0
  const snapsBefore = psql(`SELECT shipment_id, freight_amount FROM freight_rate_snapshots WHERE shipment_id IN (${lotD1}, ${lotD2}) ORDER BY shipment_id`);
  step('snaps-before-delete', { snapsBefore });

  // Delete Lô 1
  const sD1 = await api(admin.token, 'GET', `/shipments/${lotD1}`);
  const v1 = sD1.json?.shipment?.version ?? sD1.json?.version ?? 1;
  const delRes = await api(admin.token, 'DELETE', `/shipments/${lotD1}?version=${v1}`);
  step('del-primary-res', { status: delRes.status });

  // Check Lô 2 promoted and total freight conserved
  const snapsAfter = psql(`SELECT shipment_id, freight_amount FROM freight_rate_snapshots WHERE shipment_id = ${lotD2}`);
  const s2After = psql(`SELECT id, rev_group_id, rev_group_order, rev_vehicle_class_id FROM shipments WHERE id = ${lotD2}`);
  step('snaps-after-delete', { snapsAfter, s2After });

  const snapConserved = snapsAfter.includes('1500000');
  const groupDissolved = s2After.includes(`${lotD2}|||`);

  const spec92Ok = unmergeRes.status === 200 && transferOk && survivorFull && leaverZero && delRes.status === 200 && snapConserved;
  record('SPEC-GAP-92-MONEY-CONSERVATION', spec92Ok ? 'PASS' : 'FAIL',
    `Unmerge: transferOk=${transferOk}, survivorFull=${survivorFull}, leaverZero=${leaverZero} :: Delete primary: status=${delRes.status}, snapConserved=${snapConserved}, dissolved=${groupDissolved}`);
} catch (e) {
  record('SPEC-GAP-92-MONEY-CONSERVATION', 'FAIL', String(e.message ?? e));
}

// ══ 3. Regression LCL spec-gap 86 (virtual plate) + Card 171026004331 (template cols)
try {
  const refV = `QA-VIRT86-${hex}`;
  const virtPlate = `QA-VIRT-${hex.slice(0, 4).toUpperCase()}`;
  const actualPlate = '15H-209.51';
  const rV = await api(cus.token, 'POST', '/shipments', {
    customerId: customer.id, bookingRef: refV, tradeDirection: 'EXPORT', cargoMode: 'LCL',
    expectedDeliveryDate: today, routeId: route.id,
  });
  const lotV = rV.json?.id;
  cleanupShipmentIds.push(lotV);

  // Set actual & virtual plate + rev vehicle class
  await api(cus.token, 'POST', '/shipments/lcl/truck', {
    shipmentId: lotV, actualTruckNo: actualPlate, billingTruckNo: virtPlate,
  });
  await api(cus.token, 'POST', '/shipments/lcl/rev-class', {
    shipmentId: lotV, vehicleSizeClassId: cls5t.id,
  });

  // Lock lot cost
  const lockRes = await api(cus.token, 'POST', `/shipments/${lotV}/lock`, {});
  step('lock-lot-res', { status: lockRes.status, body: lockRes.text?.slice(0, 100) });

  // Generate Debit Note
  const dnRes = await api(cus.token, 'POST', `/shipments/${lotV}/debit-note`, {}, {
    'Idempotency-Key': `idemp-dn-${hex}`,
  });
  step('generate-dn-res', { status: dnRes.status, body: dnRes.json });
  const docId = dnRes.json?.id;

  if (docId) {
    // Download XLSX
    const dlRes = await api(cus.token, 'GET', `/shipments/${lotV}/debit-note/export?documentId=${docId}`);
    step('download-xlsx-res', { status: dlRes.status, len: dlRes.text?.length });

    // Load into ExcelJS
    const wb = new ExcelJS.Workbook();
    // Fetch binary arrayBuffer
    const binRes = await fetch(`${BASE}/api/shipments/${lotV}/debit-note/export?documentId=${docId}`, {
      headers: { Authorization: `Bearer ${cus.token}` },
    });
    const buf = await binRes.arrayBuffer();
    await wb.xlsx.load(buf);
    const ws = wb.worksheets[0];

    const cellStrings = [];
    ws.eachRow((row) => {
      row.eachCell((cell) => {
        if (cell.value != null) cellStrings.push(String(cell.value));
      });
    });
    const allText = cellStrings.join(' ');
    step('xlsx-content-summary', { totalCells: cellStrings.length, sample: allText.slice(0, 300) });

    const hasVirtPlate = allText.includes(virtPlate);
    const leaksActualPlate = allText.includes(actualPlate);
    const hasPlateHeader = cellStrings.some((s) => /biển số xe|bks/i.test(s));
    const hasClassHeader = cellStrings.some((s) => /loại xe/i.test(s));

    const gap86Ok = hasVirtPlate && !leaksActualPlate;
    const card4331Ok = hasPlateHeader && hasClassHeader;

    record('SPEC-GAP-86-VIRTUAL-PLATE', gap86Ok ? 'PASS' : 'FAIL',
      `XLSX carries virtual plate "${virtPlate}"=${hasVirtPlate} :: actual plate "${actualPlate}" omitted=${!leaksActualPlate}`);
    record('CARD-171026004331-TEMPLATE-COLUMNS', card4331Ok ? 'PASS' : 'FAIL',
      `Template columns: Biển số xe column=${hasPlateHeader} :: Loại xe column=${hasClassHeader}`);
  } else {
    record('SPEC-GAP-86-VIRTUAL-PLATE', 'FAIL', `Debit Note creation failed: status ${dnRes.status}`);
    record('CARD-171026004331-TEMPLATE-COLUMNS', 'FAIL', `Debit Note creation failed: status ${dnRes.status}`);
  }
} catch (e) {
  record('SPEC-GAP-86-VIRTUAL-PLATE', 'FAIL', String(e.message ?? e));
  record('CARD-171026004331-TEMPLATE-COLUMNS', 'FAIL', String(e.message ?? e));
}

// ══ 4. Regression Card 162f2d77 (FCL Phân xe 2-line when BKS ảo ≠ BKS thực) ══
try {
  const refFcl = `QA-FCL162-${hex}`;
  const virtFcl = `QA-VFCL-${hex.slice(0, 4).toUpperCase()}`;
  const actualFcl = '15H-209.51';

  // Create FCL shipment with 1 container
  const rFcl = await api(cus.token, 'POST', '/shipments', {
    customerId: customer.id, blNumber: refFcl, tradeDirection: 'IMPORT', cargoMode: 'FCL',
    expectedDeliveryDate: today, routeId: route.id,
  });
  const lotFcl = rFcl.json?.id;
  cleanupShipmentIds.push(lotFcl);

  // Insert container row into DB
  const contRes = psql(`
    INSERT INTO shipment_containers (shipment_id, container_number, container_type_id, cargo_weight_kg)
    VALUES (${lotFcl}, 'TGHU${hex.slice(0, 6).toUpperCase()}', 1, 15000)
    RETURNING id;
  `);
  const contId = Number(contRes.trim().split('\n')[0]);

  // Set actual & billing plate on shipments
  psql(`
    UPDATE shipments
    SET actual_truck_no = '${actualFcl}', billing_truck_no = '${virtFcl}'
    WHERE id = ${lotFcl};
  `);

  // Insert fulfillment with planned carrier SilverSea
  psql(`
    INSERT INTO shipment_fulfillments (shipment_id, shipment_container_id, fulfillment_type, cargo_mode, dispatch_classification, planned_carrier_type, planned_vehicle_plate_number, source_shipment_version)
    VALUES (${lotFcl}, ${contId}, 'CONTAINER', 'FCL', 'SINGLE', 'OWN', '${actualFcl}', 1);
  `);

  // Drive UI to /shipments-detail (ShipmentContainersPage)
  const { browser, page } = await boot({ token: cus.token, width: 1440, height: 1000 });
  try {
    await page.goto(`${BASE}/shipments-detail?dateScope=all&searchSuffix=${refFcl}`, { waitUntil: 'networkidle2', timeout: 60000 });
    await sleep(4000);
    await shot(page, 'fcl-2line-board');
    const pageHtml = await page.content();
    const hasActualLine = pageHtml.includes(`BKS Thực: ${actualFcl}`) || pageHtml.includes(actualFcl);
    const hasVirtLine = pageHtml.includes(`BKS Báo khách (Ảo): ${virtFcl}`) || pageHtml.includes(virtFcl);
    step('fcl-2line-ui', { hasActualLine, hasVirtLine });
    const fcl2LineOk = hasActualLine && hasVirtLine;
    record('CARD-162F2D77-FCL-2LINE', fcl2LineOk ? 'PASS' : 'FAIL',
      `FCL row renders line 1 (BKS Thực: ${actualFcl})=${hasActualLine} :: line 2 (BKS Báo khách: ${virtFcl})=${hasVirtLine}`);
  } finally {
    await browser.close();
  }
} catch (e) {
  record('CARD-162F2D77-FCL-2LINE', 'FAIL', String(e.message ?? e));
}

// ══ 5. Regression Shadow line on CUS debit summary (Xem danh sách toggle) ════
try {
  const { browser, page } = await boot({ token: acct.token, width: 1440, height: 1000 });
  try {
    await page.goto(`${BASE}/shipments-debit`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await sleep(4000);

    const shadowInfo = await page.evaluate(() => {
      const line = document.querySelector('.shipment-debit-shadow-line');
      if (!line) return { found: false };
      const toggle = line.querySelector('.shipment-debit-shadow-line__toggle');
      return {
        found: true,
        role: line.getAttribute('role'),
        text: (line.textContent || '').trim(),
        toggleText: (toggle?.textContent || '').trim(),
        expandedBefore: toggle?.getAttribute('aria-expanded'),
      };
    });
    step('shadow-line-eval', shadowInfo);

    let toggleClicked = false;
    let listRevealed = false;
    if (shadowInfo.found && shadowInfo.toggleText) {
      await tap(page, `() => document.querySelector('.shipment-debit-shadow-line__toggle')`);
      await sleep(1500);
      await shot(page, 'shadow-line-open');
      const afterClick = await page.evaluate(() => {
        const line = document.querySelector('.shipment-debit-shadow-line');
        const toggle = line?.querySelector('.shipment-debit-shadow-line__toggle');
        const list = document.querySelector('#shipment-debit-shadow-trips');
        return {
          expandedAfter: toggle?.getAttribute('aria-expanded'),
          toggleTextAfter: (toggle?.textContent || '').trim(),
          listItemsCount: list?.querySelectorAll('li')?.length ?? 0,
        };
      });
      step('shadow-line-open-eval', afterClick);
      toggleClicked = afterClick.expandedAfter === 'true';
      listRevealed = afterClick.listItemsCount > 0;
    }

    const shadowOk = shadowInfo.found && shadowInfo.role === 'status' && toggleClicked && listRevealed;
    record('SHADOW-LINE-TOGGLE', shadowOk ? 'PASS' : 'FAIL',
      `Shadow line role=status=${shadowInfo.role === 'status'} :: text="${shadowInfo.text?.slice(0, 80)}" :: toggleClicked=${toggleClicked} :: listItemsCount=${listRevealed}`);
  } finally {
    await browser.close();
  }
} catch (e) {
  record('SHADOW-LINE-TOGGLE', 'FAIL', String(e.message ?? e));
}

// ══ 6. Cleanup fixtures ══════════════════════════════════════════════════════
for (const tripId of cleanupTripIds) {
  psql(`DELETE FROM trips WHERE id = ${tripId};`);
}
for (const id of cleanupShipmentIds) {
  psql(`UPDATE shipments SET deleted_at = NOW(), version = version + 1 WHERE id = ${id};`);
}
for (const pId of cleanupPricingIds) {
  if (pId) psql(`DELETE FROM pricing_tables WHERE id = ${pId};`);
}

step('SUMMARY', results);
writeFileSync('qa/2026-10-17_wave2_results.json', JSON.stringify({ pin: PIN, date: new Date().toISOString(), results }, null, 2));
log('WAVE 2 DONE');
