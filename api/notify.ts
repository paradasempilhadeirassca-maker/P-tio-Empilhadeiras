import twilio from "twilio";
import dotenv from "dotenv";

dotenv.config();

export default async function handler(req: any, res: any) {
  if (req.method !== "POST") {
    res.setHeader("Allow", ["POST"]);
    return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
  }

  const { message, to } = req.body;
  
  if (!process.env.ENABLE_WHATSAPP_NOTIFICATIONS || process.env.ENABLE_WHATSAPP_NOTIFICATIONS === 'false') {
    console.log("WhatsApp notifications are disabled.");
    return res.status(200).json({ success: true, status: "disabled" });
  }

  const twilioClient = process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN 
    ? twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN)
    : null;

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
    return res.status(200).json({ success: true, sid: response.sid });
  } catch (error: any) {
    console.error("Error sending WhatsApp notification:", error);
    return res.status(500).json({ success: false, error: error.message });
  }
}
