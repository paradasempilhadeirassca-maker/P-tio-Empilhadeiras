import { PushNotificationService } from "../../PushNotificationService.js";
import dotenv from "dotenv";

dotenv.config();

export default async function handler(req: any, res: any) {
  if (req.method !== "POST") {
    res.setHeader("Allow", ["POST"]);
    return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
  }

  const { title, body, originDeviceId, originUserEmail } = req.body;

  if (!title) {
    return res.status(400).json({ success: false, error: "Title is required" });
  }

  try {
    // Ensure VAPID keys are initialized
    await PushNotificationService.initVapidKeys();

    const result = await PushNotificationService.broadcastNotification({
      title,
      body: body || "",
      originDeviceId: originDeviceId || null,
      originUserEmail: originUserEmail || null
    });

    return res.status(200).json(result);
  } catch (error: any) {
    console.error("[Serverless API] Error during push broadcast notification:", error);
    return res.status(500).json({ success: false, error: error.message });
  }
}
