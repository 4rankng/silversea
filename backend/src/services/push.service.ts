import webpush from 'web-push';
import { db } from '../db';
import { pushSubscriptions } from '../db/schema';
import { eq, and } from 'drizzle-orm';
import { config } from '../config';
import type { PushSubscriptionPayload } from '@tingting/shared';

// Push is best-effort: it must NEVER throw into the notification bus, and a
// single dead endpoint must never abort delivery to the rest. See payroll's
// push_service.go for the reference behavior this mirrors.

let enabled = false;

/** Configure VAPID once at boot. No-ops (push disabled) when keys are absent. */
export function initPushService() {
  if (config.vapidPublicKey && config.vapidPrivateKey) {
    webpush.setVapidDetails(
      config.vapidSubject || 'mailto:admin@tingting.vip',
      config.vapidPublicKey,
      config.vapidPrivateKey,
    );
    enabled = true;
    console.log('✓ Web Push enabled (VAPID configured)');
  } else {
    enabled = false;
    console.warn('⚠️  Web Push disabled — set VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY to enable');
  }
}

/** Store/refresh a browser subscription for a user (upsert on user+endpoint). */
export async function subscribe(userId: number, sub: PushSubscriptionPayload) {
  await db.insert(pushSubscriptions)
    .values({
      userId,
      endpoint: sub.endpoint,
      keysP256dh: sub.keys.p256dh,
      keysAuth: sub.keys.auth,
      deviceType: sub.deviceType ?? 'web',
    })
    .onConflictDoUpdate({
      target: [pushSubscriptions.userId, pushSubscriptions.endpoint],
      set: {
        keysP256dh: sub.keys.p256dh,
        keysAuth: sub.keys.auth,
        deviceType: sub.deviceType ?? 'web',
      },
    });
}

/**
 * Remove a user's subscription for a given endpoint. Scoped by (userId,
 * endpoint): a single browser endpoint can be registered under multiple
 * userIds on a shared device, so deleting by endpoint alone would wipe other
 * users' still-valid subscriptions.
 */
export async function unsubscribe(userId: number, endpoint: string) {
  await db.delete(pushSubscriptions)
    .where(and(eq(pushSubscriptions.userId, userId), eq(pushSubscriptions.endpoint, endpoint)));
}

function statusCodeOf(err: unknown): number | undefined {
  if (err && typeof err === 'object' && 'statusCode' in err) {
    const code = (err as { statusCode?: unknown }).statusCode;
    return typeof code === 'number' ? code : undefined;
  }
  return undefined;
}

/**
 * Deliver a push to every subscription owned by `userId`. Never throws.
 * Endpoints that return 410 (Gone) or 404 (Not Found) are auto-deleted.
 */
export async function sendToUser(userId: number, title: string, body: string, url?: string, type?: string) {
  if (!enabled) return;

  // Honor the "never throws" contract on the DB read too — a transient Postgres
  // blip here must not reject into the notification bus (callers use
  // Promise.allSettled today, but the contract shouldn't depend on that).
  let subs: { endpoint: string; keysP256dh: string; keysAuth: string }[];
  try {
    subs = await db.select({
      endpoint: pushSubscriptions.endpoint,
      keysP256dh: pushSubscriptions.keysP256dh,
      keysAuth: pushSubscriptions.keysAuth,
    }).from(pushSubscriptions).where(eq(pushSubscriptions.userId, userId));
  } catch (err) {
    console.warn(`Push subscription load failed (user=${userId}):`,
      err instanceof Error ? err.message : err);
    return;
  }

  if (subs.length === 0) return;

  const payload = JSON.stringify({
    title,
    body,
    url: url ?? '/',
    icon: '/assets/logo-192.png',
    badge: '/assets/logo-192.png',
    tag: `tingting-${type ?? 'notification'}-${url ?? 'home'}`,
    type,
  });

  await Promise.all(subs.map(async (s) => {
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.keysP256dh, auth: s.keysAuth } },
        payload,
        { TTL: 86400, urgency: 'high' },
      );
    } catch (err) {
      const code = statusCodeOf(err);
      // 410 Gone / 404 Not Found => the subscription no longer exists. Purge it
      // so we stop attempting to send to a dead endpoint. Other codes (400/401/
      // 403/413/429…) are sender-side/transient — keep the row and retry later.
      if (code === 410 || code === 404) {
        await unsubscribe(userId, s.endpoint).catch(() => { /* best-effort */ });
      } else {
        console.warn(`Push send failed (status=${code ?? '?'} user=${userId}):`,
          err instanceof Error ? err.message : err);
      }
    }
  }));
}
