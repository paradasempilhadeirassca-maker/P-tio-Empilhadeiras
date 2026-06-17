import fs from "fs";
import path from "path";

const SUBSCRIPTIONS_FILE = path.join(process.cwd(), ".push-subscriptions.json");

// Define multiple simulated devices
const mockSubscriptions = [
  {
    id: "device_b_token_abc123",
    subscription: {
      endpoint: "https://fcm.googleapis.com/fcm/send/device_b_mock_endpoint_12345",
      keys: {
        p256dh: "BLmbyQW8k7h67_n6_5vI0x-y8X73N_7GfG",
        auth: "5vI0x-y8X73N_7GfG"
      }
    },
    userId: "user_b_operator",
    updatedAt: new Date().toISOString()
  },
  {
    id: "device_c_token_xyz789",
    subscription: {
      endpoint: "https://fcm.googleapis.com/fcm/send/device_c_mock_endpoint_67890",
      keys: {
        p256dh: "ALnzyQW8k7h67_n6_5vI0x-y8X73N_7GfG",
        auth: "4uH0x-y8X73N_7GfG"
      }
    },
    userId: "user_c_mechanic",
    updatedAt: new Date().toISOString()
  },
  {
    id: "device_d_token_def456",
    subscription: {
      endpoint: "https://updates.push.services.mozilla.com/wpush/v2/device_d_mock_endpoint_98765",
      keys: {
        p256dh: "CLozyQW8k7h67_n6_5vI0x-y8X73N_7GfG",
        auth: "3tI0x-y8X73N_7GfG"
      }
    },
    userId: "user_d_manager",
    updatedAt: new Date().toISOString()
  }
];

async function runPushTest() {
  console.log("=========================================");
  console.log("INICIANDO TESTE DE VALIDAÇÃO DE PUSH");
  console.log("=========================================");
  
  // 1. Save mock subscriptions so they are available in the local cache
  console.log(`\nGravando ${mockSubscriptions.length} inscrições simuladas na base (.push-subscriptions.json)...`);
  fs.writeFileSync(SUBSCRIPTIONS_FILE, JSON.stringify(mockSubscriptions, null, 2), "utf8");
  console.log("Dispositivos simulados criados com sucesso:");
  mockSubscriptions.forEach((sub, i) => {
    console.log(` - Dispositivo ${String.fromCharCode(66 + i)} (User: ${sub.userId}) | ID: ${sub.id}`);
  });

  // 2. Trigger the local API notify-all route
  const testPayload = {
    title: "⚠️ NOVA OCORRÊNCIA CADASTRADA",
    body: "Dispositivo A: Empilhadeira CAT-05 apresentou vazamento hidráulico."
  };

  console.log(`\nDispositivo A dispara um evento de ocorrência.`);
  console.log(`Fazendo requisição de transmissão /api/notifications/notify-all...`);

  try {
    const response = await fetch("http://localhost:3000/api/notifications/notify-all", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(testPayload)
    });

    console.log(`Status da resposta do servidor: ${response.status}`);
    const result: any = await response.json();
    console.log("\n--- RESULTADO DE RETORNO DO SERVIDOR ---");
    console.log(JSON.stringify(result, null, 2));
    
    console.log("\n=========================================");
    console.log("TESTE DE VALIDAÇÃO DA ROTINA CONCLUÍDO!");
    console.log("=========================================");
  } catch (err: any) {
    console.error("Erro ao chamar o endpoint de notificação local:", err.message);
    console.log("\nExecutando o simulador de broadcast diretamente para exibir logs de envio...");
    
    // Fallback: If dev server is currently offline or rebooting, we can simulate the web-push call directly
    const webpush = require("web-push");
    const paths = require("path");
    
    // Load VAPID details if possible
    let vapidPublicKey = "";
    let vapidPrivateKey = "";
    const VAPID_KEYS_FILE = path.join(process.cwd(), ".vapid-keys.json");
    if (fs.existsSync(VAPID_KEYS_FILE)) {
      const keys = JSON.parse(fs.readFileSync(VAPID_KEYS_FILE, 'utf8'));
      vapidPublicKey = keys.publicKey;
      vapidPrivateKey = keys.privateKey;
      webpush.setVapidDetails("mailto:paradas.empilhadeiras.sca@gmail.com", vapidPublicKey, vapidPrivateKey);
    }

    let successCount = 0;
    let failureCount = 0;
    const payloadStr = JSON.stringify(testPayload);

    for (const sub of mockSubscriptions) {
      console.log(`Enviando para dispositivo (User: ${sub.userId}) endpoint: ${sub.subscription.endpoint.slice(0, 60)}...`);
      try {
        if (!vapidPublicKey) {
          throw new Error("VAPID keys not configured, simulated broadcast error");
        }
        await webpush.sendNotification(sub.subscription, payloadStr);
        successCount++;
        console.log("Resultado: Sucesso");
      } catch (e: any) {
        failureCount++;
        console.log(`Resultado: Erro ${e.statusCode || 400} - ${e.message}`);
      }
    }

    console.log(`\n--- RELATÓRIO DE ENVIO DIRETO EM CASO DE REBOOT ---`);
    console.log(`Quantidade de dispositivos notificados: ${mockSubscriptions.length}`);
    console.log(`Quantidade de sucessos: ${successCount}`);
    console.log(`Quantidade de falhas: ${failureCount}`);
  }
}

runPushTest();
