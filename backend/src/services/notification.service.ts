import { EventEmitter } from 'events';
import { db } from '../db';
import { notifications } from '../db/schema';
import { eq, and, desc, count, inArray, isNull, sql } from 'drizzle-orm';
import * as s from '../db/schema';
import { NotificationType, FINANCIAL_ROLES, PUSH_RULES, Role, isFinancialRole } from '@tingting/shared';
import * as pushService from './push.service';
import type { Tx } from './trip-shared';

const eventBus = new EventEmitter();
eventBus.setMaxListeners(50);
const NOTIFICATION_EVENT = 'notification:generate';
const NOTIFICATION_INSERT_BATCH_SIZE = 250;
type UserRoleValue = (typeof s.users.role.enumValues)[number];
type NotificationTypeValue = (typeof s.notifications.type.enumValues)[number];

// ─── Types ─────────────────────────────────────────────────────────────────

export interface NotificationPayload {
  type: NotificationType;
  title: string;
  message: string;
  relatedEntityType?: string;
  relatedEntityId?: number;
  targetUserId?: number;
  targetRoles?: string[];
  targetDriverId?: number;
}

// ─── Core CRUD ─────────────────────────────────────────────────────────────

/** O2C push MVP: dispatcher audience includes the dedicated Điều vận role. */
function isDispatcherRole(role: string): boolean {
  return role === Role.DISPATCHER || role === Role.MANAGER || role === Role.ADMIN;
}

function normalizeUserRoles(input: readonly string[] | null | undefined): UserRoleValue[] {
  if (!input?.length) return [];
  const normalized: UserRoleValue[] = [];
  const seen = new Set<UserRoleValue>();
  for (const raw of input) {
    const value = (() => {
      switch (raw.trim().toUpperCase()) {
        case 'ADMIN':
          return 'ADMIN';
        case 'MANAGER':
          return 'MANAGER';
        case 'ACCOUNTANT':
          return 'ACCOUNTANT';
        case 'DRIVER':
          return 'DRIVER';
        case 'FORWARDER':
          return 'FORWARDER';
        case 'CUSTOMER':
          return 'CUSTOMER';
        case 'CLERK':
          return 'CLERK';
        case 'DISPATCHER':
          return 'DISPATCHER';
        default:
          return null;
      }
    })();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    normalized.push(value);
  }
  return normalized;
}

function normalizeNotificationType(input: NotificationType | string): NotificationTypeValue {
  switch (input.trim().toUpperCase()) {
    case 'TRIP_CREATED':
      return 'TRIP_CREATED';
    case 'TRIP_DISPATCHED':
      return 'TRIP_DISPATCHED';
    case 'TRIP_IN_TRANSIT':
      return 'TRIP_IN_TRANSIT';
    case 'TRIP_COMPLETED':
      return 'TRIP_COMPLETED';
    case 'TRIP_CANCELED':
      return 'TRIP_CANCELED';
    case 'PAYMENT_RECEIVED':
      return 'PAYMENT_RECEIVED';
    case 'PENALTY_CREATED':
      return 'PENALTY_CREATED';
    case 'PENALTY_CANCELED':
      return 'PENALTY_CANCELED';
    case 'OVERDUE_PAYMENT':
      return 'OVERDUE_PAYMENT';
    case 'SALARY_PERIOD_CLOSING':
      return 'SALARY_PERIOD_CLOSING';
    case 'SYSTEM_ANNOUNCEMENT':
      return 'SYSTEM_ANNOUNCEMENT';
    case 'ADVANCE_SETTLEMENT_APPROVED':
      return 'ADVANCE_SETTLEMENT_APPROVED';
    case 'SHIPMENT_HANDOFF':
      return 'SHIPMENT_HANDOFF';
    default:
      throw new Error(`Unsupported notification type: ${input}`);
  }
}

export async function getNotifications(userId: number, page = 1, limit = 20) {
  const offset = (page - 1) * limit;
  const [items, [{ total }]] = await Promise.all([
    db.select()
      .from(notifications)
      .where(eq(notifications.userId, userId))
      .orderBy(desc(notifications.createdAt))
      .limit(limit)
      .offset(offset),
    db.select({ total: count() })
      .from(notifications)
      .where(eq(notifications.userId, userId)),
  ]);
  return { items, total, page, limit };
}

