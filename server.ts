import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import twilio from "twilio";
import dotenv from "dotenv";
import fs from "fs";
import { PushNotificationService } from "./PushNotificationService";

dotenv.config();

async function startServer() {
  // Initialize dynamic VAPID keys on startup
  const vapidPublicKey = await PushNotificationService.initVapidKeys();
  console.log("[Server] VAPID keys loaded successfully.");

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

  // Subscribe API - Direct registration into Firestore using Firebase Admin
  app.post("/api/notifications/subscribe", async (req, res) => {
    const { subscription, userId, deviceId, metadata } = req.body;
    if (!subscription || !subscription.endpoint) {
      return res.status(400).json({ success: false, error: "Invalid subscription payload" });
    }
    if (!deviceId) {
      return res.status(400).json({ success: false, error: "Missing persistent deviceId" });
    }

    try {
      await PushNotificationService.registerDevice({
        deviceId,
        userId: userId || "",
        subscription,
        metadata
      });

      res.json({ success: true });
    } catch (error: any) {
      console.error("Error registering subscription in PushNotificationService:", error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Sync-Subscriptions API - Stub for backwards-compatibility
  app.post("/api/notifications/sync-subscriptions", (req, res) => {
    res.json({ success: true, count: 0 });
  });

  // Send/Broadcast to all API
  app.post("/api/notifications/notify-all", async (req, res) => {
    const { title, body, originDeviceId, originUserEmail } = req.body;

    if (!title) {
      return res.status(400).json({ success: false, error: "Title is required" });
    }

    try {
      const result = await PushNotificationService.broadcastNotification({
        title,
        body: body || "",
        originDeviceId: originDeviceId || null,
        originUserEmail: originUserEmail || null
      });

      res.json(result);
    } catch (error: any) {
      console.error("[Server] Error during push broadcast notification:", error);
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
