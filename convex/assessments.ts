// Public Convex module: assessments (v2)
// Re-export v2 assessment functions so callers can use "assessments:*" path.
export {
  getLatestAssessmentSummary,
  recordSkillAssessmentV2,
  checkFinalizeIdempotency,
  markFinalizeCompleted,
  persistAssessmentSummaryV2,
} from "./functions/assessments";
