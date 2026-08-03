import { randomUUID } from 'node:crypto';
import { and, asc, eq, gt, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../db';
import * as s from '../db/schema';
import logger from '../lib/logger';
import { cacheInvalidate, getRedis } from '../lib/redis';
import { lockApplicationOwnedUniqueness } from './application-owned-uniqueness.service';
import { storageService } from './storage.service';
import type { Tx } from './trip-shared';

export const DURABLE_EFFECT_KIND = {
  CACHE_INVALIDATE: 'CACHE_INVALIDATE',
  STORAGE_DELETE: 'STORAGE_DELETE',
  LEGAL_INVOICE_HANDOFF: 'LEGAL_INVOICE_HANDOFF',
} as const;

export const DURABLE_EFFECT_STATUS = {
  PENDING: 'PENDING',
  RUNNING: 'RUNNING',
  RETRY: 'RETRY',
  SUCCEEDED: 'SUCCEEDED',
  CANCELLED: 'CANCELLED',
  DEAD: 'DEAD',
} as const;

export const STORAGE_DELETE_MODE = {
  ORPHAN_GUARD: 'ORPHAN_GUARD',
  FINAL_DELETE: 'FINAL_DELETE',
} as const;

export type DurableEffectKind = typeof DURABLE_EFFECT_KIND[keyof typeof DURABLE_EFFECT_KIND];
export type DurableEffectStatus = typeof DURABLE_EFFECT_STATUS[keyof typeof DURABLE_EFFECT_STATUS];
export type StorageDeleteMode = typeof STORAGE_DELETE_MODE[keyof typeof STORAGE_DELETE_MODE];

const cacheInvalidateJobSchema = z.object({
  kind: z.literal(DURABLE_EFFECT_KIND.CACHE_INVALIDATE),
  payloadVersion: z.literal(1),
  dedupeKey: z.string().trim().min(1).max(255),
  payload: z.object({
    key: z.string().trim().min(1).max(255),
  }),
  maxAttempts: z.number().int().positive().max(100).optional(),
});

const storageDeleteJobSchema = z.object({
  kind: z.literal(DURABLE_EFFECT_KIND.STORAGE_DELETE),
  payloadVersion: z.literal(1),
  dedupeKey: z.string().trim().min(1).max(255),
  payload: z.object({
    storageKey: z.string().trim().min(1).max(255),
    mode: z.enum([STORAGE_DELETE_MODE.ORPHAN_GUARD, STORAGE_DELETE_MODE.FINAL_DELETE]),
    entityType: z.string().trim().min(1).max(80).optional(),
    entityId: z.number().int().positive().optional(),
  }),
  maxAttempts: z.number().int().positive().max(100).optional(),
});

const legalInvoiceHandoffJobSchema = z.object({
  kind: z.literal(DURABLE_EFFECT_KIND.LEGAL_INVOICE_HANDOFF),
  payloadVersion: z.literal(1),
  dedupeKey: z.string().trim().min(1).max(255),
  payload: z.object({
    documentId: z.number().int().positive(),
    confirmedVersion: z.number().int().positive(),
    provider: z.string().trim().min(1).max(80),
    payloadHash: z.string().regex(/^[a-f0-9]{64}$/),
  }),
  maxAttempts: z.number().int().positive().max(100).optional(),
});

const durableEffectInputSchema = z.discriminatedUnion('kind', [
  cacheInvalidateJobSchema,
  storageDeleteJobSchema,
  legalInvoiceHandoffJobSchema,
]);

type CacheInvalidateEffect = z.infer<typeof cacheInvalidateJobSchema>;
type StorageDeleteEffect = z.infer<typeof storageDeleteJobSchema>;
type LegalInvoiceHandoffEffect = z.infer<typeof legalInvoiceHandoffJobSchema>;
export type DurableEffectInput = z.infer<typeof durableEffectInputSchema>;
type DurableEffectJobRow = typeof s.durableEffectJobs.$inferSelect;

export interface StorageCleanupGuardLease {
  jobId: number;
  leaseToken: string;
  dedupeKey: string;
  storageKey: string;
  leaseExpiresAt: Date;
}

export interface LegalInvoiceHandoffResult {
  status: 'UNKNOWN' | 'ISSUED' | 'CANCELED';
  providerReference?: string;
  checksum?: string;
  issuedAt?: string;
}

interface DurableEffectDependencies {
  now?: () => Date;
  uuid?: () => string;
  cacheInvalidateKey?: (key: string) => Promise<void>;
  storageDelete?: (storageKey: string) => Promise<void>;
  isStorageKeyReferenced?: (storageKey: string) => Promise<boolean>;
  legalInvoiceHandoff?: (
    payload: LegalInvoiceHandoffEffect['payload'],
  ) => Promise<LegalInvoiceHandoffResult>;
  legalInvoiceStatusProbe?: (
    payload: LegalInvoiceHandoffEffect['payload'],
  ) => Promise<LegalInvoiceHandoffResult>;
  leaseMs?: number;
}

const MAX_BATCH_LIMIT = 100;
const DEFAULT_BATCH_LIMIT = 50;
const DEFAULT_WORKER_LEASE_MS = 2 * 60_000;
const DEFAULT_GUARD_LEASE_MS = 10 * 60_000;
const STORAGE_DELETE_MAX_ATTEMPTS = 50;
const DEFAULT_RETRY_DELAYS_MS = [
  30_000,
  2 * 60_000,
  10 * 60_000,
  30 * 60_000,
  2 * 60 * 60_000,
  6 * 60 * 60_000,
  24 * 60 * 60_000,
] as const;

function stableJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, nested]) => `${JSON.stringify(key)}:${stableJson(nested)}`);
  return `{${entries.join(',')}}`;
}

