"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

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
  const router = useRouter();
  const [skills, setSkills] = useState<Skill[]>([]);
  const [tracked, setTracked] = useState<TrackedSkill[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  // No entry gating; show content immediately so skeletons are visible
  const [leaving, setLeaving] = useState(false);
  const [leavingDir, setLeavingDir] = useState<"left" | "right">("left");

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

  // Entry transition handled by route layout (app/skills/layout.tsx)

  // Removed entry animation gating to avoid blank page during initial render

  // Entry animation is handled by app/skills/layout.tsx to avoid double transforms

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

  function handleBack() {
    try {
      const reduce = typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (reduce) {
        router.back();
        return;
      }
      if (!leaving) {
        try { window.sessionStorage.setItem('navDir', 'back'); } catch {}
        setLeavingDir('right');
        setLeaving(true);
        setTimeout(() => router.back(), 650);
      }
    } catch {
      router.back();
    }
  }

  // Forward navigation helper: slide out left, next page enters from right
  function navigateForward(url: string) {
    const reduce = typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) {
      router.push(url);
      return;
    }
    try { window.sessionStorage.setItem('navDir', 'forward'); } catch {}
    try { router.prefetch(url); } catch {}
    setLeavingDir('left');
    setLeaving(true);
    setTimeout(() => router.push(url), 650);
  }

  return (
    <div
      className="min-h-screen bg-neutral-50 text-neutral-800 font-sans p-4 overflow-x-hidden transform-gpu will-change-transform transition-transform duration-700 ease-in-out"
      style={{
        transform: leaving
          ? (leavingDir === 'left' ? 'translateX(-120vw)' : 'translateX(120vw)')
          : 'translateX(0)'
      }}
    >
      <div className={"max-w-md mx-auto"}>
        <button
          type="button"
          onClick={handleBack}
          className="text-sm text-neutral-700 hover:text-neutral-900 mb-2"
          aria-label="Go back"
        >
          &larr; Back
        </button>
        <h1 className="text-xl md:text-2xl uppercase tracking-wide text-neutral-500 font-medium mb-4 text-center">Skills</h1>

        {error && (
          <div role="alert" className="mb-4 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg p-3">{error}</div>
        )}
        {actionError && (
          <div role="alert" className="mb-4 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg p-3">{actionError}</div>
        )}

        <section className="mb-8">
          <div className="text-sm uppercase tracking-wide text-neutral-500 font-medium mb-3">Tracked</div>
          <div className="-mx-2 px-2 overflow-x-auto">
            <ul className="flex gap-3 snap-x snap-mandatory justify-center mx-auto w-full" data-testid="tracked-list" role="list">
              {loading ? (
                <>
                  <li className="min-w-[160px] w-[160px] h-28 snap-start skeleton skeleton-rounded border border-neutral-200" />
                  <li className="min-w-[160px] w-[160px] h-28 snap-start skeleton skeleton-rounded border border-neutral-200" />
                </>
              ) : (
                <>
                  {tracked.length === 0 && <li className="text-sm text-neutral-500">No tracked skills yet.</li>}
                  {[...tracked]
                    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
                    .map((t) => {
                      const s = t.skill ?? skills.find((x) => x.id === t.skillId) ?? ({ id: t.skillId, title: t.skillId } as Skill);
                      return (
                        <li
                          key={t.skillId}
                          className="relative w-[160px] min-w-[160px] h-28 snap-start border border-neutral-200 rounded-2xl p-4 bg-white shadow-sm cursor-pointer hover:bg-neutral-50"
                          role="button"
                          tabIndex={0}
                          onClick={() => navigateForward(`/skills/${encodeURIComponent(t.skillId)}`)}
                          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); navigateForward(`/skills/${encodeURIComponent(t.skillId)}`); } }}
                        >
                          <button
                            onClick={(e) => { e.stopPropagation(); onUntrack(t.skillId); }}
                            className="absolute top-2 right-2 text-neutral-500 hover:text-neutral-800 active:scale-95 transition text-lg leading-none px-1"
                            aria-label={`Untrack ${s.title}`}
                            title="Untrack"
                          >
                            -
                          </button>
                          <div className="h-full flex flex-col">
                            <div className="text-sm font-semibold text-neutral-800 mb-3 pr-6">{s.title}</div>
                            <div className="flex-1 flex items-center justify-center">
                              <div className="text-3xl font-semibold text-neutral-800 text-center">
                                <span data-testid={`tracked-current-level-${s.id}`}>{t.currentLevel}</span>
                              </div>
                            </div>
                          </div>
                        </li>
                      );
                    })}
                </>
              )}
            </ul>
          </div>
        </section>

        <section>
          <div className="text-sm uppercase tracking-wide text-neutral-500 font-medium mb-3">Untracked</div>
          <ul className="flex flex-wrap gap-3 justify-center" data-testid="untracked-list" role="list">
            {loading ? (
              <>
                {Array.from({ length: 6 }).map((_, i) => (
                  <li key={i} className="w-[160px] min-w-[160px] h-28 skeleton skeleton-rounded border border-neutral-200" />
                ))}
              </>
            ) : (
              <>
                {untrackedSkills.length === 0 && <li className="text-sm text-neutral-500">All skills are tracked.</li>}
                {untrackedSkills.map((s) => {
              const disabled = tracked.length >= trackedMax;
              return (
                <li
                  key={s.id}
                  className={[
                    "relative w-[160px] min-w-[160px] h-28 border border-neutral-200 rounded-2xl p-4 bg-white shadow-sm",
                    disabled ? "opacity-60 cursor-not-allowed" : "cursor-pointer hover:bg-neutral-50",
                  ].join(" ")}
                  role="button"
                  aria-disabled={disabled}
                  tabIndex={disabled ? -1 : 0}
                  onClick={() => { if (!disabled) onTrack(s.id); }}
                  onKeyDown={(e) => { if (!disabled && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onTrack(s.id); } }}
                  aria-label={`Track ${s.title}`}
                >
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); navigateForward(`/skills/${encodeURIComponent(s.id)}`); }}
                    className="absolute top-2 right-2 text-neutral-500 hover:text-neutral-800 active:scale-95 transition text-lg leading-none px-1 cursor-pointer"
                    aria-label={`View ${s.title} details`}
                    title="Open details"
                  >
                    ↗
                  </button>
                  <div className="h-full flex flex-col">
                    <div className="text-sm font-semibold text-neutral-800 mb-3 truncate">{s.title}</div>
                    <div className="flex-1 flex items-center justify-center">
                      <div className="text-3xl font-semibold text-neutral-800 text-center">0</div>
                    </div>
                  </div>
                </li>
              );
            })}
              </>
            )}
          </ul>
        </section>

        {!loading && skills.length === 0 && !error && (
          <div className="text-sm text-neutral-500 mt-4">No skills found.</div>
        )}
      </div>
    </div>
  );
}
