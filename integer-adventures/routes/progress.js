// routes/progress.js
// GET /api/progress/:student_id  — returns full learner state for dashboard / resume

const express = require('express');
const router  = express.Router();
const db      = require('../db/init');

// ════════════════════════════════════════════════════════════════════════════
// GET /api/progress/:student_id
// Returns learner profile + BKT posteriors + session summary
// ════════════════════════════════════════════════════════════════════════════
router.get('/:student_id', (req, res) => {
  const { student_id } = req.params;

  if (!student_id) {
    return res.status(400).json({ error: 'student_id is required' });
  }

  try {
    // Learner profile
    const learner = db.prepare('SELECT * FROM learners WHERE student_id = ?')
                      .get(student_id);

    if (!learner) {
      return res.status(404).json({ error: 'Learner not found' });
    }

    // BKT posteriors (all KCs for this learner)
    const bktRows = db.prepare('SELECT kc_id, posterior, updated_at FROM bkt_state WHERE student_id = ?')
                      .all(student_id);
    const bkt = {};
    bktRows.forEach(row => { bkt[row.kc_id] = row.posterior; });

    // Aggregate response stats (all-time)
    const stats = db.prepare(`
      SELECT
        COUNT(*)                          AS total_answered,
        SUM(correct)                      AS total_correct,
        SUM(hints_used)                   AS total_hints_used,
        SUM(retry_count)                  AS total_retries,
        COUNT(DISTINCT concept_id)        AS concepts_attempted
      FROM responses
      WHERE student_id = ?
    `).get(student_id);

    // Most recent session
    const session = db.prepare(`
      SELECT * FROM sessions
      WHERE student_id = ?
      ORDER BY start_ts DESC
      LIMIT 1
    `).get(student_id);

    // Remediation summary
    const remediations = db.prepare(`
      SELECT concept_id, COUNT(*) AS count, SUM(passed) AS passed_count
      FROM remediation_log
      WHERE student_id = ?
      GROUP BY concept_id
    `).all(student_id);

    // Most recent recommendation
    const lastRecommendation = db.prepare(`
      SELECT response_json, sent_at FROM recommend_log
      WHERE student_id = ?
      ORDER BY sent_at DESC
      LIMIT 1
    `).get(student_id);

    res.json({
      learner,
      bkt,
      stats: {
        total_answered:      stats.total_answered       || 0,
        total_correct:       stats.total_correct        || 0,
        total_hints_used:    stats.total_hints_used     || 0,
        total_retries:       stats.total_retries        || 0,
        concepts_attempted:  stats.concepts_attempted   || 0,
        accuracy: stats.total_answered > 0
          ? Math.round((stats.total_correct / stats.total_answered) * 100) / 100
          : 0,
      },
      session:            session           || null,
      remediations,
      last_recommendation: lastRecommendation
        ? JSON.parse(lastRecommendation.response_json || '{}')
        : null,
    });

  } catch (err) {
    console.error('[progress]', err.message);
    res.status(500).json({ error: 'Database error', detail: err.message });
  }
});

module.exports = router;
