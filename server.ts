import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import twilio from "twilio";
import dotenv from "dotenv";
import admin from "firebase-admin";
import webpush from "web-push";
import fs from "fs";

dotenv.config();

// Load firebaseConfig safely across node engines
const firebaseConfig = JSON.parse(
  fs.readFileSync(path.join(process.cwd(), "firebase-applet-config.json"), "utf8")
);

// Initialize Firebase Admin SDK
if (admin.apps.length === 0) {
  admin.initializeApp({
    projectId: firebaseConfig.projectId
  });
}

// REST-based Firestore client to bypass IAM permission limitations in Sandbox environments
const FIRESTORE_BASE_URL = `https://firestore.googleapis.com/v1/projects/${firebaseConfig.projectId}/databases/${firebaseConfig.firestoreDatabaseId}/documents`;
const FIRESTORE_API_KEY = firebaseConfig.apiKey;

function toFirestoreFields(obj: any): any {
  const fields: any = {};
  for (const [key, val] of Object.entries(obj)) {
    if (val === null || val === undefined) {
      continue;
    }
    if (typeof val === 'string') {
      fields[key] = { stringValue: val };
    } else if (typeof val === 'number') {
      fields[key] = { doubleValue: val };
    } else if (typeof val === 'boolean') {
      fields[key] = { booleanValue: val };
    } else if (typeof val === 'object') {
      if (val instanceof Date) {
        fields[key] = { timestampValue: val.toISOString() };
      } else if (Array.isArray(val)) {
        fields[key] = toFirestoreArrayValue(val);
      } else {
        fields[key] = { mapValue: { fields: toFirestoreFields(val) } };
      }
    }
  }
  return fields;
}

function toFirestoreArrayValue(arr: any[]): any {
  return {
    arrayValue: {
      values: arr.map(item => {
        if (typeof item === 'string') return { stringValue: item };
        if (typeof item === 'number') return { doubleValue: item };
        if (typeof item === 'boolean') return { booleanValue: item };
        if (typeof item === 'object') return { mapValue: { fields: toFirestoreFields(item) } };
        return { stringValue: String(item) };
      })
    }
  };
}

function fromFirestoreFields(fields: any): any {
  if (!fields) return {};
  const res: any = {};
  for (const [key, val] of Object.entries(fields)) {
    const v = val as any;
    if ('stringValue' in v) {
      res[key] = v.stringValue;
    } else if ('doubleValue' in v) {
      res[key] = Number(v.doubleValue);
    } else if ('integerValue' in v) {
      res[key] = Number(v.integerValue);
    } else if ('booleanValue' in v) {
      res[key] = v.booleanValue;
    } else if ('timestampValue' in v) {
      res[key] = v.timestampValue;
    } else if ('mapValue' in v && v.mapValue && v.mapValue.fields) {
      res[key] = fromFirestoreFields(v.mapValue.fields);
    } else if ('arrayValue' in v && v.arrayValue && v.arrayValue.values) {
      res[key] = v.arrayValue.values.map((item: any) => {
        if ('stringValue' in item) return item.stringValue;
        if ('doubleValue' in item) return Number(item.doubleValue);
        if ('integerValue' in item) return Number(item.integerValue);
        if ('booleanValue' in item) return item.booleanValue;
        if ('mapValue' in item && item.mapValue && item.mapValue.fields) {
          return fromFirestoreFields(item.mapValue.fields);
        }
        return item;
      });
    }
  }
  return res;
}

async function getDocRest(collectionName: string, docId: string) {
  const url = `${FIRESTORE_BASE_URL}/${collectionName}/${docId}?key=${FIRESTORE_API_KEY}`;
  const response = await fetch(url);
  if (!response.ok) {
    if (response.status === 404) {
      return null;
    }
    const errBody = await response.text();
    throw new Error(`Firestore REST GET failed with status ${response.status}: ${errBody}`);
  }
  const data = await response.json();
  return {
    id: docId,
    exists: true,
    data: () => fromFirestoreFields(data.fields)
  };
}

