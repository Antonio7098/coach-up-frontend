"use client";

import { useEffect, useLayoutEffect, useMemo, useState, useRef } from "react";
import { useRouter } from "next/navigation";

// Minimal types (local copy)
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

// Tiny SVG sparkline (no deps)
function Sparkline({
  data,
  className = "",
  stroke = "rgb(var(--cu-accent))",
  fill = "rgba(var(--cu-accent), 0.12)",
  height = 56,
}: {
  data: number[];
  className?: string;
  stroke?: string;
  fill?: string;
  height?: number;
}) {
  const w = 240;
  const h = 48;
  const pad = 2;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const span = Math.max(1, max - min);
  const pts = data.map((v, i) => {
    const x = pad + (i * (w - pad * 2)) / Math.max(1, data.length - 1);
    const y = pad + (h - pad * 2) * (1 - (v - min) / span);
    return [x, y] as const;
  });
  // ref moved to CoachAnalyticsPage
  const d = pts.map((p, i) => `${i === 0 ? "M" : "L"}${p[0].toFixed(2)},${p[1].toFixed(2)}`).join(" ");
  const area = `${d} L${pts[pts.length - 1][0].toFixed(2)},${(h - pad).toFixed(2)} L${pts[0][0].toFixed(2)},${(h - pad).toFixed(2)} Z`;
  return (
    <svg className={className} viewBox={`0 0 ${w} ${h}`} role="img" aria-label="trend graph" style={{ height }}>
      <path d={area} fill={fill} stroke="none" />
      <path d={d} fill="none" stroke={stroke} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

// Upward-trending mock data
function genUpwardTrend(n = 12, start = 50, stepMin = 3, stepMax = 10): number[] {
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

export default function CoachAnalyticsPage() {
  const router = useRouter();
  const [tracked, setTracked] = useState<TrackedSkill[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [enterDir, setEnterDir] = useState<"left" | "right" | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);

  // On mount: fetch tracked skills (mock API in dev) and prefetch coach for back nav
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/v1/skills/tracked", { headers: { accept: "application/json" } });
        if (!res.ok) throw new Error(`Failed to load tracked skills (${res.status})`);
        const data: any = await res.json();
        const list: TrackedSkill[] = Array.isArray(data) ? data : Array.isArray(data?.tracked) ? data.tracked : [];
        if (!cancelled) setTracked(list);
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

  // Hydration-safe entry animation: read navDir on mount and set enterDir
  useEffect(() => {
    try {
      const reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      const d = window.sessionStorage.getItem("navDir");
      window.sessionStorage.removeItem("navDir");
      if (!reduce && (d === "back" || d === "forward")) {
        // Forward: page enters from the right; Back: enter from the left
        setEnterDir(d === "forward" ? "right" : "left");
      }
    } catch {}
  }, []);

  // Consume navDir and animate entry to 0
  useLayoutEffect(() => {
    const id = requestAnimationFrame(() => setEnterDir(null));
    return () => cancelAnimationFrame(id);
  }, []);

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

  // Generate per-skill mock trend data
  const perSkillTrends = useMemo(() => {
    const base = [
      genUpwardTrend(16, 60, 2, 8),
      genUpwardTrend(16, 40, 3, 9),
      genUpwardTrend(16, 30, 4, 10),
      genUpwardTrend(16, 20, 2, 7),
    ];
    return (tracked.length ? tracked : []).map((_, i) => base[i % base.length]);
  }, [tracked]);

  function goBack() {
    try { window.sessionStorage.setItem("navDir", "back"); } catch {}
    router.push('/coach');
  }

  return (
    <div
      ref={rootRef}
      className="min-h-screen bg-background text-foreground font-sans overflow-x-hidden transform-gpu will-change-transform transition-transform duration-700 ease-in-out"
      style={{
        transform:
          enterDir === "left"
            ? "translateX(-120vw)"
            : enterDir === "right"
            ? "translateX(120vw)"
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
            <div>
              <div className="text-xs uppercase tracking-wide cu-muted">Analytics</div>
              <h1 className="text-2xl font-semibold">Points by Skill</h1>
            </div>
          </div>

          {loading ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="h-24 rounded-2xl animate-pulse cu-accent-soft-bg" />
              <div className="h-24 rounded-2xl animate-pulse cu-accent-soft-bg" />
            </div>
          ) : error ? (
            <div className="text-sm cu-error-text cu-error-soft-bg border cu-error-border rounded-lg p-3">{error}</div>
          ) : tracked && tracked.length > 0 ? (
            <ul className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {tracked
                .slice()
                .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
                .map((t, idx) => (
                  <li key={t.skillId} className="border-2 cu-border rounded-2xl cu-surface p-4">
                    <div className="text-sm font-medium text-foreground line-clamp-2 mb-2">
                      {t.skill?.title || "Untitled skill"}
                    </div>
                    <Sparkline data={perSkillTrends[idx] || genUpwardTrend(16, 30, 3, 9)} className="w-full" height={64} />
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
