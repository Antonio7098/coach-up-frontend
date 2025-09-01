// Simple in-memory prompt preview store (dev/debug only)
// Not suitable for multi-instance or prod: guarded by env/query flags in routes

type PromptPreview = {
  system?: string;
  summary?: string;
  summaryLen?: number;
  recentMessages?: Array<{ role: string; content: string; len: number }>;
  prompt?: string;
  createdAt: number;
};

const store = new Map<string, PromptPreview>();

export function savePromptPreview(id: string, preview: Omit<PromptPreview, "createdAt">) {
  if (!id || !preview) return;
  store.set(id, { ...preview, createdAt: Date.now() });
}

export function getPromptPreview(id: string): PromptPreview | null {
  if (!id) return null;
  return store.get(id) ?? null;
}

export function clearPromptPreview(id: string) {
  if (!id) return;
  try { store.delete(id); } catch {}
}