function durableEffectDefinitionMatches(
  existing: Pick<typeof s.durableEffectJobs.$inferSelect, 'payloadVersion' | 'payload' | 'maxAttempts'>,
  row: Pick<typeof s.durableEffectJobs.$inferInsert, 'payloadVersion' | 'payload' | 'maxAttempts'>,
): boolean {
  return existing.payloadVersion === row.payloadVersion
    && existing.maxAttempts === row.maxAttempts
    && stableJson(existing.payload) === stableJson(row.payload);
}

export async function enqueueDurableEffect(
  tx: Tx,
  input: DurableEffectInput,
): Promise<void> {
  await enqueueDurableEffects(tx, [input]);
}

export async function enqueueDurableEffects(
  tx: Tx,
  inputs: readonly DurableEffectInput[],
): Promise<void> {
  if (inputs.length === 0) return;
  const rows = inputs.map((raw) => {
    const input = durableEffectInputSchema.parse(raw);
    return {
      kind: input.kind,
      payloadVersion: input.payloadVersion,
      dedupeKey: input.dedupeKey,
      payload: input.payload,
      status: DURABLE_EFFECT_STATUS.PENDING,
      maxAttempts: resolveMaxAttempts(input),
    };
  });
  for (const row of rows) {
    await lockApplicationOwnedUniqueness(tx, 'durable-effect-job', [row.kind, row.dedupeKey]);
    const [existing] = await tx.select({
      id: s.durableEffectJobs.id,
      payloadVersion: s.durableEffectJobs.payloadVersion,
      payload: s.durableEffectJobs.payload,
      maxAttempts: s.durableEffectJobs.maxAttempts,
    }).from(s.durableEffectJobs)
      .where(and(
        eq(s.durableEffectJobs.kind, row.kind),
        eq(s.durableEffectJobs.dedupeKey, row.dedupeKey),
      ))
      .limit(1);

    if (!existing) {
      await tx.insert(s.durableEffectJobs).values(row);
      continue;
    }

    if (!durableEffectDefinitionMatches(existing, row)) {
      throw new Error(`durable effect job already exists with different payload: ${row.kind}:${row.dedupeKey}`);
    }
  }
}

