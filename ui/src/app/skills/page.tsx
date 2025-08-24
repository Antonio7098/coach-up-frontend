"use client";

import { useEffect, useState } from "react";

type Skill = {
  id: string;
  title: string;
  description?: string;
  category?: string;
  isActive?: boolean;
  currentLevel?: number; // optional, per-user selection not yet implemented
  levels?: Array<{
    level: number;
    criteria: string;
    examples?: string[];
    rubricHints?: string[];
  }>;
};

type TrackedSkill = {
  userId: string;
  skillId: string;
  currentLevel: number;
  order: number;
  createdAt: number;
  updatedAt: number;
  skill?: Skill | null;
};

export default function SkillsPage() {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [tracked, setTracked] = useState<TrackedSkill[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      try {
        const [resSkills, resTracked] = await Promise.all([
          fetch("/api/v1/skills", { headers: { accept: "application/json" } }),
          fetch("/api/v1/skills/tracked", { headers: { accept: "application/json" } }),
        ]);
        if (!resSkills.ok) throw new Error(`Failed to load skills: ${resSkills.status}`);
        if (!resTracked.ok) throw new Error(`Failed to load tracked skills: ${resTracked.status}`);
        const dataSkills = await resSkills.json();
        const dataTracked = await resTracked.json();
        if (!cancelled) {
          setSkills(Array.isArray(dataSkills?.skills) ? dataSkills.skills : []);
          setTracked(Array.isArray(dataTracked?.tracked) ? dataTracked.tracked : []);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err ?? 'Unknown error');
        if (!cancelled) setError(msg);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    run();
    return () => {
      cancelled = true;
    };
  }, []);

  const trackedIds = new Set(tracked.map((t) => t.skillId));
  const untrackedSkills = skills.filter((s) => !trackedIds.has(s.id));
  const trackedMax = 2; // enforce max 2 tracked skills for now

  async function refreshTracked() {
    try {
      const res = await fetch("/api/v1/skills/tracked", { headers: { accept: "application/json" } });
      if (res.ok) {
        const data = await res.json();
        setTracked(Array.isArray(data?.tracked) ? data.tracked : []);
      }
    } catch {}
  }

  async function onTrack(skillId: string) {
    setActionError(null);
    if (!trackedIds.has(skillId) && tracked.length >= trackedMax) {
      setActionError(`You can only track up to ${trackedMax} skills.`);
      return;
    }
    const order = tracked.find((t) => t.skillId === skillId)?.order ?? (tracked.length + 1);
    try {
      const res = await fetch("/api/v1/skills/track", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ skillId, order }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error || `Failed to track skill (${res.status})`);
      }
      await refreshTracked();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setActionError(msg);
    }
  }

  async function onUntrack(skillId: string) {
    setActionError(null);
    try {
      const res = await fetch("/api/v1/skills/untrack", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ skillId }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error || `Failed to untrack skill (${res.status})`);
      }
      await refreshTracked();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setActionError(msg);
    }
  }

  return (
    <div className="min-h-screen p-8 sm:p-12 font-sans">
      <h1 className="text-2xl font-semibold mb-4">Skills</h1>
      <p data-testid="skills-count" className="text-sm text-gray-600 mb-2">
        {loading ? "Loading..." : `${skills.length} skills total`}
      </p>
      <p className="text-xs text-gray-600 mb-4">Tracked: {tracked.length}/{trackedMax}</p>
      {error && (
        <div role="alert" className="mb-4 text-red-600">
          {error}
        </div>
      )}
      {actionError && (
        <div role="alert" className="mb-4 text-red-600">
          {actionError}
        </div>
      )}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        <section>
          <h2 className="text-lg font-semibold mb-2">Tracked ({tracked.length}/{trackedMax})</h2>
          <ul className="space-y-3" data-testid="tracked-list">
            {tracked.length === 0 && <li className="text-sm text-gray-500">No tracked skills yet.</li>}
            {[...tracked]
              .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
              .map((t) => {
                const s = t.skill ?? skills.find((x) => x.id === t.skillId) ?? { id: t.skillId, title: t.skillId } as Skill;
                return (
                  <li key={t.skillId} className="border rounded p-3">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <div className="font-medium">{s.title}</div>
                        {s.category && <div className="text-xs text-gray-500">Category: {s.category}</div>}
                        {s.description && <p className="text-xs mt-1 text-gray-700">{s.description}</p>}
                        <div className="mt-1 text-xs text-gray-700">
                          <span className="font-medium">Current level:</span>{" "}
                          <span data-testid={`tracked-current-level-${s.id}`}>{t.currentLevel}</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="inline-flex items-center rounded bg-blue-50 text-blue-700 px-2 py-0.5 text-xs font-semibold">Order {t.order}</span>
                        <button
                          onClick={() => onUntrack(t.skillId)}
                          className="text-xs rounded border border-gray-300 px-3 py-1 hover:bg-gray-50"
                          aria-label={`Untrack ${s.title}`}
                        >
                          Untrack
                        </button>
                      </div>
                    </div>
                  </li>
                );
              })}
          </ul>
        </section>

        <section>
          <h2 className="text-lg font-semibold mb-2">Untracked</h2>
          <ul className="space-y-3" data-testid="untracked-list">
            {untrackedSkills.length === 0 && <li className="text-sm text-gray-500">All skills are tracked.</li>}
            {untrackedSkills.map((s) => (
              <li key={s.id} className="border rounded p-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="font-medium">{s.title}</div>
                    {s.category && <div className="text-xs text-gray-500">Category: {s.category}</div>}
                    {s.description && <p className="text-xs mt-1 text-gray-700">{s.description}</p>}
                  </div>
                  <button
                    onClick={() => onTrack(s.id)}
                    disabled={tracked.length >= trackedMax}
                    className="text-xs rounded border border-blue-600 text-blue-700 px-3 py-1 hover:bg-blue-50 disabled:opacity-50 disabled:cursor-not-allowed"
                    aria-label={`Track ${s.title}`}
                  >
                    Track
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      </div>
      {!loading && skills.length === 0 && !error && (
        <div className="text-sm text-gray-500 mt-4">No skills found.</div>
      )}
    </div>
  );
}
