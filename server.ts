import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import dotenv from "dotenv";
import { PushNotificationService } from "./PushNotificationService";

// Import Vercel Serverless Function handlers to use as Express route handlers
import notifyHandler from "./api/notify";
import vapidPublicKeyHandler from "./api/notifications/vapid-public-key";
import subscribeHandler from "./api/notifications/subscribe";
import syncHandler from "./api/notifications/sync-subscriptions";
import notifyAllHandler from "./api/notifications/notify-all";

dotenv.config();

async function startServer() {
  // Initialize dynamic VAPID keys on startup
  await PushNotificationService.initVapidKeys();
  console.log("[Server] VAPID keys loaded successfully.");

  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // API Routes delegating directly to the Vercel Serverless Functions
  app.post("/api/notify", (req, res) => {
    notifyHandler(req, res).catch(err => {
      console.error("Error in notifyHandler:", err);
      res.status(500).json({ success: false, error: err.message });
    });
  });

  app.get("/api/notifications/vapid-public-key", (req, res) => {
    vapidPublicKeyHandler(req, res).catch(err => {
      console.error("Error in vapidPublicKeyHandler:", err);
      res.status(500).json({ success: false, error: err.message });
    });
  });

  app.post("/api/notifications/subscribe", (req, res) => {
    subscribeHandler(req, res).catch(err => {
      console.error("Error in subscribeHandler:", err);
      res.status(500).json({ success: false, error: err.message });
    });
  });

  app.post("/api/notifications/sync-subscriptions", (req, res) => {
    syncHandler(req, res).catch(err => {
      console.error("Error in syncHandler:", err);
      res.status(500).json({ success: false, error: err.message });
    });
  });

  app.post("/api/notifications/notify-all", (req, res) => {
    notifyAllHandler(req, res).catch(err => {
      console.error("Error in notifyAllHandler:", err);
      res.status(500).json({ success: false, error: err.message });
    });
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
