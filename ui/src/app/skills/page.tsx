"use client";

import { useEffect, useState, useLayoutEffect } from "react";
import { useRouter } from "next/navigation";
import HeroCard from "../components/HeroCard";
import SectionCard from "../components/SectionCard";

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
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set());
  // No entry gating; show content immediately so skeletons are visible
  const [leaving, setLeaving] = useState(false);
  const [leavingDir, setLeavingDir] = useState<"left" | "right">("left");
  const [enterDir, setEnterDir] = useState<"left" | "right" | null>(null);
  // Feature flag: disable cross-page transitions for performance
  const ENABLE_ROUTE_TRANSITIONS = false;

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
    if (!ENABLE_ROUTE_TRANSITIONS) return;
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
  }, [ENABLE_ROUTE_TRANSITIONS]);

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
      setPendingIds((prev) => new Set(prev).add(skillId));
      const res = await fetch("/api/v1/skills/track", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ skillId, order }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error || `Failed to track skill (${res.status})`);
      }
      // Optimistic update: if not present, add locally while background refresh reconciles
      setTracked((prev) => {
        if (prev.some((t) => t.skillId === skillId)) return prev;
        const now = Date.now();
        const skill = skills.find((s) => s.id === skillId) || null;
        const next: TrackedSkill = {
          userId: "me",
          skillId,
          currentLevel: 0,
          order,
          createdAt: now,
          updatedAt: now,
          skill,
        };
        const arr = [...prev, next].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
        return arr;
      });
      // Fire-and-forget refresh to ensure consistency
      refreshTracked();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setActionError(msg);
    }
    finally {
      setPendingIds((prev) => {
        const next = new Set(prev);
        next.delete(skillId);
        return next;
      });
    }
  }

  async function onUntrack(skillId: string) {
    setActionError(null);
    try {
      setPendingIds((prev) => new Set(prev).add(skillId));
      const res = await fetch("/api/v1/skills/untrack", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ skillId }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error || `Failed to untrack skill (${res.status})`);
      }
      // Optimistic removal
      setTracked((prev) => prev.filter((t) => t.skillId !== skillId));
      refreshTracked();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setActionError(msg);
    }
    finally {
      setPendingIds((prev) => {
        const next = new Set(prev);
        next.delete(skillId);
        return next;
      });
    }
  }

  function handleBack() {
    try {
      const reduce = typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (reduce || !ENABLE_ROUTE_TRANSITIONS) {
        try { window.sessionStorage.setItem('resumeDashboardNoAnim', '1'); } catch {}
        router.push('/coach');
        return;
      }
      if (!leaving) {
        try { window.sessionStorage.setItem('navDir', 'back'); } catch {}
        try { window.sessionStorage.setItem('resumeDashboardNoAnim', '1'); } catch {}
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
    if (reduce || !ENABLE_ROUTE_TRANSITIONS) {
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
      className={[
        "min-h-screen bg-background text-foreground font-sans p-4 overflow-x-hidden",
        ENABLE_ROUTE_TRANSITIONS ? "transform-gpu will-change-transform transition-transform duration-300 ease-out" : ""
      ].join(" ")}
      style={{
        transform: ENABLE_ROUTE_TRANSITIONS
          ? (leaving
              ? (leavingDir === 'left' ? 'translateX(-120vw)' : 'translateX(120vw)')
              : enterDir === "left"
              ? "translateX(-120vw)"
              : enterDir === "right"
              ? "translateX(120vw)"
              : 'translateX(0)')
          : 'translateX(0)'
      }}
    >
      <div className={"max-w-md mx-auto"}>
        <button
          type="button"
          onClick={handleBack}
          className="relative inline-flex items-center gap-2 mb-2 px-3 py-1.5 rounded-full border cu-border-surface cu-surface text-sm font-medium cu-muted hover:text-foreground shadow-sm hover:shadow transition-all active:scale-[0.98] focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/30"
          aria-label="Go back"
        >
          <span
            aria-hidden
            className="pointer-events-none absolute inset-0 rounded-full opacity-[0.25]"
            style={{
              background:
                "linear-gradient(135deg, rgba(99,102,241,0.08), rgba(16,185,129,0.08))",
            }}
          />
          <svg aria-hidden viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 18l-6-6 6-6" />
          </svg>
          <span>Back</span>
        </button>

        {/* Hero header consistent with /coach */}
        <div className="mb-4">
          {loading ? (
            <SectionCard>
              <div
                className="h-6 w-40 mx-auto skeleton skeleton-text"
                style={{ animationDuration: "5s", animationTimingFunction: "linear" }}
              />
              <div
                className="mt-2 h-4 w-64 mx-auto skeleton skeleton-text"
                style={{ animationDuration: "5s", animationTimingFunction: "linear" }}
              />
            </SectionCard>
          ) : (
            <HeroCard label="Skills" title={<span>Your skills</span>} subtitle={<span>Browse and manage your tracked skills.</span>} />
          )}
        </div>

        {error && (
          <SectionCard className="mb-3">
            <div role="alert" className="text-sm cu-error-text">{error}</div>
          </SectionCard>
        )}
        {actionError && (
          <SectionCard className="mb-3">
            <div role="alert" className="text-sm cu-error-text">{actionError}</div>
          </SectionCard>
        )}

        <section className="mb-8">
          <div className="text-sm uppercase tracking-wide cu-muted font-medium mb-3">Tracked</div>
          {loading ? (
            <div className="grid grid-cols-2 gap-3">
              <div
                className="h-24 rounded-2xl skeleton skeleton-rounded"
                style={{ animationDuration: "5s", animationTimingFunction: "linear" }}
              />
              <div
                className="h-24 rounded-2xl skeleton skeleton-rounded"
                style={{ animationDuration: "5s", animationTimingFunction: "linear" }}
              />
            </div>
          ) : tracked && tracked.length > 0 ? (
            <ul className="grid grid-cols-2 gap-3" data-testid="tracked-list" role="list">
              {[...tracked]
                .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
                .map((t) => {
                  const s = t.skill ?? skills.find((x) => x.id === t.skillId) ?? ({ id: t.skillId, title: t.skillId } as Skill);
                  const pct = Math.max(0, Math.min(10, Number(t.currentLevel) || 0)) * 10;
                  const isPending = pendingIds.has(t.skillId);
                  return (
                    <li key={t.skillId} className="group relative overflow-hidden border-2 cu-border rounded-2xl cu-surface shadow-sm transition-all hover:shadow-md">
                      <button
                        type="button"
                        onClick={() => navigateForward(`/skills/${encodeURIComponent(t.skillId)}`)}
                        className="w-full text-left p-4"
                        aria-label={`Open ${s.title}`}
                        aria-busy={isPending}
                      >
                        {/* base subtle gradient texture */}
                        <span
                          aria-hidden
                          className="pointer-events-none absolute inset-0 opacity-[0.35]"
                          style={{
                            background:
                              "linear-gradient(135deg, rgba(99,102,241,0.05), rgba(16,185,129,0.05))",
                          }}
                        />
                        <span aria-hidden className="pointer-events-none absolute -top-10 -right-10 h-24 w-24 rounded-full opacity-0 group-hover:opacity-30 blur-2xl" style={{ background: "radial-gradient(closest-side, rgba(99,102,241,0.35), transparent)" }} />
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <span className="inline-flex items-center justify-center h-6 w-6 rounded-full bg-gradient-to-br from-indigo-500/20 to-emerald-500/20 text-[10px] font-semibold shadow-sm border cu-border-surface">
                                {(t.currentLevel ?? 0) || 0}
                              </span>
                              <div className="text-sm font-medium text-foreground truncate">{s.title || "Untitled skill"}</div>
                            </div>
                            <div className="mt-1 text-[11px] cu-muted truncate">{s.category || `Lv ${t.currentLevel}/10`}</div>
                          </div>
                          <svg aria-hidden viewBox="0 0 24 24" className="w-4 h-4 cu-muted transition-all group-hover:translate-x-0.5 group-hover:opacity-100 opacity-60" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18l6-6-6-6"/></svg>
                        </div>
                        <div className="mt-3 relative h-1.5 cu-accent-soft-bg rounded-full overflow-hidden">
                          <div className="absolute inset-0 pointer-events-none" aria-hidden style={{ background: "linear-gradient(90deg, rgba(255,255,255,0.14), rgba(255,255,255,0))" }} />
                          <div className="h-full transition-[width] duration-500 ease-out" style={{ width: `${pct}%`, background: "linear-gradient(90deg, rgba(99,102,241,1), rgba(16,185,129,1))" }} />
                        </div>
                        <div className="mt-1 text-[11px] cu-muted">Lv {t.currentLevel}/10</div>
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); if (!pendingIds.has(t.skillId)) onUntrack(t.skillId); }}
                        disabled={isPending}
                        aria-busy={isPending}
                        className="absolute top-2 right-2 cu-muted hover:text-foreground active:scale-95 transition text-base leading-none px-2 py-0.5 rounded-md cu-surface border cu-border-surface disabled:opacity-60 disabled:cursor-not-allowed"
                        aria-label={`Untrack ${s.title}`}
                        title="Untrack"
                      >
                        −
                      </button>
                    </li>
                  );
                })}
            </ul>
          ) : (
            <div className="relative overflow-hidden border-2 border-dashed cu-border rounded-2xl p-6 text-center cu-surface shadow-sm">
              <div aria-hidden className="pointer-events-none absolute -top-10 left-1/2 -translate-x-1/2 h-32 w-32 rounded-full opacity-20 blur-3xl cu-accent-soft-bg" />
              <div className="text-sm cu-muted mb-3">You haven’t added any tracked skills yet.</div>
              <button
                type="button"
                onClick={() => navigateForward('/skills')}
                className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md cu-surface border cu-border-surface hover:bg-surface/80 active:scale-[0.98] transition-all text-sm shadow-sm"
              >
                <svg aria-hidden="true" viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14M5 12h14"/></svg>
                Add skills
              </button>
            </div>
          )}
        </section>

        <section>
          <div className="text-sm uppercase tracking-wide cu-muted font-medium mb-3">Untracked</div>
          {loading ? (
            <div className="grid grid-cols-2 gap-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <div
                  key={i}
                  className="h-24 rounded-2xl skeleton skeleton-rounded"
                  style={{ animationDuration: "5s", animationTimingFunction: "linear" }}
                />
              ))}
            </div>
          ) : untrackedSkills.length === 0 ? (
            <div className="text-sm cu-muted">All skills are tracked.</div>
          ) : (
            <ul className="grid grid-cols-2 gap-3" data-testid="untracked-list" role="list">
              {untrackedSkills.map((s) => {
                const disabled = tracked.length >= trackedMax || pendingIds.has(s.id);
                return (
                  <li key={s.id} className={["group relative overflow-hidden border-2 cu-border rounded-2xl cu-surface shadow-sm transition-all hover:shadow-md", disabled ? "opacity-60 cursor-not-allowed" : "cursor-pointer"].join(" ") }>
                    <button
                      type="button"
                      disabled={disabled}
                      onClick={() => { if (!disabled) onTrack(s.id); }}
                      className="w-full text-left p-4 disabled:cursor-not-allowed"
                      aria-busy={pendingIds.has(s.id)}
                      aria-label={disabled ? `${s.title} (tracking limit reached)` : `Track ${s.title}`}
                    >
                      {/* base subtle gradient texture */}
                      <span
                        aria-hidden
                        className="pointer-events-none absolute inset-0 opacity-[0.35]"
                        style={{
                          background:
                            "linear-gradient(135deg, rgba(99,102,241,0.05), rgba(16,185,129,0.05))",
                        }}
                      />
                      <span aria-hidden className="pointer-events-none absolute -top-10 -right-10 h-24 w-24 rounded-full opacity-0 group-hover:opacity-30 blur-2xl" style={{ background: "radial-gradient(closest-side, rgba(99,102,241,0.35), transparent)" }} />
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="inline-flex items-center justify-center h-6 w-6 rounded-full bg-gradient-to-br from-indigo-500/20 to-emerald-500/20 text-[10px] font-semibold shadow-sm border cu-border-surface">0</span>
                            <div className="text-sm font-medium text-foreground truncate">{s.title || "Untitled skill"}</div>
                          </div>
                          <div className="mt-1 text-[11px] cu-muted truncate">Lv 0/10</div>
                        </div>
                        <svg aria-hidden viewBox="0 0 24 24" className="w-4 h-4 cu-muted transition-all group-hover:translate-x-0.5 group-hover:opacity-100 opacity-60" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18l6-6-6-6"/></svg>
                      </div>
                      <div className="mt-3 relative h-1.5 cu-accent-soft-bg rounded-full overflow-hidden">
                        <div className="absolute inset-0 pointer-events-none" aria-hidden style={{ background: "linear-gradient(90deg, rgba(255,255,255,0.14), rgba(255,255,255,0))" }} />
                        <div className="h-full" style={{ width: `0%`, background: "linear-gradient(90deg, rgba(99,102,241,1), rgba(16,185,129,1))" }} />
                      </div>
                      <div className="mt-1 text-[11px] cu-muted">Lv 0/10</div>
                    </button>
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); navigateForward(`/skills/${encodeURIComponent(s.id)}`); }}
                      className="absolute top-2 right-2 cu-muted hover:text-foreground active:scale-95 transition text-base leading-none px-2 py-0.5 rounded-md cu-surface border cu-border-surface"
                      aria-label={`View ${s.title} details`}
                      title="Open details"
                    >
                      ↗
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {!loading && skills.length === 0 && !error && (
          <div className="text-sm cu-muted mt-4">No skills found.</div>
        )}
      </div>
    </div>
  );
}
