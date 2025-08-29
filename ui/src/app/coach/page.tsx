"use client";

import { Fragment, useEffect, useLayoutEffect, useMemo, useState, useRef } from "react";
import { createPortal } from "react-dom";
import { useRouter, usePathname } from "next/navigation";
import { useChat } from "../../context/ChatContext";
import { useMic } from "../../context/MicContext";
import AudioUnlockBanner from "../../components/AudioUnlockBanner";
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

// Small helper for relative timestamps
function timeAgo(ts: number): string {
  try {
    const ms = Date.now() - ts;
    const s = Math.max(0, Math.floor(ms / 1000));
    if (s < 60) return `${s}s ago`;
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    const d = Math.floor(h / 24);
    return `${d}d ago`;
  } catch {
    return "";
  }
}

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
  const pathname = usePathname();
  const { sessionId } = useChat();
  const mic = useMic();
  const { setInCoach, showDashboard, setShowDashboard, setHandlers } = useMicUI();
  const [dashboardMounted, setDashboardMounted] = useState(false);
  const [tracked, setTracked] = useState<TrackedSkill[]>([]);
  const [skillHistory, setSkillHistory] = useState<Record<string, Array<{ level: number; timestamp: number }>>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [recent, setRecent] = useState<AssessmentLogItem[]>([]);
  const [dashAnim, setDashAnim] = useState(false);
  const dashUnmountTimer = useRef<number | null>(null);
  const dashContainerRef = useRef<HTMLDivElement | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  // Expanded state for assessment chip details in chat mode
  const [chipOpen, setChipOpen] = useState<Record<string, boolean>>({});
  // Debug chat input
  const [debugPrompt, setDebugPrompt] = useState("");
  const [leaving, setLeaving] = useState(false);
  const [leavingDir, setLeavingDir] = useState<"left" | "right">("left");
  const [enterDir, setEnterDir] = useState<"left" | "right" | null>(null);
  // Feature flag: disable cross-page transitions for performance
  const ENABLE_ROUTE_TRANSITIONS = false;
  // Feature flag: enable/disable voice mode and mic interactions on Coach page
  const ENABLE_VOICE = (() => {
    try {
      const v = String(process.env.NEXT_PUBLIC_ENABLE_VOICE ?? "0").toLowerCase();
      return v === "1" || v === "true" || v === "yes" || v === "on";
    } catch { return false; }
  })();
  // Feature flag: model selector is disabled to avoid unintended model overrides
  const ENABLE_MODEL_SELECTOR = false;
  // When returning from a subpage (skills/analytics), skip the initial dashboard entrance animation
  const [skipNextDashboardAnim, setSkipNextDashboardAnim] = useState(false);

  // Mic logic moved to MicProvider. Coach page only consumes via `useMic()` and controls UI/animation.

  // Debug panel & logs
  const [debugOpen, setDebugOpen] = useState(false);
  const [tuningOpen, setTuningOpen] = useState(false);
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

  // Unified configuration modal state
  const [showConfig, setShowConfig] = useState(false);
  const [selectedModel, setSelectedModel] = useState<string>("");
  const [configTab, setConfigTab] = useState<"logs" | "voice" | "model">("logs");
  const MODEL_OPTIONS: Array<{ value: string; label: string }> = [
    { value: "google/gemini-2.5-flash-lite", label: "google/gemini-2.5-flash-lite" },
    { value: "openai/gpt-5-mini", label: "openai/gpt-5-mini" },
    { value: "google/gemini-2.5-flash", label: "google/gemini-2.5-flash" },
    { value: "anthropic/claude-3.5-haiku", label: "anthropic/claude-3.5-haiku" },
    { value: "openai/chatgpt-4o-latest", label: "openai/chatgpt-4o-latest" },
    { value: "openai/gpt-4o-mini", label: "openai/gpt-4o-mini" },
  ];
  useEffect(() => {
    try {
      const m = localStorage.getItem("chat:model");
      const allowed = new Set(MODEL_OPTIONS.map((o) => o.value));
      if (m && allowed.has(m)) setSelectedModel(m);
      else setSelectedModel(MODEL_OPTIONS[0]?.value || "");
    } catch {}
  }, []);

  // (Preamble logging removed; MicProvider handles voice pipeline.)

  // Mark that we are on the coach page so GlobalMicButton switches to coach UI
  useEffect(() => {
    setInCoach(true);
    return () => setInCoach(false);
  }, [setInCoach]);
  // Wire mic interactions into the global mic via MicUIContext handlers
  useEffect(() => {
    if (ENABLE_VOICE) {
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
    } else {
      // Voice disabled: only allow toggling the dashboard; no mic interactions
      setHandlers({
        onTap: () => setShowDashboard(!showDashboard),
        onLongPress: () => {},
      });
    }
  }, [ENABLE_VOICE, mic, setHandlers, setShowDashboard, showDashboard]);

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

        // Fetch level history for deriving latest levels (tracked and untracked)
        try {
          const historyRes = await fetch("/api/v1/skills/level-history", { headers: { accept: "application/json" } });
          if (historyRes.ok) {
            const hData: any = await historyRes.json();
            if (!cancelled) setSkillHistory(hData?.history || {});
          }
        } catch {}
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
    if (!ENABLE_ROUTE_TRANSITIONS) return;
    try {
      const reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      const d = window.sessionStorage.getItem("navDir");
      window.sessionStorage.removeItem("navDir");
      if (!reduce && (d === "back" || d === "forward")) {
        setEnterDir(d === "forward" ? "right" : "left");
        requestAnimationFrame(() => {});
      }
    } catch {}
  }, [ENABLE_ROUTE_TRANSITIONS]);

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
      if (skipNextDashboardAnim) {
        // Show immediately without entrance animation
        setDashAnim(true);
        setSkipNextDashboardAnim(false);
      } else {
        setDashAnim(false);
        // Two RAFs + forced reflow to ensure initial styles are applied before transitioning
        requestAnimationFrame(() => {
          // force layout
          void dashContainerRef.current?.getBoundingClientRect();
          requestAnimationFrame(() => setDashAnim(true));
        });
      }
    } else {
      setDashAnim(false); // triggers slide-up
      // Unmount after exit animation completes
      if (dashUnmountTimer.current) window.clearTimeout(dashUnmountTimer.current);
      dashUnmountTimer.current = window.setTimeout(() => {
        setDashboardMounted(false);
        dashUnmountTimer.current = null;
      }, EXIT_MS);
    }
  }, [showDashboard, skipNextDashboardAnim]);

  // Forward navigation with animated exit (left)
  function navigateForward(url: string) {
    // If route transitions are disabled, navigate immediately without animating
    if (!ENABLE_ROUTE_TRANSITIONS) {
      try { window.sessionStorage.setItem("resumeDashboardNoAnim", "1"); } catch {}
      try { router.push(url); } catch {}
      return;
    }
    // Otherwise, run the animated exit and hide dashboard during the transition
    setShowDashboard(false);
    try { window.sessionStorage.setItem("navDir", "forward"); } catch {}
    try { window.sessionStorage.setItem("resumeDashboardNoAnim", "1"); } catch {}
    try { router.prefetch(url); } catch {}
    setLeavingDir("left");
    setLeaving(true);
    setTimeout(() => router.push(url), 250);
  }

  // If we navigated back to /coach, resume on dashboard without animating
  useEffect(() => {
    if (pathname === '/coach') {
      try {
        const resume = window.sessionStorage.getItem("resumeDashboardNoAnim");
        if (resume) {
          window.sessionStorage.removeItem("resumeDashboardNoAnim");
          setSkipNextDashboardAnim(true);
          setShowDashboard(true);
          setDashboardMounted(true);
          setDashAnim(true);
        }
      } catch {}
    }
  }, [pathname, setShowDashboard]);

  // Auto-start mic when entering chat mode with voice loop active (use global mic)
  useEffect(() => {
    if (
      ENABLE_VOICE &&
      !showDashboard &&
      mic.mediaSupported &&
      mic.voiceLoop &&
      !mic.recording &&
      mic.busy === "idle"
    ) {
      log("auto: voice loop active -> start mic (provider)");
      void mic.startRecording();
    }
  }, [ENABLE_VOICE, showDashboard, mic]);

  // Component-level cleanup on unmount: MicProvider owns mic lifecycle

  // Compute latest level from history per skillId
  const latestLevelBySkillId = useMemo(() => {
    const out: Record<string, number> = {};
    try {
      for (const [skillId, hist] of Object.entries(skillHistory || {})) {
        if (Array.isArray(hist) && hist.length) {
          // pick the entry with max timestamp (history may or may not be sorted)
          const latest = hist.reduce((a, b) => (a.timestamp >= b.timestamp ? a : b));
          out[skillId] = Number.isFinite(Number(latest.level)) ? Math.max(0, Math.min(10, Number(latest.level))) : 0;
        }
      }
    } catch {}
    return out;
  }, [skillHistory]);

  const overallLevel = useMemo(() => {
    if (!tracked.length) return 0;
    const levels = tracked.map((t) => {
      const fromHist = latestLevelBySkillId[t.skillId];
      return Number.isFinite(fromHist) ? fromHist : (Number(t.currentLevel) || 0);
    });
    const sum = levels.reduce((acc, n) => acc + n, 0);
    return Math.round((sum / levels.length) * 10) / 10; // average to 1 decimal
  }, [tracked, latestLevelBySkillId]);

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
      className={[
        "min-h-screen bg-background text-foreground font-sans relative overflow-x-hidden",
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
      {/* Autoplay unlock banner only during chat mode */}
      {ENABLE_VOICE && !showDashboard && <AudioUnlockBanner />}
      {/* Ambient background accents (dashboard only) */}
      {dashboardMounted && (
        <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
          <div className="absolute -top-40 -left-32 h-80 w-80 rounded-full blur-3xl opacity-30 cu-accent-soft-bg" />
          <div className="absolute -bottom-32 -right-20 h-72 w-72 rounded-full blur-3xl opacity-20 cu-accent-soft-bg" />
        </div>
      )}
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
            {/* Hero header */}
            <div
              className={["transform-gpu will-change-transform transition-all duration-[450ms] ease-out", dashAnim ? "opacity-100" : "opacity-0"].join(" ")}
              style={{ transform: dashAnim ? "translateY(0)" : "translateY(-120vh)" }}
            >
              <div className="relative overflow-hidden rounded-3xl border-2 cu-border cu-surface shadow-sm">
                <div className="absolute inset-0 opacity-40 pointer-events-none" aria-hidden="true" style={{
                  background:
                    "radial-gradient(800px 280px at 5% -10%, rgba(99,102,241,0.35), transparent 60%), " +
                    "radial-gradient(700px 280px at 105% 110%, rgba(16,185,129,0.25), transparent 60%)"
                }} />
                <div className="absolute inset-0 backdrop-blur-[2px] opacity-[0.35] pointer-events-none" aria-hidden="true" />
                <div className="relative p-5">
                  <div className="text-xs font-semibold uppercase tracking-wide cu-muted">Coach</div>
                  <h1 className="mt-1 text-2xl font-semibold tracking-tight">Welcome back</h1>
                  <p className="mt-1 text-sm cu-muted">Track your progress and practice with focused guidance.</p>

                  

                  {/* Moved Level progress and Focus into hero */}
                  <div className="mt-4">
                    <div className="grid grid-cols-3 items-end">
                      <div className="text-xs font-semibold uppercase tracking-wide cu-muted">Level</div>
                      <div className="justify-self-center relative inline-block leading-none">
                        <span className="text-5xl md:text-6xl font-extrabold tracking-tight text-black">3</span>
                        {/* soft glow behind the number */}
                        <span aria-hidden className="pointer-events-none absolute -inset-x-4 -bottom-1 h-3 blur-md opacity-40 rounded-full" style={{ background: "radial-gradient(closest-side, rgba(99,102,241,0.35), rgba(16,185,129,0.35))" }} />
                      </div>
                      <div />
                    </div>
                    <div className="mt-2 relative h-5 cu-accent-soft-bg rounded-full overflow-hidden">
                      <div className="absolute inset-0 pointer-events-none" aria-hidden style={{ background: "linear-gradient(90deg, rgba(255,255,255,0.12), rgba(255,255,255,0))" }} />
                      <div className="h-full" style={{ width: "35%", background: "linear-gradient(90deg, rgba(99,102,241,1), rgba(16,185,129,1))" }} />
                      <div className="absolute inset-0 grid place-items-center text-[11px] font-medium text-foreground">
                        7/20
                      </div>
                    </div>
                    <div className="mt-3">
                      <div className="flex items-center justify-between">
                        <div className="text-xs tracking-wide font-semibold cu-muted">Focus</div>
                      </div>
                      <div className="mt-2 flex flex-wrap gap-2">
                        <span className="inline-flex items-center gap-2 text-xs px-2.5 py-1 rounded-full border cu-border-surface cu-surface shadow-sm hover:shadow-md transition-all hover:-translate-y-[0.5px]">
                          <svg aria-hidden viewBox="0 0 24 24" className="w-3.5 h-3.5 cu-success-text" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5"/></svg>
                          Reduce filler words like “um”
                        </span>
                        <span className="inline-flex items-center gap-2 text-xs px-2.5 py-1 rounded-full border cu-border-surface cu-surface shadow-sm hover:shadow-md transition-all hover:-translate-y-[0.5px]">
                          <svg aria-hidden viewBox="0 0 24 24" className="w-3.5 h-3.5 cu-success-text" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5"/></svg>
                          Prefer clear, simple phrasing
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            

            {/* Analytics */}
            <section
              aria-labelledby="analytics-label"
              className="mt-6 transform-gpu will-change-transform transition-all duration-[600ms] ease-out"
              style={{ opacity: dashAnim ? 1 : 0, transform: dashAnim ? "translateY(0)" : "translateY(-120vh)" }}
              onMouseEnter={() => { try { router.prefetch("/coach/analytics"); } catch {} }}
              onFocus={() => { try { router.prefetch("/coach/analytics"); } catch {} }}
              role="button"
              tabIndex={0}
              aria-label="Open analytics"
              onClick={() => navigateForward('/coach/analytics')}
            >
              <h2 id="analytics-label" className="sr-only">Analytics</h2>
              <div className="rounded-2xl border-2 cu-border cu-surface p-4 shadow-sm group">
                {/* Header */}
                <div className="flex items-center justify-between gap-2">
                  <div className="text-sm font-semibold uppercase tracking-wide">ANALYTICS</div>
                  <div className="flex items-center gap-1">
                    <span className="text-[11px] px-2 py-0.5 rounded-full border cu-border-surface cu-surface cu-muted">7d</span>
                    <span className="text-[11px] px-2 py-0.5 rounded-full border cu-border-surface cu-surface cu-muted">30d</span>
                    <span className="text-[11px] px-2 py-0.5 rounded-full border cu-border-surface cu-surface text-foreground">All</span>
                  </div>
                </div>

                {/* Mini-stats */}
                <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
                  <div className="rounded-lg border cu-border-surface cu-surface p-2 text-center">
                    <div className="cu-muted">Total</div>
                    <div className="font-semibold text-foreground">{analyticsPoints.reduce((a,b)=>a+b,0)}</div>
                  </div>
                  <div className="rounded-lg border cu-border-surface cu-surface p-2 text-center">
                    <div className="cu-muted">Avg</div>
                    <div className="font-semibold text-foreground">{Math.round(analyticsPoints.reduce((a,b)=>a+b,0)/analyticsPoints.length)}</div>
                  </div>
                  <div className="rounded-lg border cu-border-surface cu-surface p-2 text-center">
                    <div className="cu-muted">Trend</div>
                    <div className="inline-flex items-center justify-center gap-1 font-semibold text-foreground">
                      <svg aria-hidden viewBox="0 0 24 24" className="w-3.5 h-3.5 cu-success-text" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12l6-6 5 5 7-7"/></svg>
                      Up
                    </div>
                  </div>
                </div>

                {/* Chart */}
                <div className="mt-3">
                  <SkillChart data={analyticsPoints} className="w-full" height={80} />
                </div>

                {/* Footer hint */}
                <div className="mt-2 flex items-center justify-between">
                  <div className="text-[11px] cu-muted flex items-center gap-2">
                    <span className="inline-block h-2 w-2 rounded-full" style={{ background: "linear-gradient(90deg, rgba(99,102,241,1), rgba(16,185,129,1))" }} />
                    Points earned
                  </div>
                  <div className="opacity-0 group-hover:opacity-100 transition-opacity text-xs cu-muted">View details →</div>
                </div>
              </div>
            </section>

            {/* Tracked skills */}
            <section
              aria-labelledby="skills-label"
              className="mt-6 mb-6 transform-gpu will-change-transform transition-all duration-[700ms] ease-out"
              style={{ opacity: dashAnim ? 1 : 0, transform: dashAnim ? "translateY(0)" : "translateY(-120vh)", transitionDelay: dashAnim ? "100ms" : "0ms" }}
            >
              <div className="rounded-2xl border-2 cu-border cu-surface p-4 shadow-sm">
                <div className="flex items-center justify-between mb-2">
                  <button
                    type="button"
                    onClick={() => navigateForward("/skills")}
                    onMouseEnter={() => { try { router.prefetch("/skills"); } catch {} }}
                    onFocus={() => { try { router.prefetch("/skills"); } catch {} }}
                    aria-label="Go to skills overview"
                    className="block"
                  >
                    <div id="skills-label" className="text-sm font-semibold uppercase tracking-wide">SKILLS</div>
                  </button>
                </div>

                {loading ? (
                  <div className="grid grid-cols-2 gap-3">
                    <SkeletonLoader className="h-24 rounded-2xl" />
                    <SkeletonLoader className="h-24 rounded-2xl" />
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
                        <li key={t.skillId} className="group relative overflow-hidden border-2 cu-border rounded-2xl cu-surface shadow-sm transition-all hover:shadow-md">
                          <button
                            type="button"
                            onClick={() => navigateForward(`/skills/${t.skillId}`)}
                            className="w-full text-left p-4"
                            aria-label={`Open ${t.skill?.title || 'skill'}`}
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
                            <span aria-hidden className="pointer-events-none absolute -top-10 -right-10 h-24 w-24 rounded-full opacity-0 group-hover:opacity-30 blur-2xl" style={{ background: 'radial-gradient(closest-side, rgba(99,102,241,0.35), transparent)' }} />
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2">
                                  <span className="inline-flex items-center justify-center h-6 w-6 rounded-full bg-gradient-to-br from-indigo-500/20 to-emerald-500/20 text-[10px] font-semibold shadow-sm border cu-border-surface">{(Number.isFinite(latestLevelBySkillId[t.skillId]) ? latestLevelBySkillId[t.skillId] : (t.currentLevel ?? 0)) || 0}</span>
                                  <div className="text-sm font-medium text-foreground truncate">{t.skill?.title || 'Untitled skill'}</div>
                                </div>
                                <div className="mt-1 text-[11px] cu-muted truncate">{t.skill?.category || `Lv ${(Number.isFinite(latestLevelBySkillId[t.skillId]) ? latestLevelBySkillId[t.skillId] : (t.currentLevel ?? 0))}/10`}</div>
                              </div>
                              <svg aria-hidden viewBox="0 0 24 24" className="w-4 h-4 cu-muted transition-all group-hover:translate-x-0.5 group-hover:opacity-100 opacity-60" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18l6-6-6-6"/></svg>
                            </div>
                            <div className="mt-3 relative h-1.5 cu-accent-soft-bg rounded-full overflow-hidden">
                              <div className="absolute inset-0 pointer-events-none" aria-hidden style={{ background: 'linear-gradient(90deg, rgba(255,255,255,0.14), rgba(255,255,255,0))' }} />
                              <div className="h-full transition-[width] duration-500 ease-out" style={{ width: `${Math.max(0, Math.min(10, Number(Number.isFinite(latestLevelBySkillId[t.skillId]) ? latestLevelBySkillId[t.skillId] : (t.currentLevel || 0)) || 0)) * 10}%`, background: 'linear-gradient(90deg, rgba(99,102,241,1), rgba(16,185,129,1))' }} />
                            </div>
                            <div className="mt-1 text-[11px] cu-muted">Lv {(Number.isFinite(latestLevelBySkillId[t.skillId]) ? latestLevelBySkillId[t.skillId] : (t.currentLevel ?? 0))}/10</div>
                          </button>
                        </li>
                      ))}
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
              </div>
            </section>

            {/* Log */}
            <section
              aria-labelledby="recent-label"
              className="transform-gpu will-change-transform transition-all duration-[500ms] ease-out"
              style={{ opacity: dashAnim ? 1 : 0, transform: dashAnim ? "translateY(0)" : "translateY(-120vh)", transitionDelay: dashAnim ? "150ms" : "0ms" }}
            >
              <div className="rounded-2xl border-2 cu-border cu-surface p-4 shadow-sm">
                <div className="flex items-center justify-between mb-2">
                  <div id="recent-label" className="text-sm font-semibold uppercase tracking-wide">LOG</div>
                </div>
                <ul className="space-y-3">
                  {[...recent].sort((a, b) => b.createdAt - a.createdAt).map((item) => (
                    <li key={item.id} className="group border cu-border-surface rounded-2xl p-4 cu-surface hover:shadow-sm transition-all hover:bg-surface/80">
                      <button
                        type="button"
                        onClick={() => setExpanded((m) => ({ ...m, [item.id]: !m[item.id] }))}
                        aria-expanded={!!expanded[item.id]}
                        aria-controls={`log-${item.id}-panel`}
                        className="w-full flex items-center gap-3"
                      >
                        <div className="text-sm text-foreground mr-2 flex-1 text-left">
                          {item.title}
                          <span className="ml-2 text-xs cu-muted">{timeAgo(item.createdAt)}</span>
                        </div>
                        {!expanded[item.id] && (
                          <div className="hidden sm:flex items-center gap-3 flex-wrap text-xs cu-muted mr-1">
                            {item.scores.map((s) => (
                              <span key={s.category} className="whitespace-nowrap">
                                {s.category}: Lv {s.level}
                              </span>
                            ))}
                          </div>
                        )}
                        <svg aria-hidden viewBox="0 0 24 24" className="w-4 h-4 cu-muted transition-transform" style={{ transform: expanded[item.id] ? 'rotate(90deg)' : 'rotate(0deg)' }} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18l6-6-6-6"/></svg>
                      </button>
                      {expanded[item.id] && (
                        <div id={`log-${item.id}-panel`} className="mt-3 text-sm">
                          <div className="grid grid-cols-2 gap-2">
                            {item.scores.map((s) => (
                              <div key={s.category} className="rounded-lg border cu-border-surface cu-surface p-2 text-center">
                                <div className="cu-muted text-xs">{s.category}</div>
                                <div className="font-semibold text-foreground">Lv {s.level}</div>
                              </div>
                            ))}
                          </div>
                          {item.scores.some((s) => s.feedback && s.feedback.length) && (
                            <div className="mt-2">
                              <div className="text-xs font-medium cu-muted">Feedback</div>
                              <ul className="list-disc ml-5 mt-1">
                                {item.scores.flatMap((s) => s.feedback || []).map((f, i) => (
                                  <li key={i} className="text-sm">{f}</li>
                                ))}
                              </ul>
                            </div>
                          )}
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            </section>
          </div>
        </header>
      )}

      {/* Overlays portal: configuration modal, and toasts (mic button is now global) */}
      {mounted && createPortal(
        <>
          {/* Unified Configure button */}
          <button
            type="button"
            onClick={() => setShowConfig(true)}
            className="fixed bottom-4 right-4 z-40 px-3 py-1.5 text-xs rounded-md cu-surface cu-border-surface cu-accent-text shadow"
            aria-haspopup="dialog"
          >
            Configure
          </button>

          {/* Config Modal */}
          {showConfig && (
            <div className="fixed z-50 bottom-16 right-4">
              <div className="relative w-[58vw] h-[58vw] max-w-[92vw] max-h-[82vh] rounded-lg border cu-border-surface cu-surface p-3 overflow-auto shadow-2xl ring-1 ring-black/10">
                <div className="flex items-center justify-between mb-2">
                  <h2 className="text-base font-semibold">Coach Configuration</h2>
                  <button
                    type="button"
                    onClick={() => setShowConfig(false)}
                    className="rounded px-2 py-1 cu-accent-soft-bg hover:opacity-90 text-sm"
                  >
                    Close
                  </button>
                </div>

                {/* Tabs */}
                <div className="flex items-center gap-1 border-b cu-border-surface mb-3">
                  {(
                    ENABLE_MODEL_SELECTOR
                      ? ([
                          { key: 'logs', label: 'Logs' },
                          { key: 'voice', label: 'Voice Tuner' },
                          { key: 'model', label: 'Model' },
                        ] as const)
                      : ([
                          { key: 'logs', label: 'Logs' },
                          { key: 'voice', label: 'Voice Tuner' },
                        ] as const)
                  ).map((tab) => (
                    <button
                      key={tab.key}
                      type="button"
                      onClick={() => setConfigTab(tab.key)}
                      className={`px-3 py-1.5 text-sm -mb-px border-b-2 ${configTab === tab.key ? 'border-accent text-foreground' : 'border-transparent cu-muted hover:text-foreground'}`}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>

                {/* Model */}
                {ENABLE_MODEL_SELECTOR && configTab === 'model' && (
                  <div>
                    <label className="block text-sm font-medium mb-1">Model</label>
                    <select
                      className="w-full rounded border cu-border-surface px-3 py-1.5"
                      value={selectedModel}
                      onChange={(e) => {
                        const v = e.target.value;
                        setSelectedModel(v);
                        try { localStorage.setItem("chat:model", v); } catch {}
                      }}
                    >
                      {MODEL_OPTIONS.map((m) => (
                        <option key={m.value || 'default'} value={m.value}>{m.label}</option>
                      ))}
                    </select>
                    <div className="text-xs cu-muted mt-1">
                      The selected model will be included as a <code>model</code> parameter in chat requests.
                    </div>
                  </div>
                )}

                {/* Voice tuner */}
                {configTab === 'voice' && (
                  <div className="space-y-3">
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => mic.resetTuning?.()}
                        className="px-2 py-1 rounded border cu-border-surface hover:bg-surface/80 text-[11px]"
                      >
                        Reset to defaults
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          try { localStorage.removeItem('cu.voice.tuning'); } catch {}
                          try { window.location.reload(); } catch {}
                        }}
                        className="px-2 py-1 rounded border cu-border-surface hover:bg-surface/80 text-[11px]"
                      >
                        Clear overrides
                      </button>
                    </div>
                    <div className="grid grid-cols-1 gap-3">
                      <label className="flex flex-col gap-1">
                        <span className="text-[11px] cu-muted">VAD Threshold (RMS)</span>
                        <div className="flex items-center gap-2">
                          <input type="range" min={0.005} max={0.1} step={0.001} value={mic.vadThreshold} onChange={(e) => mic.setTuning({ vadThreshold: Number(e.target.value) })} className="flex-1" />
                          <input type="number" min={0.001} max={0.5} step={0.001} value={Number(mic.vadThreshold.toFixed(3))} onChange={(e) => mic.setTuning({ vadThreshold: Number(e.target.value) })} className="w-24 px-2 py-1 rounded border cu-border-surface bg-transparent" />
                        </div>
                      </label>
                      <label className="flex flex-col gap-1">
                        <span className="text-[11px] cu-muted">Max Silence (ms)</span>
                        <div className="flex items-center gap-2">
                          <input type="range" min={200} max={3000} step={50} value={mic.vadMaxSilenceMs} onChange={(e) => mic.setTuning({ vadMaxSilenceMs: Number(e.target.value) })} className="flex-1" />
                          <input type="number" min={100} max={10000} step={50} value={mic.vadMaxSilenceMs} onChange={(e) => mic.setTuning({ vadMaxSilenceMs: Number(e.target.value) })} className="w-28 px-2 py-1 rounded border cu-border-surface bg-transparent" />
                        </div>
                      </label>
                      <label className="flex flex-col gap-1">
                        <span className="text-[11px] cu-muted">Barge RMS Threshold</span>
                        <div className="flex items-center gap-2">
                          <input type="range" min={0.01} max={0.4} step={0.005} value={mic.bargeRmsThreshold} onChange={(e) => mic.setTuning({ bargeRmsThreshold: Number(e.target.value) })} className="flex-1" />
                          <input type="number" min={0.01} max={1} step={0.005} value={Number(mic.bargeRmsThreshold.toFixed(3))} onChange={(e) => mic.setTuning({ bargeRmsThreshold: Number(e.target.value) })} className="w-28 px-2 py-1 rounded border cu-border-surface bg-transparent" />
                        </div>
                      </label>
                      <label className="flex flex-col gap-1">
                        <span className="text-[11px] cu-muted">Barge Min Frames</span>
                        <div className="flex items-center gap-2">
                          <input type="range" min={1} max={15} step={1} value={mic.bargeMinFrames} onChange={(e) => mic.setTuning({ bargeMinFrames: Number(e.target.value) })} className="flex-1" />
                          <input type="number" min={0} max={100} step={1} value={mic.bargeMinFrames} onChange={(e) => mic.setTuning({ bargeMinFrames: Number(e.target.value) })} className="w-24 px-2 py-1 rounded border cu-border-surface bg-transparent" />
                        </div>
                      </label>
                      <label className="flex flex-col gap-1">
                        <span className="text-[11px] cu-muted">Max Utterance (ms)</span>
                        <div className="flex items-center gap-2">
                          <input type="range" min={2000} max={15000} step={250} value={mic.maxUtterMs} onChange={(e) => mic.setTuning({ maxUtterMs: Number(e.target.value) })} className="flex-1" />
                          <input type="number" min={1000} max={30000} step={100} value={mic.maxUtterMs} onChange={(e) => mic.setTuning({ maxUtterMs: Number(e.target.value) })} className="w-28 px-2 py-1 rounded border cu-border-surface bg-transparent" />
                        </div>
                      </label>
                      <label className="flex flex-col gap-1">
                        <span className="text-[11px] cu-muted">Min Speech (ms)</span>
                        <div className="flex items-center gap-2">
                          <input type="range" min={100} max={2000} step={50} value={mic.minSpeechMs} onChange={(e) => mic.setTuning({ minSpeechMs: Number(e.target.value) })} className="flex-1" />
                          <input type="number" min={0} max={5000} step={50} value={mic.minSpeechMs} onChange={(e) => mic.setTuning({ minSpeechMs: Number(e.target.value) })} className="w-28 px-2 py-1 rounded border cu-border-surface bg-transparent" />
                        </div>
                      </label>
                      <label className="flex flex-col gap-1">
                        <span className="text-[11px] cu-muted">Silence Debounce (frames)</span>
                        <div className="flex items-center gap-2">
                          <input type="range" min={0} max={10} step={1} value={mic.silenceDebounceFrames} onChange={(e) => mic.setTuning({ silenceDebounceFrames: Number(e.target.value) })} className="flex-1" />
                          <input type="number" min={0} max={50} step={1} value={mic.silenceDebounceFrames} onChange={(e) => mic.setTuning({ silenceDebounceFrames: Number(e.target.value) })} className="w-24 px-2 py-1 rounded border cu-border-surface bg-transparent" />
                        </div>
                      </label>
                      <label className="flex flex-col gap-1">
                        <span className="text-[11px] cu-muted">VAD Grace (ms)</span>
                        <div className="flex items-center gap-2">
                          <input type="range" min={0} max={2000} step={50} value={mic.vadGraceMs} onChange={(e) => mic.setTuning({ vadGraceMs: Number(e.target.value) })} className="flex-1" />
                          <input type="number" min={0} max={5000} step={50} value={mic.vadGraceMs} onChange={(e) => mic.setTuning({ vadGraceMs: Number(e.target.value) })} className="w-28 px-2 py-1 rounded border cu-border-surface bg-transparent" />
                        </div>
                      </label>
                    </div>
                    <div className="mt-1 text-[11px] cu-muted">Changes apply immediately and persist locally.</div>
                  </div>
                )}

                {/* Logs */}
                {configTab === 'logs' && (
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <div className="text-sm font-medium">Logs</div>
                      <div className="flex items-center gap-2">
                        <span className="text-[11px] cu-muted">sessionId={sessionId} · mediaSupported={String(mic.mediaSupported)} · recording={String(mic.recording)} · busy={mic.busy}</span>
                        <button
                          type="button"
                          onClick={() => setLogs([])}
                          className="px-2 py-1 rounded border cu-border-surface hover:bg-surface/80 text-[11px]"
                        >
                          Clear
                        </button>
                      </div>
                    </div>
                    <pre className="whitespace-pre-wrap break-words leading-4 text-xs max-h-56 overflow-auto">{logs.join("\n") || "(no logs yet)"}</pre>
                  </div>
                )}
              </div>
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
        <main className="px-6 pt-10 pb-32">
          <div className="max-w-md mx-auto space-y-4">
            {/* Multi-turn interaction indicator */}
            <div className="flex items-center justify-between rounded-lg border cu-border-surface cu-surface p-2 shadow-sm">
              <div className="flex items-center gap-2 text-sm">
                <span
                  aria-hidden
                  className={["inline-block h-2.5 w-2.5 rounded-full",
                    mic.interactionState === "active" ? "bg-emerald-500" : "bg-zinc-400"].join(" ")}
                />
                <span className="font-medium">
                  {mic.interactionState === "active" ? "Multi‑turn active" : "Idle"}
                </span>
                {mic.interactionGroupId && (
                  <span className="text-xs cu-muted">· {mic.interactionGroupId.length > 12 ? `${mic.interactionGroupId.slice(0,6)}…${mic.interactionGroupId.slice(-4)}` : mic.interactionGroupId}</span>
                )}
              </div>
              <div className="text-xs cu-muted">Turns: {mic.interactionTurnCount || 0}</div>
            </div>

            {/* Live assistant stream panel */}
            <section aria-label="Live assistant" className="rounded-lg border cu-border-surface cu-surface p-3 shadow-sm">
              <div className="flex items-center justify-between mb-1">
                <div className="text-sm font-semibold">Assistant</div>
                <div className="text-[11px] cu-muted">
                  busy={mic.busy} · recording={String(mic.recording)}
                </div>
              </div>
              <div className="text-sm whitespace-pre-wrap break-words min-h-[2.5rem]">
                {mic.assistantText || <span className="cu-muted">(waiting for response…)</span>}
              </div>
              {mic.transcript ? (
                <div className="mt-2 border-t cu-border-surface pt-2 text-xs">
                  <div className="cu-muted mb-0.5">You</div>
                  <div className="whitespace-pre-wrap break-words">{mic.transcript}</div>
                </div>
              ) : null}

              {/* Debug prompt controls */}
              <div className="mt-3 flex items-center gap-2">
                <input
                  type="text"
                  value={debugPrompt}
                  onChange={(e) => setDebugPrompt(e.target.value)}
                  placeholder="Type a prompt to test streaming"
                  className="flex-1 px-2 py-1 rounded border cu-border-surface bg-transparent text-sm"
                />
                <button
                  type="button"
                  onClick={async () => { try { await mic.sendPrompt(debugPrompt); } catch {} }}
                  className="px-2 py-1 rounded border cu-border-surface text-sm hover:bg-surface/80"
                >
                  Send
                </button>
                <button
                  type="button"
                  onClick={() => { try { mic.clear(); } catch {}; setDebugPrompt(""); }}
                  className="px-2 py-1 rounded border cu-border-surface text-sm hover:bg-surface/80"
                >
                  Clear
                </button>
              </div>
            </section>

            {/* Assessment chips row */}
            {mic.assessmentChips && mic.assessmentChips.length > 0 && (
              <section aria-label="Assessments">
                <div className="flex gap-2 overflow-x-auto pb-1">
                  {mic.assessmentChips.map((chip) => (
                    <button
                      key={chip.id}
                      type="button"
                      onClick={() => setChipOpen((m) => ({ ...m, [chip.id]: !m[chip.id] }))}
                      aria-expanded={!!chipOpen[chip.id]}
                      className="shrink-0 inline-flex items-center gap-2 px-2.5 py-1.5 rounded-full border cu-border-surface cu-surface text-xs shadow-sm hover:shadow-md transition-all hover:-translate-y-[0.5px]"
                      title={chip.id}
                    >
                      {/* Status icon */}
                      {chip.status === "done" ? (
                        <svg aria-hidden viewBox="0 0 24 24" className="w-3.5 h-3.5 cu-success-text" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5"/></svg>
                      ) : chip.status === "error" ? (
                        <svg aria-hidden viewBox="0 0 24 24" className="w-3.5 h-3.5 cu-error-text" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M15 9l-6 6M9 9l6 6"/></svg>
                      ) : (
                        <span className="inline-block h-2.5 w-2.5 rounded-full bg-amber-400" aria-hidden />
                      )}
                      <span className="whitespace-nowrap">Assessment</span>
                      <span className="text-[11px] cu-muted">
                        {chip.status === "queued" ? "Queued" : chip.status === "done" ? "Ready" : "Error"}
                      </span>
                    </button>
                  ))}
                </div>

                {/* Chip details panels */}
                <div className="space-y-2 mt-1">
                  {mic.assessmentChips.map((chip) => (
                    chipOpen[chip.id] ? (
                      <div key={chip.id} className="rounded-lg border cu-border-surface cu-surface p-3 text-sm">
                        <div className="flex items-center justify-between">
                          <div className="font-medium">Assessment {chip.id.length > 14 ? `${chip.id.slice(0,8)}…${chip.id.slice(-4)}` : chip.id}</div>
                          <span className="text-xs cu-muted">{new Date(chip.createdAt).toLocaleTimeString()}</span>
                        </div>
                        {chip.status === "queued" && (
                          <div className="mt-2 text-xs cu-muted">Queued — awaiting results…</div>
                        )}
                        {chip.status === "error" && (
                          <div className="mt-2 text-xs cu-error-text">Error. {String(chip.summary?.error || chip.summary?.message || "See logs")}</div>
                        )}
                        {chip.status === "done" && (
                          <div className="mt-2 space-y-2">
                            {/* Meta summary if present */}
                            {chip.summary?.meta && (
                              <div className="grid grid-cols-2 gap-2 text-xs">
                                <div className="rounded border cu-border-surface p-2"><div className="cu-muted">Tokens In</div><div className="font-semibold">{chip.summary?.meta?.tokensIn ?? "-"}</div></div>
                                <div className="rounded border cu-border-surface p-2"><div className="cu-muted">Tokens Out</div><div className="font-semibold">{chip.summary?.meta?.tokensOut ?? "-"}</div></div>
                                <div className="rounded border cu-border-surface p-2"><div className="cu-muted">Cost</div><div className="font-semibold">{chip.summary?.meta?.costUsd != null ? `$${chip.summary.meta.costUsd.toFixed?.(4) ?? chip.summary.meta.costUsd}` : "-"}</div></div>
                                <div className="rounded border cu-border-surface p-2"><div className="cu-muted">Latency</div><div className="font-semibold">{chip.summary?.meta?.latencyMsTotal != null ? `${chip.summary.meta.latencyMsTotal} ms` : "-"}</div></div>
                              </div>
                            )}
                            {/* Counts if present */}
                            <div className="text-xs cu-muted">
                              {Array.isArray(chip.summary?.skillAssessments) && (<span className="mr-2">Skills: {chip.summary.skillAssessments.length}</span>)}
                              {Array.isArray(chip.summary?.errors) && chip.summary.errors.length > 0 && (<span>Errors: {chip.summary.errors.length}</span>)}
                            </div>
                            {/* Fallback raw JSON if nothing else */}
                            {!chip.summary?.meta && !Array.isArray(chip.summary?.skillAssessments) && !Array.isArray(chip.summary?.errors) && (
                              <pre className="text-xs overflow-auto max-h-48 cu-muted">{JSON.stringify(chip.summary ?? {}, null, 2)}</pre>
                            )}
                          </div>
                        )}
                      </div>
                    ) : null
                  ))}
                </div>
              </section>
            )}
          </div>
        </main>
      )}

      {/* Overlays moved to portal above */}
    </div>
  )
}
