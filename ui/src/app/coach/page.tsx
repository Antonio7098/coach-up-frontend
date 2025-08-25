"use client";

import { useEffect, useMemo, useRef, useState } from "react";

// Mock data for dashboard (mirrors tracked skills shape from API)
type Skill = {
  id: string;
  title: string;
  category?: string;
  description?: string;
};

type TrackedSkill = {
  userId: string;
  skillId: string;
  currentLevel: number; // 0..10
  order: number; // 1..2
  createdAt: number;
  updatedAt: number;
  skill?: Skill | null;
};

// Recent assessments (mock) — roughly aligned with `convex/schema.ts` assessments table
type AssessmentScore = {
  category: string; // e.g., "clarity", "conciseness"
  level: number; // 0..10 derived from provider score (0..1)
  feedback?: string[]; // optional feedback items for expand view
};

type AssessmentLogItem = {
  id: string;
  title: string; // scenario / group label
  createdAt: number;
  scores: AssessmentScore[];
};

// Skeleton loader component
const SkeletonLoader = ({ className = "" }: { className?: string }) => (
  <div className={`animate-pulse bg-neutral-200 rounded ${className}`} />
);

// Data is loaded from /api/v1/skills/tracked with MOCK_CONVEX=1 in dev

export default function CoachPage() {
  const [showDashboard, setShowDashboard] = useState(false);
  const [dashboardMounted, setDashboardMounted] = useState(false);
  const [tracked, setTracked] = useState<TrackedSkill[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [recent, setRecent] = useState<AssessmentLogItem[]>([]);
  const [dashAnim, setDashAnim] = useState(false);
  const dashUnmountTimer = useRef<number | null>(null);
  const dashContainerRef = useRef<HTMLDivElement | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  useEffect(() => {
    let cancelled = false;
    async function run() {
      try {
        const res = await fetch("/api/v1/skills/tracked", { headers: { accept: "application/json" } });
        if (!res.ok) throw new Error(`Failed to load tracked skills (${res.status})`);
        const data = await res.json();
        if (!cancelled) setTracked(Array.isArray(data?.tracked) ? data.tracked : []);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e ?? "Unknown error");
        if (!cancelled) setError(msg);
      } finally {
        if (!cancelled) setLoading(false);
      }

      // Mock recent assessments (replace with real fetch when backend is wired)
      // Based on schema: assessments by group/scenario with per-category scores
      const now = Date.now();
      const mock: AssessmentLogItem[] = [
        {
          id: "grp_1",
          title: "Sales Scenario",
          createdAt: now - 1000 * 60 * 12,
          scores: [
            { category: "clarity", level: 8, feedback: ["Clear structure throughout", "Good use of summaries"] },
            { category: "conciseness", level: 5, feedback: ["Some repetition detected", "Tighten examples"] },
          ],
        },
        {
          id: "grp_2",
          title: "Practicing Pencil Pitch",
          createdAt: now - 1000 * 60 * 45,
          scores: [
            { category: "clarity", level: 7, feedback: ["Good signposting of key points"] },
            { category: "conciseness", level: 6, feedback: ["Trim filler phrases like 'basically'"] },
          ],
        },
      ];
      if (!cancelled) setRecent(mock);
    }
    run();
    return () => {
      cancelled = true;
    };
  }, []);

  // (No viewport tracking needed; use CSS vh for off-screen state)

  // Mount/unmount with animation. On open: mount then animate in. On close: animate out then unmount.
  useEffect(() => {
    const EXIT_MS = 1600; // longest child duration + delays buffer
    if (showDashboard) {
      // Cancel pending unmount if any
      if (dashUnmountTimer.current) {
        window.clearTimeout(dashUnmountTimer.current);
        dashUnmountTimer.current = null;
      }
      setDashboardMounted(true);
      setDashAnim(false);
      // Two RAFs + forced reflow to ensure initial styles are applied before transitioning
      requestAnimationFrame(() => {
        // force layout
        void dashContainerRef.current?.getBoundingClientRect();
        requestAnimationFrame(() => setDashAnim(true));
      });
    } else {
      setDashAnim(false); // triggers slide-up
      // Unmount after exit animation completes
      if (dashUnmountTimer.current) window.clearTimeout(dashUnmountTimer.current);
      dashUnmountTimer.current = window.setTimeout(() => {
        setDashboardMounted(false);
        dashUnmountTimer.current = null;
      }, EXIT_MS);
    }
  }, [showDashboard]);

  const overallLevel = useMemo(() => {
    if (!tracked.length) return 0;
    const sum = tracked.reduce((sum, t) => sum + (Number(t.currentLevel) || 0), 0);
    return Math.round((sum / tracked.length) * 10) / 10; // average to 1 decimal
  }, [tracked]);

  const levelStats = useMemo(() => {
    const currentLevelInt = Math.floor(overallLevel);
    const nextLevelInt = currentLevelInt + 1;
    const progressPercent = Math.max(0, Math.min(100, (overallLevel - currentLevelInt) * 100));
    const pointsLeft = Math.max(0, Math.ceil((nextLevelInt - overallLevel) * 10));
    return { currentLevelInt, nextLevelInt, progressPercent, pointsLeft };
  }, [overallLevel]);

  return (
    <div className="min-h-screen bg-neutral-50 text-neutral-800 font-sans relative overflow-x-hidden">
      {/* Dashboard button in top left */}
      {!showDashboard && (
        <button
          aria-label="Open dashboard"
          className="fixed top-4 left-4 p-3 rounded-full text-neutral-800 bg-white border border-neutral-200 hover:bg-neutral-100 active:scale-95 transition-all duration-200 shadow-sm z-40"
          onClick={() => setShowDashboard(true)}
        >
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            className="w-5 h-5"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M3 11.5L12 4l9 7.5" />
            <path d="M5 10.5V20h14v-9.5" />
          </svg>
        </button>
      )}

      {/* Overall Level and Skills - remain mounted during exit for animation */}
      {dashboardMounted && (
        <header className="p-4 pb-40">
          <div ref={dashContainerRef} className="max-w-md mx-auto">
            {/* Level block (slides in first) */}
            <div
              className={["transform-gpu will-change-transform transition-all duration-[600ms] ease-out", dashAnim ? "opacity-100" : "opacity-0"].join(" ")}
              style={{ transform: dashAnim ? "translateY(0)" : "translateY(-120vh)" }}
            >
              {/* Level header row */}
              <div className="mb-3">
                <div className="text-sm uppercase tracking-wide text-neutral-500 font-medium">Level</div>
                <div className="mt-2 flex items-center gap-4">
                  <div className="w-16 h-16 rounded-full border border-neutral-300 bg-white flex items-center justify-center">
                    <span className="text-2xl font-semibold text-neutral-800" data-testid="overall-level">{levelStats.currentLevelInt}</span>
                  </div>
                  <div className="text-xl font-medium text-neutral-800">Level {levelStats.currentLevelInt}</div>
                </div>
              </div>

              {/* Progress bar with inline points indicator */}
              <div className="w-full mt-3 mb-5">
                <div className="relative w-full h-4 bg-neutral-200 rounded border border-neutral-300 overflow-hidden">
                  <div
                    className="h-full bg-neutral-700"
                    style={{ width: `${levelStats.progressPercent}%` }}
                  />
                  {/* points within current level (out of 20) */}
                  <div className="absolute inset-0 flex items-center justify-center">
                    <span className="text-[11px] font-medium text-neutral-700 select-none">
                      {Math.round((levelStats.progressPercent / 100) * 20)}/20
                    </span>
                  </div>
                </div>
              </div>
            </div>

            <div
              className={["transform-gpu will-change-transform transition-all duration-[900ms] ease-out delay-150", dashAnim ? "opacity-100" : "opacity-0"].join(" ")}
              style={{ transform: dashAnim ? "translateY(0)" : "translateY(-120vh)" }}
            >
              <a href="/skills" className="text-sm uppercase tracking-wide text-neutral-500 font-medium mb-3 inline-block hover:text-neutral-700" aria-label="Go to Skills page">Skills</a>
              {loading && (
                <div className="space-y-3">
                  <SkeletonLoader className="h-16 w-full" />
                  <SkeletonLoader className="h-16 w-full" />
                  <SkeletonLoader className="h-16 w-full" />
                </div>
              )}
              {error && !loading && (
                <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg p-3" role="alert">{error}</div>
              )}
              {!loading && !error && (
                <div className="overflow-x-auto -mx-2 px-2">
                  <ul className="flex gap-3 snap-x snap-mandatory" data-testid="tracked-skills" role="list">
                    {[...tracked]
                      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
                      .map((t) => {
                        const s = t.skill ?? ({ id: t.skillId, title: t.skillId } as Skill);
                        return (
                          <li
                            key={t.skillId}
                            className="min-w-[160px] snap-start border border-neutral-200 rounded-2xl p-4 bg-white shadow-sm"
                          >
                            <div className="text-sm text-neutral-500 mb-3">{s.title}</div>
                            <div className="text-3xl font-semibold text-neutral-800 text-center">{t.currentLevel}</div>
                          </li>
                        );
                      })}
                  </ul>
                </div>
              )}
            </div>

            {/* Log section */}
            <section
              className={["mt-8 transform-gpu will-change-transform transition-all duration-1000 ease-out delay-300", dashAnim ? "opacity-100" : "opacity-0"].join(" ")}
              style={{ transform: dashAnim ? "translateY(0)" : "translateY(-120vh)" }}
            >
              <div className="text-sm uppercase tracking-wide text-neutral-500 font-medium mb-3">Log</div>
              <ul className="space-y-4">
                {[...recent].sort((a, b) => b.createdAt - a.createdAt).map((item) => (
                  <li key={item.id} className="border border-neutral-200 rounded-2xl p-4 bg-white shadow-sm">
                    <button
                      type="button"
                      onClick={() => setExpanded((m) => ({ ...m, [item.id]: !m[item.id] }))}
                      aria-expanded={!!expanded[item.id]}
                      aria-controls={`log-${item.id}-panel`}
                      className="w-full flex items-center gap-3"
                    >
                      <div className="text-sm text-neutral-800 mr-2 flex-1 text-left">{item.title}</div>
                      {!expanded[item.id] && (
                        <div className="hidden sm:flex items-center gap-3 flex-wrap text-xs text-neutral-600 mr-1">
                          {item.scores.map((s) => (
                            <span key={s.category} className="whitespace-nowrap">
                              <span className="capitalize">{s.category}</span>
                              <span className="mx-1 text-neutral-400">·</span>
                              <span className="font-semibold text-neutral-800">{s.level}</span>
                            </span>
                          ))}
                        </div>
                      )}
                      <svg
                        aria-hidden="true"
                        viewBox="0 0 24 24"
                        className={["ml-auto w-4 h-4 text-neutral-400 transition-transform", expanded[item.id] ? "rotate-180" : "rotate-0"].join(" ")}
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d="M6 9l6 6 6-6" />
                      </svg>
                    </button>

                    <div
                      id={`log-${item.id}-panel`}
                      className={[
                        "transition-all duration-300",
                        expanded[item.id]
                          ? "mt-3 pt-3 border-t border-neutral-200 opacity-100 translate-y-0 max-h-[600px]"
                          : "opacity-0 -translate-y-1 max-h-0 overflow-hidden"
                      ].join(" ")}
                    >
                      {/* Skills moved into expanded area */}
                      <div className="flex items-center gap-3 flex-wrap text-sm text-neutral-700 mb-2">
                        {item.scores.map((s) => (
                          <span key={s.category} className="whitespace-nowrap">
                            <span className="capitalize">{s.category}</span>
                            <span className="mx-1 text-neutral-400">·</span>
                            <span className="font-semibold text-neutral-800">{s.level}</span>
                          </span>
                        ))}
                      </div>

                      {/* Feedback */}
                      {item.scores.map((s) => (
                        <div key={s.category} className="mb-3">
                          {Array.isArray(s.feedback) && s.feedback.length > 0 ? (
                            <>
                              <div className="text-xs uppercase tracking-wide text-neutral-500 mb-1">{s.category}</div>
                              <ul className="list-disc pl-5 text-sm text-neutral-700 space-y-1">
                                {s.feedback.map((f, i) => (
                                  <li key={i}>{f}</li>
                                ))}
                              </ul>
                            </>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          </div>
        </header>
      )}

      {/* Voice Chat Icon (large center -> small bottom when dashboard is shown) */}
      <button
        aria-label={showDashboard ? "Return to voice chat" : "Start voice chat"}
        onClick={() => setShowDashboard((s) => !s)}
        className={[
          "fixed z-30 left-1/2 top-1/2 w-32 h-32 rounded-full bg-white text-neutral-800 flex items-center justify-center shadow-md hover:shadow-lg transform-gpu will-change-transform transition-transform duration-[1200ms] ease-in-out border border-neutral-200",
        ].join(" ")}
        style={{
          transform: showDashboard
            ? "translate(-50%, min(32vh, calc(50vh - 6rem))) scale(0.5)"
            : "translate(-50%, -50%) scale(1)",
        }}
      >
        {/* Pulsing ring (subtle animation) */}
        <span className="absolute inline-flex h-full w-full rounded-full bg-neutral-500/20 animate-ping" />
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          className="relative w-16 h-16"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M12 14a3 3 0 0 0 3-3V7a3 3 0 1 0-6 0v4a3 3 0 0 0 3 3z" />
          <path d="M19 11v1a7 7 0 0 1-14 0v-1" />
          <path d="M12 19v4" />
        </svg>
      </button>

      {/* Main content area */}
      {!showDashboard && (
        <main className="px-6 pt-10 pb-32 text-center">
          {/* Clean, minimal chat mode */}
        </main>
      )}
    </div>
  );
}
