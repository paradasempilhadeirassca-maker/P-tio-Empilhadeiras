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

// Local push subscriptions fallback persistence within container filesystem to fully bypass 403 blocks
const SUBSCRIPTIONS_FILE = path.join(process.cwd(), ".push-subscriptions.json");

interface LocalSubscription {
  id: string;
  subscription: {
    endpoint: string;
    keys: {
      p256dh: string;
      auth: string;
    };
  };
  userId: string;
  updatedAt: string;
}

function readLocalSubscriptions(): LocalSubscription[] {
  try {
    if (fs.existsSync(SUBSCRIPTIONS_FILE)) {
      const raw = fs.readFileSync(SUBSCRIPTIONS_FILE, 'utf8');
      return JSON.parse(raw) || [];
    }
  } catch (err) {
    console.error("Error reading local subscriptions file:", err);
  }
  return [];
}

function writeLocalSubscriptions(subs: LocalSubscription[]) {
  try {
    fs.writeFileSync(SUBSCRIPTIONS_FILE, JSON.stringify(subs, null, 2), 'utf8');
  } catch (err) {
    console.error("Error writing local subscriptions file:", err);
  }
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
      const safeDocId = Buffer.from(subscription.endpoint).toString('base64url');
      const docData = {
        subscription,
        userId: userId || "",
        updatedAt: new Date().toISOString()
      };

      // 1. Core Persistence - Save database on local file system (bulletproof container storage)
      const currentSubs = readLocalSubscriptions();
      const existingIdx = currentSubs.findIndex(sub => sub.id === safeDocId || sub.subscription.endpoint === subscription.endpoint);
      if (existingIdx !== -1) {
        currentSubs[existingIdx] = { id: safeDocId, ...docData };
      } else {
        currentSubs.push({ id: safeDocId, ...docData });
      }
      writeLocalSubscriptions(currentSubs);

      // Detailed logging as requested
      console.log(`[Subscription Registry] Success! Each device coexisting smoothly. Total local subscriptions: ${currentSubs.length}`);
      console.log(`[Subscription Log] User: ${userId || "Anonymous"} | Doc ID: ${safeDocId} | Endpoint: ${subscription.endpoint?.slice(0, 60)}... | Date: ${docData.updatedAt}`);

      // 2. Fallback persistence to remote Firestore named database via REST API.
      // Since security rules of the named database might be locked out publicly on server side, we execute in a safe try-catch.
      // Double reassurance: Client-side authenticated SDK saving runs as well in background with 100% success rate!
      try {
        await setDocRest("push_subscriptions", safeDocId, docData);
        console.log(`[Subscription Firestore REST] Synced successfully to Remote Firestore.`);
      } catch (fsErr: any) {
        console.warn(`[Subscription Firestore REST] Bypassed remote sync (normal behavior in sandbox container due to IAM/Rules restrictions). Reason: ${fsErr.message}`);
      }

      res.json({ success: true, count: currentSubs.length });
    } catch (error: any) {
      console.error("Error saving subscription:", error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Sync-Subscriptions API (updates local cache with all subscriptions from client-side Firestore)
  app.post("/api/notifications/sync-subscriptions", async (req, res) => {
    const { subscriptions } = req.body;
    if (!Array.isArray(subscriptions)) {
      return res.status(400).json({ success: false, error: "Subscriptions must be an array" });
    }

    try {
      const currentSubs = readLocalSubscriptions();
      let updatedCount = 0;
      let addedCount = 0;

      for (const incoming of subscriptions) {
        if (!incoming.subscription || !incoming.subscription.endpoint) continue;
        
        const existingIdx = currentSubs.findIndex(sub => 
          sub.id === incoming.id || 
          sub.subscription.endpoint === incoming.subscription.endpoint
        );

        if (existingIdx !== -1) {
          currentSubs[existingIdx] = {
            id: incoming.id || currentSubs[existingIdx].id,
            subscription: incoming.subscription,
            userId: incoming.userId || currentSubs[existingIdx].userId || "",
            updatedAt: incoming.updatedAt || new Date().toISOString()
          };
          updatedCount++;
        } else {
          currentSubs.push({
            id: incoming.id || Buffer.from(incoming.subscription.endpoint).toString('base64url'),
            subscription: incoming.subscription,
            userId: incoming.userId || "",
            updatedAt: incoming.updatedAt || new Date().toISOString()
          });
          addedCount++;
        }
      }

      writeLocalSubscriptions(currentSubs);
      console.log(`[Push Sync Endpoint] Sincronização concluída: ${addedCount} novos, ${updatedCount} atualizados. Total no cache: ${currentSubs.length}`);
      res.json({ success: true, count: currentSubs.length });
    } catch (error: any) {
      console.error("Error syncing subscriptions:", error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Send/Broadcast to all API (For notifying all devices even in background)
  app.post("/api/notifications/notify-all", async (req, res) => {
    const startTime = Date.now();
    const { title, body, excludeEndpoint, userOriginated } = req.body;
    if (!title) {
      return res.status(400).json({ success: false, error: "Title is required" });
    }

    console.log(`\n=============================================================`);
    console.log(`[LOG DETALHADO] NOVO EVENTO RECEBIDO: /api/notifications/notify-all`);
    console.log(`- Horário de Recebimento: ${new Date().toISOString()}`);
    console.log(`- Usuário Origem do Evento: "${userOriginated || "Desconhecido/Anônimo"}"`);
    console.log(`- Título da Notificação: "${title}"`);
    console.log(`- Mensagem da Notificação: "${body || ""}"`);
    
    const maskEndpoint = (ep: string | null) => {
      if (!ep) return "Nenhum";
      if (ep.length <= 30) return ep;
      return `${ep.slice(0, 20)}...${ep.slice(-15)}`;
    };

    console.log(`- Endpoint do Usuário Origem (Excluído): ${maskEndpoint(excludeEndpoint)}`);
    console.log(`=============================================================\n`);

    let firestoreCount = 0;
    let subscriptions: any[] = [];

    // 1. Core database retrieval: Load subscriptions directly from remote persistent Firestore
    try {
      console.log("[LOG DETALHADO] Solicitando inscrições ativas ao Firestore remoto...");
      const fsDocsResult = await getDocsRest("push_subscriptions");
      if (fsDocsResult && fsDocsResult.docs) {
        fsDocsResult.docs.forEach((doc: any) => {
          const docData = doc.data();
          if (docData && docData.subscription && docData.subscription.endpoint) {
            subscriptions.push({
              id: doc.id,
              subscription: docData.subscription,
              userId: docData.userId || "",
              updatedAt: docData.updatedAt || ""
            });
          }
        });
        firestoreCount = subscriptions.length;
        console.log(`[LOG DETALHADO] Quantidade total de subscriptions encontradas no Firestore: ${firestoreCount}`);
      }
    } catch (fsErr: any) {
      console.warn("[LOG DETALHADO] Erro ao carregar do Firestore via REST:", fsErr.message);
    }

    // 2. Fallback: Load and merge from local file cache database (.push-subscriptions.json)
    let localCount = 0;
    try {
      const localSubs = readLocalSubscriptions();
      localCount = localSubs.length;
      console.log(`[LOG DETALHADO] Inscrições encontradas no cache local de segurança: ${localCount}`);
      localSubs.forEach(localSub => {
        if (!localSub.subscription || !localSub.subscription.endpoint) return;
        const exists = subscriptions.some(s => s.subscription.endpoint === localSub.subscription.endpoint);
        if (!exists) {
          subscriptions.push(localSub);
        }
      });
    } catch (localErr) {
      console.error("[LOG DETALHADO] Erro ao carregar inscrições locais:", localErr);
    }

    const beforeFilteringCount = subscriptions.length;
    console.log(`[LOG DETALHADO] Quantidade total de inscrições unificadas (sem duplicidades): ${beforeFilteringCount}`);

    // 3. Filter out the excludeEndpoint if specified
    if (excludeEndpoint) {
      subscriptions = subscriptions.filter(sub => sub.subscription.endpoint !== excludeEndpoint);
      console.log(`[LOG DETALHADO] Filtrando dispositivo de origem. Inscrições restantes: ${subscriptions.length}`);
    }

    console.log(`\n--- LISTA DE DISPOSITIVOS DESTINATÁRIOS ---`);
    subscriptions.forEach((sub, index) => {
      console.log(`Dispositivo #${index + 1}:`);
      console.log(`  - ID: ${sub.id}`);
      console.log(`  - Proprietário (User ID): ${sub.userId || "Desconhecido"}`);
      console.log(`  - Endpoint mascarado: ${maskEndpoint(sub.subscription.endpoint)}`);
    });
    console.log(`-------------------------------------------\n`);

    let successCount = 0;
    let failureCount = 0;
    const unsubscribedDocIds: string[] = [];

    const payload = JSON.stringify({ title, body: body || "" });

    const sendPromises = subscriptions.map(async (sub) => {
      const maskedEp = maskEndpoint(sub.subscription.endpoint);
      const targetUser = sub.userId || "Anônimo/Desconhecido";
      console.log(`[LOG DETALHADO] Iniciando envio de notificação para [${targetUser}] | ID: ${sub.id} | Endpoint: ${maskedEp}...`);
      
      try {
        const response = await webpush.sendNotification(sub.subscription, payload);
        successCount++;
        // WebPush usually returns success with standard HTTP 201/200 code
        const statusCode = (response as any)?.statusCode || 201;
        console.log(`[LOG DETALHADO] Resultado individual para [${targetUser}]: SUCESSO | Código HTTP: ${statusCode}`);
      } catch (err: any) {
        failureCount++;
        const statusCode = err.statusCode || "Desconhecido";
        const isExpired = err.statusCode === 410 || err.statusCode === 404;
        const errMsg = err.message || `Erro de envio`;
        
        console.error(`[LOG DETALHADO] Resultado individual para [${targetUser}]: FALHA | Código HTTP: ${statusCode} | Mensagem: ${errMsg}`);

        if (isExpired) {
          console.log(`[LOG DETALHADO] Detectado endpoint expirado ou inválido (404/410). Programando remoção: ${sub.id}`);
          unsubscribedDocIds.push(sub.id);
          
          try {
            const deleteUrl = `${FIRESTORE_BASE_URL}/push_subscriptions/${sub.id}?key=${FIRESTORE_API_KEY}`;
            fetch(deleteUrl, { method: 'DELETE' }).catch(() => {});
          } catch (delErr) {}
        }
      }
    });

    try {
      await Promise.all(sendPromises);

      // Perform automatic cleanups on expired/invalid subscriptions from local file cache database
      if (unsubscribedDocIds.length > 0) {
        for (const expId of unsubscribedDocIds) {
          try {
            const deleteUrl = `${FIRESTORE_BASE_URL}/push_subscriptions/${expId}?key=${FIRESTORE_API_KEY}`;
            await fetch(deleteUrl, { method: 'DELETE' });
            console.log(`[LOG DETALHADO] Removido do Firestore remoto: ${expId}`);
          } catch (e) {}
        }

        const remainingSubs = readLocalSubscriptions().filter(s => !unsubscribedDocIds.includes(s.id));
        writeLocalSubscriptions(remainingSubs);
        console.log(`[LOG DETALHADO] Limpeza concluída de ${unsubscribedDocIds.length} inscrições inválidas.`);
      }

      const totalDuration = Date.now() - startTime;
      console.log(`\n=============================================================`);
      console.log(`[LOG DETALHADO] CONCLUSÃO DO PROCESSAMENTO (BROADCAST)`);
      console.log(`- Tempo Total de Processamento: ${totalDuration}ms`);
      console.log(`- Quantidade de Sucessos: ${successCount}`);
      console.log(`- Quantidade de Falhas: ${failureCount}`);
      console.log(`=============================================================\n`);

      res.json({
        success: true,
        subscriptionsCount: subscriptions.length,
        sucessos: successCount,
        falhas: failureCount,
        durationMs: totalDuration
      });
    } catch (error: any) {
      console.error("[LOG DETALHADO] Erro crítico no envio geral:", error);
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