export async function enqueueStorageDelete(
  tx: Tx,
  input: Omit<StorageDeleteEffect, 'kind' | 'payloadVersion'>,
): Promise<void> {
  await enqueueDurableEffect(tx, {
    kind: DURABLE_EFFECT_KIND.STORAGE_DELETE,
    payloadVersion: 1,
    dedupeKey: input.dedupeKey,
    payload: input.payload,
    maxAttempts: input.maxAttempts,
  });
}

export async function armStorageCleanupGuard(input: {
  dedupeKey: string;
  storageKey: string;
  entityType?: string;
  entityId?: number;
  leaseMs?: number;
  now?: Date;
  maxAttempts?: number;
}): Promise<StorageCleanupGuardLease> {
  const now = input.now ?? new Date();
  const leaseMs = input.leaseMs ?? DEFAULT_GUARD_LEASE_MS;
  const leaseToken = randomUUID();
  const leaseExpiresAt = new Date(now.getTime() + leaseMs);
  const payload: StorageDeleteEffect['payload'] = {
    storageKey: input.storageKey,
    mode: STORAGE_DELETE_MODE.ORPHAN_GUARD,
    entityType: input.entityType,
    entityId: input.entityId,
  };

  const row = await db.transaction(async (tx) => {
    await lockApplicationOwnedUniqueness(tx, 'durable-effect-job', [
      DURABLE_EFFECT_KIND.STORAGE_DELETE,
      input.dedupeKey,
    ]);

    const [existing] = await tx.select().from(s.durableEffectJobs)
      .where(and(
        eq(s.durableEffectJobs.kind, DURABLE_EFFECT_KIND.STORAGE_DELETE),
        eq(s.durableEffectJobs.dedupeKey, input.dedupeKey),
      ))
      .limit(1)
      .for('update');

    if (!existing) {
      const [created] = await tx.insert(s.durableEffectJobs).values({
        kind: DURABLE_EFFECT_KIND.STORAGE_DELETE,
        payloadVersion: 1,
        dedupeKey: input.dedupeKey,
        payload,
        status: DURABLE_EFFECT_STATUS.RUNNING,
        maxAttempts: input.maxAttempts ?? STORAGE_DELETE_MAX_ATTEMPTS,
        nextAttemptAt: now,
        leaseToken,
        leaseExpiresAt,
      }).returning();
      return created!;
    }

    if (
      existing.status === DURABLE_EFFECT_STATUS.RUNNING
      && existing.leaseExpiresAt
      && existing.leaseExpiresAt.getTime() > now.getTime()
    ) {
      throw new Error(`storage cleanup guard already leased: ${input.dedupeKey}`);
    }
    if (
      existing.status === DURABLE_EFFECT_STATUS.CANCELLED
      || existing.status === DURABLE_EFFECT_STATUS.DEAD
    ) {
      throw new Error(`storage cleanup guard already closed: ${input.dedupeKey}`);
    }

    const [rearmed] = await tx.update(s.durableEffectJobs).set({
      payloadVersion: 1,
      payload,
      status: DURABLE_EFFECT_STATUS.RUNNING,
      nextAttemptAt: now,
      leaseToken,
      leaseExpiresAt,
      lastError: null,
      completedAt: null,
      updatedAt: now,
    }).where(eq(s.durableEffectJobs.id, existing.id)).returning();
    return rearmed ?? existing;
  });

  return {
    jobId: row.id,
    leaseToken,
    dedupeKey: input.dedupeKey,
    storageKey: input.storageKey,
    leaseExpiresAt,
  };
}

