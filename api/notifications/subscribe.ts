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
  console.log("- Request Body:", JSON.stringify(req.body, null, 2));
  console.log("=============================================================\n");

  const { subscription, userId, deviceId, metadata } = req.body;
  if (!subscription || !subscription.endpoint) {
    console.warn("[Serverless Route Warning] Invalid subscription payload received.");
    return res.status(400).json({ success: false, error: "Invalid subscription payload" });
  }
  if (!deviceId) {
    console.warn("[Serverless Route Warning] Missing persistent deviceId.");
    return res.status(400).json({ success: false, error: "Missing persistent deviceId" });
  }

  try {
    // Ensure VAPID keys are initialized
    await PushNotificationService.initVapidKeys();

    console.log(`[Serverless Route] Executing PushNotificationService.registerDevice() for device: "${deviceId}"`);
    await PushNotificationService.registerDevice({
      deviceId,
      userId: userId || "",
      subscription,
      metadata
    });

    console.log(`[Serverless Route] Device registration completed successfully for device: "${deviceId}"`);
    return res.status(200).json({ success: true });
  } catch (error: any) {
    console.error("[Serverless Route Error] Error registering subscription in PushNotificationService:", error);
    return res.status(500).json({ success: false, error: error.message });
  }
}
