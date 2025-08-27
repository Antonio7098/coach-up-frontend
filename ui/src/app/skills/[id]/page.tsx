"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useChat } from "../../../context/ChatContext";

type Skill = {
  id: string;
  title: string;
  description?: string;
  category?: string;
  isActive?: boolean;
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

export default function SkillDetailPage() {
  const router = useRouter();
  const params = useParams();
  const skillId = String((params as { id?: string })?.id || "");
  const { sessionId } = useChat();
  const [skill, setSkill] = useState<Skill | null>(null);
  const [tracked, setTracked] = useState<TrackedSkill[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAllCriteria, setShowAllCriteria] = useState(false);
  const [assessments, setAssessments] = useState<any | null>(null);
  const [assessError, setAssessError] = useState<string | null>(null);
  const [assessLoading, setAssessLoading] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [leavingDir, setLeavingDir] = useState<"left" | "right">("left");
  // Chat session id provided by ChatProvider

  // Load skill and tracked info
  useEffect(() => {
    let cancelled = false;
    async function run() {
      if (!skillId) return;
      setLoading(true);
      setError(null);
      try {
        const [resSkill, resTracked] = await Promise.all([
          fetch(`/api/v1/skills?id=${encodeURIComponent(skillId)}`, { headers: { accept: "application/json" } }),
          fetch(`/api/v1/skills/tracked`, { headers: { accept: "application/json" } }),
        ]);
        if (!resSkill.ok) throw new Error(`Failed to load skill (${resSkill.status})`);
        if (!resTracked.ok) throw new Error(`Failed to load tracked skills (${resTracked.status})`);
        const dataSkill = await resSkill.json();
        const dataTracked = await resTracked.json();
        if (!cancelled) {
          setSkill((dataSkill?.skill as Skill) ?? null);
          setTracked(Array.isArray(dataTracked?.tracked) ? (dataTracked.tracked as TrackedSkill[]) : []);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e ?? "Unknown error"));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    run();
    return () => { cancelled = true; };
  }, [skillId]);

  // Entry transition handled by route layout (app/skills/layout.tsx)

  const trackedEntry = useMemo(() => tracked.find((t) => t.skillId === skillId) || null, [tracked, skillId]);
  const currentLevel = trackedEntry?.currentLevel ?? 0;
  const trackedMax = 2;
  const canTrackMore = tracked.length < trackedMax || !!trackedEntry;

  const nearestCriteria = useMemo(() => {
    const levels = skill?.levels ?? [];
    if (levels.length === 0) return null;
    // Prefer exact match; else the highest level <= currentLevel; else closest by absolute difference
    const exact = levels.find((l) => l.level === currentLevel);
    if (exact) return exact;
    const belowOrEqual = levels
      .filter((l) => l.level <= currentLevel)
      .sort((a, b) => b.level - a.level)[0];
    if (belowOrEqual) return belowOrEqual;
    // Fallback: closest by abs diff
    return levels.slice().sort((a, b) => Math.abs(a.level - currentLevel) - Math.abs(b.level - currentLevel))[0];
  }, [skill, currentLevel]);

  async function fetchAssessments() {
    if (!sessionId) return;
    setAssessLoading(true);
    setAssessError(null);
    try {
      console.debug("[skill] fetch assessments start", { sessionId, skillId });
      const res = await fetch(`/api/assessments/${encodeURIComponent(sessionId)}`, {
        headers: {
          accept: "application/json",
          "X-Tracked-Skill-Id": skillId,
        },
      });
      // Show 404 as empty state rather than error
      if (res.status === 404) {
        setAssessments(null);
        setAssessLoading(false);
        return;
      }
      if (!res.ok) throw new Error(`Failed to fetch assessments (${res.status})`);
      const data = await res.json();
      setAssessments(data);
      try {
        const raw: any = data;
        const arr: any[] = Array.isArray(raw?.skillAssessments)
          ? raw.skillAssessments
          : Array.isArray(raw?.summary?.skillAssessments)
          ? raw.summary.skillAssessments
          : [];
        const total = Array.isArray(arr) ? arr.length : 0;
        const matched = Array.isArray(arr)
          ? arr.filter((it) => String((it?.skill?.id ?? "")).trim() === String(skillId)).length
          : 0;
        const reqId = res.headers.get("x-request-id") || undefined;
        console.debug("[skill] fetch assessments ok", { sessionId, skillId, total, matched, filteredServerSide: matched === total, requestId: reqId });
      } catch {}
    } catch (e) {
      console.error("[skill] fetch assessments error", e);
      setAssessError(e instanceof Error ? e.message : String(e ?? "Unknown error"));
    } finally {
      setAssessLoading(false);
    }
  }

  useEffect(() => {
    // Attempt to fetch assessments once we have both session and skill id
    if (sessionId && skillId) {
      void fetchAssessments();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, skillId]);

  // Extract v2 skill assessments for this skill when available
  const v2SkillAssessments: Array<{ level?: number; metCriteria?: string[]; unmetCriteria?: string[]; feedback?: string[] }>
    = useMemo(() => {
      const raw = assessments as any;
      const arr: any[] = Array.isArray(raw?.skillAssessments)
        ? raw.skillAssessments
        : Array.isArray(raw?.summary?.skillAssessments)
        ? raw.summary.skillAssessments
        : [];
      if (!Array.isArray(arr)) return [];
      const filtered = arr.filter((it) => String((it?.skill?.id ?? "")).trim() === String(skillId));
      if (filtered.length !== arr.length) {
        try {
          console.debug("[skill] client filter applied", { sessionId, skillId, before: arr.length, after: filtered.length });
        } catch {}
      }
      return filtered as Array<{ level?: number; metCriteria?: string[]; unmetCriteria?: string[]; feedback?: string[] }>;
    }, [assessments, skillId, sessionId]);

  async function refreshTracked() {
    try {
      const res = await fetch(`/api/v1/skills/tracked`, { headers: { accept: "application/json" } });
      if (res.ok) {
        const data = await res.json();
        setTracked(Array.isArray(data?.tracked) ? (data.tracked as TrackedSkill[]) : []);
      }
    } catch {
      // ignore refresh errors
    }
  }

  async function onTrack() {
    if (!skillId) return;
    if (tracked.length >= trackedMax) {
      setActionError("You can only track up to 2 skills.");
      return;
    }
    setActionLoading(true);
    setActionError(null);
    try {
      const res = await fetch(`/api/v1/skills/track`, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ skillId }),
      });
      if (!res.ok) throw new Error(`Failed to track (${res.status})`);
      await refreshTracked();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
    } finally {
      setActionLoading(false);
    }
  }

  async function onUntrack() {
    if (!skillId) return;
    setActionLoading(true);
    setActionError(null);
    try {
      const res = await fetch(`/api/v1/skills/untrack`, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ skillId }),
      });
      if (!res.ok) throw new Error(`Failed to untrack (${res.status})`);
      await refreshTracked();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
    } finally {
      setActionLoading(false);
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
        setTimeout(() => router.push('/coach'), 650);
      }
    } catch {
      router.push('/coach');
    }
  }

  return (
    <div
      className="min-h-screen bg-background text-foreground font-sans p-4 overflow-x-hidden transform-gpu will-change-transform transition-transform duration-700 ease-in-out"
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
          className="text-sm cu-muted hover:text-foreground mb-2"
          aria-label="Go back"
        >
          &larr; Back
        </button>

        {loading ? (
          <div className="mb-4">
            <div className="h-6 w-40 mx-auto skeleton skeleton-text" />
            <div className="mt-2 h-4 w-64 mx-auto skeleton skeleton-text" />
          </div>
        ) : (
          <>
            <h1 className="text-xl md:text-2xl uppercase tracking-wide cu-muted font-medium mb-1 text-center">
              {skill?.title || "Skill"}
            </h1>
            {skill?.description && (
              <p className="text-sm cu-muted text-center mb-4">{skill.description}</p>
            )}
          </>
        )}

        {actionError && (
          <div role="alert" className="text-sm cu-error-text cu-error-soft-bg border cu-error-border rounded-lg p-3 mb-3">{actionError}</div>
        )}

        <div className="flex items-center justify-center mb-4">
          {trackedEntry ? (
            <button
              type="button"
              onClick={onUntrack}
              disabled={actionLoading}
              className="rounded-lg border cu-border-surface cu-surface px-4 py-2 text-sm hover:opacity-90 disabled:opacity-60"
            >
              {actionLoading ? "Working…" : "Untrack"}
            </button>
          ) : (
            <button
              type="button"
              onClick={onTrack}
              disabled={!canTrackMore || actionLoading}
              className="rounded-lg cu-accent-bg px-4 py-2 text-sm hover:opacity-90 disabled:opacity-60"
            >
              {actionLoading ? "Working…" : "Track"}
            </button>
          )}
        </div>

        {loading ? (
          <div className="rounded-2xl cu-surface border cu-border-surface shadow-sm p-4 mb-4">
            <div className="h-4 w-24 skeleton skeleton-text mb-3" />
            <div className="h-10 w-16 mx-auto skeleton skeleton-rounded" />
          </div>
        ) : (
          <div className="rounded-2xl cu-surface border cu-border-surface shadow-sm p-4 mb-4">
            <div className="text-xs uppercase tracking-wide cu-muted mb-1">Current level</div>
            <div className="text-4xl font-semibold text-foreground text-center" data-testid="skill-current-level">
              {currentLevel}
            </div>
          </div>
        )}

        {loading ? (
          <div className="rounded-2xl cu-surface border cu-border-surface shadow-sm p-4 mb-4">
            <div className="h-4 w-24 skeleton skeleton-text mb-3" />
            <div className="space-y-2">
              <div className="h-4 w-full skeleton skeleton-text" />
              <div className="h-4 w-11/12 skeleton skeleton-text" />
              <div className="h-4 w-10/12 skeleton skeleton-text" />
            </div>
          </div>
        ) : (
          <div className="rounded-2xl cu-surface border cu-border-surface shadow-sm p-4 mb-4">
            <div className="text-xs uppercase tracking-wide cu-muted mb-2">Criteria</div>
            {nearestCriteria ? (
              <div>
                <div className="text-sm text-foreground">
                  <span className="font-medium">Level {nearestCriteria.level}:</span> {nearestCriteria.criteria}
                </div>
                <button
                  type="button"
                  onClick={() => setShowAllCriteria((v) => !v)}
                  className="mt-2 text-xs cu-accent-text hover:opacity-90 underline"
                >
                  {showAllCriteria ? "Hide all criteria" : "Show all criteria"}
                </button>
                {showAllCriteria && (
                  <ul className="mt-3 space-y-1 text-sm text-foreground">
                    {(skill?.levels || []).slice().sort((a, b) => a.level - b.level).map((l) => (
                      <li key={l.level} className="flex items-start gap-2">
                        <span className="inline-block w-10 shrink-0 cu-muted">{l.level}</span>
                        <span>{l.criteria}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ) : (
              <div className="text-sm cu-muted">No criteria available.</div>
            )}
          </div>
        )}

        <section>
          <div className="text-sm uppercase tracking-wide cu-muted font-medium mb-2">Assessments</div>
          {assessLoading && (
            <div className="text-sm cu-muted">Loading assessments…</div>
          )}
          {assessError && (
            <div className="text-sm cu-error-text cu-error-soft-bg border cu-error-border rounded-lg p-3 mb-3">{assessError}</div>
          )}
          {!assessLoading && !assessError && (
            <div className="space-y-3">
              {v2SkillAssessments.length > 0 ? (
                v2SkillAssessments.map((a, idx) => (
                  <div key={idx} className="rounded-2xl cu-surface border cu-border-surface shadow-sm p-4">
                    <div className="text-xs uppercase tracking-wide cu-muted mb-1">Assessment</div>
                    {typeof a.level === "number" && (
                      <div className="text-sm text-foreground mb-2">Level: <span className="font-medium">{a.level}</span></div>
                    )}
                    {Array.isArray(a.metCriteria) && a.metCriteria.length > 0 && (
                      <div className="mb-2">
                        <div className="text-xs font-medium cu-success-text">Met</div>
                        <ul className="list-disc ml-5 text-sm text-foreground">
                          {a.metCriteria.map((c, i) => (<li key={i}>{c}</li>))}
                        </ul>
                      </div>
                    )}
                    {Array.isArray(a.unmetCriteria) && a.unmetCriteria.length > 0 && (
                      <div className="mb-2">
                        <div className="text-xs font-medium cu-error-text">Unmet</div>
                        <ul className="list-disc ml-5 text-sm text-foreground">
                          {a.unmetCriteria.map((c, i) => (<li key={i}>{c}</li>))}
                        </ul>
                      </div>
                    )}
                    {Array.isArray(a.feedback) && a.feedback.length > 0 && (
                      <div>
                        <div className="text-xs font-medium text-foreground">Feedback</div>
                        <ul className="list-disc ml-5 text-sm text-foreground">
                          {a.feedback.map((c, i) => (<li key={i}>{c}</li>))}
                        </ul>
                      </div>
                    )}
                  </div>
                ))
              ) : assessments?.summary ? (
                <div className="rounded-2xl cu-surface border cu-border-surface shadow-sm p-4">
                  <div className="text-xs uppercase tracking-wide cu-muted mb-1">Latest Summary</div>
                  <div className="text-sm text-foreground">
                    <div className="mb-2">
                      <div className="text-xs font-medium text-foreground">Highlights</div>
                      <ul className="list-disc ml-5">
                        {(assessments.summary?.highlights || []).map((h: string, i: number) => (<li key={i}>{h}</li>))}
                      </ul>
                    </div>
                    <div className="mb-2">
                      <div className="text-xs font-medium text-foreground">Recommendations</div>
                      <ul className="list-disc ml-5">
                        {(assessments.summary?.recommendations || []).map((h: string, i: number) => (<li key={i}>{h}</li>))}
                      </ul>
                    </div>
                    {assessments.summary?.rubricVersion && (
                      <div className="text-xs cu-muted">Rubric: {assessments.summary.rubricVersion}</div>
                    )}
                  </div>
                </div>
              ) : (
                <div className="text-sm cu-muted">No assessments available yet.</div>
              )}
              <div>
                <button
                  type="button"
                  onClick={() => fetchAssessments()}
                  className="rounded cu-accent-soft-bg px-3 py-1.5 hover:opacity-90 text-sm"
                >
                  Refresh
                </button>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