export async function cancelStorageCleanupGuard(
  tx: Tx,
  lease: Pick<StorageCleanupGuardLease, 'jobId' | 'leaseToken'>,
  now = new Date(),
): Promise<boolean> {
  const [updated] = await tx.update(s.durableEffectJobs).set({
    status: DURABLE_EFFECT_STATUS.CANCELLED,
    leaseToken: null,
    leaseExpiresAt: null,
    completedAt: now,
    lastError: null,
    updatedAt: now,
  }).where(and(
    eq(s.durableEffectJobs.id, lease.jobId),
    eq(s.durableEffectJobs.kind, DURABLE_EFFECT_KIND.STORAGE_DELETE),
    eq(s.durableEffectJobs.status, DURABLE_EFFECT_STATUS.RUNNING),
    eq(s.durableEffectJobs.leaseToken, lease.leaseToken),
  )).returning({ id: s.durableEffectJobs.id });
  return Boolean(updated);
}

export async function releaseStorageCleanupGuard(
  lease: Pick<StorageCleanupGuardLease, 'jobId' | 'leaseToken'>,
  error?: unknown,
  now = new Date(),
): Promise<boolean> {
  const [updated] = await db.update(s.durableEffectJobs).set({
    status: DURABLE_EFFECT_STATUS.RETRY,
    nextAttemptAt: now,
    leaseToken: null,
    leaseExpiresAt: null,
    lastError: normalizeError(error),
    updatedAt: now,
  }).where(and(
    eq(s.durableEffectJobs.id, lease.jobId),
    eq(s.durableEffectJobs.kind, DURABLE_EFFECT_KIND.STORAGE_DELETE),
    eq(s.durableEffectJobs.status, DURABLE_EFFECT_STATUS.RUNNING),
    eq(s.durableEffectJobs.leaseToken, lease.leaseToken),
  )).returning({ id: s.durableEffectJobs.id });
  return Boolean(updated);
}

export async function claimDueDurableEffectJobs(
  limit = DEFAULT_BATCH_LIMIT,
  dependencies: Pick<DurableEffectDependencies, 'now' | 'uuid' | 'leaseMs'> = {},
): Promise<DurableEffectJobRow[]> {
  const now = dependencies.now?.() ?? new Date();
  const leaseMs = dependencies.leaseMs ?? DEFAULT_WORKER_LEASE_MS;
  const uuid = dependencies.uuid ?? randomUUID;
  const batchLimit = Math.max(1, Math.min(limit, MAX_BATCH_LIMIT));

  return db.transaction(async (tx) => {
    const rows = await tx.select().from(s.durableEffectJobs)
      .where(or(
        and(
          inArray(s.durableEffectJobs.status, [DURABLE_EFFECT_STATUS.PENDING, DURABLE_EFFECT_STATUS.RETRY]),
          lte(s.durableEffectJobs.nextAttemptAt, now),
        ),
        and(
          eq(s.durableEffectJobs.status, DURABLE_EFFECT_STATUS.RUNNING),
          or(
            isNull(s.durableEffectJobs.leaseExpiresAt),
            lte(s.durableEffectJobs.leaseExpiresAt, now),
          ),
        ),
      ))
      .orderBy(asc(s.durableEffectJobs.nextAttemptAt), asc(s.durableEffectJobs.id))
      .limit(batchLimit)
      .for('update', { skipLocked: true });

    const claimed: DurableEffectJobRow[] = [];
    for (const row of rows) {
      const leaseToken = uuid();
      const [updated] = await tx.update(s.durableEffectJobs).set({
        status: DURABLE_EFFECT_STATUS.RUNNING,
        attemptCount: row.attemptCount + 1,
        leaseToken,
        leaseExpiresAt: new Date(now.getTime() + leaseMs),
        lastError: null,
        updatedAt: now,
      }).where(eq(s.durableEffectJobs.id, row.id)).returning();
      if (updated) claimed.push(updated);
    }
    return claimed;
  });
}

export async function processDueDurableEffectJobs(
  limit = DEFAULT_BATCH_LIMIT,
  dependencies: DurableEffectDependencies = {},
): Promise<DurableEffectJobRow[]> {
  const claimed = await claimDueDurableEffectJobs(limit, dependencies);
  const results: DurableEffectJobRow[] = [];
  for (const job of claimed) {
    results.push(await processDurableEffectJob(job, dependencies));
  }
  return results;
}

