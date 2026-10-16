/**
 * Pricing-catalog tombstone uniqueness (card 161026121500 regression).
 *
 * The pricing CRUD soft-deletes rows and its app-level duplicate guards
 * exclude tombstones, so the DB partial unique indexes must exclude them
 * too — otherwise "xóa rồi thêm lại" (delete then re-add the same bảng
 * giá / phụ cấp / giá nâng hạ) passes the guard and then fails the INSERT
 * with a phantom duplicate. These tests pin the tombstone predicate on
 * every affected index at the drizzle-schema boundary (no live DB — same
 * tier as tire-transfer-schema), and pin the two carrier_route_pricing
 * indexes that already had the law so a regen can't silently drop it.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { getTableConfig, PgDialect, type PgTable } from 'drizzle-orm/pg-core';
import {
  pricingTables, carrierRoutePricing, roadAllowances, liftPricing, portZoneSurcharges,
} from '../../db/schema';

const dialect = new PgDialect();

function indexPredicate(table: PgTable, indexName: string): string {
  const cfg = getTableConfig(table);
  const idx = cfg.indexes.find((i) => i.config.name === indexName);
  assert.ok(idx, `${cfg.name}.${indexName} missing from schema`);
  const where = (idx.config as { where?: unknown }).where;
  assert.ok(where, `${cfg.name}.${indexName} must stay a PARTIAL index (has WHERE)`);
  return dialect.sqlToQuery(where as never).sql;
}

describe('tombstone releases the pricing-catalog uniqueness slot', () => {
  test('pricing_tables — all three selector indexes exclude deleted rows', () => {
    for (const name of [
      'pricing_tables_general_date_idx',
      'pricing_tables_container_date_idx',
      'pricing_tables_rate_key_date_idx',
    ]) {
      const pred = indexPredicate(pricingTables, name);
      assert.match(pred, /"pricing_tables"\."deleted_at" is null/, `${name}: ${pred}`);
    }
  });

  test('road_allowances — route × trailer-type index excludes deleted rows', () => {
    const pred = indexPredicate(roadAllowances, 'road_allowances_route_type_idx');
    assert.match(pred, /"road_allowances"\."deleted_at" is null/, pred);
  });

  test('lift_pricing — selector × date index excludes deleted rows', () => {
    const pred = indexPredicate(liftPricing, 'lift_pricing_port_type_state_dir_date_uniq');
    assert.match(pred, /"lift_pricing"\."deleted_at" is null/, pred);
  });

  test('carrier_route_pricing — the two reference indexes keep the law', () => {
    for (const name of [
      'carrier_route_pricing_generic_date_uniq',
      'carrier_route_pricing_supplier_date_uniq',
    ]) {
      const pred = indexPredicate(carrierRoutePricing, name);
      assert.match(pred, /"carrier_route_pricing"\."deleted_at" is null/, pred);
    }
  });

  test('port_zone_surcharges — reference index keeps the law', () => {
    const pred = indexPredicate(portZoneSurcharges, 'port_zone_surcharges_port_kind_uniq');
    // Written with a raw column name — renders unquoted and unqualified.
    assert.match(pred, /("port_zone_surcharges"\.)?"?deleted_at"? is null/, pred);
  });
});
