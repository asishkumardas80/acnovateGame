// DevRush Arena - Express server
// Serves the single-page app and a simple key-value API backed by data.json.
// The KV store holds all shared game state so teams + host stay in sync.

const express = require('express');
const fs = require('fs');
const path = require('path');
let compression = null; try { compression = require('compression'); } catch (e) {}

const app = express();
if (compression) app.use(compression());   // gzip responses (big win for /api/all at scale)
const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'data.json');
const UPLOAD_DIR = path.join(__dirname, 'public', 'uploads');

// Where host-uploaded images (e.g. Logo Guess logos) are stored. Served
// statically from /uploads because it lives under public/.
try { fs.mkdirSync(UPLOAD_DIR, { recursive: true }); } catch (e) {}

// ---- In-memory store (mirrored to data.json) -------------------------------
// Keeping the whole store in memory means concurrent requests mutate the same
// object (Node is single-threaded), so there are no read-modify-write races.
// Each team writes to its own key (e.g. "score:3:Team Alpha"), so teams never
// clobber each other even when they submit at the same instant.
let store = {};
try {
  store = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')) || {};
} catch (e) {
  store = {};
}

// Store version — bumped on every change so clients can poll cheaply: an
// unchanged store returns 304 (tiny) instead of the whole payload.
let version = 0;
function bump() { version++; persist(); }

// Debounced write so a burst of POSTs doesn't hammer the disk.
let saveTimer = null;
function persist() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    fs.writeFile(DATA_FILE, JSON.stringify(store, null, 2), (err) => {
      if (err) console.error('Failed to persist data.json:', err.message);
    });
  }, 250);
}

app.use(express.json({ limit: '16mb' })); // room for base64 image uploads
// Never cache the HTML/JS app shell, so players always get the latest version
// (important behind a CDN tunnel that would otherwise serve a stale page).
app.use(express.static(path.join(__dirname, 'public'), {
  etag: true,
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
    }
  }
}));

// Image upload for the host (Logo Guess round). The browser sends a data URL
// as JSON; we decode it and write a file, then return its public URL. No
// multipart/multer dependency needed.
app.post('/api/upload', (req, res) => {
  try {
    const { filename, dataUrl } = req.body || {};
    const m = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/.exec(dataUrl || '');
    if (!m) return res.status(400).json({ error: 'expected an image data URL' });
    const ext = ({ 'image/png': 'png', 'image/jpeg': 'jpg', 'image/jpg': 'jpg',
      'image/gif': 'gif', 'image/webp': 'webp', 'image/svg+xml': 'svg' })[m[1]] || 'img';
    const buf = Buffer.from(m[2], 'base64');
    if (buf.length > 8 * 1024 * 1024) return res.status(413).json({ error: 'image too large (max 8MB)' });
    const safe = String(filename || 'logo').replace(/\.[^.]+$/, '')
      .replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 40) || 'logo';
    const name = Date.now() + '_' + Math.random().toString(36).slice(2, 8) + '_' + safe + '.' + ext;
    fs.writeFileSync(path.join(UPLOAD_DIR, name), buf);
    res.json({ ok: true, url: '/uploads/' + name });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Server clock, used by clients to correct for device clock skew so the
// synced countdown timer lines up across every screen.
app.get('/api/time', (req, res) => {
  res.json({ now: Date.now() });
});

// Return the entire store in one shot. The host uses this to read every
// team's submission/score at once; teams use it to render the leaderboard.
app.get('/api/all', (req, res) => {
  // Cheap polling: if the client already has the current version, send 304.
  if (req.query.v !== undefined && Number(req.query.v) === version) return res.status(304).end();
  res.setHeader('X-Store-Version', String(version));
  res.json(store);
});

// Read a single key.
app.get('/api/storage/:key', (req, res) => {
  const key = req.params.key;
  res.json({ key, value: key in store ? store[key] : null });
});

// Write a single key. Accepts either { "value": <anything> } or a raw body.
app.post('/api/storage/:key', (req, res) => {
  const key = req.params.key;
  const body = req.body || {};
  store[key] = ('value' in body) ? body.value : body;
  bump();
  res.json({ ok: true, key, value: store[key] });
});

// Delete a single key.
app.delete('/api/storage/:key', (req, res) => {
  delete store[req.params.key];
  bump();
  res.json({ ok: true });
});

// Wipe everything (host "Reset" uses this).
app.post('/api/reset', (req, res) => {
  store = {};
  bump();
  res.json({ ok: true });
});

// Clear only the scores (host "Restart Game") — keeps players, teams and logos
// so the same teams can play again from round 1.
app.post('/api/clearScores', (req, res) => {
  for (const k of Object.keys(store)) {
    if (k.startsWith('pscore:') || k.startsWith('panswer:') || k.startsWith('tscore:') ||
        k.startsWith('bs:') || k.startsWith('rq:') || k.startsWith('cb:') || k.startsWith('em:')) delete store[k];
  }
  bump();
  res.json({ ok: true });
});

app.listen(PORT, () => {
  console.log(`\n  DevRush Arena running:`);
  console.log(`   Local:   http://localhost:${PORT}`);
  console.log(`   Network: http://<your-LAN-ip>:${PORT}  (share this with teams)\n`);
});
