import { NextRequest } from 'next/server';
import {
  __seedManySkillsForTests,
  __seedSkillAssessmentHistoryForTests,
  __resetAllForTests,
  listActiveSkills,
  listTrackedSkillsForUser,
  listLevelHistoryForUser,
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
  } = body || {};

  if (reset) await __resetAllForTests();

  __seedManySkillsForTests({ total: Number(totalSkills) || 100, categories });

  const skills = await listActiveSkills();
  const skillIds = skills.map((s) => s.id);

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

  return new Response(
    JSON.stringify({
      ok: true,
      skillsSeeded: skills.length,
      assessmentsInserted: hist.assessmentsInserted,
      trackedCount: tracked.length,
      levelHistoryCount: history.length,
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
}
