import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import twilio from "twilio";
import dotenv from "dotenv";
import admin from "firebase-admin";
import { getFirestore } from "firebase-admin/firestore";
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

const firestoreDb = getFirestore(firebaseConfig.firestoreDatabaseId);

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
    const docRef = firestoreDb.collection("system_settings").doc("vapid_keys");
    const doc = await docRef.get();
    if (doc.exists) {
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

    await docRef.set({
      publicKey: vapidPublicKey,
      privateKey: vapidPrivateKey,
      createdAt: admin.firestore.FieldValue.serverTimestamp()
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
      
      const subRef = firestoreDb.collection("push_subscriptions").doc(safeDocId);
      await subRef.set({
        subscription,
        userId: userId || null,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });

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
      const snapshot = await firestoreDb.collection("push_subscriptions").get();
      const payload = JSON.stringify({ title, body: body || "" });

      const sendPromises = snapshot.docs.map(async (doc) => {
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
