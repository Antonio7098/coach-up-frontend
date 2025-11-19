"use client";

import React from "react";
import { useAuth, useUser } from "@clerk/nextjs";
import { MinimalAudioProvider, useMinimalAudio } from "../../context/minimal/MinimalAudioContext";
import { MinimalVoiceProvider, useMinimalVoice } from "../../context/minimal/MinimalVoiceContext";
import { MinimalConversationProvider, useMinimalConversation } from "../../context/minimal/MinimalConversationContext";
import { useMinimalSession } from "../../context/minimal/MinimalSessionContext";
import { MinimalMicProvider, useMinimalMic } from "../../context/minimal/MinimalMicContext";
import { MinimalSessionProvider } from "../../context/minimal/MinimalSessionContext";
import { fetchWithRetry } from "../../app/api/lib/retry";
import MicMinButton from "../../components/MicMinButton";
import AssessmentChip from "../../components/AssessmentChip";
import { devLog } from "../../app/api/lib/observability";

function App() {
  // Profile and Goals data - moved to parent so it can be passed to MinimalMicProvider
  const [profile, setProfile] = React.useState<{ displayName?: string; bio?: string } | null>(null);
  const [goals, setGoals] = React.useState<Array<{ goalId: string; title: string; description?: string; status?: string; targetDateMs?: number }>>([]);
  const [profileLoading, setProfileLoading] = React.useState<boolean>(false);
  const [goalsLoading, setGoalsLoading] = React.useState<boolean>(false);

  // System prompt functionality - added for coach-min debug panel
  const [customSystemPrompt, setCustomSystemPrompt] = React.useState<string>("");
  const [isSystemPromptEnabled, setIsSystemPromptEnabled] = React.useState<boolean>(false);

  // Model selection functionality
  const [selectedModel, setSelectedModel] = React.useState<string>("google/gemini-2.5-flash-lite");

  // Test ingest status
  const [ingestTestStatus, setIngestTestStatus] = React.useState<string>("");


  return (
    <MinimalAudioProvider>
      <MinimalSessionProvider>
        <MinimalVoiceProvider>
          <MinimalConversationProvider>
            <MinimalMicProvider
              userProfile={profile || undefined}
              userGoals={goals}
              customSystemPrompt={isSystemPromptEnabled && customSystemPrompt.trim() ? customSystemPrompt.trim() : undefined}
              model={selectedModel || undefined}
              onModelChange={(model: string) => {
                // Update the model selector to reflect the actual model used
                if (model && model !== selectedModel) {
                  setSelectedModel(model);
                  try { localStorage.setItem("chat:model", model); } catch {}
                }
              }}
            >
              <Content
                profile={profile}
                setProfile={setProfile}
                goals={goals}
                setGoals={setGoals}
                profileLoading={profileLoading}
                setProfileLoading={setProfileLoading}
                goalsLoading={goalsLoading}
                setGoalsLoading={setGoalsLoading}
                customSystemPrompt={customSystemPrompt}
                setCustomSystemPrompt={setCustomSystemPrompt}
                isSystemPromptEnabled={isSystemPromptEnabled}
                setIsSystemPromptEnabled={setIsSystemPromptEnabled}
                selectedModel={selectedModel}
                setSelectedModel={setSelectedModel}
                ingestTestStatus={ingestTestStatus}
                setIngestTestStatus={setIngestTestStatus}
              />
            </MinimalMicProvider>
          </MinimalConversationProvider>
        </MinimalVoiceProvider>
      </MinimalSessionProvider>
    </MinimalAudioProvider>
  );
}


