import { PushNotificationService } from "../../PushNotificationService";
import dotenv from "dotenv";

dotenv.config();

export default async function handler(req: any, res: any) {
  if (req.method !== "GET") {
    res.setHeader("Allow", ["GET"]);
    return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
  }

  try {
    const vapidPublicKey = await PushNotificationService.initVapidKeys();
    return res.status(200).json({ publicKey: vapidPublicKey });
  } catch (error: any) {
    console.error("[VAPID API Error]:", error);
    return res.status(500).json({ success: false, error: error.message });
  }
}
