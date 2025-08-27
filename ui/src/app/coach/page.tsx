"use client";

import { useEffect, useMemo, useRef, useState, useLayoutEffect } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { useChat } from "../../context/ChatContext";
import { useMic } from "../../context/MicContext";
import { useMicUI } from "../../context/MicUIContext";
import SkillChart from "../../components/SkillChart";
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
  <div className={`animate-pulse cu-accent-soft-bg rounded ${className}`} />
);

// Upward-trending mock data
function genUpwardTrend(n = 8, start = 10, stepMin = 4, stepMax = 12): number[] {
  const out: number[] = [];
  let cur = start;
  for (let i = 0; i < n; i++) {
    if (i === 0) out.push(cur);
    else {
      cur += stepMin + Math.floor(Math.random() * (stepMax - stepMin + 1));
      out.push(cur);
    }
  }
  return out;
}

export default function CoachPage() {
  const router = useRouter();
  const { sessionId } = useChat();
  const mic = useMic();
  const { setInCoach, showDashboard, setShowDashboard, setHandlers } = useMicUI();
  const [dashboardMounted, setDashboardMounted] = useState(false);
  const [tracked, setTracked] = useState<TrackedSkill[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [recent, setRecent] = useState<AssessmentLogItem[]>([]);
  const [dashAnim, setDashAnim] = useState(false);
  const dashUnmountTimer = useRef<number | null>(null);
  const dashContainerRef = useRef<HTMLDivElement | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [leaving, setLeaving] = useState(false);
  const [leavingDir, setLeavingDir] = useState<"left" | "right">("left");
  const [enterDir, setEnterDir] = useState<"left" | "right" | null>(null);

  // Mic logic moved to MicProvider. Coach page only consumes via `useMic()` and controls UI/animation.

  // Debug panel & logs
  const [debugOpen, setDebugOpen] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  // Mount guard for portals
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); return () => setMounted(false); }, []);
  const log = (msg: string) => {
    try {
      const ts = new Date().toLocaleTimeString();
      setLogs((prev) => [...prev.slice(-99), `[${ts}] ${msg}`]);
    } catch {
      // noop
    }
  };

  // (Preamble logging removed; MicProvider handles voice pipeline.)

  // Mark that we are on the coach page so GlobalMicButton switches to coach UI
  useEffect(() => {
    setInCoach(true);
    return () => setInCoach(false);
  }, [setInCoach]);
  // Wire mic interactions into the global mic via MicUIContext handlers
  useEffect(() => {
    setHandlers({
      onTap: () => {
        if (showDashboard) {
          setShowDashboard(false);
        } else {
          mic.toggleVoiceLoop();
        }
      },
      onLongPress: () => {
        if (showDashboard) {
          try { mic.stopRecording(); } catch {}
        }
      },
    });
  }, [mic, setHandlers, setShowDashboard, showDashboard]);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      try {
        const res = await fetch("/api/v1/skills/tracked", { headers: { accept: "application/json" } });
        if (!res.ok) throw new Error(`Failed to load tracked skills (${res.status})`);
        const data: any = await res.json();
        const list: TrackedSkill[] = Array.isArray(data)
          ? data
          : Array.isArray(data?.tracked)
          ? data.tracked
          : [];
        if (!cancelled) {
          setTracked(list);
          log(`skills: loaded ${list.length}`);
        }
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

  // Dev/HMR safety: Fast Refresh can preserve state; ensure we don't stay off-screen if `leaving` was true
  useEffect(() => {
    if (leaving) {
      log("nav: reset leaving=false on mount (HMR safety)");
      setLeaving(false);
    }
    // Always ensure enterDir settles
    const id = requestAnimationFrame(() => setEnterDir(null));
    return () => cancelAnimationFrame(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Back/forward cache and history navigation safety: when the page is restored or user navigates back,
  // make sure we reset any off-screen transforms so content (and mic portal) is visible.
  useEffect(() => {
    const resetPosition = () => {
      try {
        const el = rootRef.current;
        const rect = el ? el.getBoundingClientRect() : null;
        const comp = el ? window.getComputedStyle(el).transform : "";
        const info = { leaving, enterDir, rect, comp, vw: window.innerWidth, vh: window.innerHeight, dpr: window.devicePixelRatio, vis: document.visibilityState };
        console.log("[coach] resetPosition: pre", info);
        log(`diag: pre reset rect=${rect ? `${Math.round(rect.x)},${Math.round(rect.y)} ${Math.round(rect.width)}x${Math.round(rect.height)}` : 'null'} transform='${comp || 'none'}' vw=${window.innerWidth} vh=${window.innerHeight}`);
      } catch {}
      try {
        if (leaving) log("nav: pageshow/popstate -> reset leaving=false");
      } catch {}
      setLeaving(false);
      setEnterDir(null);
      // Hard DOM-level reset in case React state isn't applied yet
      try {
        const el = rootRef.current;
        if (el) {
          el.style.transition = "none";
          el.style.transform = "translateX(0)";
          requestAnimationFrame(() => {
            // allow future transitions
            if (el) el.style.transition = "";
            try {
              const rect2 = el.getBoundingClientRect();
              const comp2 = window.getComputedStyle(el).transform;
              console.log("[coach] resetPosition: post", { rect: rect2, comp: comp2 });
              log(`diag: post reset rect=${rect2 ? `${Math.round(rect2.x)},${Math.round(rect2.y)} ${Math.round(rect2.width)}x${Math.round(rect2.height)}` : 'null'} transform='${comp2 || 'none'}'`);
            } catch {}
          });
        }
      } catch {}
    };
    const onPageShow = () => { console.log("[coach] pageshow"); resetPosition(); };
    const onPopState = () => { console.log("[coach] popstate"); resetPosition(); };
    const onVisibility = () => { console.log("[coach] visibilitychange", document.visibilityState); if (document.visibilityState === "visible") resetPosition(); };
    const onFocus = () => { console.log("[coach] focus"); resetPosition(); };
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
    // We intentionally do not include deps: we want a single stable listener for the component lifetime
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-reset leaving after a short window in case navigation didn't complete (e.g., during HMR)
  useEffect(() => {
    if (!leaving) return;
    log("nav: leaving=true -> auto-reset timer started");
    const t = window.setTimeout(() => {
      log("nav: auto-reset leaving=false (timeout)");
      setLeaving(false);
    }, 1600);
    return () => window.clearTimeout(t);
  }, [leaving]);

  // Proactively prefetch Skills route to avoid RSC fetch hiccups during animated navigation
  useEffect(() => {
    try {
      router.prefetch("/skills");
    } catch {}
    try {
      router.prefetch("/coach/analytics");
    } catch {}
  }, [router]);

  // Hydration-safe entry transition: read navDir on mount and animate new content in
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

  // Chat session id is provided by ChatProvider

  // (Media support detection handled by MicProvider)

  // (Voice helpers moved to MicProvider)

  // (Mic button interactions now provided via MicUIContext -> GlobalMicButton)

  // (No viewport tracking needed; use CSS vh for off-screen state)

  // Mount/unmount with animation. On open: mount then animate in. On close: animate out then unmount.
  useLayoutEffect(() => {
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

  // Forward navigation with animated exit (left)
  function navigateForward(url: string) {
    try { window.sessionStorage.setItem("navDir", "forward"); } catch {}
    // Best-effort prefetch before we start the exit animation
    try { router.prefetch(url); } catch {}
    setLeavingDir("left");
    setLeaving(true);
    setTimeout(() => router.push(url), 400);
  }

  // Auto-start mic when entering chat mode with voice loop active (use global mic)
  useEffect(() => {
    if (!showDashboard && mic.mediaSupported && mic.voiceLoop && !mic.recording && mic.busy === "idle") {
      log("auto: voice loop active -> start mic (provider)");
      void mic.startRecording();
    }
  }, [showDashboard, mic]);

  // Component-level cleanup on unmount: MicProvider owns mic lifecycle

  const overallLevel = useMemo(() => {
    if (!tracked.length) return 0;
    const sum = tracked.reduce((sum, t) => sum + (Number(t.currentLevel) || 0), 0);
    return Math.round((sum / tracked.length) * 10) / 10; // average to 1 decimal
  }, [tracked]);

  const levelStats = useMemo(() => {
    const currentLevelInt = Math.floor(overallLevel);
    const nextLevelInt = currentLevelInt + 1;
    const frac = Math.max(0, Math.min(1, overallLevel - currentLevelInt));
    const progressPercent = Math.round(frac * 100);
    const pointsTotal = 20;
    const pointsEarned = Math.round(frac * pointsTotal);
    return { currentLevelInt, nextLevelInt, progressPercent, pointsEarned, pointsTotal };
  }, [overallLevel]);

  const analyticsPoints = useMemo(() => genUpwardTrend(12, 80, 3, 10), []);

  return (
    <div
      ref={rootRef}
      className="min-h-screen bg-background text-foreground font-sans relative overflow-x-hidden transform-gpu will-change-transform transition-transform duration-400 ease-out"
      style={{
        transform: leaving
          ? (leavingDir === "left" ? "translateX(-120vw)" : "translateX(120vw)")
          : enterDir === "left"
          ? "translateX(-120vw)"
          : enterDir === "right"
          ? "translateX(120vw)"
          : "translateX(0)",
      }}
    >
      {/* Dashboard button in top left */}
      {!showDashboard && (
        <button
          aria-label="Open dashboard"
          className="fixed top-4 left-4 p-3 rounded-full text-foreground cu-surface border cu-border-surface cu-hover-accent-soft-bg active:scale-95 transition-all duration-200 shadow-sm z-40"
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
        <header className="px-4 pt-10 pb-64">
          <div ref={dashContainerRef} className="max-w-md mx-auto">
            {/* Level block (slides in first) */}
            <div
              className={["transform-gpu will-change-transform transition-all duration-[600ms] ease-out", dashAnim ? "opacity-100" : "opacity-0"].join(" ")}
              style={{ transform: dashAnim ? "translateY(0)" : "translateY(-120vh)" }}
            >
              {/* Level header + card */}
              <div className="mb-6">
                <div className="flex items-center justify-between mb-2">
                  <h2 id="level-label" className="text-sm font-semibold uppercase tracking-wide cu-muted">Level</h2>
                </div>
                
                <div className="border-2 cu-border rounded-2xl cu-surface p-4">
                  <div className="flex items-center justify-between">
                    <div className="flex-1 grid place-items-center">
                      <div className="text-3xl font-semibold text-foreground">{overallLevel}</div>
                    </div>
                    <div className="ml-4 text-xs">
                      <div className="tracking-wide font-semibold cu-muted">Focus</div>
                      <ul className="mt-1 space-y-1 text-foreground">
                        <li>• Stop using um filler word</li>
                        <li>• Use less complicated technical jargon</li>
                      </ul>
                    </div>
                  </div>
                  <div className="mt-3 relative h-5 cu-accent-soft-bg rounded-full overflow-hidden">
                    <div className="h-full cu-progress" style={{ width: `${levelStats.progressPercent}%` }} />
                    <div className="absolute inset-0 grid place-items-center text-[11px] font-medium text-foreground">
                      {levelStats.pointsEarned}/{levelStats.pointsTotal}
                    </div>
                  </div>
                </div>
              </div>
            </div>
            {/* Analytics card */}
           <section
              aria-labelledby="analytics-label"
              className="mt-6 mb-6 transform-gpu will-change-transform transition-all duration-[700ms] ease-out"
              style={{ opacity: dashAnim ? 1 : 0, transform: dashAnim ? "translateY(0)" : "translateY(-120vh)", transitionDelay: dashAnim ? "60ms" : "0ms" }}
            >
              <div className="flex items-center justify-between mb-2">
                <h2 id="analytics-label" className="text-sm font-semibold uppercase tracking-wide cu-muted">Analytics</h2>
              </div>
              
              <div
                className="border-2 cu-border rounded-2xl cu-surface p-4 cursor-pointer hover:bg-surface/80 transition-colors"
                onClick={() => navigateForward("/coach/analytics")}
                onMouseEnter={() => { try { router.prefetch("/coach/analytics"); } catch {} }}
                onFocus={() => { try { router.prefetch("/coach/analytics"); } catch {} }}
                role="button"
                tabIndex={0}
                aria-label="Open analytics"
              >
                <div className="flex items-center justify-between mb-1">
                  <div className="text-xs cu-muted">Points earned</div>
                </div>
                <SkillChart data={analyticsPoints} className="w-full" height={56} />
              </div>
            </section>
            {/* Tracked skills */}
            <section
              aria-labelledby="skills-label"
              className="mt-6 mb-6 transform-gpu will-change-transform transition-all duration-[700ms] ease-out"
              style={{ opacity: dashAnim ? 1 : 0, transform: dashAnim ? "translateY(0)" : "translateY(-120vh)", transitionDelay: dashAnim ? "120ms" : "0ms" }}
            >
              <div className="flex items-center justify-between mb-2">
                <button
                  type="button"
                  onClick={() => navigateForward("/skills")}
                  onMouseEnter={() => { try { router.prefetch("/skills"); } catch {} }}
                  onFocus={() => { try { router.prefetch("/skills"); } catch {} }}
                  aria-label="Go to skills overview"
                  className="block"
                >
                  <h2 id="skills-label" className="text-sm font-semibold uppercase tracking-wide cu-muted hover:text-foreground hover:underline">
                    Skills
                  </h2>
                </button>
              </div>
              
              {loading ? (
                <div className="grid grid-cols-2 gap-3">
                  <SkeletonLoader className="h-20 rounded-2xl" />
                  <SkeletonLoader className="h-20 rounded-2xl" />
                </div>
              ) : error ? (
                <div className="text-sm cu-error-text cu-error-soft-bg border cu-error-border rounded-lg p-3">
                  {error}
                </div>
              ) : tracked && tracked.length > 0 ? (
                <ul className="grid grid-cols-2 gap-3">
                  {[...tracked]
                    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
                    .map((t) => (
                      <li key={t.skillId} className="border-2 cu-border rounded-2xl cu-surface">
                        <button
                          type="button"
                          onClick={() => navigateForward(`/skills/${t.skillId}`)}
                          className="w-full text-left p-4"
                          aria-label={`Open ${t.skill?.title || "skill"}`}
                        >
                          <div className="text-sm font-medium text-foreground line-clamp-2">
                            {t.skill?.title || "Untitled skill"}
                          </div>
                          <div className="mt-2 h-1.5 cu-accent-soft-bg rounded-full overflow-hidden">
                            <div
                              className="h-full cu-progress"
                              style={{ width: `${Math.max(0, Math.min(10, Number(t.currentLevel) || 0)) * 10}%` }}
                            />
                          </div>
                          <div className="mt-1 text-xs cu-muted">Lv {t.currentLevel}/10</div>
                        </button>
                      </li>
                    ))}
                </ul>
              ) : (
                <div className="border border-dashed cu-border rounded-2xl p-4 text-center text-sm cu-muted">
                  No tracked skills yet.
                </div>
              )}
            </section>
            <section
              aria-labelledby="recent-label"
              className="space-y-3 transform-gpu will-change-transform transition-all duration-[700ms] ease-out"
              style={{ opacity: dashAnim ? 1 : 0, transform: dashAnim ? "translateY(0)" : "translateY(-120vh)", transitionDelay: dashAnim ? "240ms" : "0ms" }}
            >
              <div className="flex items-center justify-between mb-2">
                <h2 id="recent-label" className="text-sm font-semibold uppercase tracking-wide cu-muted">Log</h2>
              </div>
              
              <ul className="space-y-3">
                {[...recent].sort((a, b) => b.createdAt - a.createdAt).map((item) => (
                  <li key={item.id} className="border-2 cu-border rounded-2xl p-4 cu-surface">
                    <button
                      type="button"
                      onClick={() => setExpanded((m) => ({ ...m, [item.id]: !m[item.id] }))}
                      aria-expanded={!!expanded[item.id]}
                      aria-controls={`log-${item.id}-panel`}
                      className="w-full flex items-center gap-3"
                    >
                      <div className="text-sm text-foreground mr-2 flex-1 text-left">{item.title}</div>
                      {!expanded[item.id] && (
                        <div className="hidden sm:flex items-center gap-3 flex-wrap text-xs cu-muted mr-1">
                          {item.scores.map((s) => (
                            <span key={s.category} className="whitespace-nowrap">
                              <span className="capitalize">{s.category}</span>
                              <span className="mx-1 cu-muted">·</span>
                              <span className="font-semibold text-foreground">{s.level}</span>
                            </span>
                          ))}
                        </div>
                      )}
                      <svg
                        aria-hidden="true"
                        viewBox="0 0 24 24"
                        className={["ml-auto w-4 h-4 cu-muted transition-transform", expanded[item.id] ? "rotate-180" : "rotate-0"].join(" ")}
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
                          ? "mt-3 pt-3 border-t cu-border opacity-100 translate-y-0 max-h-[600px]"
                          : "opacity-0 -translate-y-1 max-h-0 overflow-hidden"
                      ].join(" ")}
                    >
                      {/* Skills moved into expanded area */}
                      <div className="flex items-center gap-3 flex-wrap text-sm cu-muted mb-2">
                        {item.scores.map((s) => (
                          <span key={s.category} className="whitespace-nowrap">
                            <span className="capitalize">{s.category}</span>
                            <span className="mx-1 cu-muted">·</span>
                            <span className="font-semibold text-foreground">{s.level}</span>
                          </span>
                        ))}
                      </div>

                      {/* Feedback */}
                      {item.scores.map((s) => (
                        <div key={s.category} className="mb-3">
                          {Array.isArray(s.feedback) && s.feedback.length > 0 ? (
                            <>
                              <div className="text-xs uppercase tracking-wide cu-muted mb-1">{s.category}</div>
                              <ul className="list-disc pl-5 text-sm text-foreground space-y-1">
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

      {/* Overlays portal: debug controls, and toasts (mic button is now global) */}
      {mounted && createPortal(
        <>
          {/* Debug toggle button */}
          <button
            type="button"
            onClick={() => setDebugOpen((v) => !v)}
            className="fixed bottom-4 right-4 z-40 px-3 py-1.5 text-xs rounded-md cu-surface cu-border-surface cu-accent-text shadow"
          >
            {debugOpen ? "Hide Logs" : "Show Logs"}
          </button>

          {/* Debug panel */}
          {debugOpen && (
            <div className="fixed bottom-16 left-4 right-4 z-40 max-h-56 overflow-auto rounded-lg cu-bg-80 text-foreground text-xs p-3 shadow-lg border cu-border-surface">
              <div className="mb-2 text-[10px] cu-muted">
                sessionId={sessionId} · mediaSupported={String(mic.mediaSupported)} · recording={String(mic.recording)} · busy={mic.busy}
              </div>
              <pre className="whitespace-pre-wrap break-words leading-4">{logs.join("\n")}</pre>
            </div>
          )}

          {/* Inline mic error toast */}
          {mic.voiceError && (
            <div className="fixed bottom-4 left-1/2 -translate-x-1/2 px-3 py-2 rounded cu-error-bg text-sm shadow">
              {mic.voiceError}
            </div>
          )}
        </>,
        document.body as any
      )}

      {/* Voice Mode toggle removed: mic icon now controls pause/resume */}

      {/* Main content area */}
      {!showDashboard && (
        <main className="px-6 pt-10 pb-32 text-center">
          {/* Clean, minimal chat mode */}
        </main>
      )}

      {/* Overlays moved to portal above */}
    </div>
  )
}
