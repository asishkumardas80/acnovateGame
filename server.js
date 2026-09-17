// DevRush Arena - Express server
// Serves the single-page app and a simple key-value API backed by data.json.
// The KV store holds all shared game state so teams + host stay in sync.

const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
let compression = null; try { compression = require('compression'); } catch (e) {}

const app = express();
if (compression) app.use(compression());   // gzip responses (big win for /api/all at scale)
const PORT = process.env.PORT || 3000;
// Where to persist the store. Set DATA_DIR to a mounted persistent disk (e.g.
// /data on Render Starter) so game state survives restarts and redeploys.
// Falls back to the app folder for local dev / free tier (ephemeral).
const DATA_DIR = process.env.DATA_DIR || __dirname;
try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch (e) {}
const DATA_FILE = path.join(DATA_DIR, 'data.json');
const UPLOAD_DIR = path.join(__dirname, 'public', 'uploads');

// ---- Host authentication ---------------------------------------------------
// The passcode lives ONLY on the server (set HOST_CODE in the environment; the
// fallback is for local dev). It is never sent to the browser, so it cannot be
// found by inspecting the page. A correct passcode gets a random session token;
// host-only actions (reset, start/build, uploads) require that token.
const HOST_CODE = process.env.HOST_CODE || 'devrush';
const hostTokens = new Set();                       // valid tokens (in memory)
function hostAuthed(req) {
  const t = req.get('X-Host-Token') || '';
  return t && hostTokens.has(t);
}
// Keys only the host may write/delete. Players write their own player:/pscore:/
// panswer:/chat: and per-game keys, which stay open so joins/answers never block.
function isHostKey(key) {
  return key === 'game' || key === 'teams' ||
         key.startsWith('tscore:') || key.startsWith('config:');
}
function requireHost(req, res) {
  if (hostAuthed(req)) return true;
  res.status(401).json({ error: 'host authentication required' });
  return false;
}

// ---- Presence: auto-remove players who disappear -----------------------------
// Every player's poll (~every 2s) carries ?pid=, so the server knows who is
// still connected — independent of any browser "leave" event. A player who
// stops polling (closed tab, crash, dead battery) is pruned from the lobby, so
// they never linger as a "ghost" in everyone else's lobby. Never prunes during
// an active game (a slept/backgrounded phone must keep its team slot).
const lastSeen = {};                 // pid -> last time we heard from them (ms)
const bootTime = Date.now();
const STALE_MS = 40000;              // in the lobby: gone if not seen for 40s
const GAME_STALE_MS = 120000;        // mid-game: a longer window so a briefly-slept active player keeps their slot
const BOOT_GRACE_MS = 60000;         // grace for persisted players to reconnect after a restart
function pruneStalePlayers() {
  const now = Date.now();
  const inGame = ((store.game || {}).stage || 'lobby') === 'game';
  const staleMs = inGame ? GAME_STALE_MS : STALE_MS;
  let removed = 0;
  for (const key of Object.keys(store)) {
    if (!key.startsWith('player:')) continue;
    const pid = key.slice(7);
    const seen = lastSeen[pid];
    // Gone if they polled then went silent past the window, OR never polled at
    // all since boot (an old persisted ghost from a previous session).
    const gone = seen ? (now - seen > staleMs)
                      : (now - bootTime > BOOT_GRACE_MS);
    if (gone) { delete store[key]; delete lastSeen[pid]; removed++; }
  }
  if (removed) bump();
}
setInterval(pruneStalePlayers, 15000);

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

// Verify the host passcode (checked on the server so it never ships to the
// browser) and hand back a session token used for host-only actions.
app.post('/api/host-login', (req, res) => {
  const code = (req.body && req.body.code) || '';
  if (code !== HOST_CODE) return res.status(401).json({ ok: false });
  const token = crypto.randomBytes(24).toString('hex');
  hostTokens.add(token);
  res.json({ ok: true, token });
});

// Is this token still a valid host session? (Used after a page refresh; tokens
// reset if the server restarts, so the host is asked for the passcode again.)
app.get('/api/host-check', (req, res) => {
  res.json({ ok: hostAuthed(req) });
});

// Image upload for the host (Logo Guess round). The browser sends a data URL
// as JSON; we decode it and write a file, then return its public URL. No
// multipart/multer dependency needed.
app.post('/api/upload', (req, res) => {
  if (!requireHost(req, res)) return;
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
  // Presence: note that this player is still here (works even when we 304 below).
  if (req.query.pid) lastSeen[String(req.query.pid)] = Date.now();
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
// Host-only keys (game/teams/tscore:/config:) require a valid host token.
app.post('/api/storage/:key', (req, res) => {
  const key = req.params.key;
  if (isHostKey(key) && !requireHost(req, res)) return;
  const body = req.body || {};
  store[key] = ('value' in body) ? body.value : body;
  bump();
  res.json({ ok: true, key, value: store[key] });
});

// Delete a single key. Host-only keys require a valid host token.
app.delete('/api/storage/:key', (req, res) => {
  const key = req.params.key;
  if (isHostKey(key) && !requireHost(req, res)) return;
  delete store[key];
  bump();
  res.json({ ok: true });
});

// Wipe everything (host "Reset" uses this).
app.post('/api/reset', (req, res) => {
  if (!requireHost(req, res)) return;
  store = {};
  bump();
  res.json({ ok: true });
});

// Clear only the scores (host "Restart Game") — keeps players, teams and logos
// so the same teams can play again from round 1.
app.post('/api/clearScores', (req, res) => {
  if (!requireHost(req, res)) return;
  for (const k of Object.keys(store)) {
    if (k.startsWith('pscore:') || k.startsWith('panswer:') || k.startsWith('tscore:') ||
        k.startsWith('bs:') || k.startsWith('rq:') || k.startsWith('cb:') || k.startsWith('em:') || k.startsWith('lg:')) delete store[k];
  }
  bump();
  res.json({ ok: true });
});

app.listen(PORT, () => {
  console.log(`\n  DevRush Arena running:`);
  console.log(`   Local:   http://localhost:${PORT}`);
  console.log(`   Network: http://<your-LAN-ip>:${PORT}  (share this with teams)\n`);
});