async function setDocRest(collectionName: string, docId: string, data: any) {
  const url = `${FIRESTORE_BASE_URL}/${collectionName}/${docId}?key=${FIRESTORE_API_KEY}`;
  const payload = {
    fields: toFirestoreFields(data)
  };
  const response = await fetch(url, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });
  if (!response.ok) {
    const errBody = await response.text();
    throw new Error(`Firestore REST PATCH failed with status ${response.status}: ${errBody}`);
  }
  return true;
}

async function getDocsRest(collectionName: string) {
  const url = `${FIRESTORE_BASE_URL}/${collectionName}?key=${FIRESTORE_API_KEY}`;
  const response = await fetch(url);
  if (!response.ok) {
    const errBody = await response.text();
    throw new Error(`Firestore REST GET collection failed with status ${response.status}: ${errBody}`);
  }
  const result = await response.json();
  const documents = result.documents || [];
  return {
    size: documents.length,
    docs: documents.map((doc: any) => {
      const nameParts = doc.name.split('/');
      const id = nameParts[nameParts.length - 1];
      return {
        id,
        ref: {
          delete: async () => {
            const deleteUrl = `${FIRESTORE_BASE_URL}/${collectionName}/${id}?key=${FIRESTORE_API_KEY}`;
            const delRes = await fetch(deleteUrl, { method: 'DELETE' });
            if (!delRes.ok) {
              const delErr = await delRes.text();
              throw new Error(`Firestore REST DELETE failed: ${delErr}`);
            }
          }
        },
        data: () => fromFirestoreFields(doc.fields)
      };
    })
  };
}

// Setup Web Push with Firestore persistent VAPID keypair
let vapidPublicKey = process.env.VAPID_PUBLIC_KEY || "";
let vapidPrivateKey = process.env.VAPID_PRIVATE_KEY || "";

async function initVapidKeys() {
  if (vapidPublicKey && vapidPrivateKey) {
    webpush.setVapidDetails(
      "mailto:paradas.empilhadeiras.sca@gmail.com",
      vapidPublicKey,
      vapidPrivateKey
    );
    return;
  }

  try {
    const doc = await getDocRest("system_settings", "vapid_keys");
    if (doc && doc.exists) {
      const data = doc.data();
      if (data && data.publicKey && data.privateKey) {
        vapidPublicKey = data.publicKey;
        vapidPrivateKey = data.privateKey;
        console.log("Successfully loaded VAPID keys from Firestore!");
        webpush.setVapidDetails(
          "mailto:paradas.empilhadeiras.sca@gmail.com",
          vapidPublicKey,
          vapidPrivateKey
        );
        return;
      }
    }

    console.log("No VAPID keys found in Firestore. Generating and persisting...");
    const keys = webpush.generateVAPIDKeys();
    vapidPublicKey = keys.publicKey;
    vapidPrivateKey = keys.privateKey;

    await setDocRest("system_settings", "vapid_keys", {
      publicKey: vapidPublicKey,
      privateKey: vapidPrivateKey,
      createdAt: new Date().toISOString()
    });

    webpush.setVapidDetails(
      "mailto:paradas.empilhadeiras.sca@gmail.com",
      vapidPublicKey,
      vapidPrivateKey
    );
  } catch (err) {
    console.error("Failed to load/persist VAPID keys from Firestore, falling back to local files:", err);
    
    // Safety fallback
    const VAPID_KEYS_FILE = path.join(process.cwd(), ".vapid-keys.json");
    if (fs.existsSync(VAPID_KEYS_FILE)) {
      try {
        const keys = JSON.parse(fs.readFileSync(VAPID_KEYS_FILE, 'utf8'));
        vapidPublicKey = keys.publicKey;
        vapidPrivateKey = keys.privateKey;
      } catch (fileErr) {
        console.error("Error reading fallback local VAPID keys:", fileErr);
      }
    }

    if (!vapidPublicKey || !vapidPrivateKey) {
      const keys = webpush.generateVAPIDKeys();
      vapidPublicKey = keys.publicKey;
      vapidPrivateKey = keys.privateKey;
      try {
        fs.writeFileSync(VAPID_KEYS_FILE, JSON.stringify(keys), 'utf8');
      } catch (writeErr) {
        console.error("Failed to write local backup keys:", writeErr);
      }
    }

    webpush.setVapidDetails(
      "mailto:paradas.empilhadeiras.sca@gmail.com",
      vapidPublicKey,
      vapidPrivateKey
    );
  }
}

