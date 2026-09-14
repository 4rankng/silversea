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

// Decision-ready e-POD state per trip: the accepted submission's id/version
// and its acceptance timestamp, or nulls when no submission is ACCEPTED.
// Aggregated (not a raw join) so multiple PENDING/REJECTED submissions never
// multiply register rows, and so a blocked trip — no accepted e-POD — still
// appears in the reconciliation list (QA-036 family: the old INNER accepted
// condition hid the very rows the work-queue links to).
const podDecisionProjection = db.select({
  tripId: s.tripPodSubmissions.tripId,
  acceptedSubmissionId: sql<number | null>`max(${s.tripPodSubmissions.id}) filter (where ${s.tripPodSubmissions.status} = 'ACCEPTED')`.as('accepted_submission_id'),
  acceptedVersion: sql<number | null>`max(${s.tripPodSubmissions.submissionVersion}) filter (where ${s.tripPodSubmissions.status} = 'ACCEPTED')`.as('accepted_version'),
  acceptedAt: sql<string | null>`max(coalesce(${s.tripPodSubmissions.reviewedAt}, ${s.tripPodSubmissions.submittedAt})) filter (where ${s.tripPodSubmissions.status} = 'ACCEPTED')`.as('accepted_at'),
}).from(s.tripPodSubmissions)
  .groupBy(s.tripPodSubmissions.tripId)
  .as('accounting_transport_pod_decisions');

// Sort whitelist — one key per register data column, mapped to a real SQL
// expression over the joins the item query already applies (no row-multiplying
// joins). OWN trips carry no carrier name, so the carrier column falls back to
// the literal label the cell renders ('Xe nhà'); readiness ranks via a
// case-rank (READY = 0). NULLs last in both directions comes from the wrapper
// at the orderBy call site.
type TransportSortKey = NonNullable<AccountingTransportRegisterQuery['sortBy']>;
const TRANSPORT_SORT_SQL: Record<TransportSortKey, SQL> = {
  tripCode: sql`${s.trips.tripCode}`,
  customerName: sql`${operationalName(s.customers.shortName, s.customers.name)}`,
  carrierName: sql`coalesce(${operationalName(carrier.shortName, carrier.name)}, N'Xe nhà')`,
  revenue: sql`${s.profitabilitySnapshots.revenue}`,
  directCost: sql`${s.profitabilitySnapshots.directCost}`,
  profit: sql`${s.profitabilitySnapshots.profit}`,
  readiness: sql`case
    when ${podDecisionProjection.acceptedSubmissionId} is null then 2
    when ${s.profitabilitySnapshots.id} is null then 1
    else 0
  end`,
};

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
    // The accepted-POD gate is deliberately NOT an inner condition anymore:
    // it demoted blocked trips (no accepted e-POD) out of the register, so
    // the work-queue's deep link landed on a list that could never contain
    // its own row. Blocked trips now list with MISSING_ACCEPTED_POD.
    isNull(s.trips.deletedAt),
    gte(completionBusinessDate, input.from),
    lte(completionBusinessDate, input.to),
  ];
  if (input.customerId != null) conditions.push(eq(s.trips.customerId, input.customerId));
  // External carrier is now a soft pointer (external_entity_id for CUSTOMER-typed).
  // O2C H3: constrain to CUSTOMER type so a SUPPLIER-typed entity sharing the
  // same id can't produce a false match.
  if (input.carrierId != null) {
    conditions.push(eq(s.tripCarrierInfo.externalEntityId, input.carrierId));
    conditions.push(eq(s.tripCarrierInfo.externalEntityType, 'CUSTOMER'));
  }
  if (input.ownership != null) conditions.push(eq(s.tripCarrierInfo.carrierType, input.ownership));
  if (input.readiness === 'READY') conditions.push(and(
    isNotNull(s.profitabilitySnapshots.id),
    isNotNull(podDecisionProjection.acceptedSubmissionId),
  )!);
  if (input.readiness === 'MISSING_PROFITABILITY_SNAPSHOT') conditions.push(and(
    isNotNull(podDecisionProjection.acceptedSubmissionId),
    isNull(s.profitabilitySnapshots.id),
  )!);
  if (input.readiness === 'MISSING_ACCEPTED_POD') conditions.push(isNull(podDecisionProjection.acceptedSubmissionId));
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
      ilike(s.tripCarrierInfo.externalPlateNumber, pattern),
      sql`${containerProjection.containerNumbers}::text ilike ${pattern}`,
    )!);
  }
  return conditions;
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string' && item.length > 0);
}