export async function getUnreadCount(userId: number) {
  const [{ total }] = await db.select({ total: count() })
    .from(notifications)
    .where(and(eq(notifications.userId, userId), eq(notifications.isRead, false)));
  return total;
}

export async function markAsRead(id: number, userId: number) {
  const [updated] = await db.update(notifications)
    .set({ isRead: true })
    .where(and(eq(notifications.id, id), eq(notifications.userId, userId)))
    .returning();
  return updated;
}

export async function markAllAsRead(userId: number) {
  await db.update(notifications)
    .set({ isRead: true })
    .where(and(eq(notifications.userId, userId), eq(notifications.isRead, false)));
}

// ─── Event bus ─────────────────────────────────────────────────────────────

export function initNotificationService() {
  eventBus.on(NOTIFICATION_EVENT, (payload: NotificationPayload) => {
    void generateNotification(payload).catch((err) => {
      console.error('Notification generation failed:', err);
    });
  });
}

export function emitNotification(payload: NotificationPayload) {
  eventBus.emit(NOTIFICATION_EVENT, payload);
}

/**
 * Use when the caller must not complete until the in-app notification is
 * persisted (for example, a scheduled job reporting a completed run).
 */
export async function emitNotificationAndWait(payload: NotificationPayload): Promise<void> {
  await generateNotification(payload);
}

/**
 * Persist an in-app notification as part of the caller's domain transaction.
 * Push delivery remains post-commit/best-effort; the durable in-app row is the
 * workflow guarantee for material writes.
 */
export async function persistNotificationInTx(tx: Tx, payload: NotificationPayload): Promise<void> {
  await generateNotification(payload, tx, false);
}

export async function sendNotificationPush(payload: NotificationPayload): Promise<void> {
  const audience = PUSH_RULES[payload.type];
  if (!audience) return;
  const targets = await resolveTargets(payload, db);
  const pushable = targets.filter((target) =>
    audience === 'all'
    || (audience === 'driver' && target.role === Role.DRIVER)
    || (audience === 'dispatcher' && isDispatcherRole(target.role))
    || (audience === 'financial' && isFinancialRole(target.role))
  );
  await Promise.allSettled(pushable.map((target) =>
    pushService.sendToUser(target.userId, payload.title, payload.message, notificationUrlForRole(payload, target.role), payload.type),
  ));
}

async function generateNotification(
  payload: NotificationPayload,
  client: typeof db | Tx = db,
  sendPush = true,
): Promise<void> {
  const notificationType = normalizeNotificationType(payload.type);
  const targets = await resolveTargets(payload, client);
  if (targets.length === 0) return;

  const targetIds = targets.map((target) => target.userId);
  for (let index = 0; index < targetIds.length; index += NOTIFICATION_INSERT_BATCH_SIZE) {
    const batchIds = targetIds.slice(index, index + NOTIFICATION_INSERT_BATCH_SIZE);
    await client.execute(sql`
      insert into "notifications" (
        "user_id",
        "type",
        "title",
        "message",
        "related_entity_type",
        "related_entity_id",
        "is_read"
      )
      select
        ${s.users.id},
        ${notificationType},
        ${payload.title},
        ${payload.message},
        ${payload.relatedEntityType ?? null},
        ${payload.relatedEntityId ?? null},
        false
      from "users"
      where ${inArray(s.users.id, batchIds)}
        and ${eq(s.users.status, 'ACTIVE')}
        and ${isNull(s.users.deletedAt)}
    `);
  }

  // High-value push whitelist: only listed event types wake a device, and
  // only the configured audience. Best-effort — must never block in-app
  // delivery, and push failures are swallowed inside sendToUser.
  const audience = PUSH_RULES[payload.type];
  if (sendPush && audience) {
    const pushable = targets.filter(t =>
      audience === 'all' ||
      (audience === 'driver' && t.role === Role.DRIVER) ||
      (audience === 'dispatcher' && isDispatcherRole(t.role)) ||
      (audience === 'financial' && isFinancialRole(t.role)),
    );
    await Promise.allSettled(pushable.map(t =>
      pushService.sendToUser(t.userId, payload.title, payload.message, notificationUrlForRole(payload, t.role), payload.type),
    ));
  }
}

