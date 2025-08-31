/* eslint-disable no-console */

export type SummaryRow = {
  sessionId: string;
  version: number;
  text: string;
  lastMessageTs?: number;
  createdAt: number;
  updatedAt: number;
  meta?: { provider?: string; modelId?: string; tokenBudget?: number };
};

type Store = {
  bySession: Map<string, SummaryRow[]>; // newest first
};

function ensureStore(): Store {
  const g = globalThis as unknown as { __cuSummaries?: Store };
  if (!g.__cuSummaries) {
    g.__cuSummaries = { bySession: new Map() };
  }
  return g.__cuSummaries;
}

export function getLatestSummary(sessionId: string): SummaryRow | null {
  const store = ensureStore();
  const arr = store.bySession.get(sessionId);
  if (!arr || arr.length === 0) return null;
  return arr[0] ?? null;
}

export function upsertSummary(row: Omit<SummaryRow, "createdAt" | "updatedAt" | "version"> & { version?: number }): SummaryRow {
  const store = ensureStore();
  const now = Date.now();
  const existing = getLatestSummary(row.sessionId);
  const version = typeof row.version === "number" && row.version > 0 ? row.version : (existing ? existing.version + 1 : 1);
  const next: SummaryRow = {
    sessionId: row.sessionId,
    version,
    text: String(row.text || "").trim(),
    lastMessageTs: row.lastMessageTs,
    meta: row.meta,
    createdAt: now,
    updatedAt: now,
  };
  const arr = store.bySession.get(row.sessionId) ?? [];
  arr.unshift(next);
  while (arr.length > 5) arr.pop();
  store.bySession.set(row.sessionId, arr);
  try { console.log("[summaries] upsert", { sessionId: row.sessionId, version: next.version, len: next.text.length }); } catch {}
  return next;
}