function readinessFor(
  snapshotId: number | null,
  acceptedSubmissionId: number | null,
): AccountingTransportReadiness {
  // Precedence: the POD acceptance gate blocks first; profitability snapshot
  // is the second readiness requirement.
  if (acceptedSubmissionId == null) return 'MISSING_ACCEPTED_POD';
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
    ownership: s.tripCarrierInfo.carrierType,
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
      when ${s.tripCarrierInfo.carrierType} = 'EXTERNAL' then ${s.tripCarrierInfo.externalPlateNumber}
      else ${s.trucks.licensePlate}
    end`,
    revenue: s.profitabilitySnapshots.revenue,
    directCost: s.profitabilitySnapshots.directCost,
    carrierPayable: sql<string>`coalesce(${carrierPayableProjection.amount}, '0')`,
    profit: s.profitabilitySnapshots.profit,
    profitabilitySnapshotId: s.profitabilitySnapshots.id,
    acceptedPodSubmissionId: podDecisionProjection.acceptedSubmissionId,
    acceptedPodVersion: podDecisionProjection.acceptedVersion,
    acceptedPodAt: podDecisionProjection.acceptedAt,
  }).from(s.trips)
    .innerJoin(s.tripFinancialPostings, eq(s.tripFinancialPostings.tripId, s.trips.id))
    .innerJoin(s.customers, eq(s.customers.id, s.trips.customerId))
    .innerJoin(s.routes, eq(s.routes.id, s.trips.routeId))
    .leftJoin(podDecisionProjection, eq(podDecisionProjection.tripId, s.trips.id))
    .leftJoin(s.profitabilitySnapshots, eq(
      s.profitabilitySnapshots.financialPostingId,
      s.tripFinancialPostings.id,
    ))
    .leftJoin(s.shipments, eq(s.shipments.id, s.trips.shipmentId))
    .leftJoin(s.operationalSites, eq(s.operationalSites.id, s.shipments.operationalSiteId))
    .leftJoin(s.trucks, eq(s.trucks.id, s.trips.truckId))
    .leftJoin(s.tripCarrierInfo, eq(s.tripCarrierInfo.tripId, s.trips.id))
    .leftJoin(carrier, and(eq(carrier.id, s.tripCarrierInfo.externalEntityId), eq(s.tripCarrierInfo.externalEntityType, 'CUSTOMER')))
    .leftJoin(containerProjection, eq(containerProjection.tripId, s.trips.id))
    .leftJoin(
      carrierPayableProjection,
      eq(carrierPayableProjection.financialPostingId, s.tripFinancialPostings.id),
    )
    .where(and(...conditions))
    .orderBy(...(
      input.sortBy
        ? [
            sql`${TRANSPORT_SORT_SQL[input.sortBy]} ${input.sortDir === 'desc' ? sql`desc` : sql`asc`} nulls last`,
            desc(completionBusinessDate),
            desc(s.trips.id),
          ]
        : [desc(completionBusinessDate), desc(s.trips.id)]
    ))
    .limit(input.limit)
    .offset(offset);

  const countQuery = db.select({
    total: sql<number>`count(*)`,
  }).from(s.trips)
    .innerJoin(s.tripFinancialPostings, eq(s.tripFinancialPostings.tripId, s.trips.id))
    .innerJoin(s.customers, eq(s.customers.id, s.trips.customerId))
    .innerJoin(s.routes, eq(s.routes.id, s.trips.routeId))
    .leftJoin(podDecisionProjection, eq(podDecisionProjection.tripId, s.trips.id))
    .leftJoin(s.profitabilitySnapshots, eq(
      s.profitabilitySnapshots.financialPostingId,
      s.tripFinancialPostings.id,
    ))
    .leftJoin(s.shipments, eq(s.shipments.id, s.trips.shipmentId))
    .leftJoin(s.operationalSites, eq(s.operationalSites.id, s.shipments.operationalSiteId))
    .leftJoin(s.trucks, eq(s.trucks.id, s.trips.truckId))
    .leftJoin(s.tripCarrierInfo, eq(s.tripCarrierInfo.tripId, s.trips.id))
    .leftJoin(carrier, and(eq(carrier.id, s.tripCarrierInfo.externalEntityId), eq(s.tripCarrierInfo.externalEntityType, 'CUSTOMER')))
    .leftJoin(containerProjection, eq(containerProjection.tripId, s.trips.id))
    .leftJoin(
      carrierPayableProjection,
      eq(carrierPayableProjection.financialPostingId, s.tripFinancialPostings.id),
    )
    .where(and(...conditions));

  const [rawItems, countRows] = await Promise.all([itemQuery, countQuery]);
  const total = Number(countRows[0]?.total ?? 0);
  const items: AccountingTransportRegisterRow[] = rawItems.map((row) => {
    const readiness = readinessFor(row.profitabilitySnapshotId ?? null, row.acceptedPodSubmissionId ?? null);
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
        acceptedPodAt: row.acceptedPodAt ? new Date(row.acceptedPodAt).toISOString() : null,
        profitabilitySnapshotId: row.profitabilitySnapshotId ?? null,
        evidence: [
          'ACTIVE_FINANCIAL_POSTING',
          'COMPLETED_TRIP',
          ...(readiness !== 'MISSING_ACCEPTED_POD' ? ['ACCEPTED_EPOD'] : []),
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
