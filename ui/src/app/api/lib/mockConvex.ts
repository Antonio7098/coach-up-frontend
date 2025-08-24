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
  trackedSkillIdHash?: string;
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
type InteractionDoc = {
  sessionId: string;
  groupId: string;
  messageId: string;
  role: 'user' | 'assistant' | 'system';
  contentHash: string;
  text?: string;
  audioUrl?: string;
  ts: number;
  createdAt: number;
};
type EventDoc = {
  userId: string;
  sessionId: string;
  groupId?: string;
  requestId: string;
  trackedSkillIdHash?: string;
  kind: string;
  payload?: Record<string, unknown>;
  createdAt: number;
};
type SessionDoc = {
  userId: string;
  sessionId: string;
  state: Record<string, unknown>;
  latestGroupId?: string;
  createdAt: number;
  lastActivityAt: number;
};
const _interactions: InteractionDoc[] = [];
const _events: EventDoc[] = [];
const _sessions: SessionDoc[] = [];
type TrackedSkillDoc = {
  userId: string;
  skillId: string;
  currentLevel: number; // 0..10
  order: number; // 1..2
  createdAt: number;
  updatedAt: number;
};
const _tracked: TrackedSkillDoc[] = [];

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

export async function persistAssessmentSummary(args: {
  sessionId: string;
  groupId: string;
  rubricVersion: string;
  summary: Summary;
  trackedSkillIdHash?: string;
}) {
  const now = Date.now();
  _db.push({
    userId: 'unknown',
    sessionId: args.sessionId,
    trackedSkillId: undefined,
    trackedSkillIdHash: args.trackedSkillIdHash,
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
  return { ok: true, trackedSkillIdHash: args.trackedSkillIdHash } as const;
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

export async function appendInteraction(args: {
  sessionId: string;
  groupId: string;
  messageId: string;
  role: 'user' | 'assistant' | 'system';
  contentHash: string;
  text?: string;
  audioUrl?: string;
  ts: number;
}) {
  const now = Date.now();
  _interactions.push({ ...args, createdAt: now });
  return { id: `${args.sessionId}:${args.messageId}` } as const;
}

export async function listInteractionsBySession(args: { sessionId: string; limit?: number }) {
  const lim = Math.max(1, Math.min(500, Number.isFinite(Number(args.limit)) ? Number(args.limit) : 200));
  const docs = _interactions.filter((i) => i.sessionId === args.sessionId);
  docs.sort((a, b) => (a.ts ?? 0) - (b.ts ?? 0));
  return docs.length > lim ? docs.slice(docs.length - lim) : docs;
}

export async function listInteractionsByGroup(args: { groupId: string; limit?: number }) {
  const lim = Math.max(1, Math.min(500, Number.isFinite(Number(args.limit)) ? Number(args.limit) : 200));
  const docs = _interactions.filter((i) => i.groupId === args.groupId);
  docs.sort((a, b) => (a.ts ?? 0) - (b.ts ?? 0));
  return docs.length > lim ? docs.slice(docs.length - lim) : docs;
}

export async function logEvent(args: {
  userId: string;
  sessionId: string;
  groupId?: string;
  requestId: string;
  trackedSkillIdHash?: string;
  kind: string;
  payload?: Record<string, unknown>;
}) {
  const now = Date.now();
  _events.push({ ...args, createdAt: now });
  return { ok: true } as const;
}

export async function updateSessionState(args: {
  userId: string;
  sessionId: string;
  state?: Record<string, unknown>;
  latestGroupId?: string;
}) {
  const now = Date.now();
  const existing = _sessions.find((s) => s.sessionId === args.sessionId);
  if (!existing) {
    const doc: SessionDoc = {
      userId: args.userId,
      sessionId: args.sessionId,
      state: args.state ?? {},
      latestGroupId: args.latestGroupId,
      createdAt: now,
      lastActivityAt: now,
    };
    _sessions.push(doc);
    return { created: true, id: args.sessionId } as const;
  }
  existing.state = (args.state ?? existing.state ?? {}) as Record<string, unknown>;
  existing.latestGroupId = args.latestGroupId ?? existing.latestGroupId;
  existing.lastActivityAt = now;
  return { created: false, id: args.sessionId } as const;
}

export async function listEventsBySession(args: { sessionId: string; limit: number }) {
  const lim = Math.max(1, Math.min(200, Number.isFinite(Number(args.limit)) ? Number(args.limit) : 50));
  const filtered = _events.filter((e) => e.sessionId === args.sessionId);
  filtered.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
  return filtered.slice(0, lim);
}

// -------------------- Skills (mock) --------------------
export type SkillDoc = {
  id: string;
  title: string;
  description: string;
  levels: Array<{ level: number; criteria: string; examples?: string[]; rubricHints?: string[] }>;
  category?: string;
  isActive: boolean;
  createdAt: number;
  updatedAt: number;
};
const _skills: SkillDoc[] = [];

export async function listActiveSkills() {
  return _skills.filter((s) => s.isActive);
}

export async function getSkillById(args: { id: string }) {
  return _skills.find((s) => s.id === args.id) ?? null;
}

export async function listSkillsByCategory(args: { category: string }) {
  return _skills.filter((s) => s.category === args.category);
}

// Test-only: seed skills into in-memory store
export function __seedSkillsForTests(skills: SkillDoc[]) {
  _skills.length = 0;
  for (const s of skills) _skills.push(s);
}

// Dev-only: seed a few default skills if empty (idempotent)
export function __devSeedDefaultSkills() {
  if (_skills.length > 0) return;
  const now = Date.now();
  const defaults: SkillDoc[] = [
    {
      id: 'clarity_eloquence',
      title: 'Clarity & Eloquence',
      description: 'Communicate ideas clearly and eloquently.',
      levels: [
        { level: 0, criteria: 'Basic articulation' },
        { level: 5, criteria: 'Consistent clarity in most contexts' },
        { level: 10, criteria: 'Exceptional clarity and eloquence' },
      ],
      category: 'communication',
      isActive: true,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'active_listening',
      title: 'Active Listening',
      description: 'Engage attentively and reflect understanding.',
      levels: [
        { level: 0, criteria: 'Occasional acknowledgment' },
        { level: 5, criteria: 'Paraphrases and probes appropriately' },
        { level: 10, criteria: 'Consistently demonstrates deep listening' },
      ],
      category: 'communication',
      isActive: true,
      createdAt: now,
      updatedAt: now,
    },
  ];
  for (const s of defaults) _skills.push(s);
}

// Test-only helper to reset in-memory state between tests
export function __resetAllForTests() {
  _db.length = 0;
  _interactions.length = 0;
  _events.length = 0;
  _sessions.length = 0;
  _skills.length = 0;
  _tracked.length = 0;
}

// -------------------- Tracked Skills (mock) --------------------
export async function listTrackedSkillsForUser(args: { userId: string }) {
  const rows = _tracked.filter((t) => t.userId === args.userId);
  const out = rows.map((t) => ({
    ...t,
    skill: _skills.find((s) => s.id === t.skillId) ?? null,
  }));
  out.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  return out;
}

export async function trackSkill(args: { userId: string; skillId: string; order?: number }) {
  const skill = _skills.find((s) => s.id === args.skillId);
  if (!skill) throw new Error("skill not found");
  if (!skill.isActive) throw new Error("skill not active");

  const existingForUser = _tracked.filter((t) => t.userId === args.userId);
  const existing = existingForUser.find((t) => t.skillId === args.skillId);
  if (!existing && existingForUser.length >= 2) {
    throw new Error("maximum of 2 tracked skills per user");
  }
  const now = Date.now();
  const ord = Number.isFinite(Number(args.order))
    ? Math.max(1, Math.min(2, Number(args.order)))
    : Math.min(2, existing ? existing.order : (existingForUser.length + 1));

  if (!existing) {
    _tracked.push({ userId: args.userId, skillId: args.skillId, currentLevel: 0, order: ord, createdAt: now, updatedAt: now });
    return { created: true } as const;
  }
  existing.order = ord;
  existing.updatedAt = now;
  return { created: false } as const;
}

export async function untrackSkill(args: { userId: string; skillId: string }) {
  const idx = _tracked.findIndex((t) => t.userId === args.userId && t.skillId === args.skillId);
  if (idx === -1) return { ok: true, removed: false } as const;
  _tracked.splice(idx, 1);
  return { ok: true, removed: true } as const;
}

export async function setSkillLevel(args: { userId: string; skillId: string; currentLevel: number }) {
  const { userId, skillId, currentLevel } = args;
  if (currentLevel < 0 || currentLevel > 10) throw new Error("currentLevel must be between 0 and 10");
  const existing = _tracked.find((t) => t.userId === userId && t.skillId === skillId);
  if (!existing) throw new Error("skill not tracked");
  const now = Date.now();
  existing.currentLevel = currentLevel;
  existing.updatedAt = now;
  return { ok: true } as const;
}
