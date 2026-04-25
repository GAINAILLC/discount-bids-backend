const express = require('express');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

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

// ── Supabase client ───────────────────────────────────────────────────────────
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

async function getManifest() {
  const { data, error } = await supabase.from('manifest').select('data').eq('id', 'current').maybeSingle();
  if (error || !data) return null;
  return data.data;
}

async function saveManifest(value) {
  const { error } = await supabase.from('manifest').upsert({ id: 'current', data: value, updated_at: new Date().toISOString() });
  if (error) throw error;
}

async function deleteManifest() {
  const { error } = await supabase.from('manifest').delete().eq('id', 'current');
  if (error) throw error;
}

// ── Manifest routes ───────────────────────────────────────────────────────────

// Publish manifest (called from the label maker after generating)
app.post('/manifest/publish', async (req, res) => {
  try {
    const { date, sheetName, shipments, labelImages, publishedAt } = req.body;
    if (!shipments || !Array.isArray(shipments)) {
      return res.status(400).json({ success: false, error: 'Missing shipments array' });
    }
    const record = {
      date: date || sheetName || new Date().toLocaleDateString('en-US', { timeZone: 'America/Chicago' }),
      sheetName: sheetName || date,
      shipments,
      labelImages: labelImages || {},
      publishedAt: publishedAt || new Date().toISOString(),
      count: shipments.length
    };
    await saveManifest(record);
    console.log(`[Manifest] Published: ${record.count} shipments for ${record.date}`);
    res.json({ success: true, count: record.count });
  } catch (err) {
    console.error('[Manifest] Publish error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Get current manifest
app.get('/manifest', async (req, res) => {
  try {
    const manifest = await getManifest();
    if (!manifest) return res.json({ empty: true });
    res.json(manifest);
  } catch (err) {
    console.error('[Manifest] Get error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Clear manifest
app.delete('/manifest', async (req, res) => {
  try {
    await deleteManifest();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── PDF label store (in-memory, used within a single session) ─────────────────
let pdfStore = [];

app.post('/manifest/labels-pdf', (req, res) => {
  const { pdfs } = req.body;
  if (!pdfs || !Array.isArray(pdfs)) return res.status(400).json({ error: 'Missing pdfs array' });
  pdfStore = pdfs.map(b64 => Buffer.from(b64, 'base64'));
  console.log(`[PDF] Stored ${pdfStore.length} PDF file(s)`);
  res.json({ success: true, count: pdfStore.length });
});

app.get('/manifest/labels-pdf/:index', (req, res) => {
  const idx = parseInt(req.params.index);
  if (isNaN(idx) || idx < 0 || idx >= pdfStore.length) return res.status(404).json({ error: 'Not found' });
  res.set('Content-Type', 'application/pdf');
  res.set('Content-Disposition', `inline; filename="labels-${idx + 1}.pdf"`);
  res.send(pdfStore[idx]);
});

app.get('/manifest/labels-pdf', (req, res) => {
  res.json({ count: pdfStore.length });
});

// ── Viewer page ───────────────────────────────────────────────────────────────
app.get('/view', (req, res) => res.sendFile(path.join(__dirname, 'public', 'view.html')));

// ── Health ────────────────────────────────────────────────────────────────────
app.get('/health', (req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }));

// ── GitHub webhook → auto-redeploy ───────────────────────────────────────────
app.post('/github-webhook', async (req, res) => {
  const event = req.headers['x-github-event'];
  const branch = req.body?.ref;
  if (event !== 'push' || !branch?.endsWith('/master')) return res.json({ skipped: true });
  res.json({ triggered: true });
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
