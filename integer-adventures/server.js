// server.js
// Integer Adventures — Express server
// Port: 3009  (NTNU team designation — do NOT change)
// Serves: static frontend (public/) + API routes

const express = require('express');
const path    = require('path');
const cors    = require('cors');

const app  = express();
const PORT = 3009;

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

// Request logger (lightweight — no extra library)
app.use((req, _res, next) => {
  if (req.path.startsWith('/api')) {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  }
  next();
});

// ── Initialise database (creates tables if not exists) ────────────────────────
// Importing init.js triggers db.exec() with the full schema
require('./db/init');

// ── API routes ────────────────────────────────────────────────────────────────
app.use('/api/session',   require('./routes/session'));
app.use('/api/progress',  require('./routes/progress'));
app.use('/api/recommend', require('./routes/recommend'));

// ── Health check ──────────────────────────────────────────────────────────────
app.get('/api/health', (_req, res) => {
  res.json({
    status:    'ok',
    service:   'integer-adventures',
    team:      'NTNU',
    chapter:   'grade6_other_side_zero',
    port:      PORT,
    timestamp: new Date().toISOString(),
  });
});

// ── /chapter route ────────────────────────────────────────────────────────────
// The Merge portal redirects students here with ?token=&student_id=&session_id=
// We just serve index.html — the frontend JS handles URL param extraction.
app.get('/chapter', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ── Serve static frontend ─────────────────────────────────────────────────────
// index.html (our full React app, Parts 1–6) lives in public/
app.use(express.static(path.join(__dirname, 'public')));

// ── SPA fallback — all non-API routes return index.html ──────────────────────
app.get('*', (req, res) => {
  // Don't interfere with API 404s
  if (req.path.startsWith('/api')) {
    return res.status(404).json({ error: `No API route: ${req.method} ${req.path}` });
  }
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ── Global error handler ──────────────────────────────────────────────────────
app.use((err, _req, res, _next) => {
  console.error('[ERROR]', err.message);
  res.status(500).json({ error: 'Internal server error', detail: err.message });
});

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, '0.0.0.0', () => {
  console.log('╔══════════════════════════════════════════════════════╗');
  console.log('║        Integer Adventures — Server Started           ║');
  console.log(`║  Port    : ${PORT}                                      ║`);
  console.log(`║  URL     : https://grade6-the-other-side-of-zero     ║`);
  console.log(`║              .kaushik-dev.online                     ║`);
  console.log(`║  Health  : /api/health                               ║`);
  console.log('╚══════════════════════════════════════════════════════╝');
});