async function startServer() {
  await initVapidKeys();
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // Twilio Client Setup
  const twilioClient = process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN 
    ? twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN)
    : null;

  // API Routes
  app.post("/api/notify", async (req, res) => {
    const { message, to } = req.body;
    
    if (!process.env.ENABLE_WHATSAPP_NOTIFICATIONS || process.env.ENABLE_WHATSAPP_NOTIFICATIONS === 'false') {
      console.log("WhatsApp notifications are disabled.");
      return res.json({ success: true, status: "disabled" });
    }

    if (!twilioClient) {
      console.warn("Twilio client not initialized. Check environment variables.");
      return res.status(500).json({ success: false, error: "Twilio not configured" });
    }

    try {
      const targetNumber = to || process.env.MANAGER_WHATSAPP_NUMBER;
      
      if (!targetNumber) {
        return res.status(400).json({ success: false, error: "No target number provided" });
      }

      const response = await twilioClient.messages.create({
        body: message,
        from: process.env.TWILIO_WHATSAPP_NUMBER || 'whatsapp:+14155238886',
        to: targetNumber
      });

      console.log(`Notification sent: ${response.sid}`);
      res.json({ success: true, sid: response.sid });
    } catch (error: any) {
      console.error("Error sending WhatsApp notification:", error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // VAPID Public Key API
  app.get("/api/notifications/vapid-public-key", (req, res) => {
    res.json({ publicKey: vapidPublicKey });
  });

  // Subscribe API
  app.post("/api/notifications/subscribe", async (req, res) => {
    const { subscription, userId } = req.body;
    if (!subscription || !subscription.endpoint) {
      return res.status(400).json({ success: false, error: "Invalid subscription payload" });
    }

    try {
      // Use the endpoint URL as a clean, unique ID to avoid duplicates
      // Encode it as a safe base64url string to make a clean doc ID
      const safeDocId = Buffer.from(subscription.endpoint).toString('base64url');
      
      await setDocRest("push_subscriptions", safeDocId, {
        subscription,
        userId: userId || "",
        updatedAt: new Date().toISOString()
      });

      res.json({ success: true });
    } catch (error: any) {
      console.error("Error saving subscription:", error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Send/Broadcast to all API (For notifying all devices even in background)
  app.post("/api/notifications/notify-all", async (req, res) => {
    const { title, body } = req.body;
    if (!title) {
      return res.status(400).json({ success: false, error: "Title is required" });
    }

    try {
      const snapshot = await getDocsRest("push_subscriptions");
      const payload = JSON.stringify({ title, body: body || "" });

      const sendPromises = snapshot.docs.map(async (doc: any) => {
        const subData = doc.data();
        try {
          await webpush.sendNotification(subData.subscription, payload);
        } catch (err: any) {
          // If subscription is expired or unsubscribed, delete it from DB
          if (err.statusCode === 410 || err.statusCode === 404) {
            console.log(`Deleting expired push subscription: ${doc.id}`);
            await doc.ref.delete();
          } else {
            console.error(`Error sending push to ${doc.id}:`, err);
          }
        }
      });

      await Promise.all(sendPromises);
      res.json({ success: true, count: snapshot.size });
    } catch (error: any) {
      console.error("Error broadcasting push:", error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*all', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
