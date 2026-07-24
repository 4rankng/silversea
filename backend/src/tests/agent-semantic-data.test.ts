import { after, before, describe, test } from 'node:test';
import assert from 'node:assert';
import { eq } from 'drizzle-orm';
import { Role } from '@tingting/shared';
import { client, db } from '../db';
import * as s from '../db/schema';
import {
  SEMANTIC_ENTITIES,
  listSemanticEntities,
  semanticAggregate,
  semanticDetail,
  semanticSearch,
  semanticTimeline,
} from '../services/agent/semantic-data.service';
import { findTool } from '../services/agent/tool.registry';

const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const agentCtx = { userId: 1, role: Role.ADMIN };
let supplierId: number;
let truckId: number;
let tireId: number;

before(async () => {
  const [supplier] = await db.insert(s.suppliers).values({
    name: `Agent Tire Supplier ${stamp}`,
    status: 'ACTIVE',
  }).returning();
  supplierId = supplier.id;

  const [truck] = await db.insert(s.trucks).values({
    licensePlate: `AG${stamp.slice(-6).toUpperCase()}`,
    status: 'ACTIVE',
  }).returning();
  truckId = truck.id;

  const [tire] = await db.insert(s.tires).values({
    serial: `AGENT-TIRE-${stamp}`,
    truckId,
    position: 'Lốp lái đầu kéo',
    size: '12R22.5',
    supplierId,
    cost: '3200000',
    purchasedAt: '2026-06-01',
    installedAt: '2026-06-02',
    status: 'IN_USE',
  }).returning();
  tireId = tire.id;
});

after(async () => {
  if (tireId) await db.delete(s.tires).where(eq(s.tires.id, tireId));
  if (truckId) await db.delete(s.trucks).where(eq(s.trucks.id, truckId));
  if (supplierId) await db.delete(s.suppliers).where(eq(s.suppliers.id, supplierId));
  await client.end();
});

describe('agent semantic data gateway', () => {
  test('metadata covers the core business entities with non-generic fields', () => {
    const meta = listSemanticEntities();
    assert.deepStrictEqual(
      meta.map((m) => m.entity),
      [...SEMANTIC_ENTITIES],
    );
    for (const entity of ['trips', 'tires', 'expenses', 'ledger', 'auditLogs']) {
      const item = meta.find((m) => m.entity === entity);
      assert.ok(item, `${entity} metadata exists`);
      assert.ok(item.searchableFields.length > 0, `${entity} has search fields`);
      assert.ok(item.detailFields.includes('id'), `${entity} detail includes id`);
    }
    assert.ok(
      meta.find((m) => m.entity === 'expenses')?.searchableFields.includes('vehiclePlate'),
      'expenses search advertises the actual vehicle plate field',
    );
  });

  test('global search finds a tire serial and returns enriched location context', async () => {
    const result = await semanticSearch(`AGENT-TIRE-${stamp}`, 3);
    const tireBucket = result.find((bucket) => bucket.entity === 'tires');
    assert.ok(tireBucket, 'tires bucket returned');
    const tire = tireBucket.rows.find((row) => row.id === tireId);
    assert.ok(tire, 'created tire returned');
    assert.strictEqual(tire.statusLabel, 'Đang dùng');
    assert.strictEqual(tire.supplierName, `Agent Tire Supplier ${stamp}`);
    assert.strictEqual(tire.locationLabel, `Xe đầu kéo AG${stamp.slice(-6).toUpperCase()}`);
    assert.strictEqual(tire.position, 'Lốp lái đầu kéo');
    assert.strictEqual(typeof tire.tireAgeDays, 'number');
  });

  test('detail, aggregate, and timeline work for a whitelisted entity', async () => {
    const detail = await semanticDetail('tires', tireId);
    assert.ok(detail);
    assert.strictEqual(detail.serial, `AGENT-TIRE-${stamp}`);
    assert.strictEqual(detail.vehicleType, 'TRUCK');

    const aggregate = await semanticAggregate({
      entity: 'tires',
      metric: 'count',
      filters: { serial: `AGENT-TIRE-${stamp}` },
    });
    assert.strictEqual(Number(aggregate[0]?.value), 1);

    const timeline = await semanticTimeline({
      entity: 'tires',
      filters: { serial: `AGENT-TIRE-${stamp}` },
      limit: 5,
    });
    assert.ok(timeline.some((row) => row.id === tireId));
  });

  test('finance-sensitive totals are steered away from naive data aggregates', async () => {
    const meta = listSemanticEntities();
    const trips = meta.find((m) => m.entity === 'trips');
    const drivers = meta.find((m) => m.entity === 'drivers');
    const customers = meta.find((m) => m.entity === 'customers');
    assert.ok(trips && drivers && customers);

    // VAT/margin-sensitive trip money → report.run (profit_report), never aggregate.
    assert.ok(!trips.aggregateMetrics.includes('revenue'));
    assert.ok(!trips.aggregateMetrics.includes('grossProfit'));
    // baseSalary is a per-driver RATE; creditLimit is a per-customer CAP — neither
    // is an additive total, so SUM() is meaningless. Real payroll / exposure go
    // through report.run (salary_all_drivers / receivables_summary).
    assert.ok(!drivers.aggregateMetrics.includes('baseSalary'), 'baseSalary is a rate, not SUM-able');
    assert.ok(!customers.aggregateMetrics.includes('creditLimit'), 'creditLimit is a cap, not SUM-able');
    assert.ok(findTool('report.run'), 'report.run is advertised for deterministic reports');

    await Promise.all([
      assert.rejects(
        () => semanticAggregate({ entity: 'trips', metric: 'revenue' }),
        /Metric "revenue" is not allowed/,
      ),
      assert.rejects(
        () => semanticAggregate({ entity: 'drivers', metric: 'baseSalary' }),
        /Metric "baseSalary" is not allowed/,
      ),
      assert.rejects(
        () => semanticAggregate({ entity: 'customers', metric: 'creditLimit' }),
        /Metric "creditLimit" is not allowed/,
      ),
    ]);
  });

  test('agent data/report tools tolerate common LLM naming aliases', async () => {
    const detailTool = findTool('data.detail');
    assert.ok(detailTool);
    const tireDetail = await detailTool.execute({ entity: 'tire', id: tireId }, agentCtx);
    assert.strictEqual((tireDetail.data as Record<string, unknown>).serial, `AGENT-TIRE-${stamp}`);

    const reportTool = findTool('report.run');
    assert.ok(reportTool);
    const report = await reportTool.execute({ reportKey: 'expenses.list', limit: 1 }, agentCtx);
    assert.ok(report.data);
  });
});