export async function processDurableEffectJob(
  job: DurableEffectJobRow,
  dependencies: DurableEffectDependencies = {},
): Promise<DurableEffectJobRow> {
  const now = dependencies.now?.() ?? new Date();
  if (job.status !== DURABLE_EFFECT_STATUS.RUNNING || !job.leaseToken) {
    return job;
  }

  const cacheInvalidateKey = dependencies.cacheInvalidateKey ?? defaultCacheInvalidateKey;
  const storageDelete = dependencies.storageDelete ?? storageService.delete.bind(storageService);
  const isStorageKeyReferenced = dependencies.isStorageKeyReferenced ?? defaultStorageKeyReferenceCheck;

  const parsed = parseJob(job);
  if (!parsed.ok) {
    return markDurableEffectJobDead(job.id, job.leaseToken, parsed.error, now);
  }

  try {
    if (parsed.job.kind === DURABLE_EFFECT_KIND.CACHE_INVALIDATE) {
      await cacheInvalidateKey(parsed.job.payload.key);
      return (await markDurableEffectJobSucceeded(job.id, job.leaseToken, now)) ?? job;
    }

    if (parsed.job.kind === DURABLE_EFFECT_KIND.LEGAL_INVOICE_HANDOFF) {
      const shouldProbe = await legalInvoiceHandoffNeedsStatusProbe(parsed.job.payload);
      const execute = shouldProbe
        ? dependencies.legalInvoiceStatusProbe ?? defaultLegalInvoiceHandoff
        : dependencies.legalInvoiceHandoff ?? defaultLegalInvoiceHandoff;
      try {
        const result = await execute(parsed.job.payload);
        await applyLegalInvoiceHandoffResult(parsed.job.payload, result, now, job.id, job.leaseToken);
      } catch (error) {
        // A provider timeout is ambiguous: persist UNKNOWN before scheduling a
        // retry. The next attempt probes provider status and never blindly
        // issues the legal invoice again.
        await applyLegalInvoiceHandoffResult(parsed.job.payload, { status: 'UNKNOWN' }, now, job.id, job.leaseToken);
        throw error;
      }
      return (await markDurableEffectJobSucceeded(job.id, job.leaseToken, now)) ?? job;
    }

    if (parsed.job.payload.mode === STORAGE_DELETE_MODE.ORPHAN_GUARD) {
      const referenced = await isStorageKeyReferenced(parsed.job.payload.storageKey);
      if (referenced) {
        return (await markDurableEffectJobCancelled(job.id, job.leaseToken, now)) ?? job;
      }
    }

    await storageDelete(parsed.job.payload.storageKey);
    return (await markDurableEffectJobSucceeded(job.id, job.leaseToken, now)) ?? job;
  } catch (error) {
    const terminal = job.attemptCount >= job.maxAttempts;
    if (terminal) {
      return markDurableEffectJobDead(job.id, job.leaseToken, normalizeError(error), now);
    }
    return markDurableEffectJobRetry(job, job.leaseToken, normalizeError(error), now);
  }
}

export async function markDurableEffectJobSucceeded(
  jobId: number,
  leaseToken: string,
  now = new Date(),
): Promise<DurableEffectJobRow | null> {
  const [updated] = await db.update(s.durableEffectJobs).set({
    status: DURABLE_EFFECT_STATUS.SUCCEEDED,
    leaseToken: null,
    leaseExpiresAt: null,
    completedAt: now,
    lastError: null,
    updatedAt: now,
  }).where(and(
    eq(s.durableEffectJobs.id, jobId),
    eq(s.durableEffectJobs.status, DURABLE_EFFECT_STATUS.RUNNING),
    eq(s.durableEffectJobs.leaseToken, leaseToken),
  )).returning();
  return updated ?? null;
}

