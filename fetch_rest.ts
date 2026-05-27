import https from 'https';

const projectId = "gen-lang-client-0174045597";
const databaseId = "ai-studio-c0400085-9a32-44b0-afcc-b60f4df45b47";
const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/${databaseId}/documents/forklifts`;

https.get(url, (res) => {
  let data = '';
  res.on('data', (chunk) => {
    data += chunk;
  });
  res.on('end', () => {
    try {
      const json = JSON.parse(data);
      if (!json.documents) {
        console.log("No documents found or error:", json);
        return;
      }
      console.log(`Successfully fetched ${json.documents.length} forklift documents via REST API:`);
      json.documents.forEach((doc: any, idx: number) => {
        const fields = doc.fields;
        const nameParts = doc.name.split('/');
        const id = nameParts[nameParts.length - 1];
        const model = fields.model ? fields.model.stringValue : 'N/A';
        const serial = fields.serialNumber ? fields.serialNumber.stringValue : 'N/A';
        const status = fields.status ? fields.status.stringValue : 'N/A';
        console.log(`[${idx + 1}] ID: ${id} | Model: ${model} | Serial: ${serial} | Status: ${status}`);
      });
    } catch (e) {
      console.error("Parse error:", e);
    }
  });
}).on('error', (err) => {
  console.error("HTTP Request Error:", err);
});
