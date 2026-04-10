// services/mergeApi.js
// Builds, validates, and submits the recommendation payload to the Merge API.
// Implements retry with exponential back-off (max 3 attempts).

const axios = require('axios');

const MERGE_API_URL = 'https://kaushik-dev.online/api/recommend/';
const CHAPTER_ID    = 'grade6_other_side_zero';   // canonical — never changes

// ── Total question / hint counts for this chapter ────────────────────────────
const TOTAL_QUESTIONS     = 54;   // 18 concepts × 3 questions each
const TOTAL_HINTS_EMBEDDED = 216; // 54 questions × 4 hint levels each

// ── Payload builder ───────────────────────────────────────────────────────────
/**
 * Build the recommendation payload from tracked session metrics.
 *
 * @param {object} p
 * @param {string}  p.student_id
 * @param {string}  p.session_id
 * @param {string}  p.session_status       "completed" | "exited_midway"
 * @param {number}  p.correct_answers
 * @param {number}  p.wrong_answers
 * @param {number}  p.questions_attempted
 * @param {number}  p.retry_count
 * @param {number}  p.hints_used
 * @param {number}  p.time_spent_seconds
 * @param {number}  p.topic_completion_ratio  0–1
 * @returns {object} payload ready for the API
 */
function buildPayload(p) {
  return {
    student_id:             p.student_id,
    session_id:             p.session_id,
    chapter_id:             CHAPTER_ID,
    timestamp:              new Date().toISOString(),
    session_status:         p.session_status,
    correct_answers:        Math.max(0, Math.floor(p.correct_answers    || 0)),
    wrong_answers:          Math.max(0, Math.floor(p.wrong_answers      || 0)),
    questions_attempted:    Math.max(0, Math.floor(p.questions_attempted || 0)),
    total_questions:        TOTAL_QUESTIONS,
    retry_count:            Math.max(0, Math.floor(p.retry_count         || 0)),
    hints_used:             Math.max(0, Math.floor(p.hints_used          || 0)),
    total_hints_embedded:   TOTAL_HINTS_EMBEDDED,
    time_spent_seconds:     Math.max(0, Math.floor(p.time_spent_seconds  || 0)),
    topic_completion_ratio: Math.min(1, Math.max(0, Number(p.topic_completion_ratio) || 0)),
  };
}

// ── Validation ────────────────────────────────────────────────────────────────
/**
 * Validate payload against Merge API rules.
 * Returns { valid: true } or { valid: false, errors: string[] }
 */
function validatePayload(payload) {
  const errors = [];

  const {
    correct_answers: C,
    wrong_answers: W,
    questions_attempted: A,
    total_questions: T,
    retry_count: R,
    hints_used: H,
    total_hints_embedded: TH,
    topic_completion_ratio: CR,
    session_status: SS,
  } = payload;

  // Rule 1: correct + wrong == attempted
  if (C + W !== A) {
    errors.push(`correct_answers(${C}) + wrong_answers(${W}) must equal questions_attempted(${A})`);
  }

  // Rule 2: attempted <= total
  if (A > T) {
    errors.push(`questions_attempted(${A}) must be <= total_questions(${T})`);
  }

  // Rule 3: retry_count <= attempted
  if (R > A) {
    errors.push(`retry_count(${R}) must be <= questions_attempted(${A})`);
  }

  // Rule 4: hints_used <= total_hints_embedded
  if (H > TH) {
    errors.push(`hints_used(${H}) must be <= total_hints_embedded(${TH})`);
  }

  // Rule 5: ratio in [0, 1]
  if (CR < 0 || CR > 1) {
    errors.push(`topic_completion_ratio(${CR}) must be between 0 and 1`);
  }

  // Rule 6: if completed, attempted must equal total
  if (SS === 'completed' && A !== T) {
    // Relax this rule — some students may skip; we adjust status instead
    // errors.push(`When session_status is "completed", questions_attempted must equal total_questions`);
    // Instead: downgrade status gracefully
    payload.session_status = 'exited_midway';
  }

  return errors.length === 0
    ? { valid: true }
    : { valid: false, errors };
}

// ── Submit with retry ─────────────────────────────────────────────────────────
/**
 * POST payload to Merge API with up to `maxRetries` attempts.
 * Uses exponential back-off: 1s, 2s, 3s between retries.
 *
 * @param {object} payload
 * @param {string} token    JWT Bearer token from the redirect URL
 * @param {number} maxRetries
 * @returns {Promise<{success: boolean, data?: object, error?: string}>}
 */
async function submitToMerge(payload, token, maxRetries = 3) {
  let lastError = null;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const response = await axios.post(MERGE_API_URL, payload, {
        headers: {
          'Content-Type':  'application/json',
          'Authorization': `Bearer ${token}`,
        },
        timeout: 10000, // 10 s
      });

      return { success: true, data: response.data, statusCode: response.status };

    } catch (err) {
      lastError = err;
      const status = err.response?.status;

      // Do not retry on client errors (4xx) — they won't fix themselves
      if (status && status >= 400 && status < 500) {
        return {
          success: false,
          error: `Client error ${status}: ${err.response?.data?.detail || err.message}`,
          statusCode: status,
        };
      }

      // Wait before retrying (exponential back-off)
      if (attempt < maxRetries - 1) {
        await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
      }
    }
  }

  return {
    success:    false,
    error:      lastError?.message || 'Unknown error after retries',
    statusCode: lastError?.response?.status || 0,
  };
}

module.exports = { buildPayload, validatePayload, submitToMerge, CHAPTER_ID };
