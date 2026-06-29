import { PushNotificationService } from "../../PushNotificationService.js";
import dotenv from "dotenv";

dotenv.config();

export default async function handler(req: any, res: any) {
  if (req.method !== "POST") {
    res.setHeader("Allow", ["POST"]);
    return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
  }

  console.log("\n=============================================================");
  console.log("[Serverless Route Hit] POST /api/notifications/subscribe");
  console.log("- Request Body exists:", !!req.body);
  console.log("- subscription exists:", !!req.body?.subscription);
  console.log("- subscription.endpoint:", req.body?.subscription?.endpoint || "MISSING");
  console.log("- deviceId:", req.body?.deviceId || "MISSING");
  console.log("- userId:", req.body?.userId || "MISSING");
  console.log("- Request Body full:", JSON.stringify(req.body, null, 2));
  console.log("=============================================================\n");

  const { subscription, userId, deviceId, metadata } = req.body || {};
  if (!subscription || !subscription.endpoint) {
    console.warn("[Serverless Route Warning] Invalid subscription payload received (missing subscription or endpoint).");
    return res.status(400).json({ 
      success: false, 
      error: "Invalid subscription payload: missing subscription or endpoint",
      debug: { subscriptionExists: !!subscription, endpointExists: !!subscription?.endpoint }
    });
  }
  if (!deviceId) {
    console.warn("[Serverless Route Warning] Missing persistent deviceId.");
    return res.status(400).json({ 
      success: false, 
      error: "Missing persistent deviceId",
      debug: { deviceIdExists: false }
    });
  }

  try {
    // Ensure VAPID keys are initialized
    console.log("[Serverless Route] Initializing VAPID keys...");
    await PushNotificationService.initVapidKeys();

    console.log(`[Serverless Route] Executing PushNotificationService.registerDevice() for device: "${deviceId}", user: "${userId || "Anonymous"}"`);
    await PushNotificationService.registerDevice({
      deviceId,
      userId: userId || "",
      subscription,
      metadata
    });

    console.log(`[Serverless Route] Device registration completed successfully for device: "${deviceId}"`);
    return res.status(200).json({ 
      success: true,
      message: "Device registered successfully",
      deviceId,
      userId: userId || "Anonymous"
    });
  } catch (error: any) {
    console.error("[Serverless Route Error] Error registering subscription in PushNotificationService:", error.stack || error);
    return res.status(500).json({ 
      success: false, 
      error: error.message || "Internal server error during push subscription",
      stack: error.stack,
      debug: {
        deviceId,
        userId: userId || "Anonymous",
        endpoint: subscription.endpoint
      }
    });
  }
}
