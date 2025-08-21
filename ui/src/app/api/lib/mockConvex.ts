// Simple in-memory Convex mock used only in tests (MOCK_CONVEX=1)
// Mirrors the shapes used in `convex/assessments.ts` queries/mutations.

export type Summary = {
  highlights: string[];
  recommendations: string[];
  rubricKeyPoints: string[];
};

type Doc = {
  userId: string;
  sessionId: string;
  trackedSkillId?: string;
  interactionId?: string;
  groupId?: string;
  kind: 'per_interaction' | 'multi_turn' | 'summary';
  category: string;
  score: number;
  errors: string[];
  tags: string[];
  rubricVersion: string;
  summary?: Summary;
  createdAt: number;
  updatedAt: number;
};

const _db: Doc[] = [];

export async function createAssessmentGroup(args: {
  sessionId: string;
  groupId: string;
  rubricVersion: string;
}) {
  const now = Date.now();
  _db.push({
    userId: 'unknown',
    sessionId: args.sessionId,
    trackedSkillId: undefined,
    interactionId: undefined,
    groupId: args.groupId,
    kind: 'multi_turn',
    category: 'group_init',
    score: 0,
    errors: [],
    tags: ['group_init'],
    rubricVersion: args.rubricVersion,
    summary: undefined,
    createdAt: now,
    updatedAt: now,
  });
  return { ok: true } as const;
}

export async function finalizeAssessmentSummary(args: {
  sessionId: string;
  groupId: string;
  rubricVersion: string;
  summary: Summary;
}) {
  const now = Date.now();
  _db.push({
    userId: 'unknown',
    sessionId: args.sessionId,
    trackedSkillId: undefined,
    interactionId: undefined,
    groupId: args.groupId,
    kind: 'summary',
    category: 'session_summary',
    score: 0,
    errors: [],
    tags: ['summary'],
    rubricVersion: args.rubricVersion,
    summary: args.summary,
    createdAt: now,
    updatedAt: now,
  });
  return { ok: true } as const;
}

export async function getLatestAssessmentSummary(args: { sessionId: string }) {
  const bySession = _db.filter((d) => d.sessionId === args.sessionId);
  const summaries = bySession.filter((d) => d.kind === 'summary');
  summaries.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
  const latestSummary = summaries[0] ?? null;
  if (latestSummary) {
    return {
      sessionId: args.sessionId,
      latestGroupId: latestSummary.groupId ?? null,
      summary: latestSummary.summary ?? null,
      rubricVersion: latestSummary.rubricVersion,
    } as const;
  }
  bySession.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
  const newest = bySession[0] ?? null;
  if (!newest) return null;
  return {
    sessionId: args.sessionId,
    latestGroupId: newest.groupId ?? null,
    summary: null,
    rubricVersion: newest.rubricVersion,
  } as const;
}