export async function markDurableEffectJobCancelled(
  jobId: number,
  leaseToken: string,
  now = new Date(),
): Promise<DurableEffectJobRow | null> {
  const [updated] = await db.update(s.durableEffectJobs).set({
    status: DURABLE_EFFECT_STATUS.CANCELLED,
    leaseToken: null,
    leaseExpiresAt: null,
    completedAt: now,
    lastError: null,
    updatedAt: now,
  }).where(and(
    eq(s.durableEffectJobs.id, jobId),
    eq(s.durableEffectJobs.status, DURABLE_EFFECT_STATUS.RUNNING),
    eq(s.durableEffectJobs.leaseToken, leaseToken),
  )).returning();
  return updated ?? null;
}

export async function markDurableEffectJobDead(
  jobId: number,
  leaseToken: string,
  error: string,
  now = new Date(),
): Promise<DurableEffectJobRow> {
  const [updated] = await db.update(s.durableEffectJobs).set({
    status: DURABLE_EFFECT_STATUS.DEAD,
    leaseToken: null,
    leaseExpiresAt: null,
    completedAt: now,
    lastError: error.slice(0, 1000),
    updatedAt: now,
  }).where(and(
    eq(s.durableEffectJobs.id, jobId),
    eq(s.durableEffectJobs.status, DURABLE_EFFECT_STATUS.RUNNING),
    eq(s.durableEffectJobs.leaseToken, leaseToken),
  )).returning();
  const result = updated ?? await reloadDurableEffectJob(jobId);
  if (updated) {
    logger.error({
      durableEffectJobId: result.id,
      kind: result.kind,
      dedupeKey: result.dedupeKey,
      attemptCount: result.attemptCount,
      maxAttempts: result.maxAttempts,
      lastError: result.lastError,
      remediation: 'Inspect the owning record and requeue this DEAD durable effect after correcting the underlying failure.',
    }, 'durable-effect job exhausted retries and requires operator remediation');
  }
  return result;
}

export async function markDurableEffectJobRetry(
  job: Pick<DurableEffectJobRow, 'id' | 'attemptCount' | 'maxAttempts'>,
  leaseToken: string,
  error: string,
  now = new Date(),
): Promise<DurableEffectJobRow> {
  const [updated] = await db.update(s.durableEffectJobs).set({
    status: DURABLE_EFFECT_STATUS.RETRY,
    nextAttemptAt: retryAt(now, job.attemptCount),
    leaseToken: null,
    leaseExpiresAt: null,
    lastError: error.slice(0, 1000),
    updatedAt: now,
  }).where(and(
    eq(s.durableEffectJobs.id, job.id),
    eq(s.durableEffectJobs.status, DURABLE_EFFECT_STATUS.RUNNING),
    eq(s.durableEffectJobs.leaseToken, leaseToken),
  )).returning();
  return updated ?? await reloadDurableEffectJob(job.id);
}

async function reloadDurableEffectJob(jobId: number): Promise<DurableEffectJobRow> {
  const [row] = await db.select().from(s.durableEffectJobs)
    .where(eq(s.durableEffectJobs.id, jobId))
    .limit(1);
  if (!row) throw new Error(`durable effect job ${jobId} not found`);
  return row;
}

async function defaultCacheInvalidateKey(key: string): Promise<void> {
  await cacheInvalidate(key);
  const client = getRedis();
  await client.del(key);
}

async function defaultStorageKeyReferenceCheck(storageKey: string): Promise<boolean> {
  const [tripPhoto, expensePhoto, tripExpensePhoto, shipmentDocument, companyLogo] = await Promise.all([
    db.select({ id: s.tripPhotos.id }).from(s.tripPhotos)
      .where(eq(s.tripPhotos.storageKey, storageKey)).limit(1),
    db.select({ id: s.expensePhotos.id }).from(s.expensePhotos)
      .where(eq(s.expensePhotos.storageKey, storageKey)).limit(1),
    db.select({ id: s.tripExpensePhotos.id }).from(s.tripExpensePhotos)
      .where(eq(s.tripExpensePhotos.storageKey, storageKey)).limit(1),
    db.select({ id: s.shipmentDocuments.id }).from(s.shipmentDocuments)
      .where(eq(s.shipmentDocuments.storageKey, storageKey)).limit(1),
    db.select({ key: s.appSettings.key }).from(s.appSettings)
      .where(and(
        eq(s.appSettings.key, 'company.logo_storage_key'),
        eq(s.appSettings.value, storageKey),
      ))
      .limit(1),
  ]);

  return tripPhoto.length > 0
    || expensePhoto.length > 0
    || tripExpensePhoto.length > 0
    || shipmentDocument.length > 0
    || companyLogo.length > 0;
}

