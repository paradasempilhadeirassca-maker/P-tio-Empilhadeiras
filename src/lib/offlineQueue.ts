export interface QueuedNotification {
  id: string;
  title: string;
  body: string;
  originDeviceId: string;
  originUserEmail: string | null;
  timestamp: number;
}

const DB_NAME = 'patio_offline_notifications_db';
const STORE_NAME = 'pending_notifications';
const DB_VERSION = 1;

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    // Check if indexedDB is available (works in both window and service worker global scopes)
    const idb = typeof indexedDB !== 'undefined' 
      ? indexedDB 
      : (typeof self !== 'undefined' && 'indexedDB' in self ? (self as any).indexedDB : null);
      
    if (!idb) {
      reject(new Error('IndexedDB is not supported in this environment'));
      return;
    }

    const request = idb.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event: any) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };

    request.onsuccess = (event: any) => {
      resolve(event.target.result);
    };

    request.onerror = (event: any) => {
      reject(event.target.error);
    };
  });
}

/**
 * Add a push notification to the persistent IndexedDB queue.
 */
export async function addNotificationToIndexedDB(item: QueuedNotification): Promise<void> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.put(item);

      request.onsuccess = () => {
        console.log(`[IndexedDB Queue] Saved offline notification: "${item.title}"`);
        resolve();
      };
      request.onerror = (e: any) => reject(e.target.error);
    });
  } catch (err) {
    console.error('[IndexedDB Queue] Failed to add notification:', err);
  }
}

/**
 * Retrieve all pending notifications from the IndexedDB queue.
 */
export async function getNotificationsFromIndexedDB(): Promise<QueuedNotification[]> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.getAll();

      request.onsuccess = () => resolve(request.result || []);
      request.onerror = (e: any) => reject(e.target.error);
    });
  } catch (err) {
    console.error('[IndexedDB Queue] Failed to get notifications:', err);
    return [];
  }
}

/**
 * Remove a successfully synchronized notification from the IndexedDB queue.
 */
export async function removeNotificationFromIndexedDB(id: string): Promise<void> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.delete(id);

      request.onsuccess = () => {
        console.log(`[IndexedDB Queue] Removed notification from queue: id ${id}`);
        resolve();
      };
      request.onerror = (e: any) => reject(e.target.error);
    });
  } catch (err) {
    console.error('[IndexedDB Queue] Failed to delete notification:', err);
  }
}
