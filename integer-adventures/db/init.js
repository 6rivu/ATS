// db/init.js
// Creates all SQLite tables on startup (idempotent — safe to call every boot)

const Database = require('better-sqlite3');
const path     = require('path');
const fs       = require('fs');

const DB_DIR  = path.join(__dirname, '..', 'data');
const DB_PATH = path.join(DB_DIR, 'integer_adventures.db');

// Ensure data/ directory exists
if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });

const db = new Database(DB_PATH);

// Enable WAL mode for better concurrent read performance
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ── Schema ────────────────────────────────────────────────────────────────────

db.exec(`

  /* ── Learners ── */
  CREATE TABLE IF NOT EXISTS learners (
    student_id   TEXT PRIMARY KEY,
    name         TEXT,
    first_seen   TEXT NOT NULL,
    last_seen    TEXT NOT NULL,
    device_type  TEXT
  );

  /* ── Sessions ── */
  CREATE TABLE IF NOT EXISTS sessions (
    session_id   TEXT PRIMARY KEY,
    student_id   TEXT NOT NULL,
    start_ts     TEXT NOT NULL,
    end_ts       TEXT,
    status       TEXT DEFAULT 'active',   /* active | completed | exited_midway */
    FOREIGN KEY (student_id) REFERENCES learners(student_id)
  );

  /* ── BKT Posteriors (one row per student × KC, upserted on every answer) ── */
  CREATE TABLE IF NOT EXISTS bkt_state (
    student_id   TEXT NOT NULL,
    kc_id        TEXT NOT NULL,
    posterior    REAL NOT NULL DEFAULT 0.1,
    updated_at   TEXT NOT NULL,
    PRIMARY KEY (student_id, kc_id),
    FOREIGN KEY (student_id) REFERENCES learners(student_id)
  );

  /* ── Response Events ── */
  CREATE TABLE IF NOT EXISTS responses (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    student_id       TEXT NOT NULL,
    session_id       TEXT NOT NULL,
    concept_id       TEXT NOT NULL,
    question_id      TEXT NOT NULL,
    kc_id            TEXT NOT NULL,
    tier             INTEGER NOT NULL,
    correct          INTEGER NOT NULL,   /* 1 | 0 */
    hints_used       INTEGER NOT NULL DEFAULT 0,
    retry_count      INTEGER NOT NULL DEFAULT 0,
    pl_before        REAL,
    pl_after         REAL,
    ts               TEXT NOT NULL,
    FOREIGN KEY (student_id) REFERENCES learners(student_id),
    FOREIGN KEY (session_id) REFERENCES sessions(session_id)
  );

  /* ── Hint Events ── */
  CREATE TABLE IF NOT EXISTS hint_events (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    student_id   TEXT NOT NULL,
    session_id   TEXT NOT NULL,
    concept_id   TEXT NOT NULL,
    question_id  TEXT NOT NULL,
    hint_level   INTEGER NOT NULL,   /* 1–4 */
    ts           TEXT NOT NULL,
    FOREIGN KEY (student_id) REFERENCES learners(student_id),
    FOREIGN KEY (session_id) REFERENCES sessions(session_id)
  );

  /* ── Remediation Events ── */
  CREATE TABLE IF NOT EXISTS remediation_log (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    student_id   TEXT NOT NULL,
    session_id   TEXT NOT NULL,
    concept_id   TEXT NOT NULL,
    triggered_at TEXT NOT NULL,
    passed       INTEGER,             /* 1 | 0 | NULL (not yet answered) */
    FOREIGN KEY (student_id) REFERENCES learners(student_id),
    FOREIGN KEY (session_id) REFERENCES sessions(session_id)
  );

  /* ── Recommendation Log (one row per session submission) ── */
  CREATE TABLE IF NOT EXISTS recommend_log (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    student_id    TEXT NOT NULL,
    session_id    TEXT NOT NULL,
    sent_at       TEXT NOT NULL,
    payload_json  TEXT NOT NULL,
    status_code   INTEGER,
    response_json TEXT,
    FOREIGN KEY (student_id) REFERENCES learners(student_id),
    FOREIGN KEY (session_id) REFERENCES sessions(session_id)
  );

`);

console.log('[DB] Schema ready →', DB_PATH);

module.exports = db;