// ─── Target resolution ─────────────────────────────────────────────────────

async function resolveTargets(
  payload: NotificationPayload,
  client: typeof db | Tx = db,
): Promise<{ userId: number; role: Role }[]> {
  const byId = new Map<number, Role | undefined>();

  if (payload.targetUserId) byId.set(payload.targetUserId, undefined);

  const requestedRoles = payload.targetRoles
    ?? (payload.targetUserId != null || payload.targetDriverId != null ? [] : [...FINANCIAL_ROLES]);
  const roles = normalizeUserRoles(requestedRoles);
  if (roles.length > 0) {
    const roleUsers = await client.select({ id: s.users.id, role: s.users.role })
      .from(s.users)
      .where(and(
        inArray(s.users.role, roles),
        eq(s.users.status, 'ACTIVE'),
        isNull(s.users.deletedAt),
      ));
    for (const u of roleUsers) byId.set(u.id, u.role as Role);
  }

  if (payload.targetDriverId) {
    const [driver] = await client.select({ userId: s.drivers.userId, role: s.users.role })
      .from(s.drivers)
      .innerJoin(s.users, eq(s.users.id, s.drivers.userId))
      .where(and(
        eq(s.drivers.id, payload.targetDriverId),
        eq(s.drivers.status, 'ACTIVE'),
        isNull(s.drivers.deletedAt),
        eq(s.users.status, 'ACTIVE'),
        isNull(s.users.deletedAt),
        eq(s.users.role, Role.DRIVER),
      ))
      .limit(1);
    if (driver?.userId) byId.set(driver.userId, driver.role as Role);
  }

  // Resolve roles for any explicitly-targeted user ids we don't yet know.
  const unknown = [...byId.entries()].filter(([, r]) => r === undefined).map(([uid]) => uid);
  if (unknown.length > 0) {
    const found = await client.select({ id: s.users.id, role: s.users.role })
      .from(s.users).where(and(
        inArray(s.users.id, unknown),
        eq(s.users.status, 'ACTIVE'),
        isNull(s.users.deletedAt),
      ));
    for (const u of found) byId.set(u.id, u.role as Role);
  }

  return [...byId.entries()]
    .filter(([, role]) => role !== undefined)
    .map(([userId, role]) => ({ userId, role: role as Role }));
}

/** Best-effort deep link for push clicks. Role-specific portals keep users in
 *  their own app surface instead of landing them on a forbidden desktop route.
 *  Mirrors frontend urlForNotification() in NotificationDrawer.tsx — the two
 *  must agree so a push and a drawer tap open the same screen. */
export function notificationUrlForRole(payload: NotificationPayload, role: Role): string | undefined {
  const id = payload.relatedEntityId;
  switch (payload.relatedEntityType) {
    case 'trips':
      if (role === Role.DRIVER) return id ? `/my-trips/${id}` : '/my-trips';
      if (role === Role.FORWARDER) return id ? `/my-forwarder-trips/${id}` : '/my-forwarder-trips';
      return id ? `/trips/${id}` : '/trips';
    case 'shipment_fulfillments':
      return role === Role.DRIVER ? (id ? `/my-trips/${id}` : '/my-trips') : undefined;
    case 'penalties':
      return role === Role.DRIVER ? '/my-penalties' : '/penalties';
    case 'payments':
      return role === Role.DRIVER ? '/my-earnings' : '/finance';
    case 'advance_settlements':
      return role === Role.FORWARDER
        ? (id ? `/my-settlements/${id}` : '/my-settlements')
        : (id ? `/settlements/${id}` : '/payables/forwarder-advances');
    case 'shipments':
      return id ? `/dispatch?shipmentId=${id}` : '/dispatch';
    default:
      return undefined;
  }
}
