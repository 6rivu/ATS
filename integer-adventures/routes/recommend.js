// routes/recommend.js
// POST /api/recommend
// Called by the frontend at session end (completion or exit).
// Validates the payload, submits to the Merge API, logs the result.

const express  = require('express');
const router   = express.Router();
const db       = require('../db/init');
const { buildPayload, validatePayload, submitToMerge } = require('../services/mergeApi');

// ════════════════════════════════════════════════════════════════════════════
// POST /api/recommend
// Body: all tracked session metrics (see mergeApi.buildPayload signature)
// Headers: Authorization: Bearer <token>  (forwarded from client)
// ════════════════════════════════════════════════════════════════════════════
router.post('/', async (req, res) => {
  // ── 1. Extract JWT from Authorization header ───────────────────────────────
  const authHeader = req.headers['authorization'] || '';
  const token      = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!token) {
    return res.status(401).json({
      error: 'Missing Authorization header. Include: Authorization: Bearer <token>',
    });
  }

  // ── 2. Extract required identifiers ───────────────────────────────────────
  const { student_id, session_id } = req.body;
  if (!student_id || !session_id) {
    return res.status(400).json({ error: 'student_id and session_id are required' });
  }

  // ── 3. Build and validate payload ─────────────────────────────────────────
  const payload = buildPayload(req.body);
  const { valid, errors } = validatePayload(payload);

  if (!valid) {
    console.warn('[recommend] Validation failed:', errors);
    return res.status(422).json({
      error:  'Payload validation failed',
      errors,
      payload,  // return so frontend can inspect / log
    });
  }

  // ── 4. Submit to Merge API ─────────────────────────────────────────────────
  console.log(`[recommend] Submitting for ${student_id} / ${session_id}`);
  const result = await submitToMerge(payload, token);

  // ── 5. Log to database (always — even on failure) ─────────────────────────
  try {
    db.prepare(`
      INSERT INTO recommend_log
        (student_id, session_id, sent_at, payload_json, status_code, response_json)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      student_id,
      session_id,
      new Date().toISOString(),
      JSON.stringify(payload),
      result.statusCode || 0,
      result.data ? JSON.stringify(result.data) : null,
    );

    // Update session status in DB
    db.prepare(`
      UPDATE sessions SET status = ?, end_ts = ? WHERE session_id = ?
    `).run(payload.session_status, new Date().toISOString(), session_id);

  } catch (dbErr) {
    console.error('[recommend] DB log error:', dbErr.message);
    // Don't fail the response — logging is non-critical
  }

  // ── 6. Return result to frontend ──────────────────────────────────────────
  if (result.success) {
    console.log(`[recommend] Success for ${student_id} — state: ${result.data?.learning_state}`);
    return res.json({
      ok:             true,
      recommendation: result.data,
    });
  } else {
    console.error(`[recommend] Failed for ${student_id}:`, result.error);

    // Return a fallback recommendation so the UI can still show something
    return res.status(result.statusCode >= 400 && result.statusCode < 600
      ? result.statusCode : 502).json({
      ok:    false,
      error: result.error,
      // Fallback so frontend doesn't show a blank screen
      recommendation: {
        learning_state: 'unknown',
        performance_score: null,
        recommendation: {
          type:       'next_chapter',
          reason:     'Unable to contact the recommendation service. Please continue to the next chapter.',
          next_steps: ['Review any concepts you found difficult', 'Move on to the next topic'],
        },
      },
    });
  }
});

module.exports = router;
