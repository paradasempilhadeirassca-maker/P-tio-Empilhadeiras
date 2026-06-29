import { initializeApp, getApps, getApp } from "firebase/app";
import { 
  getFirestore, 
  collection, 
  doc, 
  getDoc, 
  getDocs, 
  setDoc, 
  updateDoc, 
  deleteDoc, 
  query, 
  where 
} from "firebase/firestore";
import webpush from "web-push";
import fs from "fs";
import path from "path";

// Load firebaseConfig safely across node engines
const firebaseConfig = JSON.parse(
  fs.readFileSync(path.join(process.cwd(), "firebase-applet-config.json"), "utf8")
);

// Initialize Firebase Client SDK if not already done
const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();
const firestoreInstance = getFirestore(app, firebaseConfig.firestoreDatabaseId);

// Compatibility wrapper to make standard Firestore Client SDK act like the Node Admin SDK
export const db = {
  collection(colName: string) {
    return {
      doc(docId: string) {
        return {
          async get() {
            const d = await getDoc(doc(firestoreInstance, colName, docId));
            return {
              exists: d.exists(),
              id: d.id,
              ref: {
                async delete() {
                  await deleteDoc(doc(firestoreInstance, colName, docId));
                }
              },
              data() {
                return d.data();
              }
            };
          },
          async set(data: any) {
            await setDoc(doc(firestoreInstance, colName, docId), data);
          },
          async update(data: any) {
            await updateDoc(doc(firestoreInstance, colName, docId), data);
          },
          async delete() {
            await deleteDoc(doc(firestoreInstance, colName, docId));
          }
        };
      },
      
      async get() {
        const q = query(collection(firestoreInstance, colName));
        const snapshot = await getDocs(q);
        return {
          size: snapshot.size,
          docs: snapshot.docs.map(d => ({
            id: d.id,
            ref: {
              async delete() {
                await deleteDoc(doc(firestoreInstance, colName, d.id));
              }
            },
            data() {
              return d.data();
            }
          }))
        };
      },

      where(field: string, op: any, value: any) {
        const constraints = [where(field, op, value)];
        return {
          where(f2: string, op2: any, v2: any) {
            constraints.push(where(f2, op2, v2));
            return this;
          },
          async get() {
            const q = query(collection(firestoreInstance, colName), ...constraints);
            const snapshot = await getDocs(q);
            return {
              size: snapshot.size,
              docs: snapshot.docs.map(d => ({
                id: d.id,
                ref: {
                  async delete() {
                    await deleteDoc(doc(firestoreInstance, colName, d.id));
                  }
                },
                data() {
                  return d.data();
                }
              }))
            };
          }
        };
      }
    };
  }
};

export interface PushSubscriptionFields {
  endpoint: string;
  keys: {
    auth: string;
    p256dh: string;
  };
  userId: string;
  deviceId: string;
  createdAt: string;
  updatedAt: string;
  platform: string;
  userAgent: string;
  appVersion: string;
  lastSeen: string;
  active: boolean;
}

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Sends a notification with exponential backoff retries for transient errors.
 */
async function sendWithRetry(subscription: any, payload: string, maxRetries = 3): Promise<any> {
  let attempt = 0;
  let backoff = 500; // ms
  
  while (attempt < maxRetries) {
    try {
      return await webpush.sendNotification(subscription, payload);
    } catch (err: any) {
      attempt++;
      const statusCode = err.statusCode || 0;
      
      // Transient errors that should be retried (e.g., 500, 502, 503, 504, Timeout or Network errors)
      const isTransient = 
        statusCode === 500 || 
        statusCode === 502 || 
        statusCode === 503 || 
        statusCode === 504 || 
        err.code === 'ETIMEDOUT' || 
        err.message?.toLowerCase().includes('timeout') || 
        err.message?.toLowerCase().includes('network') ||
        err.message?.toLowerCase().includes('econnreset');
      
      if (isTransient && attempt < maxRetries) {
        console.warn(`[Push Service] Transient error (${statusCode || err.code || err.message}) sending push. Attempt ${attempt}/${maxRetries}. Retrying in ${backoff}ms...`);
        await delay(backoff);
        backoff *= 2; // Exponential backoff
      } else {
        throw err;
      }
    }
  }
}

export class PushNotificationService {
  private static vapidPublicKey = process.env.VAPID_PUBLIC_KEY || "";
  private static vapidPrivateKey = process.env.VAPID_PRIVATE_KEY || "";
  private static keysInitialized = false;

