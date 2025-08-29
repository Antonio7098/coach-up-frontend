import { NextRequest } from 'next/server';
import {
  __seedManySkillsForTests,
  __seedSkillAssessmentHistoryForTests,
  __resetAllForTests,
  __devSeedDefaultSkills,
  listActiveSkills,
  listTrackedSkillsForUser,
  listLevelHistoryForUser,
  finalizeAssessmentSummary,
} from '../../../lib/mockConvex';

export async function POST(req: NextRequest) {
  // Only allow when MOCK_CONVEX is enabled
  if ((process.env.MOCK_CONVEX || '').trim() !== '1') {
    return new Response(JSON.stringify({ ok: false, error: 'MOCK_CONVEX not enabled' }), { status: 501 });
  }

  // Optional bearer check if DEV_SEED_SECRET is set
  const secret = (process.env.DEV_SEED_SECRET || '').trim();
  if (secret) {
    const auth = req.headers.get('authorization') || '';
    if (!auth.startsWith('Bearer ') || auth.slice('Bearer '.length).trim() !== secret) {
      return new Response(JSON.stringify({ ok: false, error: 'Unauthorized' }), { status: 401 });
    }
  }

  const body = await req.json().catch(() => ({}));
  const {
    reset = false,
    totalSkills = 100,
    categories,
    userId = 'demo_user',
    assessmentsPerSkill = 6,
    levelPerAssessment = 5,
    sessionIdBase = 'sess_seed',
    groupIdBase = 'grp_seed',
    skillIds: desiredSkillIds,
    createSummary = false,
    summaryHighlights = [
      'Clear problem framing and concise articulation observed',
      'Used concrete examples to explain trade-offs',
    ],
    summaryRecommendations = [
      'Reduce jargon; emphasize outcomes in first sentence',
      'Ask one clarifying question before proposing solutions',
    ],
    summaryKeyPoints = [
      'Goal: improve clarity and active listening',
      'Next: practice problem → action → impact framing',
    ],
  } = body || {};

  if (reset) await __resetAllForTests();

  // If caller specified explicit skillIds, ensure defaults exist (which include common IDs)
  if (Array.isArray(desiredSkillIds) && desiredSkillIds.length > 0) {
    __devSeedDefaultSkills();
  } else {
    __seedManySkillsForTests({ total: Number(totalSkills) || 100, categories });
  }

  const skills = await listActiveSkills();
  const availableIds = new Set(skills.map((s) => s.id));
  const skillIds = Array.isArray(desiredSkillIds) && desiredSkillIds.length > 0
    ? desiredSkillIds.filter((id: unknown) => typeof id === 'string' && availableIds.has(String(id)))
    : skills.map((s) => s.id);

  const hist = await __seedSkillAssessmentHistoryForTests({
    userId,
    skillIds,
    assessmentsPerSkill,
    levelPerAssessment,
    sessionIdBase,
    groupIdBase,
  });

  const tracked = await listTrackedSkillsForUser({ userId });
  const history = listLevelHistoryForUser({ userId });

  // Optionally create a real session summary document for the first generated session/group
  if (createSummary) {
    try {
      const firstSkillId = (skills[0]?.id || 'clarity_eloquence');
      const sessionId = `${sessionIdBase}_${firstSkillId}_0`;
      const groupId = `${groupIdBase}_${firstSkillId}_0`;
      await finalizeAssessmentSummary({
        sessionId,
        groupId,
        rubricVersion: 'v2',
        summary: {
          highlights: Array.isArray(summaryHighlights) ? summaryHighlights : [String(summaryHighlights || '')].filter(Boolean),
          recommendations: Array.isArray(summaryRecommendations) ? summaryRecommendations : [String(summaryRecommendations || '')].filter(Boolean),
          rubricKeyPoints: Array.isArray(summaryKeyPoints) ? summaryKeyPoints : [String(summaryKeyPoints || '')].filter(Boolean),
        },
      });
    } catch (e) {
      // non-fatal for seed
      console.warn('mock seed: failed to create summary', e);
    }
  }

  return new Response(
    JSON.stringify({
      ok: true,
      skillsSeeded: skills.length,
      assessmentsInserted: hist.assessmentsInserted,
      trackedCount: tracked.length,
      levelHistoryCount: history.length,
      summaryCreated: Boolean(createSummary),
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
}
