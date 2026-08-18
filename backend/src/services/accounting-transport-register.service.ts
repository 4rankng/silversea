import { createHash } from 'node:crypto';
import {
  and,
  desc,
  eq,
  gte,
  ilike,
  isNotNull,
  isNull,
  lte,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type {
  AccountingTransportReadiness,
  AccountingTransportRegisterQuery,
  AccountingTransportRegisterResponse,
  AccountingTransportRegisterRow,
} from '@tingting/shared';
import { TxnType } from '@tingting/shared';
import { db } from '../db';
import * as s from '../db/schema';
import { operationalName } from '../db/master-data-name';

const TIMEZONE = 'Asia/Ho_Chi_Minh' as const;
const carrier = alias(s.customers, 'accounting_transport_carrier');

const containerProjection = db.select({
  tripId: s.tripContainers.tripId,
  containerNumbers: sql<string[]>`coalesce(
    jsonb_agg(${s.tripContainers.containerNumber} order by ${s.tripContainers.id})
      filter (where ${s.tripContainers.containerNumber} is not null),
    '[]'::jsonb
  )`.as('container_numbers'),
  containerTypes: sql<string[]>`coalesce(
    jsonb_agg(coalesce(${s.containerTypes.code}, ${s.containerTypes.name}) order by ${s.tripContainers.id})
      filter (where ${s.containerTypes.id} is not null),
    '[]'::jsonb
  )`.as('container_types'),
}).from(s.tripContainers)
  .leftJoin(s.containerTypes, eq(s.containerTypes.id, s.tripContainers.containerTypeId))
  .groupBy(s.tripContainers.tripId)
  .as('accounting_transport_containers');

const carrierPayableProjection = db.select({
  financialPostingId: s.ledger.financialPostingId,
  amount: sql<string>`coalesce(sum(${s.ledger.credit} - ${s.ledger.debit}), 0)::text`.as('carrier_payable'),
}).from(s.ledger)
  .where(and(
    eq(s.ledger.txnType, TxnType.EXTERNAL_CARRIER_COST),
    isNotNull(s.ledger.financialPostingId),
  ))
  .groupBy(s.ledger.financialPostingId)
  .as('accounting_transport_carrier_payable');

const completionBusinessDate = sql<string>`to_char(
  ${s.trips.completedAt} at time zone ${TIMEZONE},
  'YYYY-MM-DD'
)`;

function canonicalFilter(input: AccountingTransportRegisterQuery) {
  return {
    from: input.from,
    to: input.to,
    customerId: input.customerId ?? null,
    carrierId: input.carrierId ?? null,
    ownership: input.ownership ?? null,
    readiness: input.readiness ?? null,
    search: input.search ?? null,
    order: ['completionDate:desc', 'tripId:desc'],
  };
}

export function buildAccountingTransportFilterFingerprint(
  input: AccountingTransportRegisterQuery,
): string {
  return createHash('sha256')
    .update(JSON.stringify(canonicalFilter(input)))
    .digest('hex');
}

function conditionsFor(input: AccountingTransportRegisterQuery): SQL[] {
  const conditions: SQL[] = [
    eq(s.tripFinancialPostings.status, 'ACTIVE'),
    // O2C: COMPLETED is the single posting state (formerly filtered on LOCKED).
    eq(s.trips.status, 'COMPLETED'),
    eq(s.tripPodSubmissions.status, 'ACCEPTED'),
    isNull(s.trips.deletedAt),
    gte(completionBusinessDate, input.from),
    lte(completionBusinessDate, input.to),
  ];
  if (input.customerId != null) conditions.push(eq(s.trips.customerId, input.customerId));
  // External carrier is now a soft pointer (external_entity_id for CUSTOMER-typed).
  // O2C H3: constrain to CUSTOMER type so a SUPPLIER-typed entity sharing the
  // same id can't produce a false match.
  if (input.carrierId != null) {
    conditions.push(eq(s.trips.externalEntityId, input.carrierId));
    conditions.push(eq(s.trips.externalEntityType, 'CUSTOMER'));
  }
  if (input.ownership != null) conditions.push(eq(s.trips.carrierType, input.ownership));
  if (input.readiness === 'READY') conditions.push(isNotNull(s.profitabilitySnapshots.id));
  if (input.readiness === 'MISSING_PROFITABILITY_SNAPSHOT') conditions.push(isNull(s.profitabilitySnapshots.id));
  if (input.search != null) {
    const pattern = `%${input.search}%`;
    conditions.push(or(
      ilike(s.trips.tripCode, pattern),
      ilike(s.customers.name, pattern),
      ilike(s.customers.shortName, pattern),
      ilike(carrier.name, pattern),
      ilike(carrier.shortName, pattern),
      ilike(s.routes.name, pattern),
      ilike(s.routes.shortName, pattern),
      ilike(s.shipments.shipmentCode, pattern),
      ilike(s.shipments.bookingRef, pattern),
      ilike(s.shipments.blNumber, pattern),
      ilike(s.shipments.factoryName, pattern),
      ilike(s.operationalSites.name, pattern),
      ilike(s.operationalSites.shortName, pattern),
      ilike(s.trucks.licensePlate, pattern),
      ilike(s.trips.externalPlateNumber, pattern),
      sql`${containerProjection.containerNumbers}::text ilike ${pattern}`,
    )!);
  }
  return conditions;
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string' && item.length > 0);
}

function readinessFor(snapshotId: number | null): AccountingTransportReadiness {
  return snapshotId == null ? 'MISSING_PROFITABILITY_SNAPSHOT' : 'READY';
}

/**
 * Read-only financial projection for the accountant transport register.
 * Money comes from immutable profitability/ledger snapshots tied to the ACTIVE
 * financial posting; this function never derives VAT or posts AR/AP entries.
 */
export async function listAccountingTransportRows(
  input: AccountingTransportRegisterQuery,
): Promise<AccountingTransportRegisterResponse> {
  const asOf = new Date().toISOString();
  const conditions = conditionsFor(input);
  const offset = (input.page - 1) * input.limit;

  const itemQuery = db.select({
    financialPostingId: s.tripFinancialPostings.id,
    financialPostingVersion: s.tripFinancialPostings.version,
    financialPostingEffectiveAt: s.tripFinancialPostings.effectiveAt,
    tripId: s.trips.id,
    tripCode: s.trips.tripCode,
    completionDate: completionBusinessDate,
    customerId: s.customers.id,
    customerName: operationalName(s.customers.shortName, s.customers.name),
    carrierId: carrier.id,
    carrierName: operationalName(carrier.shortName, carrier.name),
    ownership: s.trips.carrierType,
    shipmentId: s.shipments.id,
    shipmentCode: s.shipments.shipmentCode,
    routeId: s.routes.id,
    routeName: operationalName(s.routes.shortName, s.routes.name),
    factoryName: sql<string | null>`coalesce(
      nullif(btrim(${s.operationalSites.shortName}), ''),
      ${s.operationalSites.name},
      ${s.shipments.factoryName}
    )`,
    containerNumbers: containerProjection.containerNumbers,
    containerTypes: containerProjection.containerTypes,
    plateNumber: sql<string | null>`case
      when ${s.trips.carrierType} = 'EXTERNAL' then ${s.trips.externalPlateNumber}
      else ${s.trucks.licensePlate}
    end`,
    revenue: s.profitabilitySnapshots.revenue,
    directCost: s.profitabilitySnapshots.directCost,
    carrierPayable: sql<string>`coalesce(${carrierPayableProjection.amount}, '0')`,
    profit: s.profitabilitySnapshots.profit,
    profitabilitySnapshotId: s.profitabilitySnapshots.id,
    acceptedPodSubmissionId: s.tripPodSubmissions.id,
    acceptedPodVersion: s.tripPodSubmissions.submissionVersion,
    acceptedPodAt: sql<string>`coalesce(${s.tripPodSubmissions.reviewedAt}, ${s.tripPodSubmissions.submittedAt})`,
  }).from(s.trips)
    .innerJoin(s.tripFinancialPostings, eq(s.tripFinancialPostings.tripId, s.trips.id))
    .innerJoin(s.customers, eq(s.customers.id, s.trips.customerId))
    .innerJoin(s.routes, eq(s.routes.id, s.trips.routeId))
    .innerJoin(s.tripPodSubmissions, eq(s.tripPodSubmissions.tripId, s.trips.id))
    .leftJoin(s.profitabilitySnapshots, eq(
      s.profitabilitySnapshots.financialPostingId,
      s.tripFinancialPostings.id,
    ))
    .leftJoin(s.shipments, eq(s.shipments.id, s.trips.shipmentId))
    .leftJoin(s.operationalSites, eq(s.operationalSites.id, s.shipments.operationalSiteId))
    .leftJoin(s.trucks, eq(s.trucks.id, s.trips.truckId))
    .leftJoin(carrier, and(eq(carrier.id, s.trips.externalEntityId), eq(s.trips.externalEntityType, 'CUSTOMER')))
    .leftJoin(containerProjection, eq(containerProjection.tripId, s.trips.id))
    .leftJoin(
      carrierPayableProjection,
      eq(carrierPayableProjection.financialPostingId, s.tripFinancialPostings.id),
    )
    .where(and(...conditions))
    .orderBy(desc(completionBusinessDate), desc(s.trips.id))
    .limit(input.limit)
    .offset(offset);

  const countQuery = db.select({
    total: sql<number>`count(*)`,
  }).from(s.trips)
    .innerJoin(s.tripFinancialPostings, eq(s.tripFinancialPostings.tripId, s.trips.id))
    .innerJoin(s.customers, eq(s.customers.id, s.trips.customerId))
    .innerJoin(s.routes, eq(s.routes.id, s.trips.routeId))
    .innerJoin(s.tripPodSubmissions, eq(s.tripPodSubmissions.tripId, s.trips.id))
    .leftJoin(s.profitabilitySnapshots, eq(
      s.profitabilitySnapshots.financialPostingId,
      s.tripFinancialPostings.id,
    ))
    .leftJoin(s.shipments, eq(s.shipments.id, s.trips.shipmentId))
    .leftJoin(s.operationalSites, eq(s.operationalSites.id, s.shipments.operationalSiteId))
    .leftJoin(s.trucks, eq(s.trucks.id, s.trips.truckId))
    .leftJoin(carrier, and(eq(carrier.id, s.trips.externalEntityId), eq(s.trips.externalEntityType, 'CUSTOMER')))
    .leftJoin(containerProjection, eq(containerProjection.tripId, s.trips.id))
    .leftJoin(
      carrierPayableProjection,
      eq(carrierPayableProjection.financialPostingId, s.tripFinancialPostings.id),
    )
    .where(and(...conditions));

  const [rawItems, countRows] = await Promise.all([itemQuery, countQuery]);
  const total = Number(countRows[0]?.total ?? 0);
  const items: AccountingTransportRegisterRow[] = rawItems.map((row) => {
    const readiness = readinessFor(row.profitabilitySnapshotId ?? null);
    return {
      financialPostingId: row.financialPostingId,
      financialPostingVersion: row.financialPostingVersion,
      financialPostingEffectiveAt: row.financialPostingEffectiveAt.toISOString(),
      tripId: row.tripId,
      tripCode: row.tripCode ?? null,
      completionDate: row.completionDate,
      customerId: row.customerId,
      customerName: row.customerName,
      carrierId: row.carrierId ?? null,
      carrierName: row.carrierName ?? null,
      ownership: row.ownership as 'OWN' | 'EXTERNAL',
      shipmentId: row.shipmentId ?? null,
      shipmentCode: row.shipmentCode ?? null,
      routeId: row.routeId,
      routeName: row.routeName,
      factoryName: row.factoryName ?? null,
      containerNumbers: normalizeStringArray(row.containerNumbers),
      containerTypes: normalizeStringArray(row.containerTypes),
      plateNumber: row.plateNumber ?? null,
      revenue: row.revenue ?? null,
      directCost: row.directCost ?? null,
      carrierPayable: row.carrierPayable,
      profit: row.profit ?? null,
      readiness: {
        status: readiness,
        acceptedPodSubmissionId: row.acceptedPodSubmissionId,
        acceptedPodVersion: row.acceptedPodVersion,
        acceptedPodAt: new Date(row.acceptedPodAt).toISOString(),
        profitabilitySnapshotId: row.profitabilitySnapshotId ?? null,
        evidence: [
          'ACTIVE_FINANCIAL_POSTING',
          'COMPLETED_TRIP',
          'ACCEPTED_EPOD',
          ...(readiness === 'READY' ? ['PROFITABILITY_SNAPSHOT'] : []),
        ],
      },
    };
  });

  return {
    asOf,
    timezone: TIMEZONE,
    filterFingerprint: buildAccountingTransportFilterFingerprint(input),
    page: input.page,
    limit: input.limit,
    total,
    totalPages: total === 0 ? 0 : Math.ceil(total / input.limit),
    items,
  };
}
