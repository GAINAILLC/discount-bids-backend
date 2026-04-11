const express = require('express');
const path = require('path');

const app = express();
app.use(express.json({ limit: '50mb' }));

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

app.use(express.static(path.join(__dirname, 'public')));

// ── Manifest store (in-memory) ────────────────────────────────────────────────
// Holds the last published manifest so any device can view it
let manifestStore = null;

// Publish manifest (called from the label-maker's browser after generating)
app.post('/manifest/publish', (req, res) => {
  const { date, sheetName, shipments, labelImages, publishedAt } = req.body;
  if (!shipments || !Array.isArray(shipments)) {
    return res.status(400).json({ success: false, error: 'Missing shipments array' });
  }
  manifestStore = {
    date: date || sheetName || new Date().toLocaleDateString('en-US', { timeZone: 'America/Chicago' }),
    sheetName: sheetName || date,
    shipments,       // [{ username, name, addr1, addr2, city, state, zip, displayItems, splitInfo, box, labelImage }]
    labelImages: labelImages || {},   // { username_pageNum: base64png }
    publishedAt: publishedAt || new Date().toISOString(),
    count: shipments.length
  };
  console.log(`[Manifest] Published: ${manifestStore.count} shipments for ${manifestStore.date}`);
  res.json({ success: true, count: manifestStore.count });
});

// Get current manifest
app.get('/manifest', (req, res) => {
  if (!manifestStore) return res.json({ empty: true });
  res.json(manifestStore);
});

// Clear manifest
app.delete('/manifest', (req, res) => {
  manifestStore = null;
  res.json({ success: true });
});

app.get('/health', (req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }));

// GitHub webhook → auto-redeploy on push to master
app.post('/github-webhook', async (req, res) => {
  const event = req.headers['x-github-event'];
  const branch = req.body?.ref;
  if (event !== 'push' || !branch?.endsWith('/master')) return res.json({ skipped: true });
  res.json({ triggered: true });
  // Call Render API to deploy
  const https = require('https');
  const payload = JSON.stringify({ clearCache: 'do_not_clear' });
  const options = {
    hostname: 'api.render.com',
    path: '/v1/services/srv-d7cka0lckfvc73a4cbk0/deploys',
    method: 'POST',
    headers: {
      'Authorization': 'Bearer rnd_vF2EHJOy6dK7NWt2fI07EwTnRBfA',
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'Content-Length': Buffer.byteLength(payload)
    }
  };
  const r = https.request(options);
  r.write(payload);
  r.end();
  console.log('[Auto-deploy] Triggered by GitHub push to master');
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Discount Bids Backend running on port ${PORT}`));
