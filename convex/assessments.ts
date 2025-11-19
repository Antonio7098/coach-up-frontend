// Public Convex module: assessments (v2)
// Re-export v2 assessment functions so callers can use "assessments:*" path.
export {
  // New v2 endpoints
  createAssessment,
  insertSkillResults,
  getLatestBySession,
  getById,
  // Legacy v2 shims kept for compatibility
  getLatestAssessmentResults,
  recordSkillAssessmentV2,
  checkFinalizeIdempotency,
  markFinalizeCompleted,
  persistAssessmentResultsV2,
} from "./functions/assessments";