async function defaultLegalInvoiceHandoff(): Promise<LegalInvoiceHandoffResult> {
  // SilverSea is the AR authority, not a tax-invoice issuer. Until an external
  // provider/manual reference is configured, the durable handoff records an
  // explicit unknown external state without inventing a legal invoice number.
  return { status: 'UNKNOWN' };
}

async function legalInvoiceHandoffNeedsStatusProbe(
  payload: LegalInvoiceHandoffEffect['payload'],
): Promise<boolean> {
  const [document] = await db.select({ legalInvoiceRef: s.billingDocuments.legalInvoiceRef })
    .from(s.billingDocuments)
    .where(eq(s.billingDocuments.id, payload.documentId))
    .limit(1);
  return document?.legalInvoiceRef?.requestVersion === payload.confirmedVersion
    && document.legalInvoiceRef.payloadHash === payload.payloadHash
    && document.legalInvoiceRef.status === 'UNKNOWN';
}

async function applyLegalInvoiceHandoffResult(
  payload: LegalInvoiceHandoffEffect['payload'],
  result: LegalInvoiceHandoffResult,
  now: Date,
  jobId: number,
  leaseToken: string | null,
): Promise<void> {
  await db.transaction(async (tx) => {
    if (!leaseToken) return;
    const [activeLease] = await tx.select({ id: s.durableEffectJobs.id })
      .from(s.durableEffectJobs)
      .where(and(
        eq(s.durableEffectJobs.id, jobId),
        eq(s.durableEffectJobs.status, DURABLE_EFFECT_STATUS.RUNNING),
        eq(s.durableEffectJobs.leaseToken, leaseToken),
        gt(s.durableEffectJobs.leaseExpiresAt, now),
      ))
      .limit(1)
      .for('update');
    if (!activeLease) return;
    const [document] = await tx.select({
      id: s.billingDocuments.id,
      version: s.billingDocuments.version,
      debitNoteStatus: s.billingDocuments.debitNoteStatus,
      legalInvoiceRef: s.billingDocuments.legalInvoiceRef,
    })
      .from(s.billingDocuments)
      .where(and(
        eq(s.billingDocuments.id, payload.documentId),
        isNull(s.billingDocuments.deletedAt),
      ))
      .limit(1)
      .for('update');
    if (!document) return;
    const reference = document.legalInvoiceRef;
    if (
      reference?.requestVersion !== payload.confirmedVersion
      || reference.payloadHash !== payload.payloadHash
      || reference.provider !== payload.provider
    ) {
      return;
    }
    if (document.debitNoteStatus === 'CANCELED' || document.debitNoteStatus === 'REJECTED') {
      await tx.update(s.billingDocuments).set({
        legalInvoiceRef: {
          ...reference,
          status: 'CANCELED',
          updatedAt: now.toISOString(),
        },
        version: sql`${s.billingDocuments.version} + 1`,
        updatedAt: now,
      }).where(eq(s.billingDocuments.id, document.id));
      return;
    }
    await tx.update(s.billingDocuments).set({
      legalInvoiceRef: {
        provider: payload.provider,
        status: result.status,
        providerReference: result.providerReference,
        requestVersion: payload.confirmedVersion,
        payloadHash: payload.payloadHash,
        checksum: result.checksum,
        issuedAt: result.issuedAt,
        updatedAt: now.toISOString(),
      },
      version: sql`${s.billingDocuments.version} + 1`,
      updatedAt: now,
    }).where(eq(s.billingDocuments.id, document.id));
  });
}

