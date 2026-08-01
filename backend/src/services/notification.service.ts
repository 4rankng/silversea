import { EventEmitter } from 'events';
import { db } from '../db';
import { notifications } from '../db/schema';
import { eq, and, desc, count, inArray, isNull } from 'drizzle-orm';
import * as s from '../db/schema';
import { NotificationType, FINANCIAL_ROLES, PUSH_RULES, Role, isFinancialRole } from '@tingting/shared';
import * as pushService from './push.service';
import type { Tx } from './trip-shared';

const eventBus = new EventEmitter();
eventBus.setMaxListeners(50);
const NOTIFICATION_EVENT = 'notification:generate';
const NOTIFICATION_INSERT_BATCH_SIZE = 250;

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
  const targets = await resolveTargets(payload, client);
  if (targets.length === 0) return;

  const rows = targets.map(t => ({
    userId: t.userId,
    type: payload.type as (typeof notifications.type.enumValues)[number],
    title: payload.title,
    message: payload.message,
    relatedEntityType: payload.relatedEntityType ?? null,
    relatedEntityId: payload.relatedEntityId ?? null,
    isRead: false,
  }));
  for (let index = 0; index < rows.length; index += NOTIFICATION_INSERT_BATCH_SIZE) {
    await client.insert(notifications).values(
      rows.slice(index, index + NOTIFICATION_INSERT_BATCH_SIZE),
    );
  }

  // High-value push whitelist: only listed event types wake a device, and
  // only the configured audience. Best-effort — must never block in-app
  // delivery, and push failures are swallowed inside sendToUser.
  const audience = PUSH_RULES[payload.type];
  if (sendPush && audience) {
    const pushable = targets.filter(t =>
      audience === 'all' ||
      (audience === 'driver' && t.role === Role.DRIVER) ||
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

  const roles = payload.targetRoles
    ?? (payload.targetUserId != null || payload.targetDriverId != null ? [] : [...FINANCIAL_ROLES]);
  if (roles.length > 0) {
    const roleUsers = await client.select({ id: s.users.id, role: s.users.role })
      .from(s.users)
      .where(and(
        inArray(s.users.role, roles as (typeof s.users.role.enumValues)[number][]),
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
