// Simple in-memory Convex mock used only in tests (MOCK_CONVEX=1)
// Mirrors the shapes used in `convex/assessments.ts` queries/mutations.
import { sha256Hex } from "./hash";

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
  kind: 'per_interaction' | 'multi_turn' | 'summary' | 'skill_assessment';
  category: string;
  score: number;
  errors: string[];
  tags: string[];
  rubricVersion: string;
  summary?: Summary;
  // v2 fields for per-skill rows
  skillHash?: string;
  level?: number; // 0..10
  createdAt: number;
  updatedAt: number;
};

const _db: Doc[] = [];
type LevelHistoryDoc = {
  userId: string;
  skillId: string;
  fromLevel: number;
  toLevel: number;
  reason: string;
  avgSource?: { count: number; avg: number };
  sessionId?: string;
  groupId?: string;
  createdAt: number;
};
const _levelHistory: LevelHistoryDoc[] = [];
// Minimal in-memory users_profile store for MOCK_CONVEX
type UserProfile = { userId: string; displayName?: string; email?: string; avatarUrl?: string; bio?: string; createdAt: number; updatedAt: number };
const _usersProfile: Record<string, UserProfile> = Object.create(null);
type InteractionDoc = {
  sessionId: string;
  groupId?: string;
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

// Helper to persist tracked skills to prevent loss on server restart
function saveTrackedSkills() {
  if (typeof global !== 'undefined') {
    try {
      (global as any).__mockTrackedSkills = JSON.stringify(_tracked);
    } catch {}
  }
}

function loadTrackedSkills() {
  if (typeof global !== 'undefined') {
    try {
      const saved = (global as any).__mockTrackedSkills;
      if (typeof saved === 'string') {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          _tracked.length = 0;
          _tracked.push(...parsed);
        }
      }
    } catch {}
  }
}

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
  groupId?: string;
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

