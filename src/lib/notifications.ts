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
            return;
          }
        } catch (swError) {
          console.warn('Service Worker notification failed, falling back to window.Notification', swError);
        }
      }

      // Fallback to window.Notification
      // We wrap the instantiation in a check and a try-catch to handle "Illegal constructor"
      // NOTE: In some iframe environments, Notification is present but not a constructor.
      if (typeof NotificationClass === 'function') {
        try {
          // Double check if it's likely a constructor (simple heuristic)
          if (NotificationClass.prototype) {
            const instance = new (NotificationClass as any)(title, options);
            instance.onclick = () => {
              window.focus();
              instance.close();
            };
          }
        } catch (constructorError: any) {
          // Swallow "Illegal constructor" or similar instantiation errors in restricted environments
        }
      }
    }
  } catch (globalError) {
    console.warn('Global notification error', globalError);
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
