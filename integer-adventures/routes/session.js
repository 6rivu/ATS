// routes/session.js
// POST /api/session/save  — called by the frontend after every answer
// POST /api/session/start — called when a student first arrives
// POST /api/session/hint  — logs each hint event

const express = require('express');
const router  = express.Router();
const db      = require('../db/init');

// ── Helper: upsert learner row ────────────────────────────────────────────────
function upsertLearner(student_id, name, device_type) {
  const now = new Date().toISOString();
  const existing = db.prepare('SELECT student_id FROM learners WHERE student_id = ?')
                     .get(student_id);
  if (!existing) {
    db.prepare(`
      INSERT INTO learners (student_id, name, first_seen, last_seen, device_type)
      VALUES (?, ?, ?, ?, ?)
    `).run(student_id, name || 'Anonymous', now, now, device_type || 'unknown');
  } else {
    db.prepare('UPDATE learners SET last_seen = ?, name = COALESCE(?, name) WHERE student_id = ?')
      .run(now, name, student_id);
  }
}

// ── Helper: upsert session row ────────────────────────────────────────────────
function upsertSession(session_id, student_id) {
  const now = new Date().toISOString();
  const existing = db.prepare('SELECT session_id FROM sessions WHERE session_id = ?')
                     .get(session_id);
  if (!existing) {
    db.prepare(`
      INSERT INTO sessions (session_id, student_id, start_ts, status)
      VALUES (?, ?, ?, 'active')
    `).run(session_id, student_id, now);
  }
}

// ════════════════════════════════════════════════════════════════════════════
// POST /api/session/start
// Called immediately when the student lands on /chapter
// Body: { student_id, session_id, name, device_type }
// ════════════════════════════════════════════════════════════════════════════
router.post('/start', (req, res) => {
  const { student_id, session_id, name, device_type } = req.body;

  if (!student_id || !session_id) {
    return res.status(400).json({ error: 'student_id and session_id are required' });
  }

  try {
    upsertLearner(student_id, name, device_type);
    upsertSession(session_id, student_id);
    res.json({ ok: true, student_id, session_id });
  } catch (err) {
    console.error('[session/start]', err.message);
    res.status(500).json({ error: 'Database error', detail: err.message });
  }
});

// ════════════════════════════════════════════════════════════════════════════
// POST /api/session/save
// Called after every MCQ submission to persist the BKT update
// Body:
//   student_id, session_id, concept_id, question_id, kc_id,
//   tier, correct (bool), hints_used, retry_count, pl_before, pl_after
//   bkt_posteriors: { K1: float, K2: float, ... }  (full updated state)
// ════════════════════════════════════════════════════════════════════════════
router.post('/save', (req, res) => {
  const {
    student_id, session_id,
    concept_id, question_id, kc_id,
    tier, correct, hints_used, retry_count,
    pl_before, pl_after,
    bkt_posteriors,
    name,
  } = req.body;

  // Basic required-field check
  if (!student_id || !session_id || !question_id) {
    return res.status(400).json({ error: 'student_id, session_id, and question_id are required' });
  }

  const now = new Date().toISOString();

  try {
    // Ensure learner + session rows exist (idempotent)
    upsertLearner(student_id, name);
    upsertSession(session_id, student_id);

    // Insert response event
    db.prepare(`
      INSERT INTO responses
        (student_id, session_id, concept_id, question_id, kc_id,
         tier, correct, hints_used, retry_count, pl_before, pl_after, ts)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      student_id, session_id,
      concept_id || '', question_id, kc_id || '',
      tier || 1,
      correct ? 1 : 0,
      hints_used    || 0,
      retry_count   || 0,
      pl_before     ?? null,
      pl_after      ?? null,
      now,
    );

    // Upsert BKT state for the specific KC that changed
    if (kc_id && pl_after != null) {
      db.prepare(`
        INSERT INTO bkt_state (student_id, kc_id, posterior, updated_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(student_id, kc_id) DO UPDATE SET
          posterior  = excluded.posterior,
          updated_at = excluded.updated_at
      `).run(student_id, kc_id, pl_after, now);
    }

    // If full bkt_posteriors snapshot provided, update all KCs
    if (bkt_posteriors && typeof bkt_posteriors === 'object') {
      const upsertBKT = db.prepare(`
        INSERT INTO bkt_state (student_id, kc_id, posterior, updated_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(student_id, kc_id) DO UPDATE SET
          posterior  = excluded.posterior,
          updated_at = excluded.updated_at
      `);
      const upsertAll = db.transaction((posteriors) => {
        for (const [kc, val] of Object.entries(posteriors)) {
          upsertBKT.run(student_id, kc, val, now);
        }
      });
      upsertAll(bkt_posteriors);
    }

    res.json({ ok: true });
  } catch (err) {
    console.error('[session/save]', err.message);
    res.status(500).json({ error: 'Database error', detail: err.message });
  }
});

// ════════════════════════════════════════════════════════════════════════════
// POST /api/session/hint
// Called each time a hint is revealed
// Body: { student_id, session_id, concept_id, question_id, hint_level }
// ════════════════════════════════════════════════════════════════════════════
router.post('/hint', (req, res) => {
  const { student_id, session_id, concept_id, question_id, hint_level } = req.body;

  if (!student_id || !session_id) {
    return res.status(400).json({ error: 'student_id and session_id are required' });
  }

  try {
    db.prepare(`
      INSERT INTO hint_events (student_id, session_id, concept_id, question_id, hint_level, ts)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      student_id, session_id,
      concept_id || '', question_id || '',
      hint_level || 1,
      new Date().toISOString(),
    );
    res.json({ ok: true });
  } catch (err) {
    console.error('[session/hint]', err.message);
    res.status(500).json({ error: 'Database error', detail: err.message });
  }
});

// ════════════════════════════════════════════════════════════════════════════
// POST /api/session/remediation
// Called when a remediation panel is triggered or completed
// Body: { student_id, session_id, concept_id, passed (bool | null) }
// ════════════════════════════════════════════════════════════════════════════
router.post('/remediation', (req, res) => {
  const { student_id, session_id, concept_id, passed } = req.body;

  if (!student_id || !session_id || !concept_id) {
    return res.status(400).json({ error: 'student_id, session_id, and concept_id are required' });
  }

  try {
    db.prepare(`
      INSERT INTO remediation_log (student_id, session_id, concept_id, triggered_at, passed)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      student_id, session_id, concept_id,
      new Date().toISOString(),
      passed == null ? null : (passed ? 1 : 0),
    );
    res.json({ ok: true });
  } catch (err) {
    console.error('[session/remediation]', err.message);
    res.status(500).json({ error: 'Database error', detail: err.message });
  }
});

module.exports = router;