  /**
   * Initializes the VAPID keys from environment variables, Firestore, or fallback file.
   */
  public static async initVapidKeys(): Promise<string> {
    if (this.keysInitialized && this.vapidPublicKey) {
      return this.vapidPublicKey;
    }

    if (this.vapidPublicKey && this.vapidPrivateKey) {
      webpush.setVapidDetails(
        "mailto:paradas.empilhadeiras.sca@gmail.com",
        this.vapidPublicKey,
        this.vapidPrivateKey
      );
      this.keysInitialized = true;
      return this.vapidPublicKey;
    }

    try {
      // Fetch from Firestore using Admin SDK
      const keysDoc = await db.collection("system_settings").doc("vapid_keys").get();
      if (keysDoc.exists) {
        const data = keysDoc.data();
        if (data && data.publicKey && data.privateKey) {
          this.vapidPublicKey = data.publicKey;
          this.vapidPrivateKey = data.privateKey;
          console.log("[Push Service] Successfully loaded VAPID keys from Firestore!");
          webpush.setVapidDetails(
            "mailto:paradas.empilhadeiras.sca@gmail.com",
            this.vapidPublicKey,
            this.vapidPrivateKey
          );
          this.keysInitialized = true;
          return this.vapidPublicKey;
        }
      }

      console.log("[Push Service] No VAPID keys found in Firestore. Generating and persisting...");
      const keys = webpush.generateVAPIDKeys();
      this.vapidPublicKey = keys.publicKey;
      this.vapidPrivateKey = keys.privateKey;

      await db.collection("system_settings").doc("vapid_keys").set({
        publicKey: this.vapidPublicKey,
        privateKey: this.vapidPrivateKey,
        createdAt: new Date().toISOString()
      });

      webpush.setVapidDetails(
        "mailto:paradas.empilhadeiras.sca@gmail.com",
        this.vapidPublicKey,
        this.vapidPrivateKey
      );
      this.keysInitialized = true;
      return this.vapidPublicKey;
    } catch (err: any) {
      console.error("[Push Service] Failed to load/persist VAPID keys from Firestore, falling back to local files:", err.message || err);
      
      const VAPID_KEYS_FILE = path.join(process.cwd(), ".vapid-keys.json");
      if (fs.existsSync(VAPID_KEYS_FILE)) {
        try {
          const keys = JSON.parse(fs.readFileSync(VAPID_KEYS_FILE, 'utf8'));
          this.vapidPublicKey = keys.publicKey;
          this.vapidPrivateKey = keys.privateKey;
        } catch (fileErr) {
          console.error("[Push Service] Error reading fallback local VAPID keys:", fileErr);
        }
      }

      if (!this.vapidPublicKey || !this.vapidPrivateKey) {
        const keys = webpush.generateVAPIDKeys();
        this.vapidPublicKey = keys.publicKey;
        this.vapidPrivateKey = keys.privateKey;
        try {
          fs.writeFileSync(VAPID_KEYS_FILE, JSON.stringify(keys), 'utf8');
        } catch (writeErr) {
          console.error("[Push Service] Failed to write local backup keys:", writeErr);
        }
      }

      webpush.setVapidDetails(
        "mailto:paradas.empilhadeiras.sca@gmail.com",
        this.vapidPublicKey,
        this.vapidPrivateKey
      );
      this.keysInitialized = true;
      return this.vapidPublicKey;
    }
  }

