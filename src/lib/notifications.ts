import { auth } from '../firebase';

/**
 * Generates or retrieves a persistent, unique ID for the current browser/device.
 */
export function getOrCreateDeviceId(): string {
  if (typeof window === 'undefined') return '';
  let id = localStorage.getItem('patio_device_id');
  if (!id) {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
      id = crypto.randomUUID();
    } else {
      id = 'dev_' + Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
    }
    localStorage.setItem('patio_device_id', id);
  }
  return id;
}

/**
 * Synchronizes active push subscriptions - Stub for backwards-compatibility
 */
export async function syncPushSubscriptionsWithServer() {
  console.log('[Push Sync] Servidor agora gerencia e limpa inscrições automaticamente diretamente no banco de dados.');
}

/**
 * Request permission for local browser notifications
 */
export async function requestNotificationPermission() {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    console.warn('This browser does not support desktop notifications');
    return false;
  }

  try {
    const NotificationClass = window.Notification;
    if (NotificationClass.permission === 'granted') {
      return true;
    }

    if (NotificationClass.permission !== 'denied') {
      const permission = await NotificationClass.requestPermission();
      return permission === 'granted';
    }
  } catch (err) {
    console.error('Error requesting notification permission:', err);
  }

  return false;
}

/**
 * Send a local browser notification for immediate visual feedback (if focused).
 * If triggerPush is true, also invokes the server-side notify-all endpoint to deliver in real-time.
 */
export async function sendLocalNotification(title: string, body: string, triggerPush: boolean = false) {
  if (typeof window === 'undefined') return;

  // 1. Visual local feedback only (polite check: only display local notification if tab is focused)
  if ('Notification' in window && window.Notification.permission === 'granted' && document.visibilityState === 'visible') {
    const options = {
      body,
      icon: 'https://i.postimg.cc/SKcgQrKX/openart-image-CVX2wu-Ks-1775830140914-raw-Photoroom.png',
      badge: 'https://i.postimg.cc/SKcgQrKX/openart-image-CVX2wu-Ks-1775830140914-raw-Photoroom.png',
      vibrate: [200, 100, 200],
      tag: 'patio-notification',
      renotify: true
    };

    if ('serviceWorker' in navigator) {
      try {
        const registration = await navigator.serviceWorker.ready;
        if (registration && 'showNotification' in registration) {
          await registration.showNotification(title, options);
        }
      } catch (swError) {
        try {
          new window.Notification(title, options);
        } catch (e) {}
      }
    } else {
      try {
        new window.Notification(title, options);
      } catch (e) {}
    }
  }

  // 2. Real-time broadcast to all OTHER devices
  if (triggerPush) {
    try {
      const originDeviceId = getOrCreateDeviceId();
      const originUserEmail = auth?.currentUser?.email || null;
      const targetUrl = `${window.location.origin}/api/notifications/notify-all`;

      console.log(`[Push Client] Requesting background push broadcast. Origin Device: ${originDeviceId}`);

      const res = await fetch(targetUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          title,
          body,
          originDeviceId,
          originUserEmail
        })
      });

      if (!res.ok) {
        console.error(`[Push Client] Broadcast failed with status ${res.status}`);
      } else {
        const data = await res.json();
        console.log(`[Push Client] Broadcast processed successfully:`, data);
      }
    } catch (err) {
      console.error('[Push Client] Error sending broadcast request:', err);
    }
  }
}

/**
 * Helper to convert Web Push VAPID key
 */
function urlB64ToUint8Array(base64String: string) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding)
    .replace(/\-/g, '+')
    .replace(/_/g, '/');

  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);

  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

/**
 * Subscribes the current device to backend Push Notifications.
 */
export async function subscribeUserToPush(userId?: string | null) {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator) || !('PushManager' in window)) {
    console.warn('Push messaging is not supported in this browser.');
    return;
  }

  try {
    const permission = await window.Notification.requestPermission();
    if (permission !== 'granted') {
      console.warn('Notification permission not granted.');
      return;
    }

    const registration = await navigator.serviceWorker.ready;
    if (!registration.pushManager) {
      console.warn('Push manager is not available.');
      return;
    }

    const deviceId = getOrCreateDeviceId();
    const userAgent = navigator.userAgent || '';
    const platform = (navigator as any).userAgentData?.platform || navigator.platform || 'unknown';
    const appVersion = '1.0.0';

    let subscription = await registration.pushManager.getSubscription();

    // Fetch latest VAPID key
    const keyResponse = await fetch('/api/notifications/vapid-public-key');
    const keyData = await keyResponse.json();
    const applicationServerKey = urlB64ToUint8Array(keyData.publicKey);

    // Roll over existing subscription to avoid mismatches
    if (subscription) {
      try {
        await subscription.unsubscribe();
      } catch (unsubErr) {
        console.warn('Error unsubscribing old subscription:', unsubErr);
      }
    }

    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey
    });

    const safeId = btoa(subscription.endpoint)
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
      
    const plainSub = JSON.parse(JSON.stringify(subscription));

    // Server-side registration using Admin SDK API
    await fetch('/api/notifications/subscribe', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        subscription: plainSub,
        userId: userId || "",
        deviceId,
        metadata: {
          platform,
          userAgent,
          appVersion
        }
      })
    });

    console.log('[Push Client] Device successfully subscribed to push notifications!');
  } catch (err) {
    console.error('[Push Client] Failed to subscribe device to push notifications:', err);
  }
}

/**
 * Utility to send WhatsApp notifications via the backend API.
 */
export async function sendWhatsAppNotification(message: string, to?: string) {
  console.log('WhatsApp notification bypassed:', message);
  return { success: true, status: 'bypassed' };
}