function parseJob(job: DurableEffectJobRow):
  | { ok: true; job: CacheInvalidateEffect | StorageDeleteEffect | LegalInvoiceHandoffEffect }
  | { ok: false; error: string } {
  if (job.kind === DURABLE_EFFECT_KIND.CACHE_INVALIDATE) {
    const parsed = cacheInvalidateJobSchema.safeParse({
      kind: job.kind,
      payloadVersion: job.payloadVersion,
      dedupeKey: job.dedupeKey,
      payload: job.payload,
      maxAttempts: job.maxAttempts,
    });
    return parsed.success
      ? { ok: true, job: parsed.data }
      : { ok: false, error: `invalid cache invalidate payload: ${parsed.error.issues[0]?.message ?? 'unknown'}` };
  }
  if (job.kind === DURABLE_EFFECT_KIND.STORAGE_DELETE) {
    const parsed = storageDeleteJobSchema.safeParse({
      kind: job.kind,
      payloadVersion: job.payloadVersion,
      dedupeKey: job.dedupeKey,
      payload: job.payload,
      maxAttempts: job.maxAttempts,
    });
    return parsed.success
      ? { ok: true, job: parsed.data }
      : { ok: false, error: `invalid storage delete payload: ${parsed.error.issues[0]?.message ?? 'unknown'}` };
  }
  if (job.kind === DURABLE_EFFECT_KIND.LEGAL_INVOICE_HANDOFF) {
    const parsed = legalInvoiceHandoffJobSchema.safeParse({
      kind: job.kind,
      payloadVersion: job.payloadVersion,
      dedupeKey: job.dedupeKey,
      payload: job.payload,
      maxAttempts: job.maxAttempts,
    });
    return parsed.success
      ? { ok: true, job: parsed.data }
      : { ok: false, error: `invalid legal invoice handoff payload: ${parsed.error.issues[0]?.message ?? 'unknown'}` };
  }
  return { ok: false, error: `unsupported durable effect kind/version: ${job.kind}@${job.payloadVersion}` };
}

function resolveMaxAttempts(input: DurableEffectInput): number {
  if (input.maxAttempts) return input.maxAttempts;
  return input.kind === DURABLE_EFFECT_KIND.STORAGE_DELETE
    ? STORAGE_DELETE_MAX_ATTEMPTS
    : 20;
}

function retryAt(now: Date, attemptCount: number): Date {
  const delay = DEFAULT_RETRY_DELAYS_MS[Math.min(Math.max(attemptCount - 1, 0), DEFAULT_RETRY_DELAYS_MS.length - 1)]!;
  return new Date(now.getTime() + delay);
}

function normalizeError(error: unknown): string {
  if (error instanceof Error) {
    return error.message.trim() || error.name;
  }
  if (typeof error === 'string') {
    return error.trim() || 'Unknown durable effect error';
  }
  try {
    return JSON.stringify(error);
  } catch {
    return 'Unknown durable effect error';
  }
}

export function logDurableEffectRunSummary(jobs: readonly DurableEffectJobRow[]): void {
  if (jobs.length === 0) return;
  const counts = jobs.reduce<Record<string, number>>((acc, job) => {
    acc[job.status] = (acc[job.status] ?? 0) + 1;
    return acc;
  }, {});
  const deadJobs = jobs.filter((job) => job.status === DURABLE_EFFECT_STATUS.DEAD);
  if (deadJobs.length > 0) {
    logger.error({
      counts,
      jobs: jobs.length,
      deadJobIds: deadJobs.map((job) => job.id),
      remediation: 'Inspect and requeue DEAD durable effects after correcting the underlying failure.',
    }, 'durable-effect-dispatch completed with DEAD jobs requiring operator action');
    return;
  }
  logger.info({ counts, jobs: jobs.length }, 'durable-effect-dispatch processed jobs');
}
