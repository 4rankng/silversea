// Drift validation for the agent semantic data gateway — a DB-FREE structural
// check. It asserts every field/metric the entity metadata advertises actually
// resolves to a SQL anchor in the `fields` map, and that no naive-SUM-unsafe
// money field is exposed as an aggregateMetric.
//
// Why this exists: buildSelect()/buildWhere() SILENTLY skip a field that is
// listed in meta but missing from `fields`. So if a SQL anchor is renamed or
// removed while the meta still names it, that column vanishes from results with
// no error — a silent regression. This test catches it without needing Postgres.
import { describe, test } from 'node:test';
import { deepStrictEqual, ok } from 'node:assert';
import {
  SEMANTIC_ENTITIES,
  entityFieldNames,
  getSemanticEntityMeta,
} from '../services/agent/semantic-data.service';

const META_FIELD_KEYS = [
  'searchableFields',
  'listFields',
  'detailFields',
  'filterFields',
  'timelineFields',
] as const;

// Money measures that must NEVER be exposed as a naive data.aggregate metric.
// These are either rates/caps/running-balances (whose SUM is meaningless) or
// VAT/margin-sensitive totals that have a deterministic report.run path
// (getPnlReport / getReceivablesSummary / computeAllDriverSalaries …). Genuine
// additive measures (count, fuelLiters volume, cash expense/penalty sums) stay
// aggregatable; they are intentionally NOT in this list.
const NAIVE_SUM_UNSAFE_METRICS = [
  'baseSalary', // per-driver rate (payroll = report.run salary_all_drivers)
  'socialInsurance', // rate
  'creditLimit', // per-customer cap (exposure = report.run receivables)
  'balance', // running ledger balance (SUM meaningless)
  'debit', 'credit', // ledger legs (use report.run receivables/payables)
  'revenue', 'totalCost', 'grossProfit', // VAT/margin-sensitive → getPnlReport
  'driverSalary', 'totalFuelCost', 'totalRoadAllowance', // trip cost components
] as const;

describe('agent semantic data gateway — drift validation', () => {
  for (const entity of SEMANTIC_ENTITIES) {
    describe(`entity: ${entity}`, () => {
      const meta = getSemanticEntityMeta(entity);
      const fieldNames = new Set(entityFieldNames(entity));

      test('every meta-referenced field resolves to a fields entry', () => {
        const missing: string[] = [];
        for (const key of META_FIELD_KEYS) {
          for (const field of meta[key]) {
            if (!fieldNames.has(field)) missing.push(`${key}.${field}`);
          }
        }
        deepStrictEqual(
          missing,
          [],
          `${entity}: fields referenced in meta but absent from the fields map would be silently dropped from results: ${missing.join(', ')}`,
        );
      });

      test('projects an id field (detail/list + buildSelect fallback rely on it)', () => {
        ok(fieldNames.has('id'), `${entity} must project an 'id' field`);
      });

      test('every non-count aggregateMetric resolves to a fields entry', () => {
        const missing = meta.aggregateMetrics
          .filter((m) => m !== 'count')
          .filter((m) => !fieldNames.has(m));
        deepStrictEqual(
          missing,
          [],
          `${entity}: aggregateMetrics reference unknown fields: ${missing.join(', ')}`,
        );
      });

      test('exposes no naive-SUM-unsafe money metric as aggregateMetric', () => {
        const forbidden = NAIVE_SUM_UNSAFE_METRICS.filter((m) =>
          meta.aggregateMetrics.includes(m),
        );
        deepStrictEqual(
          forbidden,
          [],
          `${entity}: naive-SUM-unsafe metrics must route through report.run, not data.aggregate: ${forbidden.join(', ')}`,
        );
      });

      test('aggregateMetrics is non-empty (at least count)', () => {
        ok(
          meta.aggregateMetrics.includes('count'),
          `${entity}: aggregateMetrics must include 'count'`,
        );
      });
    });
  }
});
