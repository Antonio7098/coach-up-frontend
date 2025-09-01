import { NextRequest } from 'next/server';
import { upsertUserProfile, addOrUpdateGoal } from '../../lib/mockConvex';

export async function POST(req: NextRequest) {
  if ((process.env.MOCK_CONVEX || '').trim() !== '1') {
    return new Response(JSON.stringify({ ok: false, error: 'MOCK_CONVEX not enabled' }), { status: 501 });
  }

  const secret = (process.env.DEV_SEED_SECRET || '').trim();
  if (secret) {
    const auth = req.headers.get('authorization') || '';
    if (!auth.startsWith('Bearer ') || auth.slice('Bearer '.length).trim() !== secret) {
      return new Response(JSON.stringify({ ok: false, error: 'Unauthorized' }), { status: 401 });
    }
  }

  const body = await req.json().catch(() => ({} as any));
  const userId = (body?.userId || 'sales_demo').trim();
  const displayName = body?.displayName || 'Sam Seller';
  const email = body?.email || 'sam.seller@example.com';
  const bio = body?.bio || 'B2B SaaS salesman focused on discovery, objection handling, and concise pitches.';
  const goals = Array.isArray(body?.goals) && body.goals.length > 0 ? body.goals : [
    { goalId: 'g_discovery', title: 'Improve discovery questioning', description: 'Ask open, probing questions to uncover pain points', status: 'active' as const },
    { goalId: 'g_pitch60', title: 'Tighten 60-second pitch', description: 'Deliver a tight, outcome-focused pitch under 60s', status: 'active' as const },
  ];

  try {
    await upsertUserProfile({ userId, displayName, email, bio });
    let goalsSeeded = 0;
    for (const g of goals) {
      await addOrUpdateGoal({ userId, goalId: g.goalId, title: g.title, description: g.description, status: g.status, targetDateMs: g.targetDateMs, tags: g.tags });
      goalsSeeded++;
    }
    return new Response(JSON.stringify({ ok: true, userId, displayName, goalsSeeded }), { status: 200, headers: { 'content-type': 'application/json' } });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e ?? 'seed error');
    return new Response(JSON.stringify({ ok: false, error: msg }), { status: 500 });
  }
}
