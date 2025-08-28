"use client";

import { useEffect, useLayoutEffect, useMemo, useState, useRef } from "react";
import { useRouter } from "next/navigation";
import SkillChart from "../../../components/SkillChart";
import HeroCard from "../../components/HeroCard";
import SectionCard from "../../components/SectionCard";

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
  order: number; // 1..N
  createdAt: number;
  updatedAt: number;
  skill?: Skill | null;
};

// Upward-trending mock data (percentage values 0-100)
function genUpwardTrend(n = 16, start = 30, stepMin = 2, stepMax = 8): number[] {
  const out: number[] = [];
  let cur = start;
  for (let i = 0; i < n; i++) {
    if (i === 0) {
      out.push(cur);
    } else {
      cur = Math.min(100, cur + stepMin + Math.floor(Math.random() * (stepMax - stepMin + 1)));
      out.push(cur);
    }
  }
  return out;
}

export default function CoachAnalyticsPage() {
  const router = useRouter();
  const [tracked, setTracked] = useState<TrackedSkill[]>([]);
  const [skillHistory, setSkillHistory] = useState<Record<string, Array<{ level: number; timestamp: number }>>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [enterDir, setEnterDir] = useState<"left" | "right" | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  // Feature flag: disable cross-page transitions for performance
  const ENABLE_ROUTE_TRANSITIONS = false;

  // On mount: fetch tracked skills and skill history (mock API in dev) and prefetch coach for back nav
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // Fetch tracked skills
        const trackedRes = await fetch("/api/v1/skills/tracked", { headers: { accept: "application/json" } });
        if (!trackedRes.ok) throw new Error(`Failed to load tracked skills (${trackedRes.status})`);
        const trackedData: any = await trackedRes.json();
        const trackedList: TrackedSkill[] = Array.isArray(trackedData) ? trackedData : Array.isArray(trackedData?.tracked) ? trackedData.tracked : [];

        if (!cancelled) setTracked(trackedList);

        // Fetch skill history (always)
        const historyRes = await fetch("/api/v1/skills/level-history", { headers: { accept: "application/json" } });
        if (historyRes.ok) {
          const historyData: any = await historyRes.json();
          if (!cancelled) setSkillHistory(historyData.history || {});
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e ?? "Unknown error");
        if (!cancelled) setError(msg);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    try { router.prefetch("/coach"); } catch {}
    return () => { cancelled = true; };
  }, [router]);

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

  // Safety: if page is restored from BFCache or user navigates back/forward, ensure we don't stay translated off-screen
  useEffect(() => {
    const resetPosition = () => {
      try {
        const el = rootRef.current;
        const rect = el ? el.getBoundingClientRect() : null;
        const comp = el ? window.getComputedStyle(el).transform : "";
        console.log("[analytics] resetPosition: pre", { enterDir, rect, comp, vw: window.innerWidth, vh: window.innerHeight, dpr: window.devicePixelRatio, vis: document.visibilityState });
      } catch {}
      try { setEnterDir(null); } catch {}
      try {
        const el = rootRef.current;
        if (el) {
          el.style.transition = "none";
          el.style.transform = "translateX(0)";
          requestAnimationFrame(() => {
            if (el) el.style.transition = "";
            try {
              const rect2 = el.getBoundingClientRect();
              const comp2 = window.getComputedStyle(el).transform;
              console.log("[analytics] resetPosition: post", { rect: rect2, comp: comp2 });
            } catch {}
          });
        }
      } catch {}
    };
    const onPageShow = () => { console.log("[analytics] pageshow"); resetPosition(); };
    const onPopState = () => { console.log("[analytics] popstate"); resetPosition(); };
    const onVisibility = () => { console.log("[analytics] visibilitychange", document.visibilityState); if (document.visibilityState === "visible") resetPosition(); };
    const onFocus = () => { console.log("[analytics] focus"); resetPosition(); };
    window.addEventListener("pageshow", onPageShow);
    window.addEventListener("popstate", onPopState);
    window.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", onFocus);
    return () => {
      window.removeEventListener("pageshow", onPageShow);
      window.removeEventListener("popstate", onPopState);
      window.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", onFocus);
    };
  }, []);

  // Convert skill history data to chart format
  const perSkillTrends = useMemo(() => {
    return tracked.map((skill: TrackedSkill) => {
      const history = skillHistory[skill.skillId];
      if (history && history.length > 0) {
        // Convert level history to chart data (levels are 0-10, chart expects any range)
        return history.map(h => h.level);
      }
      // Fallback to mock data if no history available
      return genUpwardTrend(16, Math.max(0, skill.currentLevel * 10), 2, 5);
    });
  }, [tracked, skillHistory]);

  const [leaving, setLeaving] = useState(false);
  const [leavingDir, setLeavingDir] = useState<"left" | "right">("right");

  function goBack() {
    try {
      const reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (reduce || !ENABLE_ROUTE_TRANSITIONS) {
        try { window.sessionStorage.setItem('resumeDashboardNoAnim', '1'); } catch {}
        router.push('/coach');
        return;
      }
      if (!leaving) {
        try { window.sessionStorage.setItem("navDir", "back"); } catch {}
        try { window.sessionStorage.setItem('resumeDashboardNoAnim', '1'); } catch {}
        setLeavingDir('right');
        setLeaving(true);
        setTimeout(() => router.push('/coach'), 250);
      }
    } catch {
      router.push('/coach');
    }
  }

  return (
    <div
      ref={rootRef}
      className={[
        "min-h-screen bg-background text-foreground font-sans overflow-x-hidden",
        ENABLE_ROUTE_TRANSITIONS ? "transform-gpu will-change-transform transition-transform duration-300 ease-out" : ""
      ].join(" ")}
      style={{
        transform: ENABLE_ROUTE_TRANSITIONS
          ? (leaving
              ? (leavingDir === "left" ? "translateX(-120vw)" : "translateX(120vw)")
              : enterDir === "left"
              ? "translateX(-120vw)"
              : enterDir === "right"
              ? "translateX(120vw)"
              : "translateX(0)")
          : "translateX(0)",
      }}
    >
      <header className="px-4 pt-10 pb-24">
        <div className="max-w-md mx-auto">
          <div className="flex items-center gap-3 mb-4">
            <button
              type="button"
              aria-label="Go back"
              onClick={goBack}
              className="p-2 rounded-full cu-surface border cu-border text-foreground cu-hover-accent-soft-bg active:scale-95 transition-all duration-200 shadow-sm"
            >
              <svg aria-hidden="true" viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M15 18l-6-6 6-6" />
              </svg>
            </button>
            <div className="flex-1" />
          </div>

          {/* Hero header consistent with /coach */}
          <div className="mb-4">
            {loading ? (
              <SectionCard>
                <div className="h-6 w-40 mx-auto skeleton skeleton-text" />
                <div className="mt-2 h-4 w-64 mx-auto skeleton skeleton-text" />
              </SectionCard>
            ) : (
              <HeroCard label="Analytics" title={<span>Points by Skill</span>} subtitle={<span>Explore your progress trends.</span>} />
            )}
          </div>

          {error ? (
            <SectionCard className="mb-3">
              <div className="text-sm cu-error-text">{error}</div>
            </SectionCard>
          ) : tracked && tracked.length > 0 ? (
            <ul className="grid grid-cols-1 gap-3">
              {tracked
                .slice()
                .sort((a: TrackedSkill, b: TrackedSkill) => (a.order ?? 0) - (b.order ?? 0))
                .map((t: TrackedSkill, idx: number) => (
                  <li key={t.skillId} className="relative overflow-hidden rounded-2xl border-2 cu-border cu-surface p-4 shadow-sm group">
                    {/* base subtle gradient texture */}
                    <span
                      aria-hidden
                      className="pointer-events-none absolute inset-0 opacity-[0.35]"
                      style={{
                        background:
                          "linear-gradient(135deg, rgba(99,102,241,0.05), rgba(16,185,129,0.05))",
                      }}
                    />
                    <div className="text-sm font-medium text-foreground line-clamp-2 mb-2 relative">
                      {t.skill?.title || "Untitled skill"}
                    </div>
                    <div className="mt-1 relative">
                      <SkillChart 
                        data={perSkillTrends[idx] || genUpwardTrend(16, 30, 3, 9)} 
                        className="w-full" 
                        height={140}
                        xLabel="Days ago"
                        yLabel="Level"
                        yTickLabels={['1', '5', '10']}
                      />
                    </div>
                  </li>
                ))}
            </ul>
          ) : (
            <div className="border border-dashed cu-border rounded-2xl p-4 text-center text-sm cu-muted">
              No tracked skills yet.
            </div>
          )}
        </div>
      </header>
    </div>
  );
}