  /**
   * Registers or updates a device subscription in Firestore.
   * Ensures that only ONE active subscription exists per physical device (using deviceId).
   */
  public static async registerDevice(params: {
    deviceId: string;
    userId: string;
    subscription: any;
    metadata?: {
      platform?: string;
      userAgent?: string;
      appVersion?: string;
    }
  }): Promise<void> {
    const { deviceId, userId, subscription, metadata } = params;

    if (!subscription || !subscription.endpoint) {
      throw new Error("Invalid subscription object");
    }

    if (!deviceId) {
      throw new Error("Missing persistent deviceId");
    }

    const safeDocId = Buffer.from(subscription.endpoint).toString('base64url');
    console.log(`[Push Service] Registering subscription for device "${deviceId}" (User: "${userId || "Anonymous"}")`);

    // Ensure only ONE subscription exists per deviceId
    // Find any existing subscription with this deviceId
    try {
      const existingQuery = await db.collection("push_subscriptions")
        .where("deviceId", "==", deviceId)
        .get();

      for (const docSnapshot of existingQuery.docs) {
        if (docSnapshot.id !== safeDocId) {
          console.log(`[Push Service] Cleaning up old subscription (${docSnapshot.id}) for device "${deviceId}" to enforce unique-device constraint.`);
          await docSnapshot.ref.delete();
        }
      }
    } catch (err: any) {
      console.warn(`[Push Service] Error checking existing deviceId subscriptions:`, err.message || err);
    }

    // Now check if this endpoint doc already exists to preserve `createdAt`
    const docRef = db.collection("push_subscriptions").doc(safeDocId);
    const docSnap = await docRef.get();
    
    let createdAt = new Date().toISOString();
    if (docSnap.exists) {
      const existingData = docSnap.data();
      if (existingData && existingData.createdAt) {
        createdAt = existingData.createdAt;
      }
    }

    const keys = {
      auth: subscription.keys?.auth || "",
      p256dh: subscription.keys?.p256dh || ""
    };

    const docData: PushSubscriptionFields = {
      endpoint: subscription.endpoint,
      keys,
      userId: userId || "",
      deviceId,
      createdAt,
      updatedAt: new Date().toISOString(),
      platform: metadata?.platform || "unknown",
      userAgent: metadata?.userAgent || "unknown",
      appVersion: metadata?.appVersion || "1.0.0",
      lastSeen: new Date().toISOString(),
      active: true
    };

    // Save to Firestore directly using the Admin SDK
    try {
      await docRef.set(docData);
      console.log(`\n=============================================================`);
      console.log(`[Push Service - REGISTRATION SUCCESS]`);
      console.log(`- DeviceId: "${deviceId}"`);
      console.log(`- UserId: "${userId || "Anonymous"}"`);
      console.log(`- Endpoint: "${subscription.endpoint}"`);
      console.log(`- Resultado da gravação: SUCESSO (Firestore)`);
      console.log(`- ID do documento criado: "${safeDocId}"`);
      console.log(`=============================================================\n`);

      // 8. Immediate verification read
      try {
        console.log(`[Push Service - DIAGNOSTIC] Lendo a coleção push_subscriptions para verificação imediata...`);
        const snapshot = await db.collection("push_subscriptions").get();
        const docIds = snapshot.docs.map(doc => doc.id);
        console.log(`\n=================== FIRESTORE CONFIRMATION ===================`);
        console.log(`- Quantidade de documentos na coleção: ${snapshot.size}`);
        console.log(`- IDs encontrados:`, JSON.stringify(docIds, null, 2));
        console.log(`==============================================================\n`);
      } catch (readErr: any) {
        console.error(`[Push Service - DIAGNOSTIC ERROR] Falha ao ler a coleção para confirmação:`, readErr.stack || readErr);
      }

    } catch (dbErr: any) {
      console.error(`\n=============================================================`);
      console.error(`[Push Service - REGISTRATION FAILURE]`);
      console.error(`- DeviceId: "${deviceId}"`);
      console.error(`- UserId: "${userId || "Anonymous"}"`);
      console.error(`- Endpoint: "${subscription.endpoint}"`);
      console.error(`- Resultado da gravação: ERRO`);
      console.error(`- Stack do Erro:`, dbErr.stack || dbErr);
      console.error(`=============================================================\n`);
      throw dbErr;
    }
  }

