// Extracted verbatim from the original schema.ts split; behavior identical.
// Regenerate via drizzle-kit against the barrel: db/schema/index.ts.

import {
  boolean, date, doublePrecision, index, integer, jsonb, numeric, pgTable, serial, smallint, text, timestamp, uniqueIndex, varchar,
} from 'drizzle-orm/pg-core';
import { customerAccountTypeEnum, deleteRequestStatusEnum, notificationTypeEnum, roleEnum, schedulerRunStatusEnum } from './_enums';
// ─── Config tables ───────────────────────────────────────────────────────────
export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  username: varchar('username', { length: 100 }).unique(),
  email: varchar('email', { length: 255 }).unique(),
  phone: varchar('phone', { length: 20 }).unique(),
  // Human-readable full name (e.g. "Lê Văn Tài"). Used as the actor label in
  // audit log messages so users see "Quản lý Lê Văn Tài khóa chuyến" instead
  // of the email "Quản lý giamdoc@nepo.vn khóa chuyến #76".
  fullName: varchar('full_name', { length: 255 }),
  passwordHash: text('password_hash').notNull(),
  role: roleEnum('role').notNull().default('DRIVER'),
  status: varchar('status', { length: 20 }).notNull().default('ACTIVE'),
  // Wave 0: optional 1:1 link from a CUSTOMER-role user to the AR customer
  // whose data they may see in the customer portal (Wave 2). Nullable +
  // Application delete handling unlinks users when deleting a customer (rather
  // than cascading the delete onto the user accounts). Non-CUSTOMER roles
  // leave this NULL. M:N expansion (multiple logins per customer org) can
  // layer a customer_users join table on top without changing the helper's
  // signature.
  //
  // NOTE: declared as a plain integer to avoid
  // a TypeScript circular-initializer error. The chain
  // `users → customers → debitNoteTemplates → users` is valid at runtime
  // (Drizzle's lazy `() =>` resolves it) but TS strict mode rejects the
  // cycle. The application service enforces this relationship.
  customerId: integer('customer_id'),
  customerAccountType: customerAccountTypeEnum('customer_account_type').notNull().default('SINGLE_ENTITY'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  deletedAt: timestamp('deleted_at'),
});