export async function getSessionById(args: { sessionId: string }) {
  const doc = _sessions.find(s => s.sessionId === args.sessionId);
  return doc ? { ...doc } : null;
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

// Test-only: generate many synthetic active skills
export function __seedManySkillsForTests(opts?: { total?: number; categories?: string[] }) {
  const total = Math.max(1, Math.min(2000, Number(opts?.total ?? 50)));
  const categories = (opts?.categories && opts?.categories.length ? opts.categories : [
    'communication', 'delivery', 'strategy', 'leadership', 'execution', 'collaboration', 'customer'
  ]);
  _skills.length = 0;
  const now = Date.now();
  for (let i = 0; i < total; i++) {
    const cat = categories[i % categories.length];
    _skills.push({
      id: `skill_${cat}_${i + 1}`,
      title: `Skill ${i + 1} (${cat})`,
      description: `Auto-seeded skill ${i + 1} in category ${cat}.`,
      levels: Array.from({ length: 10 }, (_, idx) => {
        const lvl = idx + 1;
        if (lvl <= 3) {
          return {
            level: lvl,
            criteria: 'Often confusing or disorganized; unclear framing; relies on jargon',
            examples: ['“We implemented a new synergistic paradigm leveraging our backend architecture…”'],
            rubricHints: ['Define terms; speak to outcomes; reduce clauses'],
          };
        }
        if (lvl <= 6) {
          return {
            level: lvl,
            criteria: 'Generally understandable; usually clear and direct; simplifies complexity',
            examples: ['“We changed how the app gets data… it’s asynchronous so it should feel a bit faster.”'],
            rubricHints: ['Use concrete subjects/verbs; one idea per sentence; emphasize outcomes'],
          };
        }
        if (lvl <= 8) {
          return {
            level: lvl,
            criteria: 'Clear, direct; simplifies complexity and explains trade-offs succinctly',
            examples: ['“We fetch data in the background, so the interface stays responsive and feels faster.”'],
            rubricHints: ['Bronze: strong clarity and brevity; problem → action → impact'],
          };
        }
        if (lvl === 9) {
          return {
            level: lvl,
            criteria: 'Consistently exceptional clarity; sharp, memorable phrasing',
            examples: ['“Data now loads asynchronously, eliminating UI freezes and ensuring a seamless experience.”'],
            rubricHints: ['Silver: consistently exceptional clarity'],
          };
        }
        return {
          level: lvl,
          criteria: 'Effortless, memorable communication; elegantly simple framing',
          examples: ['“Instantly responsive—data streams in the background.”'],
          rubricHints: ['Gold: exceptional clarity and resonance'],
        };
      }),
      category: cat,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
  }
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
      levels: Array.from({ length: 10 }, (_, idx) => {
        const lvl = idx + 1;
        if (lvl <= 3) {
          return {
            level: lvl,
            criteria: 'Often confusing or disorganized; unclear framing; relies on jargon',
            examples: ['“We implemented a new synergistic paradigm leveraging our backend architecture…”'],
            rubricHints: ['Define terms; speak to outcomes; reduce clauses'],
          };
        }
        if (lvl <= 6) {
          return {
            level: lvl,
            criteria: 'Generally understandable; usually clear and direct; simplifies complexity',
            examples: ['“We changed how the app gets data… it’s asynchronous so it should feel a bit faster.”'],
            rubricHints: ['Use concrete subjects/verbs; one idea per sentence; emphasize outcomes'],
          };
        }
        if (lvl <= 8) {
          return {
            level: lvl,
            criteria: 'Clear, direct; simplifies complexity and explains trade-offs succinctly',
            examples: ['“We fetch data in the background, so the interface stays responsive and feels faster.”'],
            rubricHints: ['Bronze: strong clarity and brevity; problem → action → impact'],
          };
        }
        if (lvl === 9) {
          return {
            level: lvl,
            criteria: 'Consistently exceptional clarity; sharp, memorable phrasing',
            examples: ['“Data now loads asynchronously, eliminating UI freezes and ensuring a seamless experience.”'],
            rubricHints: ['Silver: consistently exceptional clarity'],
          };
        }
        return {
          level: lvl,
          criteria: 'Effortless, memorable communication; elegantly simple framing',
          examples: ['“Instantly responsive—data streams in the background.”'],
          rubricHints: ['Gold: exceptional clarity and resonance'],
        };
      }),
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
        {
          level: 0,
          criteria: 'Infrequent acknowledgments; misses key points',
          examples: ['“Okay.” (no follow-up, no reflection)'],
          rubricHints: ['Reflect content and feeling; ask one clarifying question'],
        },
        {
          level: 5,
          criteria: 'Paraphrases, probes, and validates regularly',
          examples: ['“It sounds like latency is the core issue—did I get that right?”'],
          rubricHints: ['Bronze: reflect → probe → validate'],
        },
        {
          level: 10,
          criteria: 'Anticipates needs; consistently demonstrates deep listening',
          examples: ['“Given the latency concern, shall we test prefetching during idle?”'],
          rubricHints: ['Gold: anticipates and advances the conversation'],
        },
      ],
      category: 'communication',
      isActive: true,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'storytelling',
      title: 'Storytelling',
      description: 'Use narrative to engage and persuade.',
      levels: [
        {
          level: 0,
          criteria: 'Lists events without a clear arc',
          examples: ['“First we built X, then Y, then Z.”'],
          rubricHints: ['Introduce goal, conflict, stakes'],
        },
        {
          level: 5,
          criteria: 'Clear arc with tension and resolution; highlights stakes',
          examples: ['“We faced drop-offs; we reframed onboarding; activation rose 12%.”'],
          rubricHints: ['Bronze: arc + stakes + outcome'],
        },
        {
          level: 10,
          criteria: 'Compelling narrative; vivid and memorable',
          examples: ['“A 2-minute flow now opens a door to 10k weekly creators.”'],
          rubricHints: ['Gold: emotional resonance + strategic clarity'],
        },
      ],
      category: 'delivery',
      isActive: true,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'questioning',
      title: 'Questioning',
      description: 'Ask effective questions to uncover needs.',
      levels: [
        { level: 0, criteria: 'Asks closed questions' },
        { level: 5, criteria: 'Mixes open and probing questions' },
        { level: 10, criteria: 'Strategic questioning that reveals key insights' },
      ],
      category: 'communication',
      isActive: true,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'empathy',
      title: 'Empathy',
      description: 'Demonstrate understanding and care for others’ perspectives.',
      levels: [
        { level: 0, criteria: 'Acknowledges feelings occasionally' },
        { level: 5, criteria: 'Reflects emotions and validates regularly' },
        { level: 10, criteria: 'Consistently anticipates and responds with empathy' },
      ],
      category: 'communication',
      isActive: true,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'confidence',
      title: 'Confidence',
      description: 'Project confidence and credibility.',
      levels: [
        { level: 0, criteria: 'Inconsistent tone and posture' },
        { level: 5, criteria: 'Steady tone and confident delivery' },
        { level: 10, criteria: 'Authoritative and inspiring presence' },
      ],
      category: 'delivery',
      isActive: true,
      createdAt: now,
      updatedAt: now,
    },
  ];
  for (const s of defaults) _skills.push(s);
}

