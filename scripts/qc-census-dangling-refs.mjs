// Census of dangling master refs on live shipments (card 20260929_205).
//
// shipments.customer_id / cargo_type_id carry no DB foreign key (repo
// convention: master-data integrity is app-layer, see
// assertShipmentMasterRefsExist), so QA/import debris can leave rows pointing
// at deleted catalog entries. Those lots then fail trip creation with a
// misleading error. This script LISTS the debris — read-only, no fixes; the
// data decision belongs to the PM/lead.
//
// Covers both columns the card names: cargo_type_id AND customer_id, on live
// rows only (deleted_at IS NULL), matching the board lead's census SQL.
//
// Usage (read-only; works against local dev and staging):
//   DATABASE_URL=postgres://postgres:postgres@localhost:5441/silversea \
//     node scripts/qc-census-dangling-refs.mjs
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const postgres = createRequire(path.join(root, 'backend/package.json'))('postgres');

if (!process.env.DATABASE_URL) {
  console.error('Usage: DATABASE_URL=postgres://...@host:5441/silversea node scripts/qc-census-dangling-refs.mjs');
  console.error('  local dev : DATABASE_URL=postgres://postgres:postgres@localhost:5441/silversea');
  process.exit(2);
}

const sql = postgres(process.env.DATABASE_URL, { max: 1, connect_timeout: 10, idle_timeout: 10 });

function pad(value, width) {
  const text = value == null ? '—' : String(value);
  return text.length >= width ? text : text + ' '.repeat(width - text.length);
}

try {
  const { rows, liveShipments } = await sql.begin('read only', async tx => {
    await tx`SET LOCAL statement_timeout = '30s'`;
    // Static identifiers only — no user-supplied SQL. UNION ALL keeps both
    // defect classes in one ordered listing.
    const rows = await tx`
      SELECT s.id, s.shipment_code, s.bl_number, s.booking_ref,
             'cargo_type_id' AS dangling_column, s.cargo_type_id AS dangling_id
      FROM shipments s
      LEFT JOIN cargo_types c ON c.id = s.cargo_type_id
      WHERE s.deleted_at IS NULL AND s.cargo_type_id IS NOT NULL AND c.id IS NULL
      UNION ALL
      SELECT s.id, s.shipment_code, s.bl_number, s.booking_ref,
             'customer_id' AS dangling_column, s.customer_id AS dangling_id
      FROM shipments s
      LEFT JOIN customers cu ON cu.id = s.customer_id
      WHERE s.deleted_at IS NULL AND s.customer_id IS NOT NULL AND cu.id IS NULL
      ORDER BY 1, 5`;
    const [live] = await tx`SELECT count(*)::integer AS count FROM shipments WHERE deleted_at IS NULL`;
    return { rows, liveShipments: live.count };
  });

  const widths = { id: 10, shipmentCode: 44, blNumber: 20, bookingRef: 20, column: 16, danglingId: 12 };
  console.log(`live shipments scanned (deleted_at IS NULL): ${liveShipments}`);
  console.log(
    pad('id', widths.id) + pad('shipment_code', widths.shipmentCode) + pad('bl_number', widths.blNumber)
    + pad('booking_ref', widths.bookingRef) + pad('dangling_column', widths.column) + pad('dangling_id', widths.danglingId),
  );
  for (const row of rows) {
    console.log(
      pad(row.id, widths.id) + pad(row.shipment_code, widths.shipmentCode) + pad(row.bl_number, widths.blNumber)
      + pad(row.booking_ref, widths.bookingRef) + pad(row.dangling_column, widths.column) + pad(row.dangling_id, widths.danglingId),
    );
  }
  const cargoCount = rows.filter(r => r.dangling_column === 'cargo_type_id').length;
  const customerCount = rows.filter(r => r.dangling_column === 'customer_id').length;
  console.log(`\nsummary: cargo_type_id dangling = ${cargoCount}, customer_id dangling = ${customerCount}, total = ${rows.length}`);
  console.log(rows.length === 0 ? 'CLEAN — no dangling master refs on live shipments.' : 'DANGLING REFS FOUND — cleanup is a data decision (PM/lead), not this script.');
} finally {
  await sql.end();
}
