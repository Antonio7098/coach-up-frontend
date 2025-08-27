// ARCHIVED: Assessments v1 functions (SPR-002)
// These v1 functions have been replaced by v2-only implementations in SPR-007
// This file is kept for historical reference but is not imported by the app
// All v1 code paths have been removed from the active codebase

// Original v1 functions (archived):
// - createAssessmentGroup
// - recordAssessmentRun
// - getLatestAssessmentSummary
// - finalizeAssessmentSummary

// V2 replacement functions are in:
// - convex/functions/assessments.ts (recordSkillAssessmentV2, checkFinalizeIdempotency, markFinalizeCompleted)
// - convex/functions/skills.ts (resolveSkillIdFromHash, updateLevelFromRecentAssessments)

// Migration notes:
// - v1 used single summary documents per session
// - v2 uses per-skill assessment rows with skillHash and level progression
// - Schema updated to support v2 fields and new skill_level_history table
// - Idempotency added for finalize calls

// DO NOT USE - This file is archived for reference only