// Dev-only: ensure up to 2 tracked skills exist for a user (idempotent)
export function __devEnsureTrackedForUser(args: { userId: string }) {
  const userId = args.userId;
  // Seed skills if empty
  if (_skills.length === 0) __devSeedDefaultSkills();
  const existing = _tracked.filter((t) => t.userId === userId);
  if (existing.length >= 2) return;
  const picked = new Set(existing.map((t) => t.skillId));
  const now = Date.now();
  for (const s of _skills) {
    if (existing.length >= 2) break;
    if (picked.has(s.id)) continue;
    const ord = existing.length + 1; // 1..2
    _tracked.push({ userId, skillId: s.id, currentLevel: 0, order: ord, createdAt: now, updatedAt: now });
    existing.push({ userId, skillId: s.id, currentLevel: 0, order: ord, createdAt: now, updatedAt: now });
  }
}

// Test-only helper to reset in-memory state between tests
export async function __resetAllForTests() {
  _db.length = 0;
  _interactions.length = 0;
  _events.length = 0;
  _sessions.length = 0;
  _skills.length = 0;
  _tracked.length = 0;
  _levelHistory.length = 0;
  for (const k of Object.keys(_usersProfile)) delete _usersProfile[k];
  // Clear persistence
  if (typeof global !== 'undefined') {
    try {
      delete (global as any).__mockTrackedSkills;
    } catch {}
  }
}

// -------------------- Users Profile (mock) --------------------
export async function getUserProfile(args: { userId: string }) {
  const p = _usersProfile[args.userId];
  if (!p) return null;
  // Return a shallow copy to avoid accidental external mutation
  return { userId: p.userId, displayName: p.displayName, email: p.email, avatarUrl: p.avatarUrl, bio: p.bio, createdAt: p.createdAt, updatedAt: p.updatedAt };
}

export async function upsertUserProfile(args: { userId: string; displayName?: string; email?: string; avatarUrl?: string; bio?: string }) {
  const now = Date.now();
  const existing = _usersProfile[args.userId];
  if (!existing) {
    _usersProfile[args.userId] = {
      userId: args.userId,
      displayName: args.displayName,
      email: args.email,
      avatarUrl: args.avatarUrl,
      bio: args.bio,
      createdAt: now,
      updatedAt: now,
    };
    return { created: true } as const;
  }
  existing.displayName = args.displayName ?? existing.displayName;
  existing.email = args.email ?? existing.email;
  existing.avatarUrl = args.avatarUrl ?? existing.avatarUrl;
  existing.bio = args.bio ?? existing.bio;
  existing.updatedAt = now;
  return { created: false } as const;
}

// Test-only: list level history for a user (and optionally a single skill)
export function listLevelHistoryForUser(args: { userId: string; skillId?: string }) {
  return _levelHistory.filter(h => h.userId === args.userId && (!args.skillId || h.skillId === args.skillId));
}

// -------------------- Tracked Skills (mock) --------------------
export async function listTrackedSkillsForUser(args: { userId: string }) {
  loadTrackedSkills();
  const rows = _tracked.filter((t) => t.userId === args.userId);
  const out = rows.map((t) => ({
    ...t,
    skill: _skills.find((s) => s.id === t.skillId) ?? null,
  }));
  out.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  return out;
}

export async function trackSkill(args: { userId: string; skillId: string; order?: number }) {
  loadTrackedSkills();
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
    saveTrackedSkills();
    return { created: true } as const;
  }
  existing.order = ord;
  existing.updatedAt = now;
  saveTrackedSkills();
  return { created: false } as const;
}

export async function untrackSkill(args: { userId: string; skillId: string }) {
  loadTrackedSkills();
  const idx = _tracked.findIndex((t) => t.userId === args.userId && t.skillId === args.skillId);
  if (idx === -1) return { ok: true, removed: false } as const;
  _tracked.splice(idx, 1);
  saveTrackedSkills();
  return { ok: true, removed: true } as const;
}

export async function setSkillLevel(args: { userId: string; skillId: string; currentLevel: number }) {
  loadTrackedSkills();
  const { userId, skillId, currentLevel } = args;
  if (currentLevel < 0 || currentLevel > 10) throw new Error("currentLevel must be between 0 and 10");
  const existing = _tracked.find((t) => t.userId === userId && t.skillId === skillId);
  if (!existing) throw new Error("skill not tracked");
  const now = Date.now();
  existing.currentLevel = currentLevel;
  existing.updatedAt = now;
  saveTrackedSkills();
  return { ok: true } as const;
}

