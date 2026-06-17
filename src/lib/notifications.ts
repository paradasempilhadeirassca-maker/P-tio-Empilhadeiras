/**
 * Request permission for local browser notifications
 */
export async function requestNotificationPermission() {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    console.warn('This browser does not support desktop notification');
    return false;
  }

  try {
    const NotificationClass = window.Notification;
    if (NotificationClass.permission === 'granted') {
      return true;
    }

    if (NotificationClass.permission !== 'denied') {
      // Some browsers might still use callback-based requestPermission
      const permission = await NotificationClass.requestPermission();
      return permission === 'granted';
    }
  } catch (err) {
    console.error('Error requesting notification permission:', err);
  }

  return false;
}

/**
 * Send a local browser notification
 */
export async function sendLocalNotification(title: string, body: string) {
  if (typeof window === 'undefined' || !('Notification' in window)) return;

  try {
    const NotificationClass = window.Notification;
    if (NotificationClass.permission === 'granted') {
      const options = {
        body,
        icon: 'https://i.postimg.cc/SKcgQrKX/openart-image-CVX2wu-Ks-1775830140914-raw-Photoroom.png',
        badge: 'https://i.postimg.cc/SKcgQrKX/openart-image-CVX2wu-Ks-1775830140914-raw-Photoroom.png',
        vibrate: [200, 100, 200],
        tag: 'patio-notification',
        renotify: true
      };

      // Try service worker first as it is generally more stable in PWA environments
      if ('serviceWorker' in navigator) {
        try {
          const registration = await navigator.serviceWorker.ready;
          if (registration && 'showNotification' in registration) {
            await registration.showNotification(title, options);
          }
        } catch (swError) {
          console.warn('Service Worker notification failed, falling back to window.Notification', swError);
          if (typeof NotificationClass === 'function' && NotificationClass.prototype) {
            try {
              new (NotificationClass as any)(title, options);
            } catch (e) {}
          }
        }
      } else {
        if (typeof NotificationClass === 'function' && NotificationClass.prototype) {
          try {
            new (NotificationClass as any)(title, options);
          } catch (e) {}
        }
      }
    }
  } catch (globalError) {
    console.warn('Global notification error', globalError);
  }

  // Trigger backend API to broadcast to all push subscriptions (notifying closed apps!)
  try {
    fetch('/api/notifications/notify-all', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ title, body })
    }).catch(err => console.error('Error broadcasting notification to backend:', err));
  } catch (err) {
    console.error('Failed to trigger background notification broadcast:', err);
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
 * Subscribes the current device to backend Push Notifications
 */
export async function subscribeUserToPush(userId?: string | null) {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator) || !('PushManager' in window)) {
    console.warn('Push messaging is not supported in this browser.');
    return;
  }

  try {
    // Request permission first
    const permission = await window.Notification.requestPermission();
    if (permission !== 'granted') {
      console.warn('Notification permission not granted.');
      return;
    }

    const registration = await navigator.serviceWorker.ready;
    if (!registration.pushManager) {
      console.warn('Push manager is not available in service worker registration.');
      return;
    }

    // Try to get existing subscription
    let subscription = await registration.pushManager.getSubscription();

    // Fetch dynamic VAPID public key from backend
    const keyResponse = await fetch('/api/notifications/vapid-public-key');
    const keyData = await keyResponse.json();
    const applicationServerKey = urlB64ToUint8Array(keyData.publicKey);

    // To prevent signature/key mismatch errors from legacy containers or previous VAPID iterations,
    // we unsubscribe any existing subscription on this browser before making a fresh registration.
    if (subscription) {
      try {
        await subscription.unsubscribe();
      } catch (unsubErr) {
        console.warn('Error rolling over old subscription keys:', unsubErr);
      }
    }

    // Create a fresh subscription with the latest persistent server public key
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey
    });

    // Synchronize subscription details to backend database
    await fetch('/api/notifications/subscribe', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        subscription,
        userId: userId || null
      })
    });

    console.log('Dispositivos inscrito com sucesso em notificações push em segundo plano!');
  } catch (err) {
    console.error('Failed to subscribe user to push notifications:', err);
  }
}

/**
 * Utility to send WhatsApp notifications via the backend API.
 */
export async function sendWhatsAppNotification(message: string, to?: string) {
  // WhatsApp is currently disabled by user request, but keeping the logic for future use
  console.log('WhatsApp notification bypassed:', message);
  return { success: true, status: 'bypassed' };
}
