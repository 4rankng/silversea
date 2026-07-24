import { useState, useEffect, useCallback } from 'react';
import { notificationClient } from '../lib/notificationClient';
import type { PushSubscriptionPayload } from '@tingting/shared';

// Convert a base64url VAPID public key to the Uint8Array the Push API expects.
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const output = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) output[i] = rawData.charCodeAt(i);
  return output;
}

function sniffDeviceType(): PushSubscriptionPayload['deviceType'] {
  const ua = navigator.userAgent;
  if (/iPhone|iPad|iPod/.test(ua)) return 'ios';
  if (/Android/.test(ua)) return 'android';
  return 'web';
}

export type PushPermissionStatus = 'default' | 'granted' | 'denied' | 'unsupported';

// Module-level guard: prevents duplicate subscribe/unsubscribe work across hook
// instances and React StrictMode remounts.
let _busy = false;

interface UsePushNotificationsReturn {
  permissionStatus: PushPermissionStatus;
  isSubscribed: boolean;
  isSupported: boolean;
  isLoading: boolean;
  errorMessage: string | null;
  subscribe: () => Promise<boolean>;
  unsubscribe: () => Promise<void>;
}

async function getPushRegistration(): Promise<ServiceWorkerRegistration> {
  if (!('serviceWorker' in navigator)) {
    throw new Error('Service workers are not available in this browser');
  }

  const existing = await navigator.serviceWorker.getRegistration('/');
  if (existing?.active) return existing;

  if (existing) {
    // installing/waiting → a legitimate activation is in progress; wait for it.
    if (existing.installing || existing.waiting) return navigator.serviceWorker.ready;
    // No installing/waiting/active worker means the registration is 'redundant'
    // (a failed install). navigator.serviceWorker.ready never resolves in that
    // case and would hang subscribe() forever, so purge it before re-registering.
    await existing.unregister().catch(() => { /* best-effort */ });
  }

  // Vite dev does not register the app shell service worker globally because a
  // cache-first SW can interfere with HMR. For push opt-in we still need an SW,
  // so register it lazily only after the user interacts with the toggle.
  await navigator.serviceWorker.register('/sw.js');
  return navigator.serviceWorker.ready;
}

export function usePushNotifications(): UsePushNotificationsReturn {
  const [permissionStatus, setPermissionStatus] = useState<PushPermissionStatus>('default');
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  // Static feature-detection — never changes after first render, so a plain
  // const (not state) suffices and avoids a needless state slot.
  const isSupported =
    typeof window !== 'undefined' &&
    'Notification' in window &&
    'serviceWorker' in navigator &&
    'PushManager' in window;

  // Sync current OS permission + existing subscription on mount.
  useEffect(() => {
    if (!isSupported) {
      setPermissionStatus('unsupported');
      return;
    }
    const perm = Notification.permission as PushPermissionStatus;
    setPermissionStatus(perm);
    let alive = true;
    (async () => {
      try {
        const reg = await navigator.serviceWorker.getRegistration('/');
        if (!reg) {
          if (alive) setIsSubscribed(false);
          return;
        }
        const sub = await reg.pushManager.getSubscription();
        if (alive) setIsSubscribed(!!sub);
      } catch {
        /* SW not ready yet — ignore */
      }
    })();
    return () => {
      alive = false;
    };
  }, [isSupported]);

  const subscribe = useCallback(async (): Promise<boolean> => {
    if (!isSupported || _busy) return false;
    _busy = true;
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        setPermissionStatus(permission === 'denied' ? 'denied' : 'default');
        setErrorMessage(permission === 'denied' ? 'Quyền thông báo đang bị chặn trong trình duyệt.' : null);
        return false;
      }
      setPermissionStatus('granted');

      const { publicKey } = await notificationClient.getVapidKey();
      if (!publicKey) {
        console.error('Push not configured on server (empty VAPID public key)');
        setErrorMessage('Máy chủ chưa cấu hình khóa thông báo đẩy.');
        return false;
      }

      const registration = await getPushRegistration();
      const applicationServerKey = urlBase64ToUint8Array(publicKey) as BufferSource;

      // Subscribe, clearing any stale subscription bound to a different
      // applicationServerKey (e.g. after server-side key rotation): unsubscribe
      // the old one (locally + server-side) and retry once.
      let subscription: PushSubscription;
      try {
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey,
        });
      } catch (subscribeError) {
        const existing = await registration.pushManager.getSubscription();
        if (!existing) throw subscribeError;
        await existing.unsubscribe();
        try {
          await notificationClient.unsubscribePush(existing.endpoint);
        } catch {
          /* best-effort server cleanup */
        }
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey,
        });
      }

      const json = subscription.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } };
      await notificationClient.subscribePush({ endpoint: json.endpoint, keys: json.keys, deviceType: sniffDeviceType() });

      setPermissionStatus(Notification.permission as PushPermissionStatus);
      setIsSubscribed(true);
      setErrorMessage(null);
      return true;
    } catch (err) {
      console.error('Failed to subscribe to push:', err);
      setErrorMessage('Chưa bật được trên thiết bị này. Hãy thử lại hoặc kiểm tra cài đặt trình duyệt.');
      return false;
    } finally {
      _busy = false;
      setIsLoading(false);
    }
  }, [isSupported]);

  const unsubscribe = useCallback(async (): Promise<void> => {
    if (_busy) return;
    _busy = true;
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const registration = await navigator.serviceWorker.getRegistration('/');
      if (!registration) {
        setIsSubscribed(false);
        return;
      }
      const subscription = await registration.pushManager.getSubscription();
      if (subscription) {
        const endpoint = subscription.endpoint;
        await subscription.unsubscribe();
        await notificationClient.unsubscribePush(endpoint);
      }
      setIsSubscribed(false);
      setErrorMessage(null);
    } catch (err) {
      console.error('Failed to unsubscribe from push:', err);
    } finally {
      _busy = false;
      setIsLoading(false);
    }
  }, []);

  return { permissionStatus, isSubscribed, isSupported, isLoading, errorMessage, subscribe, unsubscribe };
}