// -------------------- V2 Assessments (mock) --------------------
export async function recordSkillAssessmentV2(args: {
  userId: string;
  sessionId: string;
  groupId: string;
  skillHash: string;
  level: number; // 0..10
  rubricVersion: 'v2';
  feedback: string[];
  metCriteria: string[];
  unmetCriteria: string[];
  trackedSkillIdHash?: string;
}) {
  const now = Date.now();
  _db.push({
    userId: args.userId,
    sessionId: args.sessionId,
    trackedSkillId: undefined,
    trackedSkillIdHash: args.trackedSkillIdHash,
    interactionId: undefined,
    groupId: args.groupId,
    kind: 'skill_assessment',
    category: 'skill',
    score: args.level / 10,
    errors: [],
    tags: ['v2', 'skill_assessment', args.skillHash],
    rubricVersion: 'v2',
    summary: undefined,
    skillHash: args.skillHash,
    level: args.level,
    createdAt: now,
    updatedAt: now,
  });
  return { ok: true } as const;
}

function __resolveSkillIdFromHash(skillHash: string): string | null {
  const salt = (process.env.SKILL_HASH_SALT || 'test_salt').trim();
  for (const s of _skills) {
    if (sha256Hex(`${salt}:${s.id}`) === skillHash) return s.id;
  }
  return null;
}

export async function updateLevelFromRecentAssessments(args: {
  userId: string;
  sessionId: string;
  groupId: string;
  skillHash: string;
}) {
  const userId = args.userId;
  const skillId = __resolveSkillIdFromHash(args.skillHash) || args.skillHash; // fallback to using hash as id in tests
  const N = Number(process.env.SKILL_LEVEL_AVERAGE_COUNT ?? 5);
  const THRESH = Number(process.env.SKILL_LEVEL_INCREMENT_THRESHOLD ?? 1.0);
  const rows = _db
    .filter((d) => d.kind === 'skill_assessment' && d.userId === userId && d.skillHash === args.skillHash)
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, Math.max(1, N));
  if (rows.length === 0) return { ok: true, updated: false } as const;
  const avg = rows.reduce((acc, r) => acc + (r.level ?? 0), 0) / rows.length;

  // Ensure tracked entry exists
  let tracked = _tracked.find((t) => t.userId === userId && t.skillId === skillId);
  if (!tracked) {
    const now = Date.now();
    tracked = { userId, skillId, currentLevel: 0, order: 1, createdAt: now, updatedAt: now };
    _tracked.push(tracked);
  }
  const fromLevel = tracked.currentLevel;
  const shouldIncrement = avg >= fromLevel + THRESH && fromLevel < 10;
  if (shouldIncrement) {
    tracked.currentLevel = Math.min(10, tracked.currentLevel + 1);
    tracked.updatedAt = Date.now();
    _levelHistory.push({
      userId,
      skillId,
      fromLevel,
      toLevel: tracked.currentLevel,
      reason: 'avg_threshold',
      avgSource: { count: rows.length, avg },
      sessionId: args.sessionId,
      groupId: args.groupId,
      createdAt: Date.now(),
    });
    return { ok: true, updated: true, toLevel: tracked.currentLevel } as const;
  }
  return { ok: true, updated: false } as const;
}

// Test-only: bulk seed per-skill assessments and trigger level updates
export async function __seedSkillAssessmentHistoryForTests(params: {
  userId: string;
  skillIds?: string[]; // defaults to all active skills
  assessmentsPerSkill?: number; // defaults to 8
  levelPerAssessment?: number; // defaults to 5
  sessionIdBase?: string;
  groupIdBase?: string;
}) {
  const userId = params.userId || 'unknown';
  const skillIds = (params.skillIds && params.skillIds.length ? params.skillIds : _skills.map(s => s.id));
  const per = Math.max(1, Math.min(100, Number(params.assessmentsPerSkill ?? 8)));
  const fixedLevel = Math.max(0, Math.min(10, Number(params.levelPerAssessment ?? 5)));
  const salt = (process.env.SKILL_HASH_SALT || 'test_salt').trim();

  let counter = 0;
  for (const skillId of skillIds) {
    const skillHash = sha256Hex(`${salt}:${skillId}`);
    for (let i = 0; i < per; i++) {
      const sessionId = `${params.sessionIdBase ?? 'sess_seed'}_${skillId}_${i}`;
      const groupId = `${params.groupIdBase ?? 'grp_seed'}_${skillId}_${i}`;
      await recordSkillAssessmentV2({
        userId,
        sessionId,
        groupId,
        skillHash,
        level: fixedLevel,
        rubricVersion: 'v2',
        feedback: [],
        metCriteria: [],
        unmetCriteria: [],
      });
      // Periodically trigger level update to build a plausible history
      await updateLevelFromRecentAssessments({ userId, sessionId, groupId, skillHash });
      counter++;
    }
  }
  return { ok: true, assessmentsInserted: counter } as const;
}