export const businessCalendarDays = pgTable('business_calendar_days', {
  id: serial('id').primaryKey(),
  calendarDate: date('calendar_date').notNull(),
  name: varchar('name', { length: 255 }).notNull(),
  isWorkingDay: boolean('is_working_day').notNull().default(false),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => [
  uniqueIndex('business_calendar_days_date_uniq_idx').on(table.calendarDate),
]);

export const businessUnits = pgTable('business_units', {
  id: serial('id').primaryKey(),
  code: varchar('code', { length: 50 }).unique(),
  name: varchar('name', { length: 255 }).notNull(),
  status: varchar('status', { length: 20 }).notNull().default('ACTIVE'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => [
  uniqueIndex('business_units_name_uniq_idx').on(table.name),
  index('business_units_status_idx').on(table.status),
]);

export const userBusinessUnitLinks = pgTable('user_business_unit_links', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').notNull(),
  businessUnitId: integer('business_unit_id')
    .notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => [
  uniqueIndex('user_business_unit_links_user_unit_uniq_idx').on(table.userId, table.businessUnitId),
  index('user_business_unit_links_user_idx').on(table.userId),
  index('user_business_unit_links_business_unit_idx').on(table.businessUnitId),
]);

// ─── Audit ───────────────────────────────────────────────────────────────────
export const auditLogs = pgTable('audit_logs', {
  id: serial('id').primaryKey(),
  timestamp: timestamp('timestamp').defaultNow().notNull(),
  userId: integer('user_id'),
  actorName: varchar('actor_name', { length: 255 }),
  message: text('message').notNull(),
  entityType: varchar('entity_type', { length: 50 }),
  entityId: integer('entity_id'),
  payload: jsonb('payload').$type<Record<string, unknown>>(),
  ipAddress: varchar('ip_address', { length: 45 }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => [
  // The audit log grows on every governed write; entity-correlation and
  // user-scoped queries (audit-query.service) need these to stay O(log n).
  index('audit_logs_entity_idx').on(table.entityType, table.entityId),
  index('audit_logs_user_idx').on(table.userId),
]);


export const appSettings = pgTable('app_settings', {
  key: varchar('setting_key', { length: 120 }).primaryKey(),
  value: text('setting_value').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const durableEffectJobs = pgTable('durable_effect_jobs', {
  id: serial('id').primaryKey(),
  kind: varchar('kind', { length: 40 }).notNull(),
  payloadVersion: smallint('payload_version').notNull().default(1),
  dedupeKey: varchar('dedupe_key', { length: 255 }).notNull(),
  payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
  status: varchar('status', { length: 16 }).notNull().default('PENDING'),
  attemptCount: integer('attempt_count').notNull().default(0),
  maxAttempts: integer('max_attempts').notNull().default(20),
  nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }).defaultNow().notNull(),
  leaseToken: varchar('lease_token', { length: 100 }),
  leaseExpiresAt: timestamp('lease_expires_at', { withTimezone: true }),
  lastError: text('last_error'),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex('durable_effect_jobs_kind_dedupe_uniq_idx').on(table.kind, table.dedupeKey),
  index('durable_effect_jobs_due_idx').on(table.status, table.nextAttemptAt, table.id),
  index('durable_effect_jobs_lease_idx').on(table.status, table.leaseExpiresAt),
]);

/**
 * One row per truck: the most recent GPS fix seen by getLiveFleet(). Upserted on
 * every successful live-fleet poll so the dispatch map can fall back to the
 * last-known position (shown offline) when the Bách Khoa provider is down or a
 * specific truck is absent from its response — instead of the map going empty.
 * truck_id is the PK (1:1 per truck); telemetry is double precision so values
 * round-trip as native JS numbers (no numeric string juggling on readback).
 */

// ─── Notifications ──────────────────────────────────────────────────────────
export const notifications = pgTable('notifications', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').notNull(),
  type: notificationTypeEnum('type').notNull(),
  title: varchar('title', { length: 255 }).notNull(),
  message: text('message').notNull(),
  relatedEntityType: varchar('related_entity_type', { length: 50 }),
  relatedEntityId: integer('related_entity_id'),
  isRead: boolean('is_read').default(false).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => [
  index('notifications_user_unread_idx').on(table.userId, table.isRead),
  index('notifications_user_created_idx').on(table.userId, table.createdAt),
]);


// ─── Push subscriptions (Web Push) ──────────────────────────────────────────
// One row per (user, browser endpoint). Upserted on subscribe; auto-removed
// when the push service returns 410/404 (stale endpoint). device_type is
// sniffed client-side (ios/android/web) for reporting only.
export const pushSubscriptions = pgTable('push_subscriptions', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').notNull(),
  endpoint: varchar('endpoint', { length: 500 }).notNull(),
  keysP256dh: varchar('keys_p256dh', { length: 200 }).notNull(),
  keysAuth: varchar('keys_auth', { length: 100 }).notNull(),
  deviceType: varchar('device_type', { length: 20 }).default('web').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => [
  uniqueIndex('push_sub_user_endpoint_idx').on(table.userId, table.endpoint),
  index('push_sub_user_idx').on(table.userId),
]);


export const photoGeotags = pgTable('photo_geotags', {
  id: serial('id').primaryKey(),
  // entity_type is free-form text so the set of geotaggable
  // entities can grow without a migration — the shared GEOTAG_ENTITY_TYPES
  // const is the validated whitelist at the API boundary.
  entityType: varchar('entity_type', { length: 32 }).notNull(),
  entityId: integer('entity_id').notNull(),
  lat: doublePrecision('lat').notNull(),
  lng: doublePrecision('lng').notNull(),
  accuracy: doublePrecision('accuracy'),           // meters, device-reported
  altitude: doublePrecision('altitude'),           // meters
  // Device fix timestamp — the anti-replay freshness key. The service rejects
  // fixes >300s stale or >60s future (ported from the payroll reference).
  gpsAt: timestamp('gps_at', { withTimezone: true }),
  source: varchar('source', { length: 16 }).notNull().default('phone'), // phone | exif | manual
  // Diagnostic fields captured by the warm-fix hook — stored for triage, not
  // used for acceptance gating.
  sampleCount: integer('sample_count'),
  bestAccuracy: doublePrecision('best_accuracy'),
  elapsedMs: integer('elapsed_ms'),
  recordedBy: integer('recorded_by').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  // Application locking plus lookup enforces one geotag per photo and keeps
  // resubmission idempotent.
  uniqueIndex('photo_geotags_entity_uniq').on(table.entityType, table.entityId),
]);


export const schedulerRunLogs = pgTable('scheduler_run_logs', {
  id: serial('id').primaryKey(),
  // Free-form job name (matches registry key). varchar not enum so new jobs
  // don't need a migration.
  jobName: varchar('job_name', { length: 64 }).notNull(),
  // Cron expression actually scheduled (useful when a job's cadence is env-driven).
  cron: varchar('cron', { length: 32 }).notNull(),
  status: schedulerRunStatusEnum('status').notNull().default('RUNNING'),
  attempt: integer('attempt').notNull().default(1),
  // Null on SUCCESS; the thrown error message on FAILED. Text (not jsonb) so
  // a quick SELECT is readable without parsing.
  error: text('error'),
  startedAt: timestamp('started_at', { withTimezone: true }).defaultNow().notNull(),
  endedAt: timestamp('ended_at', { withTimezone: true }),
}, (table) => [
  index('scheduler_run_logs_job_started_idx').on(table.jobName, table.startedAt),
]);


// Idempotency key registry — server-side dedupe for "resubmit doesn't
// duplicate" (PRD M10-01-03; Q23 proposal: same request id → same result,
// no extra row). Currently used by the M10.1 clerk quick-create endpoint
// (`POST /api/shipments/quick`); future write paths (offline-queue sync,
// driver progress update) reuse the same generic shape.
//
// Design notes:
//   - Primary de-dup key is `(endpoint, idempotencyKey)` — a client-generated
//     opaque token (UUID v4 recommended, any string ≤ 100 chars). The endpoint
//     tag prevents an offline-queue replay for `/shipments/quick` from
//     silently matching a future `/trips/progress` key.
//   - On first write: insert the key with the created entity id, return 201.
//   - On replay with the same key + same payload: return 200 with the stored
//     shipment.
//   - On replay with the same key but a *different* payload: reject 409. This
//     is a client bug per Q23 — never silently overwrite.
//   - `payloadHash` is a shallow SHA-256 over the canonicalised body, used
//     only for the conflict check. We do NOT match on it for the success
//     path: the client-generated key is authoritative.
//   - Retention: rows are kept indefinitely (table size is bounded by total
//     write count). A cleanup job is out of scope for M10.1 slice 1.
export const idempotencyKeys = pgTable('idempotency_keys', {
  id: serial('id').primaryKey(),
  // Logical endpoint tag, e.g. 'shipments.quick-create'. Keeps unrelated
  // endpoints from sharing a keyspace.
  endpoint: varchar('endpoint', { length: 100 }).notNull(),
  // Client-generated idempotency key. Case-sensitive, treated as opaque.
  idempotencyKey: varchar('idempotency_key', { length: 100 }).notNull(),
  // The entity created by the original request. Nullable so future
  // non-entity-producing writes (e.g. "mark seen") can dedupe too.
  entityType: varchar('entity_type', { length: 50 }),
  entityId: integer('entity_id'),
  // SHA-256 hex of the canonicalised request body, for conflict detection.
  payloadHash: varchar('payload_hash', { length: 64 }).notNull(),
  // The original HTTP success code so future exact-replay consumers can return
  // the persisted command result without re-deriving transport semantics.
  responseStatusCode: integer('response_status_code').default(200).notNull(),
  // Immutable response snapshot returned to later same-key replays, even when
  // the underlying entity later changes. Stored in the exact JSON shape sent
  // back to callers (without the transport-level replayed marker).
  responseSnapshot: jsonb('response_snapshot').$type<Record<string, unknown> | unknown[] | string | number | boolean | null>(),
  createdBy: integer('created_by'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => [
  uniqueIndex('idempotency_keys_endpoint_key_uniq')
    .on(table.endpoint, table.idempotencyKey),
  index('idempotency_keys_entity_idx').on(table.entityType, table.entityId),
]);


export const deleteRequests = pgTable('delete_requests', {
  id: serial('id').primaryKey(),
  entityType: varchar('entity_type', { length: 50 }).notNull(),
  entityId: integer('entity_id').notNull(),
  requestedBy: integer('requested_by').notNull(),
  reason: text('reason'),
  status: deleteRequestStatusEnum('status').notNull().default('PENDING'),
  reviewedBy: integer('reviewed_by'),
  reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index('delete_requests_status_idx').on(table.status),
]);