  /**
   * Broadcasts a push notification to all registered devices except the origin device.
   * Performs full validation, duplicate filtering, invalid subscription pruning, and retries.
   */
  public static async broadcastNotification(params: {
    title: string;
    body: string;
    originDeviceId?: string | null;
    originUserEmail?: string | null;
  }): Promise<{
    success: boolean;
    totalCount: number;
    sentCount: number;
    failedCount: number;
    prunedCount: number;
    durationMs: number;
  }> {
    const startTime = Date.now();
    const { title, body, originDeviceId, originUserEmail } = params;

    console.log(`\n=============================================================`);
    console.log(`[Push Service - BROADCAST] Starting notification process:`);
    console.log(`- Title: "${title}"`);
    console.log(`- Body: "${body}"`);
    console.log(`- Origin Device ID: "${originDeviceId || "None"}"`);
    console.log(`- Origin User: "${originUserEmail || "None"}"`);
    console.log(`=============================================================\n`);

    // Ensure VAPID keys are initialized
    await this.initVapidKeys();

    // 1. Fetch all active subscriptions from Firestore
    let allDocs: any[] = [];
    try {
      const querySnap = await db.collection("push_subscriptions")
        .where("active", "==", true)
        .get();
      allDocs = querySnap.docs;
      console.log(`[Push Service] Loaded ${allDocs.length} active subscription documents from Firestore.`);
    } catch (err: any) {
      console.error(`[Push Service] Critical error loading active subscriptions:`, err);
      throw err;
    }

    const payload = JSON.stringify({ title, body });
    const subscriptionsToSend: { docId: string; data: PushSubscriptionFields }[] = [];
    let prunedCount = 0;

    // 2. Validate and filter subscriptions
    const uniqueEndpoints = new Set<string>();

    for (const docSnap of allDocs) {
      const docId = docSnap.id;
      const data = docSnap.data() as PushSubscriptionFields;

      // Ensure basic shape is valid
      const endpoint = data.endpoint;
      const keys = data.keys;
      const authKey = keys?.auth;
      const p256dhKey = keys?.p256dh;

      // Validate subscription before sending (Requirement 8)
      if (!endpoint || !keys || !authKey || !p256dhKey || !data.active) {
        console.warn(`[Push Service] Pruning invalid subscription (Doc ID: ${docId}) - missing critical fields.`);
        try {
          await docSnap.ref.delete();
          prunedCount++;
        } catch (delErr: any) {
          console.error(`[Push Service] Error deleting invalid sub ${docId}:`, delErr.message || delErr);
        }
        continue;
      }

      // Filter out duplicate endpoints
      if (uniqueEndpoints.has(endpoint)) {
        console.log(`[Push Service] Pruning duplicate subscription (Doc ID: ${docId}) - endpoint already covered.`);
        try {
          await docSnap.ref.delete();
          prunedCount++;
        } catch (delErr: any) {
          console.error(`[Push Service] Error deleting duplicate sub ${docId}:`, delErr.message || delErr);
        }
        continue;
      }
      uniqueEndpoints.add(endpoint);

      // Exclude origin device if specified (Requirement 7: using deviceId)
      if (originDeviceId && data.deviceId === originDeviceId) {
        console.log(`[Push Service] Skipping origin device (ID: ${originDeviceId}, Doc: ${docId}).`);
        continue;
      }

      subscriptionsToSend.push({ docId, data });
    }

    console.log(`[Push Service] Validated and filtered. Sending to ${subscriptionsToSend.length} devices...`);

    let sentCount = 0;
    let failedCount = 0;

    // 3. Send in parallel using Promise.allSettled (Requirement 10)
    const sendPromises = subscriptionsToSend.map(async (item) => {
      const subObj = {
        endpoint: item.data.endpoint,
        keys: {
          auth: item.data.keys.auth,
          p256dh: item.data.keys.p256dh
        }
      };

      try {
        // Send with exponential backoff retries (Requirement 11)
        await sendWithRetry(subObj, payload);
        sentCount++;
        console.log(`[Push Service] ✅ Notification delivered to device (ID: ${item.data.deviceId}, Doc: ${item.docId})`);
        
        // Update lastSeen of the subscription
        try {
          await db.collection("push_subscriptions").doc(item.docId).update({
            lastSeen: new Date().toISOString()
          });
        } catch (e) {}
      } catch (err: any) {
        failedCount++;
        const statusCode = err.statusCode || 0;
        const errMsg = err.message || "Unknown error";
        console.error(`[Push Service] ❌ Failed to deliver to device (ID: ${item.data.deviceId}, Doc: ${item.docId}). Status: ${statusCode}. Error: ${errMsg}`);

        // Automatically remove invalid or expired subscriptions (Requirement 9)
        // 404/410, subscription gone/expired
        const isExpiredOrGone = 
          statusCode === 404 || 
          statusCode === 410 || 
          errMsg.toLowerCase().includes("expired") || 
          errMsg.toLowerCase().includes("gone") ||
          errMsg.toLowerCase().includes("notfound") ||
          errMsg.toLowerCase().includes("unsubscribed");
          
        if (isExpiredOrGone) {
          console.log(`[Push Service] Permanent failure detected (${statusCode}). Automatically deleting subscription: ${item.docId}`);
          try {
            await db.collection("push_subscriptions").doc(item.docId).delete();
            prunedCount++;
          } catch (delErr: any) {
            console.error(`[Push Service] Error deleting expired sub ${item.docId}:`, delErr.message || delErr);
          }
        }
      }
    });

    await Promise.allSettled(sendPromises);

    const totalDuration = Date.now() - startTime;
    console.log(`\n=============================================================`);
    console.log(`[Push Service - BROADCAST COMPLETE] Finished broadcast:`);
    console.log(`- Duration: ${totalDuration}ms`);
    console.log(`- Sent successfully: ${sentCount}`);
    console.log(`- Failed: ${failedCount}`);
    console.log(`- Pruned: ${prunedCount}`);
    console.log(`=============================================================\n`);

    return {
      success: true,
      totalCount: subscriptionsToSend.length,
      sentCount,
      failedCount,
      prunedCount,
      durationMs: totalDuration
    };
  }
}