// -------------------- Users Goals (mock) --------------------
type UserGoalDoc = {
  userId: string;
  goalId: string;
  title: string;
  description?: string;
  status: 'active' | 'paused' | 'completed';
  targetDateMs?: number;
  tags: string[];
  createdAt: number;
  updatedAt: number;
};
const _userGoals: UserGoalDoc[] = [];

export async function listUserGoals(args: { userId: string }) {
  const rows = _userGoals.filter(g => g.userId === args.userId);
  rows.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0) || (b.createdAt ?? 0) - (a.createdAt ?? 0));
  return rows;
}

export async function addOrUpdateGoal(args: { userId: string; goalId: string; title: string; description?: string; status: 'active' | 'paused' | 'completed'; targetDateMs?: number; tags?: string[] }) {
  const now = Date.now();
  const idx = _userGoals.findIndex(g => g.userId === args.userId && g.goalId === args.goalId);
  if (idx === -1) {
    _userGoals.push({
      userId: args.userId,
      goalId: args.goalId,
      title: args.title,
      description: args.description,
      status: args.status,
      targetDateMs: args.targetDateMs,
      tags: Array.isArray(args.tags) ? args.tags : [],
      createdAt: now,
      updatedAt: now,
    });
    return { created: true } as const;
  }
  const doc = _userGoals[idx];
  doc.title = args.title;
  doc.description = args.description;
  doc.status = args.status;
  doc.targetDateMs = args.targetDateMs;
  doc.tags = Array.isArray(args.tags) ? args.tags : (doc.tags ?? []);
  doc.updatedAt = now;
  return { created: false } as const;
}

export async function updateGoal(args: { userId: string; goalId: string; title?: string; description?: string; status?: 'active' | 'paused' | 'completed'; targetDateMs?: number; tags?: string[] }) {
  const doc = _userGoals.find(g => g.userId === args.userId && g.goalId === args.goalId);
  if (!doc) throw new Error('goal not found');
  if (typeof args.title === 'string') doc.title = args.title;
  if (typeof args.description === 'string' || args.description === undefined) doc.description = args.description;
  if (args.status) doc.status = args.status;
  if (typeof args.targetDateMs === 'number') doc.targetDateMs = args.targetDateMs;
  if (Array.isArray(args.tags)) doc.tags = args.tags;
  doc.updatedAt = Date.now();
  return { ok: true } as const;
}

export async function deleteGoal(args: { userId: string; goalId: string }) {
  const idx = _userGoals.findIndex(g => g.userId === args.userId && g.goalId === args.goalId);
  if (idx === -1) return { ok: true, deleted: false } as const;
  _userGoals.splice(idx, 1);
  return { ok: true, deleted: true } as const;
}

// Dev-only: seed user profile and goals for testing (idempotent)
export function __devSeedUserData() {
  const now = Date.now();

  // Seed test user profile
  if (!_usersProfile['test_user']) {
    _usersProfile['test_user'] = {
      userId: 'test_user',
      displayName: 'Test Salesman',
      email: 'sam.seller@example.com',
      bio: 'Experienced B2B sales professional with 8+ years helping companies scale their revenue through strategic partnerships and consultative selling.',
      createdAt: now,
      updatedAt: now,
    };
  }

  // Seed test user goals
  const goalsToSeed = [
    {
      goalId: 'improve_clarity',
      title: 'Improve communication clarity',
      description: 'Focus on being more clear and concise in presentations and meetings',
      status: 'active' as const,
      tags: ['communication', 'presentation'],
    },
    {
      goalId: 'reduce_filler_words',
      title: 'Reduce filler words',
      description: 'Minimize use of "um", "ah", and other filler words during conversations',
      status: 'active' as const,
      tags: ['communication', 'confidence'],
    }
  ];

  for (const goal of goalsToSeed) {
    const existingIdx = _userGoals.findIndex(g => g.userId === 'test_user' && g.goalId === goal.goalId);
    if (existingIdx === -1) {
      _userGoals.push({
        userId: 'test_user',
        ...goal,
        createdAt: now,
        updatedAt: now,
      });
    }
  }
}
