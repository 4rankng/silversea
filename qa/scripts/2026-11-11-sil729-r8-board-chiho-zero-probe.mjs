/**
 * SIL-729 r8 probe (QA integration — BE unit-only ruling: probes live here).
 *
 * Staging verdict 11/11 (board comment 4975, build dc930964): R3B-BILL01/02 +
 * K4KFP-M4 read 'Phải thu: Chưa xác định / Phải trả: Chưa xác định' on the
 * phoi-phieu board because listPhoiPhieuRows returned NULL for a lot with no
 * OPS/TRIP chi-hộ rows (a fully empty lot, or a DRIVER-only lot — road money
 * rides the tien-duong spine, not chi hộ). KB §6.7: a board row is ALWAYS
 * lot-attached, so the cell must read a VERIFIED 0 (the chi-hộ dialog prints
 * the same 0), never null.
 *
 * Run against the real dev stack (make dev):
 *   node qa/scripts/2026-11-11-sil729-r8-board-chiho-zero-probe.mjs
 *
 *   1. login hoapt → GET /expense-accounting/phoi-phieu/rows;
 *   2. every returned row carries NUMERIC chiHoThu/chiHoTra (the null →
 *      'Chưa xác định' shape is gone board-wide);
 *   3. every lot with zero RECORDED OPS/TRIP chi-hộ sources reads exactly
 *      0/0 (the staging failing shape);
 *   4. every lot WITH sources keeps its sums (SQL spot equality).
 */
import postgres from '../../backend/node_modules/postgres/src/index.js';

const BASE = process.env.PROBE_BASE ?? 'http://localhost:3002';
const DATABASE_URL = process.env.DEV_DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5441/silversea';

const failures = [];
function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures.push(name);
}

const sql = postgres(DATABASE_URL, { max: 1 });

async function main() {
  const login = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier: 'hoapt', password: 'Abc123' }),
  });
  const loginBody = await login.json().catch(() => ({}));
  check('login hoapt', login.status === 200 && typeof loginBody.token === 'string', `status ${login.status}`);
  const auth = { Authorization: `Bearer ${loginBody.token}` };

  const res = await fetch(`${BASE}/api/expense-accounting/phoi-phieu/rows?sortBy=grouped`, { headers: auth });
  if (res.status !== 200) throw new Error(`rows → ${res.status}: ${await res.text()}`);
  const { items } = await res.json();
  check('board rows fetched', Array.isArray(items) && items.length > 0, `${items?.length} rows`);

  // (2) The regression shape is gone board-wide: chi-hộ money is a number.
  const nullRows = items.filter((row) => row.chiHoThu == null || row.chiHoTra == null);
  check('no null chi-hộ cell on the board (null rendered Chưa xác định)',
    nullRows.length === 0, nullRows.map((row) => row.tripId).join(','));
  const allNumeric = items.every((row) => typeof row.chiHoThu === 'number' && typeof row.chiHoTra === 'number');
  check('every chi-hộ cell is a number', allNumeric);

  // (3)+(4) Per-lot expectation from the DB (OPS + TRIP, RECORDED only — the
  // exact set the builder sums; DRIVER rows are road money and stay out).
  // postgres.js cannot parameterize table/column names — two explicit queries.
  const ids = [...new Set(items.map((row) => row.shipmentId))];
  const opsRows = await sql`
    select s.shipment_id, count(*)::int as n,
           coalesce(sum(case when e.amount < 0 then 0 else e.amount end), 0)::float8 as tra,
           coalesce(sum(e.customer_charge_amount), 0)::float8 as thu
    from expense_accounting_sources s
    join ops_expense_entries e on e.id = s.source_id
    where s.source_kind = 'OPS' and s.status = 'RECORDED' and s.shipment_id = any(${ids})
    group by s.shipment_id`;
  const tripRows = await sql`
    select s.shipment_id, count(*)::int as n,
           coalesce(sum(case when e.buy_amount < 0 then 0 else e.buy_amount end), 0)::float8 as tra,
           coalesce(sum(e.sell_amount), 0)::float8 as thu
    from expense_accounting_sources s
    join trip_expenses e on e.id = s.source_id
    where s.source_kind = 'TRIP' and s.status = 'RECORDED' and s.shipment_id = any(${ids})
    group by s.shipment_id`;
  const sums = new Map();
  for (const row of [...opsRows, ...tripRows]) {
    const slot = sums.get(row.shipment_id) ?? { n: 0, tra: 0, thu: 0 };
    slot.n += row.n; slot.tra += row.tra; slot.thu += row.thu;
    sums.set(row.shipment_id, slot);
  }

  let emptyLots = 0;
  let populatedChecked = 0;
  for (const row of items) {
    const expected = sums.get(row.shipmentId) ?? { n: 0, tra: 0, thu: 0 };
    if (expected.n === 0) {
      emptyLots += 1;
      if (row.chiHoThu !== 0 || row.chiHoTra !== 0) {
        check(`lot ${row.shipmentId} (trip ${row.tripId}, ${row.billOrBooking ?? 'no bill'}) with no OPS/TRIP chi-hộ sources reads 0/0`,
          false, `got thu=${row.chiHoThu} tra=${row.chiHoTra}`);
      }
    } else {
      populatedChecked += 1;
      const traOk = Math.abs(Number(row.chiHoTra) - expected.tra) < 0.02;
      const thuOk = Math.abs(Number(row.chiHoThu) - expected.thu) < 0.02;
      if (!traOk || !thuOk) {
        check(`lot ${row.shipmentId} (trip ${row.tripId}) keeps its sums`,
          false, `got thu=${row.chiHoThu} tra=${row.chiHoTra}, sql thu=${expected.thu} tra=${expected.tra}`);
      }
    }
  }
  check('empty-lot lots read exactly 0/0 (staging R3B-BILL01/02 + K4KFP-M4 shape)',
    emptyLots > 0 && !failures.some((name) => name.startsWith('lot ')), `${emptyLots} empty lots on the local board`);
  check('populated lots keep their sums', populatedChecked > 0, `${populatedChecked} lots compared with SQL`);

  await sql.end();
  console.log(failures.length === 0 ? 'ALL PASS' : `FAILURES: ${failures.length}`);
  process.exit(failures.length === 0 ? 0 : 1);
}

main().catch((error) => { console.error(error); process.exit(1); });
