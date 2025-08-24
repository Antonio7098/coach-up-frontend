"use client";

import { useEffect, useMemo, useState } from "react";

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

// Skeleton loader component
const SkeletonLoader = ({ className = "" }: { className?: string }) => (
  <div className={`animate-pulse bg-[rgb(var(--cu-accent-soft))] rounded ${className}`} />
);

// Data is loaded from /api/v1/skills/tracked with MOCK_CONVEX=1 in dev

export default function CoachPage() {
  const [showDashboard, setShowDashboard] = useState(false);
  const [tracked, setTracked] = useState<TrackedSkill[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
    }
    run();
    return () => {
      cancelled = true;
    };
  }, []);

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
    <div className="min-h-screen bg-[rgb(var(--cu-bg))] text-[rgb(var(--cu-fg))] font-sans relative overflow-hidden">
      {/* Dashboard button in top left */}
      {!showDashboard && (
        <button
          aria-label="Open dashboard"
          className="fixed top-4 left-4 text-xl leading-none p-3 rounded-full hover:bg-[rgb(var(--cu-surface-border))]/40 active:scale-95 transition-all duration-200 shadow-sm bg-[rgb(var(--cu-surface))]/80 backdrop-blur-sm border border-[rgb(var(--cu-surface-border))]/50 z-40"
          onClick={() => setShowDashboard(true)}
        >
          📊
        </button>
      )}

      {/* Overall Level and Skills - only visible when dashboard is open */}
      {showDashboard && (
        <header className="p-4">
          <div className="max-w-md mx-auto">
            {/* Level header row */}
            <div className="mb-2 flex items-end justify-between">
              <div>
                <div className="text-sm uppercase tracking-wide cu-muted font-medium">Level</div>
                <div className="text-4xl font-semibold text-[rgb(var(--cu-fg))]" data-testid="overall-level">{levelStats.currentLevelInt}</div>
              </div>
              <div className="text-xl font-medium text-[rgb(var(--cu-fg))]">Level {levelStats.currentLevelInt}</div>
            </div>

            {/* Level helper text */}
            <div className="text-center text-sm cu-muted mb-3">
              {levelStats.pointsLeft} more points to level {levelStats.nextLevelInt}
            </div>

            {/* Progress bar */}
            <div className="w-full h-3 bg-[rgb(var(--cu-accent-soft))] rounded overflow-hidden mb-6 border border-[rgb(var(--cu-surface-border))]">
              <div
                className="h-full bg-[rgb(var(--cu-accent))]"
                style={{ width: `${levelStats.progressPercent}%` }}
              />
            </div>

            <div>
              <div className="text-sm uppercase tracking-wide cu-muted font-medium mb-3">Tracked Skills</div>
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
                <ul className="grid grid-cols-2 gap-4" data-testid="tracked-skills">
                  {[...tracked]
                    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
                    .map((t) => {
                      const s = t.skill ?? ({ id: t.skillId, title: t.skillId } as Skill);
                      return (
                        <li key={t.skillId} className="border border-[rgb(var(--cu-surface-border))] rounded-2xl p-4 bg-[rgb(var(--cu-surface))] shadow-sm">
                          <div className="text-sm cu-muted mb-3">{s.title}</div>
                          <div className="text-3xl font-semibold text-[rgb(var(--cu-fg))] text-center">{t.currentLevel}</div>
                        </li>
                      );
                    })}
                </ul>
              )}
            </div>
          </div>
        </header>
      )}

      {/* Voice Chat Icon (large center -> small bottom when dashboard is shown) */}
      <button
        aria-label={showDashboard ? "Return to voice chat" : "Start voice chat"}
        onClick={() => setShowDashboard((s) => !s)}
        className={[
          "fixed z-30 rounded-full bg-[rgb(var(--cu-surface))] text-[rgb(var(--cu-fg))] flex items-center justify-center shadow-md hover:shadow-lg transition-all duration-300 ease-out border border-[rgb(var(--cu-surface-border))]/60",
          showDashboard
            ? "w-14 h-14 left-1/2 -translate-x-1/2 bottom-6"
            : "w-32 h-32 left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2",
        ].join(" ")}
      >
        {/* Pulsing ring (subtle animation) */}
        <span className="absolute inline-flex h-full w-full rounded-full bg-[rgb(var(--cu-accent-soft))] opacity-30 animate-ping" />
        <span className="relative text-3xl">🎤</span>
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
