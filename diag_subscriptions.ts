import fs from "fs";
import path from "path";

const firebaseConfig = JSON.parse(
  fs.readFileSync(path.join(process.cwd(), "firebase-applet-config.json"), "utf8")
);

const FIRESTORE_BASE_URL = `https://firestore.googleapis.com/v1/projects/${firebaseConfig.projectId}/databases/${firebaseConfig.firestoreDatabaseId}/documents`;
const FIRESTORE_API_KEY = firebaseConfig.apiKey;

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

async function inspectSubscriptions() {
  const url = `${FIRESTORE_BASE_URL}/push_subscriptions?key=${FIRESTORE_API_KEY}`;
  console.log("Fetching from:", url);
  const response = await fetch(url);
  if (!response.ok) {
    console.error("Failed to fetch subscriptions:", response.status, await response.text());
    return;
  }
  const result: any = await response.json();
  const docs = result.documents || [];
  console.log(`\n--- SUBSCRIPTIONS FOUND IN FIRESTORE: ${docs.length} ---`);
  docs.forEach((doc: any, idx: number) => {
    const nameParts = doc.name.split('/');
    const id = nameParts[nameParts.length - 1];
    const data = fromFirestoreFields(doc.fields);
    console.log(`\n[Subscription #${idx + 1}]`);
    console.log(`Document ID (safe base64url):`, id);
    console.log(`UserId:`, data.userId);
    console.log(`UpdatedAt:`, data.updatedAt);
    console.log(`Endpoint:`, data.subscription?.endpoint);
  });
}

inspectSubscriptions();