function Content({
  profile,
  setProfile,
  goals,
  setGoals,
  profileLoading,
  setProfileLoading,
  goalsLoading,
  setGoalsLoading,
  customSystemPrompt,
  setCustomSystemPrompt,
  isSystemPromptEnabled,
  setIsSystemPromptEnabled,
  selectedModel,
  setSelectedModel,
  ingestTestStatus,
  setIngestTestStatus
}: {
  profile: { displayName?: string; bio?: string } | null;
  setProfile: React.Dispatch<React.SetStateAction<{ displayName?: string; bio?: string } | null>>;
  goals: Array<{ goalId: string; title: string; description?: string; status?: string; targetDateMs?: number }>;
  setGoals: React.Dispatch<React.SetStateAction<Array<{ goalId: string; title: string; description?: string; status?: string; targetDateMs?: number }>>>;
  profileLoading: boolean;
  setProfileLoading: React.Dispatch<React.SetStateAction<boolean>>;
  goalsLoading: boolean;
  setGoalsLoading: React.Dispatch<React.SetStateAction<boolean>>;
  customSystemPrompt: string;
  setCustomSystemPrompt: (value: string) => void;
  isSystemPromptEnabled: boolean;
  setIsSystemPromptEnabled: (value: boolean) => void;
  selectedModel: string;
  setSelectedModel: (value: string) => void;
  ingestTestStatus: string;
  setIngestTestStatus: (value: string) => void;
}) {
  const mic = useMinimalMic();
  const audio = useMinimalAudio();
  const voice = useMinimalVoice();
  const convo = useMinimalConversation();

  // Debug: Log available methods on convo
  React.useEffect(() => {
    devLog('debug', 'coach-min: available convo methods', { methods: Object.keys(convo), convoType: typeof convo });

    // Test if getRecentInteractions exists
    if (typeof convo.getRecentInteractions === 'function') {
      devLog('debug', 'coach-min: getRecentInteractions is available');
      try {
        const recent = convo.getRecentInteractions(2);
        devLog('debug', 'coach-min: getRecentInteractions result', { recent });
      } catch (error) {
        devLog('error', 'coach-min: error calling getRecentInteractions', { error: String(error) });
      }
    } else {
      devLog('error', 'coach-min: getRecentInteractions is NOT available on convo');
      devLog('debug', 'coach-min: available convo methods', { methods: Object.keys(convo) });
    }
  }, [convo]);
  const { sessionId, startNewSession } = useMinimalSession();
  const { user } = useUser();
  const { getToken } = useAuth();

  // Debug: Track mic context changes
  React.useEffect(() => {
    console.log("Content: Mic context updated", {
      transcript: mic.transcript?.substring(0, 50),
      transcriptLength: mic.transcript?.length,
      assistantText: mic.assistantText?.substring(0, 50),
      assistantTextLength: mic.assistantText?.length,
      status: mic.status,
      recording: mic.recording,
      playing: audio.isPlaybackActive
    });
  }, [mic.transcript, mic.assistantText, mic.status, mic.recording, audio.isPlaybackActive]);

  const buildAuthHeaders = React.useCallback(async (base: HeadersInit = {}): Promise<HeadersInit> => {
    try {
      const token = await getToken();
      if (token) return { ...base, Authorization: `Bearer ${token}` };
    } catch {}
    return base;
  }, [getToken]);

  // Dashboard state management
  const [showDashboard, setShowDashboard] = React.useState<boolean>(false);
  const [dashAnim, setDashAnim] = React.useState<boolean>(false);
  const dashUnmountTimer = React.useRef<number | null>(null);

  // Profile and Goals UI state
  const [editingGoal, setEditingGoal] = React.useState<any>(null);
  const [editingProfile, setEditingProfile] = React.useState<boolean>(false);
  const [addingGoal, setAddingGoal] = React.useState<boolean>(false);
  const [newGoalTitle, setNewGoalTitle] = React.useState<string>('');
  const [newGoalDescription, setNewGoalDescription] = React.useState<string>('');
  const [profileDisplayName, setProfileDisplayName] = React.useState<string>('');
  const [profileBio, setProfileBio] = React.useState<string>('');

  // Skills UI state (dashboard panel)
  const [skillsLoading, setSkillsLoading] = React.useState<boolean>(false);
  const [skillsError, setSkillsError] = React.useState<string>('');
  const [trackedSkillsDash, setTrackedSkillsDash] = React.useState<Array<{ skillId: string; title?: string; currentLevel?: number }>>([]);
  const [allSkillsDash, setAllSkillsDash] = React.useState<Array<{ id: string; title: string; category?: string }>>([]);

  // Get userId from Clerk authentication
  const userId = user?.id || "anonymous";

  // Fresh panel: independent state that directly calls the API
  const [fresh, setFresh] = React.useState<{ text: string; updatedAt: number; version: number; lastMessageTs?: number; thresholdTurns?: number; turnsSince?: number } | null>(null);
  const [freshStatus, setFreshStatus] = React.useState<"idle" | "loading" | "ready" | "error">("idle");
  const [freshErr, setFreshErr] = React.useState<string | undefined>(undefined);
  const [dbgOpen, setDbgOpen] = React.useState<boolean>(false);
  const [dbgPrompt, setDbgPrompt] = React.useState<{ prevSummary: string; messages: Array<{ role: 'user'|'assistant'; content: string }> } | null>(null);
  const [promptPreview, setPromptPreview] = React.useState<{
    prompt?: string;
    system?: string;
    summary?: string;
    summaryLen?: number;
    recentMessages?: Array<{ role: string; content: string; len?: number }>;
    createdAt?: number;
  } | null>(null);
  
  // Session cost tracking state
  const [sessionCosts, setSessionCosts] = React.useState<{
    costs: { totalCostCents: number; sttCostCents: number; llmCostCents: number; ttsCostCents: number };
    metrics: { durationMs: number; interactionCount: number };
    interactions: Array<{ id: string; role: string; createdAt: number }>;
  } | null>(null);
  const [sessionCostsLoading, setSessionCostsLoading] = React.useState<boolean>(false);
  const [sessionCostsError, setSessionCostsError] = React.useState<string>("");
  
  // Fetch session metrics using the new lightweight endpoint
  const [sessionMetricsData, setSessionMetricsData] = React.useState<{
    sessionId: string;
    startTime?: number;
    lastActivityAt?: number;
    interactionCount?: number;
    totalCostCents?: number;
    sttCostCents?: number;
    llmCostCents?: number;
    ttsCostCents?: number;
  } | null>(null);
  const [sessionMetricsLoading, setSessionMetricsLoading] = React.useState<boolean>(false);
  const [sessionMetricsError, setSessionMetricsError] = React.useState<string>("");
  
  // TRIAGE debug state
  const [triageItems, setTriageItems] = React.useState<Array<{ id: string; role: string; assessmentType?: string; groupId?: string; triageProcessedAt?: number; groupCount?: number; messages?: Array<{ id: string; role: string; text?: string; createdAt?: number; assessmentType?: string; triageProcessedAt?: number }> }>>([]);
  const [triageUngrouped, setTriageUngrouped] = React.useState<Array<{ id: string; role: string; text?: string; createdAt?: number; assessmentType?: string; groupId?: string; triageProcessedAt?: number; isTriaged?: boolean; isGrouped?: boolean }>>([]);
  const [triageHasGroups, setTriageHasGroups] = React.useState<boolean>(false);
  const [triageStatus, setTriageStatus] = React.useState<string>("");
  const [triageProcessing, setTriageProcessing] = React.useState<boolean>(false);
  const [triageOpenMap, setTriageOpenMap] = React.useState<Record<string, boolean>>({});
  // Overlay of triage decisions derived from events: assess | not_assess | triaged (unknown kind)
  const [triageDecisionById, setTriageDecisionById] = React.useState<Record<string, 'assess' | 'not_assess' | 'triaged'>>({});

  // ASSESS debug state
  const [assessStatus, setAssessStatus] = React.useState<string>("");
  const [assessEvents, setAssessEvents] = React.useState<Array<{ createdAt?: number; kind?: string; payload?: Record<string, unknown> }>>([]);
  const [assessLatestGroup, setAssessLatestGroup] = React.useState<string | null>(null);
  const [assessGroups, setAssessGroups] = React.useState<Array<{ groupId: string; createdAt?: number; skillsCount?: number }>>([]);
  const [assessOpenGroup, setAssessOpenGroup] = React.useState<string | null>(null);
  const [assessOpenSkills, setAssessOpenSkills] = React.useState<Record<string, boolean>>({});
  const [assessmentChipState, setAssessmentChipState] = React.useState<'idle' | 'loading' | 'completed' | 'error'>('idle');
  const [assessmentChipExpanded, setAssessmentChipExpanded] = React.useState(false);
  const [latestAssessmentResult, setLatestAssessmentResult] = React.useState<any>(null);
  const [trackedSkills, setTrackedSkills] = React.useState<Array<{ id: string; title?: string; currentLevel?: number }>>([]);
  // Group-level summary for latest assessment (highlights, recommendations, rubric)
  const [assessSummary, setAssessSummary] = React.useState<{ highlights: string[]; recommendations: string[]; rubricKeyPoints: string[]; meta?: any } | null>(null);
  // Per-skill results for latest assessment
  const [assessSkillResults, setAssessSkillResults] = React.useState<Array<any>>([]);
  
  // Live event polling state
  const [isPolling, setIsPolling] = React.useState<boolean>(false);
  const [lastEventId, setLastEventId] = React.useState<string | null>(null);
  const pollingIntervalRef = React.useRef<number | null>(null);
  const pollStopTimeoutRef = React.useRef<number | null>(null);

  // Assessment chip reset logic - when new user interaction occurs
  const resetAssessmentChipForNewInteraction = React.useCallback(() => {
    // Reset assessment chip to idle state when a new user interaction occurs
    // This makes the chip ready for the next assessment
    setAssessmentChipState('idle');
    setAssessmentChipExpanded(false);
    // Don't clear the result immediately to allow viewing previous assessment
    // but reset the state so the chip shows as ready for new assessment
  }, []);

  // Watch for new user interactions to reset assessment chip
  React.useEffect(() => {
    if (mic.transcript && mic.transcript.trim()) {
      // Small delay to ensure we don't reset during active assessment
      const timeoutId = setTimeout(() => {
        if (assessmentChipState === 'completed') {
          resetAssessmentChipForNewInteraction();
        }
      }, 2000); // Wait 2 seconds after transcript change

      return () => clearTimeout(timeoutId);
    }
  }, [mic.transcript, assessmentChipState, resetAssessmentChipForNewInteraction]);
  const [assessResults, setAssessResults] = React.useState<{
    highlights: string[];
    recommendations: string[];
    rubricKeyPoints: string[];
    meta?: { provider?: string; modelId?: string; skillsCount?: number };
    // New V2 structure
    skillAssessments?: Array<{
      skillId: string;
      skillHash: string;
      level: number;
      confidence?: number;
      levelFeedback: {
        currentLevel: number;
        nextLevelCriteria: string[];
        strengths: string[];
        improvements: string[];
        focus: string[];
        examples?: string[];
      };
      assessmentMetadata: {
        provider?: string;
        modelId?: string;
        promptVersion?: string;
        processingTimeMs?: number;
        tokenCount?: number;
        costCents?: number;
      };
      sourceContext: {
        interactionCount?: number;
        transcriptLength?: number;
        assessmentType?: string;
        sessionDuration?: number;
      };
    }>;
  } | null>(null);

  // Manual chat state
  const [manualChatInput, setManualChatInput] = React.useState<string>("");
  const [manualChatStatus, setManualChatStatus] = React.useState<"idle" | "chat" | "tts" | "playback">("idle");
  const [manualChatResponse, setManualChatResponse] = React.useState<string>("");

  const refreshTriageList = React.useCallback(async () => {
    if (!sessionId) return;
    setTriageStatus('loading');
    try {
      const reqId = Math.random().toString(36).slice(2);
      try { console.log('[TRIAGE_DEBUG] refreshTriageList start', { sessionId }); } catch {}
      const headers = await buildAuthHeaders({ accept: 'application/json', 'x-request-id': reqId });
      const res = await fetch(`/api/v1/transcripts?sessionId=${encodeURIComponent(sessionId)}&limit=100`, {
        method: 'GET', headers, cache: 'no-store'
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || `transcripts failed: ${res.status}`);
      const items = Array.isArray(data?.items) ? data.items : [];
      
      // Map to a unified shape
      const mappedAll = items.map((d: { id?: unknown; role?: unknown; text?: unknown; createdAt?: unknown; assessmentType?: unknown; groupId?: unknown; triageProcessedAt?: unknown; groupCount?: unknown }) => ({
        id: String(d?.id || ''),
        role: String(d?.role || ''),
        text: typeof d?.text === 'string' ? d.text : undefined,
        createdAt: typeof d?.createdAt === 'number' ? d.createdAt : undefined,
        assessmentType: d?.assessmentType,
        groupId: d?.groupId,
        triageProcessedAt: typeof d?.triageProcessedAt === 'number' ? d.triageProcessedAt : undefined,
        isTriaged: !!(d?.assessmentType), // All turns with assessmentType are triaged (including 'none')
        isGrouped: !!d?.groupId,
      }));
      
      // Show all recent turns, sorted by creation time (newest first)
      const allRecentTurns = mappedAll
        .sort((a: any, b: any) => (b.createdAt || 0) - (a.createdAt || 0))
        .slice(0, 30); // Show up to 30 most recent turns
      
      // Set all recent turns for display
      setTriageUngrouped(allRecentTurns);
      
      // Keep the grouped view for backward compatibility (empty for now since we're showing individual turns)
      setTriageItems([]);
      setTriageHasGroups(false);
      
      // Count stats with better pending logic
      const triaged = allRecentTurns.filter((m: any) => m.isTriaged).length;
      const assessed = allRecentTurns.filter((m: any) => m.isTriaged && m.isGrouped).length;
      const notAssessed = allRecentTurns.filter((m: any) => m.isTriaged && !m.isGrouped).length;
      const pending = allRecentTurns.filter((m: any) => !m.isTriaged).length;
      
      // Update status based on processing state
      if (triageProcessing) {
        setTriageStatus(`processing... (${pending} pending)`);
      } else {
        setTriageStatus(`ready (${allRecentTurns.length} recent: ${triaged} triaged [${assessed} assessed, ${notAssessed} not assessed], ${pending} pending)`);
      }
      
      try { 
        console.log('[TRIAGE_DEBUG] refreshTriageList ok', { total: allRecentTurns.length, triaged, assessed, notAssessed, pending, processing: triageProcessing });
        // Debug: show the last few items and their triage status
        const debugItems = allRecentTurns.slice(0, 5).map((item: any) => ({
          id: item.id?.slice(-8),
          role: item.role,
          text: item.text?.slice(0, 30),
          assessmentType: item.assessmentType,
          groupId: !!item.groupId,
          triageProcessedAt: !!item.triageProcessedAt,
          isTriaged: item.isTriaged,
          createdAt: item.createdAt ? new Date(item.createdAt).toLocaleTimeString() : 'unknown'
        }));
        console.log('[TRIAGE_DEBUG] recent items detail:', debugItems);
      } catch {}
    } catch (e: unknown) {
      setTriageStatus((e as any)?.message || 'error');
      try { console.warn('[TRIAGE_DEBUG] refreshTriageList error', e); } catch {}
    }
  }, [sessionId, buildAuthHeaders, triageProcessing]);

  // Triage refresh is now event-driven (handled in pollEvents when triage_start/triage_done occur)
  // No longer refresh on every transcript change to avoid UI churn during voice input

  const runTriageNow = React.useCallback(async () => {
    if (!sessionId) { setTriageStatus('no session'); return; }
    setTriageStatus('running');

    try {
      const reqId = Math.random().toString(36).slice(2);
      try { console.log('[TRIAGE_DEBUG] runTriageNow start', { sessionId }); } catch {}
      const headers = await buildAuthHeaders({ accept: 'application/json', 'x-request-id': reqId });
      const res = await fetch(`/api/v1/triage?sessionId=${encodeURIComponent(sessionId)}&limit=20`, {
        method: 'POST', headers, cache: 'no-store'
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || `triage failed: ${res.status}`);
      setTriageStatus(`ok: updated=${Number(data?.updated || 0)} inferred=${String(data?.inferred || '')}`);
      try { console.log('[TRIAGE_DEBUG] runTriageNow ok', { updated: Number(data?.updated || 0), inferred: String(data?.inferred || '') }); } catch {}
    } catch (e: unknown) {
      setTriageStatus((e as any)?.message || 'error');
      try { console.warn('[TRIAGE_DEBUG] runTriageNow error', e); } catch {}
    }
  }, [sessionId, buildAuthHeaders]);

  const runAssessNow = React.useCallback(async () => {
    if (!sessionId) { setAssessStatus('no session'); return; }
    setAssessStatus('running');

    try {
      const reqId = Math.random().toString(36).slice(2);
      try { console.log('[ASSESS_DEBUG] runAssessNow start', { sessionId }); } catch {}
      const headers = await buildAuthHeaders({ accept: 'application/json', 'x-request-id': reqId });
      const res = await fetch(`/api/assessments/run`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ sessionId }),
        cache: 'no-store'
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || `assessment failed: ${res.status}`);
      setAssessStatus(`ok: groupId=${String(data?.groupId || '').slice(-8)}`);
      try { console.log('[ASSESS_DEBUG] runAssessNow ok', { groupId: data?.groupId, status: data?.status }); } catch {}
    } catch (e: unknown) {
      setAssessStatus((e as any)?.message || 'error');
      try { console.warn('[ASSESS_DEBUG] runAssessNow error', e); } catch {}
    }
  }, [sessionId, buildAuthHeaders]);

  const refreshAssessPanel = React.useCallback(async () => {
    if (!sessionId) return;
    setAssessStatus('loading');
    try {
      const reqId = Math.random().toString(36).slice(2);
      const headers = await buildAuthHeaders({ accept: 'application/json', 'x-request-id': reqId });
      console.log('[ASSESS_DEBUG] refresh start', { sessionId, reqId });
      // 1) Latest assessment results (to get latestGroupId and populate skills)
      const resLatest = await fetch(`/api/assessments/results?sessionId=${encodeURIComponent(sessionId)}`, { method: 'GET', headers, cache: 'no-store' });
      const latestJson = await resLatest.json().catch(() => ({}));
      console.log('[ASSESS_DEBUG] results endpoint', { status: resLatest.status, hasResults: !!latestJson?.results, skillAssessmentsLen: Array.isArray(latestJson?.results?.skillAssessments) ? latestJson.results.skillAssessments.length : undefined, groupId: latestJson?.results?.groupId });
      const latestGroupId = typeof latestJson?.results?.groupId === 'string' ? latestJson.results.groupId : null;
      setAssessLatestGroup(latestGroupId);
      const sum = latestJson && latestJson.results && Array.isArray(latestJson.results.highlights) && Array.isArray(latestJson.results.recommendations) && Array.isArray(latestJson.results.rubricKeyPoints)
        ? {
            highlights: latestJson.results.highlights || [],
            recommendations: latestJson.results.recommendations || [],
            rubricKeyPoints: latestJson.results.rubricKeyPoints || [],
            meta: latestJson.results.meta || undefined,
          }
        : null;
      setAssessSummary(sum);
      // Store per-skill results for expandable list and wire assessResults for UI
      const rawSkillsArr = Array.isArray(latestJson?.results?.skillAssessments) ? latestJson.results.skillAssessments : [];
      // Normalize any missing fields so the renderer can be defensive but simple
      const skillsArr = rawSkillsArr.map((it: any) => ({
        ...it,
        level: Number(it?.level ?? 0),
        // v3 structured feedback (already at root level)
        structuredFeedback: it?.structuredFeedback || {
          primaryTakeaway: 'Assessment completed',
          primaryFocus: {
            description: 'Continue practicing',
            nextLevelCriteria: 'Practice regularly',
            exampleToPractice: undefined
          },
          annotatedExamples: []
        },
        quantitativeMetrics: it?.quantitativeMetrics || {},
        assessmentMetadata: it?.assessmentMetadata || {},
        sourceContext: it?.sourceContext || {},
      }));
      try { setAssessSkillResults(skillsArr); } catch {}
      try { setAssessResults(latestJson?.results ? { ...latestJson.results } : { highlights: [], recommendations: [], rubricKeyPoints: [], meta: latestJson?.results?.meta, skillAssessments: skillsArr }); } catch {}
      // 2) Tracked skills
      const resTracked = await fetch(`/api/v1/skills/tracked`, { method: 'GET', headers, cache: 'no-store' });
      const trackedJson = await resTracked.json().catch(() => ({}));
      const rows = Array.isArray(trackedJson?.tracked) ? trackedJson.tracked : [];
      const list = rows.map((r: { skillId?: unknown; skill?: { id?: unknown; title?: unknown }; title?: unknown; currentLevel?: unknown; level?: unknown }) => ({ id: String(r?.skillId || r?.skill?.id || ''), title: String(r?.skill?.title || r?.title || ''), currentLevel: Number(r?.currentLevel ?? r?.level ?? 0) }));
      setTrackedSkills(list);
      console.log('[ASSESS_DEBUG] tracked skills', { count: list.length });
      // 3) Recent events (filter assess_*)
      const resEvents = await fetch(`/api/v1/events?sessionId=${encodeURIComponent(sessionId)}&limit=100`, { method: 'GET', headers, cache: 'no-store' });
      const evJson = await resEvents.json().catch(() => ({}));
      const evs = Array.isArray(evJson?.events) ? evJson.events : [];
      const assessEvs = evs
        .filter((e: { kind?: unknown }) => typeof e?.kind === 'string' && e.kind.startsWith('assess_'))
        .map((e: { createdAt?: unknown; kind?: unknown; payload?: unknown }) => ({ createdAt: Number(e?.createdAt || Date.now()), kind: String(e?.kind || ''), payload: e?.payload || {} }));
      setAssessEvents(assessEvs);
      console.log('[ASSESS_DEBUG] assess events', { total: evs.length, assessTotal: assessEvs.length, kinds: Array.from(new Set(assessEvs.map((e: { kind: string }) => e.kind))) });
      // Build group list from any assess_* event that has a payload.groupId, prefer finalize_group if present
      const groupMap = new Map<string, { groupId: string; createdAt?: number; skillsCount?: number }>();
      // First, include finalize_group events (carry skillsCount)
      for (const ev of assessEvs) {
        if (ev.kind === 'assess_finalize_group') {
          const gid = String((ev.payload as any)?.groupId || '').trim();
          if (!gid) continue;
          const createdAt = ev.createdAt;
          const skillsCount = Number((ev.payload as any)?.skillsCount || 0) || undefined;
          const cur = groupMap.get(gid);
          if (!cur || (createdAt && (cur.createdAt || 0) < createdAt)) {
            groupMap.set(gid, { groupId: gid, createdAt, skillsCount });
          }
        }
      }
      // Then, backfill from other assess_* events with a groupId
      for (const ev of assessEvs) {
        const gid = String((ev.payload as any)?.groupId || '').trim();
        if (!gid) continue;
        if (!groupMap.has(gid)) {
          groupMap.set(gid, { groupId: gid, createdAt: ev.createdAt });
        }
      }
      let groups = Array.from(groupMap.values()).sort((a, b) => (Number(b.createdAt || 0) - Number(a.createdAt || 0)));
      if (groups.length === 0 && latestGroupId) {
        groups = [{ groupId: latestGroupId, createdAt: typeof latestJson?.assessment?.createdAt === 'number' ? latestJson.assessment.createdAt : Date.now(), skillsCount: Array.isArray(skillsArr) ? skillsArr.length : undefined }];
      }
      console.log('[ASSESS_DEBUG] groups computed', { groupsCount: groups.length, groups });
      setAssessGroups(groups);
      setAssessOpenGroup((prev) => {
        if (prev && groups.find(g => g.groupId === prev)) return prev;
        return latestGroupId;
      });
      setAssessStatus('ready');
      console.log('[ASSESS_DEBUG] refresh done', { status: 'ready', openGroup: latestGroupId, skillsLen: skillsArr.length });
    } catch (e) {
      setAssessStatus((e as any)?.message || 'error');
      console.warn('[ASSESS_DEBUG] refresh error', e);
    }
  }, [sessionId, buildAuthHeaders]);

  // Auto-refresh ASSESS shortly after a user message
  const assessRefreshInflightRef = React.useRef<boolean>(false);
  const lastUserTextRef = React.useRef<string>("");
  React.useEffect(() => {
    const cur = mic.transcript || "";
    const prev = lastUserTextRef.current || "";
    if (cur && cur !== prev && !assessRefreshInflightRef.current) {
      assessRefreshInflightRef.current = true;
      lastUserTextRef.current = cur;
      setTimeout(() => {
        void refreshAssessPanel().finally(() => { assessRefreshInflightRef.current = false; });
      }, 1000);
    }
  }, [mic.transcript, refreshAssessPanel]);

  // Auto-refresh ASSESS after a group is detected but groups list is still empty (race-safe UX)
  React.useEffect(() => {
    // If we have a latest group but the computed groups list is empty,
    // poll a few times to let Convex/events catch up so the UI shows the group
    const needsFollowUp = Boolean(assessLatestGroup) && (!assessGroups || assessGroups.length === 0);
    if (!needsFollowUp) return;
    let attempts = 0;
    const maxAttempts = 5;
    const intervalMs = 800;
    const iv = setInterval(() => {
      attempts++;
      void refreshAssessPanel();
      if (attempts >= maxAttempts) {
        clearInterval(iv);
      }
    }, intervalMs);
    return () => { try { clearInterval(iv); } catch {} };
  }, [assessLatestGroup, assessGroups, refreshAssessPanel]);

  const fetchSessionMetrics = React.useCallback(async () => {
    if (!sessionId) return;
    setSessionMetricsLoading(true);
    setSessionMetricsError("");
    try {
      const reqId = Math.random().toString(36).slice(2);
      const headers = await buildAuthHeaders({ accept: 'application/json', 'x-request-id': reqId });
      const res = await fetch(`/api/v1/sessions/metrics?sessionId=${encodeURIComponent(sessionId)}`, {
        method: 'GET',
        headers,
        cache: 'no-store',
      });
      const data = await res.json().catch(() => ({})) as { error?: string; sessionId?: string; lastActivityAt?: number; interactionCount?: number; sttCostCents?: number; llmCostCents?: number; ttsCostCents?: number; totalCostCents?: number; startTime?: number };
      if (!res.ok) throw new Error(data?.error || `session metrics failed: ${res.status}`);
      setSessionMetricsData({ ...data, sessionId: data.sessionId || sessionId });
    } catch (e) {
      setSessionMetricsError(e instanceof Error ? e.message : String(e));
    } finally {
      setSessionMetricsLoading(false);
    }
  }, [sessionId, buildAuthHeaders]);

  // Fetch session costs (totals + per-interaction history)
  const fetchSessionCosts = React.useCallback(async () => {
    if (!sessionId) return;
    setSessionCostsLoading(true);
    setSessionCostsError("");
    try {
      const reqId = Math.random().toString(36).slice(2);
      const headers = await buildAuthHeaders({ accept: 'application/json', 'x-request-id': reqId });

      // Pull totals from metrics endpoint and raw interactions for history
      const [metricsRes, interactionsRes] = await Promise.all([
        fetch(`/api/v1/sessions/metrics?sessionId=${encodeURIComponent(sessionId)}`, { method: 'GET', headers, cache: 'no-store' }),
        fetch(`/api/v1/interactions?sessionId=${encodeURIComponent(sessionId)}&limit=200`, { method: 'GET', headers, cache: 'no-store' }),
      ]);

      const metrics = await metricsRes.json().catch(() => ({} as any));
      const interactionsPayload = await interactionsRes.json().catch(() => ({} as any));
      if (!metricsRes.ok) throw new Error(metrics?.error || `metrics failed: ${metricsRes.status}`);
      if (!interactionsRes.ok) throw new Error(interactionsPayload?.error || `interactions failed: ${interactionsRes.status}`);

      const interactions = Array.isArray(interactionsPayload?.interactions) ? interactionsPayload.interactions : [];

      // Map interactions with cost fields (defaulting to 0)
      const history = interactions.map((it: any) => ({
        id: String(it?.messageId || `${it?.sessionId || ''}:${it?.ts || it?.createdAt || ''}`),
        role: String(it?.role || ''),
        text: String(it?.text || ''),
        createdAt: Number(it?.createdAt || it?.ts || Date.now()),
        costs: {
          sttCostCents: Number(it?.sttCostCents || 0),
          llmCostCents: Number(it?.llmCostCents || 0),
          ttsCostCents: Number(it?.ttsCostCents || 0),
          totalCostCents: Number(it?.totalCostCents || 0),
        },
      }));

      // Derive duration from metrics (preferred) or fallback to history span
      const startTime = typeof metrics?.startTime === 'number' ? metrics.startTime : undefined;
      const lastActivityAt = typeof metrics?.lastActivityAt === 'number' ? metrics.lastActivityAt : undefined;
      const minCreated = history.length > 0 ? Math.min(...history.map((h: any) => h.createdAt || Date.now())) : undefined;
      const maxCreated = history.length > 0 ? Math.max(...history.map((h: any) => h.createdAt || Date.now())) : undefined;
      const durationMs = (startTime && lastActivityAt)
        ? Math.max(0, lastActivityAt - startTime)
        : (minCreated && maxCreated ? Math.max(0, maxCreated - minCreated) : 0);

      const totals = {
        sttCostCents: Number(metrics?.sttCostCents || 0),
        llmCostCents: Number(metrics?.llmCostCents || 0),
        ttsCostCents: Number(metrics?.ttsCostCents || 0),
        totalCostCents: Number(metrics?.totalCostCents || 0),
      };

      setSessionCosts({
        costs: totals,
        metrics: {
          interactionCount: Number(metrics?.interactionCount || history.length || 0),
          durationMs,
        },
        interactions: history,
      });
    } catch (e) {
      setSessionCostsError(e instanceof Error ? e.message : String(e));
      setSessionCosts(null);
    } finally {
      setSessionCostsLoading(false);
    }
  }, [sessionId, buildAuthHeaders]);

  // Fetch metrics when sessionId changes
  React.useEffect(() => {
    fetchSessionMetrics();
    fetchSessionCosts();
  }, [fetchSessionMetrics, fetchSessionCosts]);

  // Tab management for collapsible panel
  const [activeTab, setActiveTab] = React.useState<'status' | 'chat' | 'summary' | 'session' | 'triage' | 'assess'>('status');
  const [panelCollapsed, setPanelCollapsed] = React.useState<boolean>(true);
  
  // Live event polling for real-time triage and assessment status
  const pollEvents = React.useCallback(async () => {
    if (!sessionId || panelCollapsed || (activeTab !== 'triage' && activeTab !== 'assess')) return;
    
    try {
      const reqId = Math.random().toString(36).slice(2);
      const headers = await buildAuthHeaders({ accept: 'application/json', 'x-request-id': reqId });
      const res = await fetch(`/api/v1/events?sessionId=${encodeURIComponent(sessionId)}&limit=100`, {
        method: 'GET', headers, cache: 'no-store'
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return;
      
      const events = Array.isArray(data?.events) ? data.events : [];
      const triageEvents = events.filter((e: { kind?: string }) => typeof e?.kind === 'string' && e.kind.startsWith('triage_'));
      const assessEvents = events.filter((e: { kind?: string }) => typeof e?.kind === 'string' && e.kind.startsWith('assess_'));

      // If we observe a finalize_group event, proactively refresh the assess panel
      // so the groups list appears without waiting for other triggers.
      if (assessEvents.some((e: any) => e?.kind === 'assess_finalize_group')) {
        void refreshAssessPanel();
      }
      
      // Update triage status based on latest events
      const latestTriageEvent = triageEvents[0]; // events are sorted newest first

      // Walk triage events (newest first) to overlay decisions on specific messageIds so UI can clear PENDING deterministically
      for (const ev of triageEvents) {
        const kindEach = (ev as any)?.kind as string;
        const payloadEach = (ev as any)?.payload || {} as any;
        const ids: string[] = Array.isArray(payloadEach?.messageIds)
          ? payloadEach.messageIds.map((x: any) => String(x))
          : [];
        if ((kindEach === 'triage_persist_ok' || kindEach === 'triage_done') && ids.length > 0) {
          const decisions = payloadEach?.decisions || {};
          const assessCount = Number(decisions?.assess || 0);
          const notAssessCount = Number(decisions?.not_assess || 0);
          setTriageDecisionById((cur) => {
            const next = { ...cur } as Record<string, 'assess' | 'not_assess' | 'triaged'>;
            // If provider returned no updates and default persist marked not_assess, reflect that
            const label: 'assess' | 'not_assess' | 'triaged' = notAssessCount > 0 && assessCount === 0 ? 'not_assess' : (assessCount > 0 ? 'assess' : 'triaged');
            for (const mid of ids) {
              next[mid] = label;
            }
            return next;
          });
        }
      }

      if (latestTriageEvent) {
        const kind = latestTriageEvent.kind;
        const payload = latestTriageEvent.payload || {};
        
        switch (kind) {
          case 'triage_start':
            setTriageProcessing(true);
            setTriageStatus(`starting (limit=${payload.limit})`);
            // Refresh triage list to show initial state when triage starts
            void refreshTriageList();
            break;
          case 'triage_queued':
            setTriageStatus(`queued (${payload.messageIds} messages)`);
            break;
          case 'triage_external_response':
            setTriageStatus(`external response ${payload.status} (${payload.tookMs}ms)`);
            break;
          case 'triage_updates_prepared':
            setTriageStatus(`prepared ${payload.updatesLen} updates`);
            break;
          case 'triage_persist_attempt':
            setTriageStatus(`persisting ${payload.updatesLen} updates`);
            break;
          case 'triage_persist_ok':
            setTriageStatus(`persisted ${payload.updated} updates`);
            // Refresh triage list immediately when updates are persisted
            if (payload.updated && Number(payload.updated) > 0) {
              void refreshTriageList();
            }
            break;
          case 'triage_persist_zero_updated':
            setTriageStatus(`persisted but 0 updated (${payload.updatesLen} attempted)`);
            // Still refresh to clear any pending states
            void refreshTriageList();
            break;
          case 'triage_persist_error':
            setTriageStatus(`persist error: ${payload.error}`);
            // Refresh to show error state properly
            void refreshTriageList();
            break;
          case 'triage_done':
            setTriageProcessing(false);
            setTriageStatus(`done: updated=${payload.updated} provider=${payload.provider} (${payload.tookMs || 0}ms)`);
            // Refresh triage list one final time on completion
            void refreshTriageList();
            // Stop polling after completion
            setTimeout(() => {
              if (pollingIntervalRef.current) {
                window.clearInterval(pollingIntervalRef.current);
                pollingIntervalRef.current = null;
                setIsPolling(false);
              }
            }, 2000);
            break;
        }
      }
      
      // Update assessment status based on latest events
      const latestAssessEvent = assessEvents[0];
      if (latestAssessEvent) {
        const kind = latestAssessEvent.kind;
        const payload = latestAssessEvent.payload || {};
        
        switch (kind) {
          case 'assess_cadence_started':
            setAssessStatus(`running (${payload.groups} groups, ${payload.skills} skills)`);
            break;
          case 'assess_finalize_attempt':
            setAssessStatus(`finalizing group ${payload.groupId} (${payload.skills} skills)`);
            break;
          case 'assess_finalize_result':
            if (payload.status === 'error') {
              setAssessStatus(`error in group ${payload.groupId}: ${payload.error}`);
            } else {
              setAssessStatus(`group ${payload.groupId} result: ${payload.status}`);
            }
            // Refresh to pick up latest group and per-skill results
            setTimeout(() => { void refreshAssessPanel(); }, 250);
            break;
          case 'assess_cadence_completed':
            setAssessStatus(`done: ${payload.completed}/${payload.groups} groups completed`);
            // Final refresh to ensure groups and latest summary are visible
            setTimeout(() => { void refreshAssessPanel(); }, 250);
            // Stop polling after completion
            setTimeout(() => {
              if (pollingIntervalRef.current) {
                window.clearInterval(pollingIntervalRef.current);
                pollingIntervalRef.current = null;
                setIsPolling(false);
              }
            }, 2000);
            break;
        }
      }
      
    } catch (e) {
      // Silently handle polling errors
    }
  }, [sessionId, panelCollapsed, activeTab, buildAuthHeaders, refreshTriageList, refreshAssessPanel]);
  
  const startEventPolling = React.useCallback(() => {
    if (pollingIntervalRef.current || !sessionId || panelCollapsed || (activeTab !== 'triage' && activeTab !== 'assess')) return;
    
    setIsPolling(true);
    pollingIntervalRef.current = window.setInterval(pollEvents, 1200); // Poll every ~1.2s
    
    // Auto-stop polling after 30 seconds of inactivity
    if (pollStopTimeoutRef.current) {
      window.clearTimeout(pollStopTimeoutRef.current);
    }
    pollStopTimeoutRef.current = window.setTimeout(() => {
      if (pollingIntervalRef.current) {
        window.clearInterval(pollingIntervalRef.current);
        pollingIntervalRef.current = null;
        setIsPolling(false);
      }
    }, 30000);
  }, [sessionId, panelCollapsed, activeTab, pollEvents]);
  
  const stopEventPolling = React.useCallback(() => {
    if (pollingIntervalRef.current) {
      window.clearInterval(pollingIntervalRef.current);
      pollingIntervalRef.current = null;
    }
    if (pollStopTimeoutRef.current) {
      window.clearTimeout(pollStopTimeoutRef.current);
      pollStopTimeoutRef.current = null;
    }
    setIsPolling(false);
  }, []);
  
  // Start/stop polling based on debug panel state and active tab
  React.useEffect(() => {
    if (!panelCollapsed && sessionId && (activeTab === 'triage' || activeTab === 'assess')) {
      startEventPolling();
    } else {
      stopEventPolling();
    }
    
    return () => {
      stopEventPolling();
    };
  }, [panelCollapsed, sessionId, activeTab, startEventPolling, stopEventPolling]);
  // Keep the latest prompt preview from SSE in sync automatically
  const lastSsePreview = convo.promptPreview;
  React.useEffect(() => {
    if (lastSsePreview && typeof lastSsePreview?.prompt === 'string' && lastSsePreview.prompt.trim().length > 0) {
      setPromptPreview(lastSsePreview);
    }
  }, [lastSsePreview]);
  // Local in-session transcript of summaries (ascending by version)
  const [transcript, setTranscript] = React.useState<Array<{ version: number; updatedAt: number; text: string }>>([]);
  const [openMap, setOpenMap] = React.useState<Record<number, boolean>>({});
  // Note: Local turn counting removed - now handled server-side via onTurn() callback
  // Server transcript (Convex-backed)
  const [serverTranscript, setServerTranscript] = React.useState<Array<{ id: string; role: 'user'|'assistant'|'system'|string; text: string; createdAt: number }>>([]);
  const [serverTranscriptStatus, setServerTranscriptStatus] = React.useState<"idle"|"loading"|"ready"|"error">("idle");
  const [serverTranscriptErr, setServerTranscriptErr] = React.useState<string | undefined>(undefined);
  const refreshServerTranscript = React.useCallback(async () => {
    if (!sessionId) return;
    setServerTranscriptStatus("loading");
    setServerTranscriptErr(undefined);
    try {
      const reqId = Math.random().toString(36).slice(2);
      const headers = await buildAuthHeaders({ accept: 'application/json', 'x-request-id': reqId });
      const res = await fetch(`/api/v1/transcripts?sessionId=${encodeURIComponent(sessionId)}&limit=200`, {
        method: 'GET',
        headers,
        cache: 'no-store',
      });
      const data = await res.json().catch(() => ({})) as { items?: Array<{ id?: string; role?: string; text?: string; createdAt?: number }>; error?: string };
      if (!res.ok) throw new Error(data?.error || `transcripts failed: ${res.status}`);
      const items = Array.isArray(data?.items) ? data.items : [];
      const mapped = items.map((it) => ({ id: String(it.id || ''), role: String(it.role || ''), text: String(it.text || ''), createdAt: Number(it.createdAt || Date.now()) }));
      setServerTranscript(mapped);
      setServerTranscriptStatus('ready');
    } catch (e) {
      setServerTranscriptErr(e instanceof Error ? e.message : String(e));
      setServerTranscriptStatus('error');
    }
  }, [sessionId, buildAuthHeaders]);

  // Session state (Convex-backed)
  const [sessionState, setSessionState] = React.useState<any>(null);
  const [sessionStateStatus, setSessionStateStatus] = React.useState<"idle"|"loading"|"ready"|"error">("idle");
  const [sessionStateErr, setSessionStateErr] = React.useState<string | undefined>(undefined);
  const refreshSessionState = React.useCallback(async () => {
    if (!sessionId) return;
    setSessionStateStatus('loading');
    setSessionStateErr(undefined);
    try {
      const reqId = Math.random().toString(36).slice(2);
      const headers = await buildAuthHeaders({ accept: 'application/json', 'x-request-id': reqId });
      const res = await fetch(`/api/v1/sessions?sessionId=${encodeURIComponent(sessionId)}`, {
        method: 'GET',
        headers,
        cache: 'no-store',
      });
      const data = await res.json().catch(() => ({})) as { session?: any; error?: string };
      if (!res.ok) throw new Error(data?.error || `sessions failed: ${res.status}`);
      setSessionState(data?.session ?? null);
      setSessionStateStatus('ready');
    } catch (e) {
      setSessionStateErr(e instanceof Error ? e.message : String(e));
      setSessionStateStatus('error');
    }
  }, [sessionId, buildAuthHeaders]);

  // Note: turns tracking is now handled server-side only
  // Server-driven cadence values (fallbacks remain for local-only)
  const refreshFresh = React.useCallback(async () => {
    if (!sessionId) return;
    setFreshStatus("loading");
    setFreshErr(undefined);
    try {
      try { console.log("[fresh] GET start", { sessionId }); } catch {}
      const reqId = Math.random().toString(36).slice(2);
      // Prefer UI API (Convex-backed) session summary
      const headers = await buildAuthHeaders({ accept: "application/json", "x-request-id": reqId });
      const res = await fetch(`/api/v1/session-summary?sessionId=${encodeURIComponent(sessionId)}`, {
        method: "GET",
        headers,
        cache: "no-store",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || `fetch failed: ${res.status}`);
      const next = {
        text: String((data?.text ?? data?.summaryText) || ""),
        updatedAt: typeof data?.updatedAt === "number" ? data.updatedAt : Date.now(),
        version: typeof data?.version === "number" ? data.version : 1,
        lastMessageTs: typeof data?.lastMessageTs === 'number' ? data.lastMessageTs : undefined,
        thresholdTurns: typeof data?.thresholdTurns === 'number' ? data.thresholdTurns : undefined,
        turnsSince: typeof data?.turnsSince === 'number' ? data.turnsSince : undefined,
        cutoffIndex: typeof data?.cutoffIndex === 'number' ? data.cutoffIndex : undefined,
        inProgress: data?.inProgress === true,
        secondsSince: typeof data?.secondsSince === 'number' ? data.secondsSince : undefined,
      } as any;
      try { console.log("[fresh] GET ok", { len: next.text.length, version: next.version, updatedAt: next.updatedAt }); } catch {}
      setFresh(next);
      setTranscript((cur) => {
        const exists = cur.some((h) => h.version === next.version);
        const arr = exists ? cur : [...cur, { version: next.version, updatedAt: next.updatedAt, text: next.text }];
        arr.sort((a,b) => a.version - b.version);
        return arr;
      });
      setFreshStatus("ready");
    } catch (e) {
      try { console.log("[fresh] GET error", { err: e instanceof Error ? e.message : String(e) }); } catch {}
      setFreshErr(e instanceof Error ? e.message : String(e));
      setFreshStatus("error");
    }
  }, [sessionId, buildAuthHeaders]);

  const generateFresh = React.useCallback(async () => {
    if (!sessionId) return;
    
    try {
      const prev = fresh?.text || "";
      let recentMessages = convo.getImmediateHistory();
      if (!recentMessages || recentMessages.length === 0) {
        const fallback: Array<{ role: 'user'|'assistant'; content: string }> = [];
        if (mic.transcript && mic.transcript.trim()) fallback.push({ role: 'user', content: mic.transcript });
        if (mic.assistantText && mic.assistantText.trim()) fallback.push({ role: 'assistant', content: mic.assistantText });
        if (fallback.length > 0) recentMessages = fallback;
      }
      // If still no messages, skip generation
      if (!recentMessages || recentMessages.length === 0) return;
      // Save debug prompt details for the panel
      try { setDbgPrompt({ prevSummary: prev, messages: recentMessages }); } catch {}
      try { console.log("[fresh] POST start", { sessionId, prevLen: prev.length, msgs: recentMessages.length }); } catch {}
      const baseHeaders = await buildAuthHeaders({ 'content-type': 'application/json' });
      const idemKey = `ss:${sessionId}:${Math.floor(Date.now()/2000)}`; // 2s bucket
      const headers = { ...baseHeaders, 'Idempotency-Key': idemKey } as any;

      // Tiny retry with jitter for transient errors
      const attempt = async () => {
        const res = await fetch(`/api/v1/session-summary`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ sessionId, prevSummary: prev, messages: recentMessages, tokenBudget: 600 }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data?.error || `generate failed: ${res.status}`);
        return data;
      };

      let data: any = null;
      for (let i = 0; i < 3; i++) {
        try {
          data = await attempt();
          break;
        } catch (e) {
          if (i === 2) throw e;
          const jitter = 50 + Math.floor(Math.random()*150);
          await new Promise(r => setTimeout(r, jitter));
        }
      }

      // After ack, refresh to fetch latest text/version and transcript for diff
      await Promise.all([
        refreshFresh(),
        refreshServerTranscript(),
      ]);
      setFreshStatus("ready");
      try { console.log("[fresh] POST ok (ack)"); } catch {}
    } catch {}
  }, [sessionId, fresh, convo, mic.transcript, mic.assistantText, buildAuthHeaders]);
  
  // Enhanced runTriageNow with live polling
  const runTriageNowWithPolling = React.useCallback(async () => {
    // Start event polling to show live progress
    if (!panelCollapsed && (activeTab === 'triage' || activeTab === 'assess')) {
      startEventPolling();
    }
    // Delegate to the original function
    return runTriageNow();
  }, [panelCollapsed, activeTab, startEventPolling, runTriageNow]);

  // Enhanced runAssessNow with live polling
  const runAssessNowWithPolling = React.useCallback(async () => {
    // Start event polling to show live progress for assessments
    if (!panelCollapsed && (activeTab === 'triage' || activeTab === 'assess')) {
      startEventPolling();
      setAssessStatus('initializing');
    }
    // Delegate to the original function
    return runAssessNow();
  }, [panelCollapsed, activeTab, startEventPolling, runAssessNow]);
  
  // Enhanced generateFresh with live polling for assessments
  const generateFreshWithPolling = React.useCallback(async () => {
    // Start event polling to show live progress for assessments
    if (!panelCollapsed && (activeTab === 'triage' || activeTab === 'assess')) {
      startEventPolling();
      setAssessStatus('initializing');
    }
    // Delegate to the original function
    return generateFresh();
  }, [panelCollapsed, activeTab, startEventPolling, generateFresh]);

  // Server cadence: remove UI auto trigger; rely on backend via persisted interactions
  // Remove UI auto cadence effect
  React.useEffect(() => {
    // Auto-start VAD loop on mount
    if (!mic.vadLoop) {
      try { mic.toggleVadLoop(); } catch {}
    }
    // Prime server panels on mount
    void refreshServerTranscript();
    void refreshSessionState();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // When assistant produces a new reply, schedule a short delayed refresh to pick up
  // backend cadence-generated summaries (non-blocking and debounced)
  const lastAssistantRef = React.useRef<string | null>(null);
  const refreshInflightRef = React.useRef<boolean>(false);
  const pollUntilRef = React.useRef<number>(0);
  React.useEffect(() => {
    const cur = mic.assistantText || "";
    const prev = lastAssistantRef.current || "";
    if (cur && cur !== prev && !refreshInflightRef.current) {
      // Note: turn counting is now handled server-side via onTurn() callback
      refreshInflightRef.current = true;
      lastAssistantRef.current = cur;
      // Short debounce to allow backend to persist and maybe complete summary
      setTimeout(() => {
        // Burst refresh immediately
        void Promise.all([
          refreshFresh(),
          refreshServerTranscript(),
          refreshSessionState(),
          fetchSessionMetrics(),
          fetchSessionCosts(),
          // triage list is gated by cadence; do not refresh unconditionally here
        ]).finally(() => { refreshInflightRef.current = false; });
      }, 1200);
      // Also poll summary state for a few seconds to reflect turns_since changes quickly
      pollUntilRef.current = Date.now() + 10000; // 10s window
    }
  }, [mic.assistantText, refreshFresh, refreshServerTranscript, refreshSessionState, fetchSessionMetrics, fetchSessionCosts]);

  React.useEffect(() => {
    // Lightweight polling for summary state while a short window is active
    const id = window.setInterval(() => {
      if (pollUntilRef.current > Date.now()) {
        try { console.log("[fresh] POLL window active – refreshing summary state"); } catch {}
        void Promise.all([
          refreshFresh(),
          // triage refresh is triggered by cadence watcher
        ]);
      }
    }, 2000);
    return () => { window.clearInterval(id); };
  }, [refreshFresh]);

  // Note: turn counter reset is now handled server-side

  // Seed LLM prompt preview whenever mic enters chat with a transcript
  React.useEffect(() => {
    try {
      if (mic.status === 'chat' && typeof mic.transcript === 'string' && mic.transcript.trim().length > 0) {
        const systemText = typeof (fresh as any)?.text === 'string' ? String((fresh as any).text) : '';
        const promptText = mic.transcript;
        console.log('[LLM_DEBUG] Seeding prompt preview from mic', { sysLen: systemText.length, promptLen: promptText.length });
        setPromptPreview({
          system: systemText,
          summary: undefined as any,
          summaryLen: undefined as any,
          recentMessages: undefined as any,
          prompt: promptText,
          createdAt: Date.now(),
        });
      }
    } catch (e) { try { console.warn('[LLM_DEBUG] Mic seed failed', e); } catch {} }
  }, [mic.status, mic.transcript, fresh?.text]);

  // Gate triage refreshes by server cadence: when turnsSince hits thresholdTurns
  React.useEffect(() => {
    const turnsSince = Number.isFinite(Number((fresh as any)?.turnsSince)) ? Number((fresh as any)?.turnsSince) : undefined;
    const threshold = Number.isFinite(Number((fresh as any)?.thresholdTurns)) ? Number((fresh as any)?.thresholdTurns) : undefined;
    if (turnsSince !== undefined && threshold !== undefined && threshold > 0 && turnsSince > 0 && (turnsSince % threshold === 0)) {
      void refreshTriageList();
    }
  }, [fresh?.turnsSince, fresh?.thresholdTurns, refreshTriageList]);

  // Handle manual chat status changes
  React.useEffect(() => {
    if (manualChatStatus === "playback" && !audio.isPlaybackActive) {
      // Reset to idle when playback ends
      setManualChatStatus("idle");
    }
  }, [manualChatStatus, audio.isPlaybackActive]);

  // Fetch profile data
  const fetchProfile = React.useCallback(async () => {
    setProfileLoading(true);
    try {
      const headers = await buildAuthHeaders({ accept: 'application/json' });
      const response = await fetch(`/api/v1/users/profile?userId=${encodeURIComponent(userId)}`, { headers });
      const data = await response.json();
      if (data.profile) {
        setProfile(data.profile);
      }
    } catch (error) {
      console.error('Failed to fetch profile:', error);
    } finally {
      setProfileLoading(false);
    }
  }, [userId, buildAuthHeaders]);

  // Fetch goals data
  const fetchGoals = React.useCallback(async () => {
    setGoalsLoading(true);
    try {
      const headers = await buildAuthHeaders({ accept: 'application/json' });
      const response = await fetch(`/api/v1/users/goals?userId=${encodeURIComponent(userId)}`, { headers });
      const data = await response.json();
      if (data.goals) {
        setGoals(data.goals);
      }
    } catch (error) {
      console.error('Failed to fetch goals:', error);
    } finally {
      setGoalsLoading(false);
    }
  }, [userId, buildAuthHeaders]);

  // Fetch profile and goals on mount and when userId changes
  React.useEffect(() => {
    if (userId && userId !== "anonymous") {
      fetchProfile();
      fetchGoals();
    }
  }, [userId, fetchProfile, fetchGoals]);

  // Skills: fetch all active + tracked
  const fetchSkills = React.useCallback(async () => {
    setSkillsLoading(true);
    setSkillsError('');
    try {
      const headers = await buildAuthHeaders({ accept: 'application/json' });
      // Fetch tracked
      const resTracked = await fetch('/api/v1/skills/tracked', { method: 'GET', headers, cache: 'no-store' });
      const trackedJson = await resTracked.json().catch(() => ({}));
      const trackedArr = Array.isArray(trackedJson?.tracked) ? trackedJson.tracked : [];
      const trackedMapped = trackedArr.map((r: any) => ({ skillId: String(r?.skillId || r?.skill?.id || ''), title: String(r?.skill?.title || r?.title || ''), currentLevel: Number(r?.currentLevel ?? r?.level ?? 0) }));
      setTrackedSkillsDash(trackedMapped);
      // Fetch all skills
      const resAll = await fetch('/api/v1/skills', { method: 'GET', headers, cache: 'no-store' });
      const allJson = await resAll.json().catch(() => ({}));
      const skills = Array.isArray(allJson?.skills) ? allJson.skills : [];
      const allMapped = skills.map((s: any) => ({ id: String(s?.id || ''), title: String(s?.title || ''), category: typeof s?.category === 'string' ? s.category : undefined }));
      setAllSkillsDash(allMapped);
    } catch (e) {
      setSkillsError(e instanceof Error ? e.message : String(e));
    } finally {
      setSkillsLoading(false);
    }
  }, [buildAuthHeaders]);

  // Track a skill (max 2 enforced server-side)
  const trackSkill = React.useCallback(async (skillId: string) => {
    try {
      const headers = await buildAuthHeaders({ 'content-type': 'application/json' });
      const res = await fetch('/api/v1/skills/track', { method: 'POST', headers, body: JSON.stringify({ skillId }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || `track failed: ${res.status}`);
      await fetchSkills();
    } catch (e) {
      setSkillsError(e instanceof Error ? e.message : String(e));
    }
  }, [buildAuthHeaders, fetchSkills]);

  // Untrack a skill
  const untrackSkill = React.useCallback(async (skillId: string) => {
    try {
      const headers = await buildAuthHeaders({ 'content-type': 'application/json' });
      const res = await fetch('/api/v1/skills/untrack', { method: 'POST', headers, body: JSON.stringify({ skillId }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || `untrack failed: ${res.status}`);
      await fetchSkills();
    } catch (e) {
      setSkillsError(e instanceof Error ? e.message : String(e));
    }
  }, [buildAuthHeaders, fetchSkills]);



  // Add new goal
  const addGoal = React.useCallback(async (title: string, description?: string) => {
    if (!title.trim()) return;
    try {
      const goalId = `goal_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      const headers = await buildAuthHeaders({ 'Content-Type': 'application/json' });
      const response = await fetch('/api/v1/users/goals', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          userId,
          goalId,
          title: title.trim(),
          description: description?.trim() || undefined,
          status: 'active',
          tags: []
        })
      });
      if (response.ok) {
        await fetchGoals();
        setNewGoalTitle('');
        setNewGoalDescription('');
        setAddingGoal(false);
      }
    } catch (error) {
      console.error('Failed to add goal:', error);
    }
  }, [userId, fetchGoals, buildAuthHeaders]);

  // Update goal
  const updateGoal = React.useCallback(async (goalId: string, updates: Partial<{ goalId: string; title: string; description?: string; status?: string; targetDateMs?: number }>) => {
    try {
      const headers = await buildAuthHeaders({ 'Content-Type': 'application/json' });
      const response = await fetch('/api/v1/users/goals', {
        method: 'PATCH',
        headers,
        body: JSON.stringify({
          userId,
          goalId,
          ...updates
        })
      });
      if (response.ok) {
        await fetchGoals();
        setEditingGoal(null);
      }
    } catch (error) {
      console.error('Failed to update goal:', error);
    }
  }, [userId, fetchGoals, buildAuthHeaders]);

  // Delete goal
  const deleteGoal = React.useCallback(async (goalId: string) => {
    try {
      const headers = await buildAuthHeaders();
      const response = await fetch(`/api/v1/users/goals?userId=${encodeURIComponent(userId)}&goalId=${encodeURIComponent(goalId)}`, { method: 'DELETE', headers });
      if (response.ok) {
        await fetchGoals();
      }
    } catch (error) {
      console.error('Failed to delete goal:', error);
    }
  }, [userId, fetchGoals, buildAuthHeaders]);

  // Update profile
  const updateProfile = React.useCallback(async (displayName: string, bio: string) => {
    try {
      const headers = await buildAuthHeaders({ 'Content-Type': 'application/json' });
      const response = await fetch('/api/v1/users/profile', {
        method: 'PUT',
        headers,
        body: JSON.stringify({
          userId,
          displayName: displayName.trim() || undefined,
          bio: bio.trim() || undefined
        })
      });
      if (response.ok) {
        await fetchProfile();
        setEditingProfile(false);
        setProfileDisplayName('');
        setProfileBio('');
      }
    } catch (error) {
      console.error('Failed to update profile:', error);
    }
  }, [userId, fetchProfile, buildAuthHeaders]);

  // Manual chat function - skips STT and calls chatToTextStreaming directly
  // Ensure/rotate session and return effectiveSessionId
  const ensureEffectiveSessionId = React.useCallback(async (): Promise<string | null> => {
    try {
      if (!sessionId) return null;
      const headers = await buildAuthHeaders({ 'content-type': 'application/json' });
      const res = await fetch('/api/v1/sessions/state', {
        method: 'POST',
        headers,
        body: JSON.stringify({ userId: user?.id || 'anonymous', sessionId })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        console.debug('[ManualChat] ensureSession failed', res.status, data?.error || data);
        return sessionId;
      }
      const eff = typeof data?.effectiveSessionId === 'string' && data.effectiveSessionId.trim() ? data.effectiveSessionId : sessionId;
      console.debug('[ManualChat] ensureSession ok', { effectiveSessionId: eff, rotated: Boolean(data?.rotated) });
      return eff;
    } catch (e) {
      console.debug('[ManualChat] ensureSession error', e);
      return sessionId || null;
    }
  }, [sessionId, user?.id, buildAuthHeaders]);

  const sendManualChat = React.useCallback(async () => {
    console.log('[ManualChat] FUNCTION CALLED - sendManualChat started');
    if (!manualChatInput.trim() || manualChatStatus !== "idle") {
      console.log('[ManualChat] EARLY RETURN - input empty or status not idle');
      return;
    }

    const inputText = manualChatInput.trim();
    console.log('[ManualChat] Starting manual chat with input:', inputText);
    console.log('[ManualChat] Mic context available:', !!mic);
    console.log('[ManualChat] Mic setTranscript available:', typeof mic.setTranscript);
    console.log('[ManualChat] Mic setAssistantText available:', typeof mic.setAssistantText);
    console.log('[ManualChat] Mic setStatus available:', typeof mic.setStatus);
    
    // Seed prompt preview locally so the debug panel is not empty
    try {
      const systemText = typeof (fresh as any)?.text === 'string' ? String((fresh as any).text) : '';
      console.log('[LLM_DEBUG] Seeding prompt preview from manual chat', { sysLen: systemText.length, promptLen: inputText.length });
      setPromptPreview({
        system: systemText,
        summary: undefined as any,
        summaryLen: undefined as any,
        recentMessages: undefined as any,
        prompt: inputText,
        createdAt: Date.now(),
      });
    } catch (error) {
      console.log('[ManualChat] Error setting prompt preview:', error);
    }
    
    setManualChatInput("");
    setManualChatStatus("chat");
    setManualChatResponse("");

    // Update mic context to show the user input in debug panel
    console.log('[ManualChat] Setting mic.transcript to:', inputText);
    mic.setTranscript(inputText);
    console.log('[ManualChat] Setting mic.status to: chat');
    mic.setStatus("chat");

    try {
      // Use the same chat options as voice chat
      const chatOptions = {
        userProfile: profile || undefined,
        userGoals: goals,
        customSystemPrompt: isSystemPromptEnabled && customSystemPrompt.trim() ? customSystemPrompt.trim() : undefined,
        model: selectedModel && selectedModel.trim() ? selectedModel.trim() : undefined,
        onModelUsed: (model: string) => {
          // Update the model if it differs from current selection
          if (model && model !== selectedModel) {
            console.log(`[ManualChat] Model updated from ${selectedModel} to ${model}`);
            setSelectedModel(model);
            try { localStorage.setItem("chat:model", model); } catch {}
          }
        }
      };

      // Call chatToTextStreaming with history
      console.log('[ManualChat] Starting chat request:', inputText);
      // Persist manual user interaction to Convex before streaming
      try {
        const effSid = await ensureEffectiveSessionId();
        if (effSid && inputText) {
          const now = Date.now();
          const reqId = Math.random().toString(36).slice(2);
          const payload = { sessionId: effSid, messageId: `ui_${now}`, role: 'user', contentHash: `${now}_${inputText.length}`, text: inputText, ts: now };
          const headers = await buildAuthHeaders({ 'content-type': 'application/json', 'x-request-id': reqId });
          const res = await fetch('/api/v1/interactions', {
            method: 'POST',
            headers,
            body: JSON.stringify(payload),
          }).catch(() => null);
          try { console.debug('[ManualChat] persist user status', res?.status); } catch {}
          // Because triage runs asynchronously on user ingest, schedule a short debug refresh
          try {
            setTimeout(() => {
              try { console.log('[TRIAGE_DEBUG] scheduling triage list refresh after user ingest'); } catch {}
              void refreshTriageList();
            }, 1500);
          } catch {}
        }
      } catch (e) { console.debug('[ManualChat] persist user failed', e); }

      const reply = await convo.chatToTextStreaming(inputText, (chunk) => {
        console.log('[ManualChat] Received chunk:', chunk);
      }, chatOptions);
      console.log('[ManualChat] Chat response:', reply);

      // Persist assistant interaction after streaming completes
      try {
        const replyText = (reply || '').trim();
        const effSid2 = await ensureEffectiveSessionId();
        if (effSid2 && replyText) {
          const now2 = Date.now();
          const reqId2 = Math.random().toString(36).slice(2);
          const payload2 = { sessionId: effSid2, messageId: `ai_${now2}`, role: 'assistant', contentHash: `${now2}_${replyText.length}`, text: replyText, ts: now2 };
          const headers2 = await buildAuthHeaders({ 'content-type': 'application/json', 'x-request-id': reqId2 });
          const res2 = await fetch('/api/v1/interactions', {
            method: 'POST',
            headers: headers2,
            body: JSON.stringify(payload2),
          }).catch(() => null);
          try { console.debug('[ManualChat] persist assistant status', res2?.status); } catch {}
        }
      } catch (e) { console.debug('[ManualChat] persist assistant failed', e); }

      if (!reply || reply.trim().length === 0) {
        throw new Error('Empty response from chat API');
      }

      // Update mic context to show the assistant response in debug panel
      console.log('[ManualChat] Setting mic.assistantText to:', reply);
      mic.setAssistantText(reply);
      console.log('[ManualChat] Setting mic.status to: tts');
      mic.setStatus("tts");

      setManualChatResponse(reply);
      setManualChatStatus("tts");

      // Start TTS playback
      try {
        console.log('[ManualChat] Starting TTS for reply:', reply);
        voice.cancelTTS?.();
        await voice.enqueueTTSSegment(reply);
        console.log('[ManualChat] TTS completed');
        setManualChatStatus("playback");
        mic.setStatus("playback");
      } catch (ttsError) {
        console.error('[ManualChat] TTS failed:', ttsError);
        setManualChatStatus("idle");
        mic.setStatus("idle");
      }

      // Record this turn into the conversation history
      try {
        if (typeof convo.recordTurn === 'function') {
          convo.recordTurn(inputText, reply);
        }
      } catch (recordError) {
        console.warn('[ManualChat] Failed to record turn:', recordError);
      }

    } catch (error) {
      console.error('[ManualChat] Chat failed:', error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      setManualChatResponse(`Error: ${errorMessage}`);
      setManualChatStatus("idle");
      mic.setStatus("idle");
    }
  }, [manualChatInput, manualChatStatus, profile, goals, isSystemPromptEnabled, customSystemPrompt, selectedModel, convo, voice, mic]);

  // Dashboard animation logic (similar to coach page)
  React.useEffect(() => {
    const EXIT_MS = 1600; // longest child duration + delays buffer
    if (showDashboard) {
      // Cancel pending unmount if any
      if (dashUnmountTimer.current) {
        window.clearTimeout(dashUnmountTimer.current);
        dashUnmountTimer.current = null;
      }
      setDashAnim(true);
      // Fetch data when dashboard opens
      fetchProfile();
      fetchGoals();
      fetchSkills();
    } else {
      setDashAnim(false);
      // After animation completes, unmount dashboard
      dashUnmountTimer.current = window.setTimeout(() => {
        // Could add cleanup here if needed
      }, EXIT_MS);
    }
  }, [showDashboard, fetchProfile, fetchGoals]);

  return (
    <div className="min-h-screen p-4">
      {audio.needsAudioUnlock ? (
        <div className="mb-3 p-2 rounded border bg-yellow-50 text-yellow-900 text-sm flex items-center justify-between">
          <span>Audio is blocked by the browser. Click to enable sound.</span>
          <button type="button" onClick={() => audio.unlockAudio()} className="ml-3 px-2 py-1 rounded border">Enable sound</button>
        </div>
      ) : null}

      {/* Home/Dashboard toggle button */}
      {!showDashboard && (
        <button
          type="button"
          onClick={() => setShowDashboard(true)}
          className="fixed top-4 left-1/2 transform -translate-x-1/2 p-3 rounded-full bg-white border border-gray-300 shadow-sm hover:bg-gray-50 transition-colors z-40"
          title="Open dashboard"
        >
          <svg viewBox="0 0 24 24" className="w-5 h-5 text-gray-700" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
            <polyline points="9,22 9,12 15,12 15,22"/>
          </svg>
        </button>
      )}



      {/* Dashboard Content */}
      {showDashboard && (
        <div className="px-6 pt-10 pb-32">
          {/* Dashboard header */}
          <div className="max-w-md mx-auto mb-6">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-semibold">Dashboard</h2>
            </div>
          </div>

          {/* Real dashboard sections */}
          <div className="max-w-md mx-auto space-y-6">
            {/* Profile Section */}
            <section
              className="transform-gpu will-change-transform transition-all duration-[600ms] ease-out"
              style={{
                opacity: dashAnim ? 1 : 0,
                transform: dashAnim ? "translateY(0)" : "translateY(-120vh)"
              }}
            >
              <div className="rounded-2xl border-2 border-gray-300 bg-white p-4 shadow-sm">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-lg font-semibold">Profile</h3>
                  {profile && !editingProfile && (
                    <button
                      onClick={() => {
                        setEditingProfile(true);
                        setProfileDisplayName(profile.displayName || '');
                        setProfileBio(profile.bio || '');
                      }}
                      className="p-1 text-gray-600 hover:text-blue-600"
                      title="Edit profile"
                    >
                      ✏️
                    </button>
                  )}
                </div>
                {profileLoading ? (
                  <div className="text-center py-4">
                    <div className="animate-pulse text-gray-500">Loading profile...</div>
                  </div>
                ) : editingProfile ? (
                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Display Name</label>
                      <input
                        type="text"
                        value={profileDisplayName}
                        onChange={(e) => setProfileDisplayName(e.target.value)}
                        placeholder="Enter your display name..."
                        className="w-full px-3 py-2 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Bio</label>
                      <textarea
                        value={profileBio}
                        onChange={(e) => setProfileBio(e.target.value)}
                        placeholder="Tell us about yourself..."
                        rows={3}
                        className="w-full px-3 py-2 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                      />
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => updateProfile(profileDisplayName, profileBio)}
                        className="px-4 py-2 bg-green-600 text-white rounded text-sm hover:bg-green-700"
                      >
                        Save
                      </button>
                      <button
                        onClick={() => {
                          setEditingProfile(false);
                          setProfileDisplayName('');
                          setProfileBio('');
                        }}
                        className="px-4 py-2 bg-gray-600 text-white rounded text-sm hover:bg-gray-700"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : profile ? (
                  <div className="space-y-3">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Display Name</label>
                      <div className="text-lg font-semibold text-gray-900">{profile.displayName || 'No display name set'}</div>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Bio</label>
                      <div className="text-sm text-gray-600 whitespace-pre-wrap">{profile.bio || 'No bio set'}</div>
                    </div>
                  </div>
                ) : (
                  <div className="text-center py-4 text-gray-500">
                    No profile data available
                    <button
                      onClick={() => {
                        setEditingProfile(true);
                        setProfileDisplayName('');
                        setProfileBio('');
                      }}
                      className="block mx-auto mt-2 px-4 py-2 bg-blue-600 text-white rounded text-sm hover:bg-blue-700"
                    >
                      Create Profile
                    </button>
                  </div>
                )}
              </div>
            </section>

            {/* Skills Section */}
            <section
              className="transform-gpu will-change-transform transition-all duration-[700ms] ease-out"
              style={{
                opacity: dashAnim ? 1 : 0,
                transform: dashAnim ? "translateY(0)" : "translateY(-120vh)",
                transitionDelay: dashAnim ? "60ms" : "0ms"
              }}
            >
              <div className="rounded-2xl border-2 border-gray-300 bg-white p-4 shadow-sm">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-lg font-semibold">Skills</h3>
                  <button
                    type="button"
                    onClick={() => fetchSkills()}
                    className="px-2 py-1 text-xs border border-gray-300 rounded text-gray-700 hover:bg-gray-50"
                  >
                    Refresh
                  </button>
                </div>
                {skillsLoading ? (
                  <div className="text-center py-4 text-gray-500">Loading skills…</div>
                ) : skillsError ? (
                  <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded p-2">{skillsError}</div>
                ) : (
                  <div className="space-y-4">
                    {/* Tracked */}
                    <div>
                      <div className="text-sm font-medium text-gray-800 mb-2">Tracked ({trackedSkillsDash.length}/2)</div>
                      {trackedSkillsDash.length === 0 ? (
                        <div className="text-sm text-gray-500">No tracked skills yet.</div>
                      ) : (
                        <div className="space-y-2">
                          {trackedSkillsDash.map((t) => (
                            <div key={t.skillId} className="flex items-center justify-between border border-gray-200 rounded p-2 bg-gray-50">
                              <div className="text-sm text-gray-800">
                                {t.title || t.skillId}
                                <span className="ml-2 text-xs text-gray-500">Lv {Number.isFinite(Number(t.currentLevel)) ? t.currentLevel : '-'}</span>
                              </div>
                              <button
                                type="button"
                                onClick={() => untrackSkill(t.skillId)}
                                className="px-2 py-1 text-xs border border-gray-300 rounded text-gray-700 hover:bg-white"
                              >
                                Untrack
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                    {/* Available */}
                    <div>
                      <div className="text-sm font-medium text-gray-800 mb-2">Available</div>
                      {(() => {
                        const trackedIds = new Set(trackedSkillsDash.map((t) => t.skillId));
                        const untracked = allSkillsDash.filter((s) => s.id && !trackedIds.has(s.id));
                        if (untracked.length === 0) return <div className="text-sm text-gray-500">No more available skills.</div>;
                        const reachedMax = trackedSkillsDash.length >= 2;
                        return (
                          <div className="space-y-2">
                            {untracked.slice(0, 20).map((s) => (
                              <div key={s.id} className="flex items-center justify-between border border-gray-200 rounded p-2">
                                <div className="text-sm text-gray-800">
                                  {s.title || s.id}
                                  {s.category ? <span className="ml-2 text-xs text-gray-500">{s.category}</span> : null}
                                </div>
                                <button
                                  type="button"
                                  disabled={reachedMax}
                                  onClick={() => trackSkill(s.id)}
                                  className={`px-2 py-1 text-xs border border-gray-300 rounded ${reachedMax ? 'text-gray-400 bg-gray-50 cursor-not-allowed' : 'text-gray-700 hover:bg-white'}`}
                                  title={reachedMax ? 'Maximum of 2 tracked skills reached' : 'Track'}
                                >
                                  Track
                                </button>
                              </div>
                            ))}
                            {untracked.length > 20 ? (
                              <div className="text-xs text-gray-500">Showing first 20. Use /skills for full list.</div>
                            ) : null}
                          </div>
                        );
                      })()}
                    </div>
                  </div>
                )}
              </div>
            </section>

            {/* Goals Section */}
            <section
              className="transform-gpu will-change-transform transition-all duration-[700ms] ease-out"
              style={{
                opacity: dashAnim ? 1 : 0,
                transform: dashAnim ? "translateY(0)" : "translateY(-120vh)",
                transitionDelay: dashAnim ? "100ms" : "0ms"
              }}
            >
              <div className="rounded-2xl border-2 border-gray-300 bg-white p-4 shadow-sm">
                <h3 className="text-lg font-semibold mb-3">Goals</h3>

                {/* Goals list */}
                {goalsLoading ? (
                  <div className="text-center py-4">
                    <div className="animate-pulse text-gray-500">Loading goals...</div>
                  </div>
                ) : goals.length === 0 ? (
                  <div className="text-center py-8 text-gray-500">
                    No goals yet. Add your first goal above!
                  </div>
                ) : (
                  <div className="space-y-3">
                    {goals.map((goal) => (
                      <div key={goal.goalId} className="border border-gray-200 rounded-lg p-3 bg-gray-50">
                        {editingGoal?.goalId === goal.goalId ? (
                          <div className="space-y-3">
                            <div>
                              <label className="block text-xs font-medium text-gray-700 mb-1">Title</label>
                              <input
                                type="text"
                                value={editingGoal.title}
                                onChange={(e) => setEditingGoal({ ...editingGoal, title: e.target.value })}
                                className="w-full px-2 py-1 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                              />
                            </div>
                            <div>
                              <label className="block text-xs font-medium text-gray-700 mb-1">Description</label>
                              <textarea
                                value={editingGoal.description || ''}
                                onChange={(e) => setEditingGoal({ ...editingGoal, description: e.target.value })}
                                rows={2}
                                className="w-full px-2 py-1 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                              />
                            </div>
                            <div className="flex gap-2">
                              <button
                                onClick={() => updateGoal(goal.goalId, {
                                  title: editingGoal.title,
                                  description: editingGoal.description || undefined
                                })}
                                className="px-3 py-1 bg-green-600 text-white rounded text-sm hover:bg-green-700"
                              >
                                Save
                              </button>
                              <button
                                onClick={() => setEditingGoal(null)}
                                className="px-3 py-1 bg-gray-600 text-white rounded text-sm hover:bg-gray-700"
                              >
                                Cancel
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div className="flex items-start justify-between">
                            <div className="flex-1">
                              <div className="font-medium text-gray-900">{goal.title}</div>
                              {goal.description && (
                                <div className="text-sm text-gray-600 mt-1">{goal.description}</div>
                              )}
                              <div className="text-xs text-gray-600 mt-2">
                                Status: <span className={`px-2 py-0.5 rounded text-xs ${
                                  goal.status === 'active' ? 'bg-green-100 text-green-800' :
                                  goal.status === 'completed' ? 'bg-blue-100 text-blue-800' :
                                  'bg-gray-100 text-gray-800'
                                }`}>
                                  {goal.status}
                                </span>
                                {goal.targetDateMs && (
                                  <span className="ml-2">
                                    Due: {new Date(goal.targetDateMs).toLocaleDateString()}
                                  </span>
                                )}
                              </div>
                            </div>
                            <div className="flex gap-1 ml-2">
                              <button
                                onClick={() => setEditingGoal({
                                  goalId: goal.goalId,
                                  title: goal.title,
                                  description: goal.description || ''
                                })}
                                className="p-1 text-gray-600 hover:text-blue-600"
                                title="Edit goal"
                              >
                                ✏️
                              </button>
                              <button
                                onClick={() => deleteGoal(goal.goalId)}
                                className="p-1 text-gray-600 hover:text-red-600"
                                title="Delete goal"
                              >
                                🗑️
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {/* Add new goal - only show if less than 2 goals */}
                {goals.length < 2 && (
                  <div className="mt-4 pt-4 border-t border-gray-200">
                    {addingGoal ? (
                      <div className="space-y-3">
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">Title</label>
                          <input
                            type="text"
                            value={newGoalTitle}
                            onChange={(e) => setNewGoalTitle(e.target.value)}
                            placeholder="Enter goal title..."
                            className="w-full px-3 py-2 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
                          <textarea
                            value={newGoalDescription}
                            onChange={(e) => setNewGoalDescription(e.target.value)}
                            placeholder="Describe your goal (optional)..."
                            rows={2}
                            className="w-full px-3 py-2 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                          />
                        </div>
        <div className="flex gap-2">
                          <button
                            onClick={() => addGoal(newGoalTitle, newGoalDescription)}
                            disabled={!newGoalTitle.trim()}
                            className="px-4 py-2 bg-blue-600 text-white rounded text-sm hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            Add Goal
                          </button>
                          <button
                            onClick={() => {
                              setAddingGoal(false);
                              setNewGoalTitle('');
                              setNewGoalDescription('');
                            }}
                            className="px-4 py-2 bg-gray-600 text-white rounded text-sm hover:bg-gray-700"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button
                        onClick={() => setAddingGoal(true)}
                        className="w-full px-4 py-3 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors"
                      >
                        + Add New Goal
                      </button>
                    )}
                  </div>
                )}

                {/* Show limit message when 2 goals reached */}
                {goals.length >= 2 && (
                  <div className="mt-4 pt-4 border-t border-gray-200">
                    <div className="text-center text-sm text-gray-600">
                      You&apos;ve reached the maximum of 2 goals. Complete or delete existing goals to add more.
                    </div>
                  </div>
                )}
              </div>
            </section>


          </div>
        </div>
      )}

      {/* Collapsible Debug Panel */}
      <div className="fixed top-4 right-4 z-40">
        {/* Collapsed Button */}
        <div className={`transition-all duration-300 ease-in-out ${
          panelCollapsed ? 'opacity-100 scale-100' : 'opacity-0 scale-75 pointer-events-none'
        }`}>
          <button
            type="button"
            onClick={() => setPanelCollapsed(false)}
            className="px-3 py-2 text-xs font-mono bg-white text-black border border-gray-300 rounded-md hover:bg-gray-50 transition-colors"
          >
⚙️
          </button>
        </div>

        {/* Expanded Panel */}
        <div className={`transition-all duration-300 ease-in-out ${
          panelCollapsed
            ? 'opacity-0 scale-75 pointer-events-none w-0 h-0 overflow-hidden'
            : 'opacity-100 scale-100 w-96 max-w-[calc(100vw-2rem)] h-[80vh] max-h-[600px]'
        }`}>
          <div className="bg-white border border-gray-300 rounded-md shadow-lg w-full h-full flex flex-col overflow-hidden">
            {/* Panel Header */}
            <div className="flex items-center justify-between p-4 border-b border-gray-200 flex-shrink-0">
              <h2 className="text-lg font-medium font-mono text-black">
                [DEBUG PANEL]
              </h2>
              <button
                type="button"
                onClick={() => setPanelCollapsed(true)}
                className="px-2 py-1 text-sm border border-gray-300 rounded font-mono text-gray-700 hover:bg-gray-50"
              >
                -
              </button>
            </div>

            {/* Tab Navigation */}
            <div className="border-b border-gray-200 flex-shrink-0 overflow-x-auto scrollbar-thin scrollbar-thumb-gray-300 scrollbar-track-transparent">
              <div className="flex min-w-max">
                <button
                  type="button"
                  onClick={() => setActiveTab('status')}
                  className={`px-4 py-2 text-sm font-mono border-b-2 transition-colors whitespace-nowrap ${
                    activeTab === 'status'
                      ? 'border-blue-500 text-blue-600'
                      : 'border-transparent text-gray-500 hover:text-gray-700'
                  }`}
                >
                  CHAT
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab('summary')}
                  className={`px-4 py-2 text-sm font-mono border-b-2 transition-colors whitespace-nowrap ${
                    activeTab === 'summary'
                      ? 'border-blue-500 text-blue-600'
                      : 'border-transparent text-gray-500 hover:text-gray-700'
                  }`}
                >
                  SUMMARY
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab('session')}
                  className={`px-4 py-2 text-sm font-mono border-b-2 transition-colors whitespace-nowrap ${
                    activeTab === 'session'
                      ? 'border-blue-500 text-blue-600'
                      : 'border-transparent text-gray-500 hover:text-gray-700'
                  }`}
                >
                  SESSION
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab('triage')}
                  className={`px-4 py-2 text-sm font-mono border-b-2 transition-colors whitespace-nowrap ${
                    activeTab === 'triage'
                      ? 'border-blue-500 text-blue-600'
                      : 'border-transparent text-gray-500 hover:text-gray-700'
                  }`}
                >
                  TRIAGE
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab('assess')}
                  className={`px-4 py-2 text-sm font-mono border-b-2 transition-colors whitespace-nowrap ${
                    activeTab === 'assess'
                      ? 'border-blue-500 text-blue-600'
                      : 'border-transparent text-gray-500 hover:text-gray-700'
                  }`}
                >
                  ASSESS
                </button>
              </div>
            </div>

            {/* Tab Content */}
            <div className="p-4 bg-white text-black font-mono text-sm overflow-auto flex-1">
              {activeTab === 'status' && (
              <div className="space-y-3">
                {/* Test Controls Section */}
                <div className="border border-gray-200 rounded p-3 bg-gray-50 mb-4">
                  <div className="text-sm font-mono text-blue-600 font-semibold mb-2">[TEST_CONTROLS]</div>
                  <div className="flex gap-2 flex-wrap">
                    <button type="button" onClick={() => mic.startRecording()} disabled={mic.vadLoop} className={`px-3 py-1.5 rounded border border-gray-300 text-gray-700 hover:bg-gray-50 ${mic.vadLoop ? 'opacity-50 cursor-not-allowed' : ''}`}>[TAP_TO_SPEAK]</button>
                    <button type="button" onClick={() => mic.stopRecording()} disabled={mic.vadLoop} className={`px-3 py-1.5 rounded border border-gray-300 text-gray-700 hover:bg-gray-50 ${mic.vadLoop ? 'opacity-50 cursor-not-allowed' : ''}`}>[STOP]</button>
                    <button type="button" onClick={() => mic.toggleVadLoop()} className={`px-3 py-1.5 rounded border border-gray-300 text-gray-700 hover:bg-gray-50`}>[VAD_LOOP]: {mic.vadLoop ? 'ON' : 'OFF'}</button>
                    <button type="button" onClick={() => (audio.isPaused ? audio.resume() : audio.pause())} className={`px-3 py-1.5 rounded border border-gray-300 text-gray-700 hover:bg-gray-50`}>[{audio.isPaused ? 'RESUME' : 'PAUSE'}_PLAYBACK]</button>
                    <button
                      type="button"
                      onClick={async () => {
                        if (!sessionId) { setIngestTestStatus('no sessionId'); return; }
                        try {
                          const now = Date.now();
                          const reqId = Math.random().toString(36).slice(2);
                          const body = { sessionId, messageId: `test_${now}`, role: 'user', contentHash: 'test', text: 'ping', ts: now };
                          const res = await fetchWithRetry('/api/v1/interactions', { method: 'POST', headers: { 'content-type': 'application/json', 'x-request-id': reqId }, body: JSON.stringify(body) }, { maxAttempts: 3, endpoint: 'interactions' });
                          const data = await res.json().catch(() => ({}));
                          setIngestTestStatus(res.ok ? `ok id=${String(data?.id || '')}` : `err ${res.status}: ${String(data?.error || '')}`);
                        } catch (e) { setIngestTestStatus(e instanceof Error ? e.message : String(e)); }
                      }}
                      className={`px-3 py-1.5 rounded border border-gray-300 text-gray-700 hover:bg-gray-50`}
                    >[TEST_INGEST]</button>
                  </div>
                  <div className="text-xs text-gray-500 mt-2">
                    Status: {ingestTestStatus || 'ready'}
                  </div>
                </div>

                <div><span className="text-blue-600 font-semibold">&gt; USER:</span> {mic.transcript || <span className="text-gray-500">(none)</span>}</div>
                  <div><span className="text-blue-600 font-semibold">&gt; ASSISTANT:</span> {mic.assistantText || <span className="text-gray-500">(none)</span>}</div>
                  <div className="text-xs text-gray-600">status={mic.status} | loop={String(mic.vadLoop)} | recording={String(mic.recording)} | playing={String(audio.isPlaybackActive)}</div>

                  {/* Interactions Cache (debug) */}
                  <div className="border border-gray-200 rounded p-2 bg-gray-50">
                    <div className="text-xs font-mono text-blue-600 font-semibold mb-1">[INTERACTIONS_CACHE]</div>
                    {(() => {
                      const c: any = convo;
                      let status: any = {};
                      try { status = c.getCacheStatus ? c.getCacheStatus() : {}; } catch {}
                      const sinceModeActive = status.sinceModeActive ?? c.sinceModeActive ?? false;
                      const lastFetchWasIncremental = status.lastFetchWasIncremental ?? c.lastFetchWasIncremental ?? false;
                      const lastFetchWas304 = status.lastFetchWas304 ?? c.lastFetchWas304 ?? false;
                      const latestId = status.latestId ?? c.latestId ?? null;
                      const cacheSize = status.cacheSize ?? c.interactionsCount ?? undefined;
                      const lastEtag = status.lastEtag ?? c.lastEtag ?? null;
                      const isLoading = status.isLoading ?? c.isInteractionsLoading ?? false;
                      // Prefetch and cache freshness indicators
                      const lastPrefetchAt = status.lastPrefetchAt ?? c.lastPrefetchAt ?? null;
                      const lastInteractionsRefreshAt = status.lastInteractionsRefreshAt ?? c.lastInteractionsRefreshAt ?? null;
                      const lastSummaryStatusRefreshAt = status.lastSummaryStatusRefreshAt ?? c.lastSummaryStatusRefreshAt ?? null;
                      const fmt = (ts: number | null) => ts ? new Date(ts).toLocaleTimeString() : '-';
                      const age = (ts: number | null) => ts ? Math.max(0, Math.floor((Date.now() - ts)/1000)) + 's' : '-';
                      return (
                        <div className="grid grid-cols-2 gap-1 text-[11px] text-gray-700">
                          <div>sinceModeActive: <span className="font-semibold">{String(sinceModeActive)}</span></div>
                          <div>lastIncr: <span className="font-semibold">{String(lastFetchWasIncremental)}</span></div>
                          <div>last304: <span className="font-semibold">{String(lastFetchWas304)}</span></div>
                          <div>latestId: <span className="font-semibold">{latestId ? String(latestId) : 'null'}</span></div>
                          <div>cacheSize: <span className="font-semibold">{typeof cacheSize === 'number' ? cacheSize : '-'}</span></div>
                          <div>etag: <span className="font-semibold">{lastEtag ? String(lastEtag) : 'null'}</span></div>
                          <div>loading: <span className="font-semibold">{String(isLoading)}</span></div>
                          <div className="col-span-2 mt-1 border-t border-gray-200"></div>
                          <div>lastPrefetchAt: <span className="font-semibold">{fmt(lastPrefetchAt)}</span> <span className="text-gray-500">({age(lastPrefetchAt)})</span></div>
                          <div>lastInteractionsRefresh: <span className="font-semibold">{fmt(lastInteractionsRefreshAt)}</span> <span className="text-gray-500">({age(lastInteractionsRefreshAt)})</span></div>
                          <div>lastSummaryStatusRefresh: <span className="font-semibold">{fmt(lastSummaryStatusRefreshAt)}</span> <span className="text-gray-500">({age(lastSummaryStatusRefreshAt)})</span></div>
                        </div>
                      );
                    })()}
                  </div>

                  {/* Manual Chat Section */}
                  <div className="border border-gray-200 rounded p-3 bg-gray-50 mb-3">
                    <div className="text-sm font-mono text-blue-600 font-semibold mb-2">[MANUAL_CHAT]</div>
                    <div className="space-y-2">
                      <div className="flex gap-2">
                        <input
                          type="text"
                          value={manualChatInput}
                          onChange={(e) => setManualChatInput(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && !e.shiftKey) {
                              e.preventDefault();
                              sendManualChat();
                            }
                          }}
                          placeholder="Type your message here..."
                          disabled={manualChatStatus !== "idle"}
                          className="flex-1 px-2 py-1 border border-gray-300 rounded text-xs font-mono bg-white disabled:bg-gray-100 disabled:text-gray-500"
                        />
                        <button
                          type="button"
                          onClick={sendManualChat}
                          disabled={!manualChatInput.trim() || manualChatStatus !== "idle"}
                          className={`px-3 py-1.5 rounded border border-gray-300 text-gray-700 hover:bg-gray-50 font-mono text-xs disabled:opacity-50 disabled:cursor-not-allowed`}
                        >
                          {manualChatStatus === "idle" ? "[SEND]" : 
                           manualChatStatus === "chat" ? "[CHAT...]" :
                           manualChatStatus === "tts" ? "[TTS...]" :
                           "[PLAYBACK...]"}
                        </button>
                      </div>
                      {manualChatResponse && (
                        <div className="text-xs">
                          <div className="text-blue-600 font-semibold mb-1">&gt; MANUAL_RESPONSE:</div>
                          <div className="bg-white border border-gray-200 p-2 rounded text-gray-800 font-mono whitespace-pre-wrap">{manualChatResponse}</div>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Chat Section */}
                  <div className="border border-gray-200 rounded p-3 bg-gray-50 mb-3">
                    <div className="text-sm font-mono text-blue-600 font-semibold mb-2">[LLM_PROMPT_DEBUG]</div>
                    <div className="flex items-center justify-between mb-3 gap-2">
                      <div className="text-xs text-gray-600 font-mono">{promptPreview ? 'STATUS: READY' : 'STATUS: EMPTY'}</div>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => { try { setPromptPreview(convo.getLastPromptPreview()); } catch {} }}
                          className="px-2 py-1 text-xs border border-gray-300 rounded font-mono text-gray-700 hover:bg-gray-50"
                        >[REFRESH]</button>
                        <button
                          type="button"
                          onClick={() => {
                            const sample = {
                              system: String((fresh as any)?.text || ''),
                              prompt: 'SEED: hello prompt preview',
                              createdAt: Date.now(),
                              summary: undefined as any,
                              summaryLen: undefined as any,
                              recentMessages: undefined as any,
                            };
                            try { console.log('[LLM_DEBUG] Manual seed button', { sysLen: (sample.system || '').length, promptLen: (sample.prompt || '').length }); } catch {}
                            setPromptPreview(sample);
                          }}
                          className="px-2 py-1 text-xs border border-gray-300 rounded font-mono text-gray-700 hover:bg-gray-50"
                        >[SEED_TEST]</button>
                      </div>
                    </div>
                    {promptPreview ? (
                      <div className="text-xs space-y-1">
                        <div className="text-blue-600 font-semibold">&gt; FULL_PROMPT_TO_LLM:</div>
                        <pre className="whitespace-pre-wrap bg-gray-50 border border-gray-200 p-3 rounded max-h-56 overflow-auto text-xs text-gray-800 font-mono">{promptPreview.prompt || ''}</pre>
                      </div>
                    ) : (
                      <div className="text-xs text-gray-500">(none)</div>
                    )}

                    {/* Model Selection Section */}
                    <div className="border-t border-gray-200 mt-4 pt-4">
                      <div className="flex items-center justify-between mb-3">
                        <div className="text-sm font-mono text-blue-600 font-semibold">[MODEL_SELECTION]</div>
                      </div>
                      <div className="mb-3">
                        <select
                          value={selectedModel}
                          onChange={(e) => setSelectedModel(e.target.value)}
                          className="w-full p-2 border border-gray-300 rounded text-xs bg-white font-mono"
                        >
                          <option value="google/gemini-2.5-flash-lite">GEMINI-2.5-FLASH-LITE</option>
                          <option value="google/gemini-2.5-flash">GEMINI-2.5-FLASH</option>
                        </select>
                        <div className="text-xs text-gray-600 mt-1">
                          Selected model will be used for chat requests
                        </div>
                      </div>
                    </div>

                    {/* System Prompt Editor Section */}
                    <div className="border-t border-gray-200 mt-4 pt-4">
                      <div className="flex items-center justify-between mb-3">
                        <div className="text-sm font-mono text-blue-600 font-semibold">[SYSTEM_PROMPT_EDITOR]</div>
                        <button
                          type="button"
                          onClick={() => setIsSystemPromptEnabled(!isSystemPromptEnabled)}
                          className={`px-3 py-1.5 rounded border border-gray-300 text-gray-700 hover:bg-gray-50 font-mono text-xs`}
                        >
                          [{isSystemPromptEnabled ? 'ENABLED' : 'DISABLED'}]
                        </button>
                      </div>

                      <div className="text-xs text-gray-600 mb-2 font-mono">
                        {isSystemPromptEnabled ? 'STATUS: CUSTOM PROMPT ACTIVE' : 'STATUS: USING DEFAULT PROMPT'}
                      </div>

                      <div className="space-y-2">
                        <textarea
                          value={customSystemPrompt}
                          onChange={(e) => setCustomSystemPrompt(e.target.value)}
                          placeholder="Enter custom system prompt here..."
                          disabled={!isSystemPromptEnabled}
                          className={`w-full p-2 border rounded text-xs font-mono ${isSystemPromptEnabled ? 'bg-white text-gray-800' : 'bg-gray-50 text-gray-400'}`}
                          rows={6}
                        />

                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              const defaultPrompt = "You are a concise, friendly speech coach. Your purpose is to help users improve speaking skills through short, actionable guidance and practice.\n\nBehavioral rules:\n- Greetings and small talk: reply with 1 short friendly sentence, then immediately pivot to the goal.\n- Default response length: at most 2–3 sentences or 5 short bullets.\n- Ask exactly one question to clarify goals or select the next focus area.\n- When providing guidance, prefer practical, immediately applicable tips.\n- Stay conversational, positive, and time-efficient.";
                              setCustomSystemPrompt(defaultPrompt);
                            }}
                            disabled={!isSystemPromptEnabled}
                            className="px-2 py-1 text-xs border border-gray-300 rounded font-mono text-gray-700 hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            [LOAD_DEFAULT]
                          </button>

                          <button
                            type="button"
                            onClick={() => setCustomSystemPrompt("")}
                            disabled={!isSystemPromptEnabled}
                            className="px-2 py-1 text-xs border border-gray-300 rounded font-mono text-gray-700 hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            [CLEAR]
                          </button>

                          <button
                            type="button"
                            onClick={() => {
                              // Prompt is applied automatically, but this provides confirmation
                            }}
                            disabled={!isSystemPromptEnabled}
                            className="px-3 py-1 text-xs border rounded bg-green-50 border-green-300 text-green-700 hover:bg-green-100 disabled:opacity-50 disabled:cursor-not-allowed font-mono"
                          >
                            [APPLY]
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
        </div>
      )}

      <MicMinButton
        showDashboard={showDashboard}
        onDashboardClick={() => setShowDashboard(false)}
      />

      <AssessmentChip
        sessionId={sessionId || undefined}
        latestInteraction={(() => {
          try {
            const recent = convo.getRecentInteractions(5);
            if (!Array.isArray(recent) || recent.length === 0) return null;

            const latestUserInteraction = recent
              .filter((interaction) => interaction && interaction.role === 'user')
              .sort((a, b) => (b.ts || 0) - (a.ts || 0))[0];

            return latestUserInteraction ? {
              id: latestUserInteraction.messageId || `user_${latestUserInteraction.ts || Date.now()}`,
              text: latestUserInteraction.text || '',
              createdAt: latestUserInteraction.ts || Date.now()
            } : null;
          } catch (error) {
            console.warn('Error getting latest interaction for assessment:', error);
            return null;
          }
        })()}
        // Pass external state for better synchronization
        externalState={assessmentChipState}
        externalExpanded={assessmentChipExpanded}
        externalResult={latestAssessmentResult}
        onStateChange={setAssessmentChipState}
        onExpandedChange={setAssessmentChipExpanded}
        onAssessmentTriggered={() => {
          console.log('Assessment triggered for latest interaction');
          setAssessmentChipState('loading');
          // Start event polling when assessment is triggered
          if (!panelCollapsed && (activeTab === 'triage' || activeTab === 'assess')) {
            startEventPolling();
          }
        }}
        onAssessmentCompleted={(result) => {
          setAssessmentChipState('completed');
          setLatestAssessmentResult(result);
          refreshAssessPanel();
        }}
        onAssessmentError={() => {
          setAssessmentChipState('error');
        }}
      />

    </div>
    </div>
    </div>
    </div>
    </div>
  );
}



export default App;
