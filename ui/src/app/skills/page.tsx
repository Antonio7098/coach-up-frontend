"use client";

import { useEffect, useState, useLayoutEffect } from "react";
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
  const [enterDir, setEnterDir] = useState<"left" | "right" | null>(null);

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

  // Entry animation: read navDir on mount and animate new content in
  useLayoutEffect(() => {
    try {
      const reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      const d = window.sessionStorage.getItem("navDir");
      window.sessionStorage.removeItem("navDir");
      if (!reduce && (d === "back" || d === "forward")) {
        // forward -> enter from right; back -> enter from left
        setEnterDir(d === "forward" ? "right" : "left");
        // Use double RAF to ensure initial position is rendered before animating
        requestAnimationFrame(() => {
          requestAnimationFrame(() => setEnterDir(null));
        });
      }
    } catch {}
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

  function handleBack() {
    try {
      const reduce = typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (reduce) {
        router.push('/coach');
        return;
      }
      if (!leaving) {
        try { window.sessionStorage.setItem('navDir', 'back'); } catch {}
        setLeavingDir('right');
        setLeaving(true);
        setTimeout(() => router.push('/coach'), 250);
      }
    } catch {
      router.push('/coach');
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
    setTimeout(() => router.push(url), 250);
  }

  return (
    <div
      className="min-h-screen bg-background text-foreground font-sans p-4 overflow-x-hidden transform-gpu will-change-transform transition-transform duration-300 ease-out"
      style={{
        transform: leaving
          ? (leavingDir === 'left' ? 'translateX(-120vw)' : 'translateX(120vw)')
          : enterDir === "left"
          ? "translateX(-120vw)"
          : enterDir === "right"
          ? "translateX(120vw)"
          : 'translateX(0)'
      }}
    >
      <div className={"max-w-md mx-auto"}>
        <button
          type="button"
          onClick={handleBack}
          className="text-sm cu-muted hover:text-foreground mb-2"
          aria-label="Go back"
        >
          &larr; Back
        </button>
        <h1 className="text-xl md:text-2xl uppercase tracking-wide cu-muted font-medium mb-4 text-center">Skills</h1>

        {error && (
          <div role="alert" className="mb-4 text-sm cu-error-text cu-error-soft-bg border cu-error-border rounded-lg p-3">{error}</div>
        )}
        {actionError && (
          <div role="alert" className="mb-4 text-sm cu-error-text cu-error-soft-bg border cu-error-border rounded-lg p-3">{actionError}</div>
        )}

        <section className="mb-8">
          <div className="text-sm uppercase tracking-wide cu-muted font-medium mb-3">Tracked</div>
          <div className="-mx-2 px-2 overflow-x-auto">
            <ul className="flex gap-3 snap-x snap-mandatory justify-center mx-auto w-full" data-testid="tracked-list" role="list">
              {loading ? (
                <>
                  <li className="min-w-[160px] w-[160px] h-28 snap-start skeleton skeleton-rounded border cu-border" />
                  <li className="min-w-[160px] w-[160px] h-28 snap-start skeleton skeleton-rounded border cu-border" />
                </>
              ) : (
                <>
                  {tracked.length === 0 && <li className="text-sm cu-muted">No tracked skills yet.</li>}
                  {[...tracked]
                    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
                    .map((t) => {
                      const s = t.skill ?? skills.find((x) => x.id === t.skillId) ?? ({ id: t.skillId, title: t.skillId } as Skill);
                      return (
                        <li
                          key={t.skillId}
                          className="relative w-[160px] min-w-[160px] h-28 snap-start border cu-border rounded-2xl p-4 cu-surface shadow-sm cursor-pointer hover:opacity-90"
                          role="button"
                          tabIndex={0}
                          onClick={() => navigateForward(`/skills/${encodeURIComponent(t.skillId)}`)}
                          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); navigateForward(`/skills/${encodeURIComponent(t.skillId)}`); } }}
                        >
                          <button
                            onClick={(e) => { e.stopPropagation(); onUntrack(t.skillId); }}
                            className="absolute top-2 right-2 cu-muted hover:text-foreground active:scale-95 transition text-lg leading-none px-1"
                            aria-label={`Untrack ${s.title}`}
                            title="Untrack"
                          >
                            -
                          </button>
                          <div className="h-full flex flex-col">
                            <div className="text-sm font-semibold text-foreground mb-3 pr-6">{s.title}</div>
                            <div className="flex-1 flex items-center justify-center">
                              <div className="text-3xl font-semibold text-foreground text-center">
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
          <div className="text-sm uppercase tracking-wide cu-muted font-medium mb-3">Untracked</div>
          <ul className="flex flex-wrap gap-3 justify-center" data-testid="untracked-list" role="list">
            {loading ? (
              <>
                {Array.from({ length: 6 }).map((_, i) => (
                  <li key={i} className="w-[160px] min-w-[160px] h-28 skeleton skeleton-rounded border cu-border" />
                ))}
              </>
            ) : (
              <>
                {untrackedSkills.length === 0 && <li className="text-sm cu-muted">All skills are tracked.</li>}
                {untrackedSkills.map((s) => {
                  const disabled = tracked.length >= trackedMax;
                  return (
                    <li
                      key={s.id}
                      className={[
                        "relative w-[160px] min-w-[160px] h-28 border cu-border rounded-2xl p-4 cu-surface shadow-sm",
                        disabled ? "opacity-60 cursor-not-allowed" : "cursor-pointer hover:opacity-90",
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
                        className="absolute top-2 right-2 cu-muted hover:text-foreground active:scale-95 transition text-lg leading-none px-1 cursor-pointer"
                        aria-label={`View ${s.title} details`}
                        title="Open details"
                      >
                        ↗
                      </button>
                      <div className="h-full flex flex-col">
                        <div className="text-sm font-semibold text-foreground mb-3 truncate">{s.title}</div>
                        <div className="flex-1 flex items-center justify-center">
                          <div className="text-3xl font-semibold text-foreground text-center">0</div>
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
          <div className="text-sm cu-muted mt-4">No skills found.</div>
        )}
      </div>
    </div>
  );
}
