"use client";

import React from "react";
import SoftCard from "./SoftCard";
import { useAuth, useUser } from "@clerk/nextjs";
import { MinimalAudioProvider, useMinimalAudio } from "../../context/minimal/MinimalAudioContext";
import { MinimalVoiceProvider, useMinimalVoice } from "../../context/minimal/MinimalVoiceContext";
import { MinimalConversationProvider, useMinimalConversation } from "../../context/minimal/MinimalConversationContext";
import { useMinimalSession } from "../../context/minimal/MinimalSessionContext";
import { MinimalMicProvider, useMinimalMic } from "../../context/minimal/MinimalMicContext";
import { MinimalSessionProvider } from "../../context/minimal/MinimalSessionContext";
import { fetchWithRetry } from "../../app/api/lib/retry";
import MicMinButton from "../../components/MicMinButton";
import { createLogger } from "../../lib/logger";

// Initialize namespaced logger for coach-new page
const logger = createLogger('ui.app.coach-new');

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
  setSelectedModel
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
}) {
  const mic = useMinimalMic();
  const audio = useMinimalAudio();
  const voice = useMinimalVoice();
  const convo = useMinimalConversation();
  const { sessionId, startNewSession } = useMinimalSession();
  const { user } = useUser();
  const { getToken } = useAuth();
  const MOCK_UI = true;

  // Debug: Track mic context changes
  React.useEffect(() => {
    logger.debug("Mic context updated", {
      transcriptLength: mic.transcript?.length,
      assistantTextLength: mic.assistantText?.length,
      status: mic.status,
      recording: mic.recording,
      playing: audio.isPlaybackActive,
      transcriptPreview: mic.transcript?.substring(0, 50),
      assistantTextPreview: mic.assistantText?.substring(0, 50)
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

  // Wireframe dashboard local UI state
  const [wfSkillsOpen, setWfSkillsOpen] = React.useState<boolean>(true);
  const [wfLogOpen, setWfLogOpen] = React.useState<boolean>(true);
  const [wfSession3Open, setWfSession3Open] = React.useState<boolean>(true);
  const [wfShowUntracked, setWfShowUntracked] = React.useState<boolean>(false);

  // Get userId from Clerk authentication
  const userId = user?.id || "anonymous";

  // Fresh panel: independent state that directly calls the API
  const [fresh, setFresh] = React.useState<{ text: string; updatedAt: number; version: number; lastMessageTs?: number; thresholdTurns?: number; turnsSince?: number } | null>(null);
  const [freshStatus, setFreshStatus] = React.useState<"idle" | "loading" | "ready" | "error">("idle");
  const [freshErr, setFreshErr] = React.useState<string | undefined>(undefined);
  const [dbgOpen, setDbgOpen] = React.useState<boolean>(false);
  const [dbgPrompt, setDbgPrompt] = React.useState<{ prevSummary: string; messages: Array<{ role: 'user'|'assistant'; content: string }> } | null>(null);
  const [promptPreview, setPromptPreview] = React.useState<{ system?: string; summary?: any; summaryLen?: any; recentMessages?: any; prompt?: string; createdAt?: number } | null>(null);
  
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
  const [triageUngrouped, setTriageUngrouped] = React.useState<Array<{ id: string; role: string; text?: string; createdAt?: number }>>([]);
  const [triageHasGroups, setTriageHasGroups] = React.useState<boolean>(false);
  const [triageStatus, setTriageStatus] = React.useState<string>("");
  const [triageOpenMap, setTriageOpenMap] = React.useState<Record<string, boolean>>({});

  // ASSESS debug state
  const [assessStatus, setAssessStatus] = React.useState<string>("");
  const [assessEvents, setAssessEvents] = React.useState<Array<{ createdAt?: number; kind?: string; payload?: Record<string, unknown> }>>([]);
  const [assessLatestGroup, setAssessLatestGroup] = React.useState<string | null>(null);
  const [trackedSkills, setTrackedSkills] = React.useState<Array<{ id: string; title?: string; currentLevel?: number }>>([]);
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
      const headers = await buildAuthHeaders({ accept: 'application/json', 'x-request-id': reqId });
      const res = await fetch(`/api/v1/transcripts?sessionId=${encodeURIComponent(sessionId)}&limit=200`, {
        method: 'GET', headers, cache: 'no-store'
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || `transcripts failed: ${res.status}`);
      const items = Array.isArray(data?.items) ? data.items : [];
      
      // Add debug logging to track what we're getting from the API
      logger.debug("Raw data from transcripts API", {
        totalItems: items.length,
        triageStatusCounts: {
          withAssessmentType: items.filter((d: any) => d.assessmentType !== undefined).length,
          withGroupId: items.filter((d: any) => d.groupId).length,
          withTriageProcessedAt: items.filter((d: any) => d.triageProcessedAt).length,
          pending: items.filter((d: any) => d.assessmentType === undefined).length,
        }
      });
      
      // Map to a unified shape
      const mappedAll = items.map((d: { id?: unknown; role?: unknown; text?: unknown; createdAt?: unknown; assessmentType?: unknown; groupId?: unknown; triageProcessedAt?: unknown; groupCount?: unknown }) => ({
        id: String(d?.id || ''),
        role: String(d?.role || ''),
        text: typeof d?.text === 'string' ? d.text : undefined,
        createdAt: typeof d?.createdAt === 'number' ? d.createdAt : undefined,
        assessmentType: d?.assessmentType,
        groupId: d?.groupId,
        triageProcessedAt: typeof d?.triageProcessedAt === 'number' ? d.triageProcessedAt : undefined,
      }));
      
      // Show ALL recent messages (last 20) as ungrouped fallback
      const ungrouped = mappedAll.slice(-20);
      setTriageUngrouped(ungrouped);

      // Filter to items that have assessmentType (triaged items), including "none"
      const mapped = mappedAll.filter((m: any) => m.assessmentType !== undefined);
      
      logger.debug("Filtered messages with assessmentType", {
        totalTriaged: mapped.length,
        sampleTriaged: mapped.slice(-3).map((m: any) => ({
          id: m.id,
          role: m.role,
          assessmentType: m.assessmentType,
          groupId: m.groupId,
          triageProcessedAt: m.triageProcessedAt,
        }))
      });
      
      // Collapse by groupId keeping latest triageProcessedAt and count, and capture messages per group
      const groupedMap = new Map<string, { id: string; role: string; assessmentType?: string; groupId: string; triageProcessedAt: number; groupCount: number; messages: Array<{ id: string; role: string; text?: string; createdAt?: number; assessmentType?: string; triageProcessedAt?: number }> }>();
      for (const m of mapped) {
        // Only group messages that actually have a groupId - others will show as ungrouped
        if (!m.groupId) continue;
        
        const gid = String(m.groupId);
        const existing = groupedMap.get(gid);
        const msg = { id: m.id, role: m.role, text: m.text, createdAt: m.createdAt, assessmentType: m.assessmentType, triageProcessedAt: m.triageProcessedAt } as any;
        if (!existing) {
          groupedMap.set(gid, {
            id: m.id,
            role: m.role,
            assessmentType: m.assessmentType,
            groupId: gid,
            triageProcessedAt: m.triageProcessedAt || Date.now(),
            groupCount: 1,
            messages: [msg],
          });
        } else {
          existing.groupCount += 1;
          existing.messages.push(msg);
          const mTriageTime = m.triageProcessedAt || 0;
          if (mTriageTime > existing.triageProcessedAt) {
            existing.triageProcessedAt = mTriageTime;
            existing.id = m.id;
            existing.role = m.role;
            existing.assessmentType = m.assessmentType;
          }
        }
      }
      const grouped = Array.from(groupedMap.values())
        .sort((a, b) => (b.triageProcessedAt - a.triageProcessedAt));
      setTriageItems(grouped as any);
      setTriageHasGroups(grouped.length > 0);
      setTriageStatus('ready');
    } catch (e: unknown) {
      setTriageStatus(e instanceof Error ? e.message : 'error');
    }
  }, [sessionId, buildAuthHeaders]);

  const runTriageNow = React.useCallback(async () => {
    if (!sessionId) { setTriageStatus('no session'); return; }
    setTriageStatus('running');
    try {
      const reqId = Math.random().toString(36).slice(2);
      const headers = await buildAuthHeaders({ accept: 'application/json', 'x-request-id': reqId });
      const res = await fetch(`/api/v1/triage?sessionId=${encodeURIComponent(sessionId)}&limit=20`, {
        method: 'POST', headers, cache: 'no-store'
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || `triage failed: ${res.status}`);
      setTriageStatus(`ok: updated=${Number(data?.updated || 0)} inferred=${String(data?.inferred || '')}`);
    } catch (e: unknown) {
      setTriageStatus(e instanceof Error ? e.message : 'error');
    }
  }, [sessionId, buildAuthHeaders]);

  const refreshAssessPanel = React.useCallback(async () => {
    if (!sessionId) return;
    setAssessStatus('loading');
    try {
      const reqId = Math.random().toString(36).slice(2);
      const headers = await buildAuthHeaders({ accept: 'application/json', 'x-request-id': reqId });
      // 1) Latest assessment results (to get latestGroupId)
      const resLatest = await fetch(`/api/assessments/convex/results/${encodeURIComponent(sessionId)}`, { method: 'GET', headers, cache: 'no-store' });
      const latestJson = await resLatest.json().catch(() => ({}));
      const latestGroupId = typeof latestJson?.latestGroupId === 'string' ? latestJson.latestGroupId : null;
      setAssessLatestGroup(latestGroupId);
      const sum = latestJson && latestJson.results && Array.isArray(latestJson.results.highlights) && Array.isArray(latestJson.results.recommendations) && Array.isArray(latestJson.results.rubricKeyPoints)
        ? {
            highlights: latestJson.results.highlights || [],
            recommendations: latestJson.results.recommendations || [],
            rubricKeyPoints: latestJson.results.rubricKeyPoints || [],
            meta: latestJson.results.meta || undefined,
            // Include V2 skill assessments if available
            skillAssessments: Array.isArray(latestJson.results.skillAssessments) ? latestJson.results.skillAssessments : undefined,
          }
        : null;
      setAssessResults(sum);
      // 2) Tracked skills
      const resTracked = await fetch(`/api/v1/skills/tracked`, { method: 'GET', headers, cache: 'no-store' });
      const trackedJson = await resTracked.json().catch(() => ({}));
      const rows = Array.isArray(trackedJson?.tracked) ? trackedJson.tracked : [];
      const list = rows.map((r: { skillId?: unknown; skill?: { id?: unknown; title?: unknown }; title?: unknown; currentLevel?: unknown; level?: unknown }) => ({ id: String(r?.skillId || r?.skill?.id || ''), title: String(r?.skill?.title || r?.title || ''), currentLevel: Number(r?.currentLevel ?? r?.level ?? 0) }));
      setTrackedSkills(list);
      // 3) Recent events (filter assess_*)
      const resEvents = await fetch(`/api/v1/events?sessionId=${encodeURIComponent(sessionId)}&limit=100`, { method: 'GET', headers, cache: 'no-store' });
      const evJson = await resEvents.json().catch(() => ({}));
      const evs = Array.isArray(evJson?.events) ? evJson.events : [];
      const assessEvs = evs.filter((e: { kind?: unknown }) => typeof e?.kind === 'string' && e.kind.startsWith('assess_')).map((e: { createdAt?: unknown; kind?: unknown; payload?: unknown }) => ({ createdAt: Number(e?.createdAt || Date.now()), kind: String(e?.kind || ''), payload: e?.payload || {} }));
      setAssessEvents(assessEvs);
      setAssessStatus('ready');
    } catch (e: unknown) {
      setAssessStatus(e instanceof Error ? e.message : 'error');
    }
  }, [sessionId, buildAuthHeaders]);

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
      if (!data.sessionId) throw new Error('sessionId missing from response');
      setSessionMetricsData({
        sessionId: data.sessionId,
        startTime: data.startTime,
        lastActivityAt: data.lastActivityAt,
        interactionCount: data.interactionCount,
        sttCostCents: data.sttCostCents,
        llmCostCents: data.llmCostCents,
        ttsCostCents: data.ttsCostCents,
        totalCostCents: data.totalCostCents
      });
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
      logger.debug("Fresh summary GET request started", { sessionId });
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
      logger.info("Fresh summary retrieved successfully", {
        sessionId,
        summaryLength: next.text.length,
        version: next.version,
        updatedAt: next.updatedAt
      });
      setFresh(next);
      setTranscript((cur) => {
        const exists = cur.some((h) => h.version === next.version);
        const arr = exists ? cur : [...cur, { version: next.version, updatedAt: next.updatedAt, text: next.text }];
        arr.sort((a,b) => a.version - b.version);
        return arr;
      });
      setFreshStatus("ready");
    } catch (e) {
      logger.error("Fresh summary fetch failed", {
        sessionId,
        error: e instanceof Error ? e.message : String(e)
      });
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
      logger.debug("Fresh summary generation started", {
        sessionId,
        prevSummaryLength: prev.length,
        messageCount: recentMessages.length
      });
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
      logger.info("Fresh summary generation completed", { sessionId });
    } catch {}
  }, [sessionId, fresh, convo, mic.transcript, mic.assistantText, buildAuthHeaders]);

  // Server cadence: remove UI auto trigger; rely on backend via persisted interactions
  // Remove UI auto cadence effect
  React.useEffect(() => {
    // Voice features disabled on coach-new: do not auto-start VAD loop
    // Prime server panels on mount
    void refreshServerTranscript();
    void refreshSessionState();
    void refreshTriageList();
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
          refreshTriageList(), // Also refresh triage to see new messages
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
        logger.debug("Polling window active - refreshing summary state", { sessionId });
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
        logger.debug("Seeding prompt preview from mic", {
          systemTextLength: systemText.length,
          promptTextLength: promptText.length
        });
        setPromptPreview({
          system: systemText,
          summary: undefined as any,
          summaryLen: undefined as any,
          recentMessages: undefined as any,
          prompt: promptText,
          createdAt: Date.now(),
        });
      }
    } catch (e) {
      logger.warn("Mic seed failed", {
        error: e instanceof Error ? e.message : String(e)
      });
    }
  }, [mic.status, mic.transcript, fresh?.text]);

  // Gate triage refreshes by server cadence: when turnsSince hits thresholdTurns
  React.useEffect(() => {
    if (!fresh) return;
    const turnsSince = Number.isFinite(Number((fresh as any)?.turnsSince)) ? Number((fresh as any).turnsSince) : undefined;
    const threshold = Number.isFinite(Number((fresh as any).thresholdTurns)) ? Number((fresh as any).thresholdTurns) : undefined;
    if (turnsSince !== undefined && threshold !== undefined && threshold > 0 && turnsSince > 0 && (turnsSince % threshold === 0)) {
      void refreshTriageList();
    }
  }, [fresh, refreshTriageList]);

  // Handle manual chat status changes
  React.useEffect(() => {
    if (manualChatStatus === "playback" && !audio.isPlaybackActive) {
      // Reset to idle when playback ends
      setManualChatStatus("idle");
    }
  }, [manualChatStatus, audio.isPlaybackActive]);

  // Fetch profile data
  const fetchProfile = React.useCallback(async () => {
    if (MOCK_UI) {
      setProfileLoading(true);
      try { setProfile({ displayName: user?.firstName || 'Antonio', bio: 'Aspiring public speaker focusing on clarity and pacing.' }); }
      finally { setProfileLoading(false); }
      return;
    }
    setProfileLoading(true);
    try {
      const headers = await buildAuthHeaders({ accept: 'application/json' });
      const response = await fetch(`/api/v1/users/profile?userId=${encodeURIComponent(userId)}`, { headers });
      const data = await response.json();
      if (data.profile) {
        setProfile(data.profile);
      }
    } catch (error) {
      logger.error('Failed to fetch profile', {
        userId,
        error: error instanceof Error ? error.message : String(error)
      });
    } finally {
      setProfileLoading(false);
    }
  }, [userId, buildAuthHeaders]);

  // Fetch goals data
  const fetchGoals = React.useCallback(async () => {
    if (MOCK_UI) {
      setGoalsLoading(true);
      try { setGoals([
        { goalId: 'g1', title: 'Improve clarity', description: 'Short, punchy ideas', status: 'active' },
        { goalId: 'g2', title: 'Steady pacing', description: 'Avoid rushing', status: 'active' },
      ]); }
      finally { setGoalsLoading(false); }
      return;
    }
    setGoalsLoading(true);
    try {
      const headers = await buildAuthHeaders({ accept: 'application/json' });
      const response = await fetch(`/api/v1/users/goals?userId=${encodeURIComponent(userId)}`, { headers });
      const data = await response.json();
      if (data.goals) {
        setGoals(data.goals);
      }
    } catch (error) {
      logger.error('Failed to fetch goals', {
        userId,
        error: error instanceof Error ? error.message : String(error)
      });
    } finally {
      setGoalsLoading(false);
    }
  }, [userId, buildAuthHeaders]);

  // Fetch profile and goals on mount and when userId changes
  React.useEffect(() => {
    if (MOCK_UI) { fetchProfile(); fetchGoals(); return; }
    if (userId && userId !== "anonymous") { fetchProfile(); fetchGoals(); }
  }, [userId, fetchProfile, fetchGoals]);

  // Skills: fetch all active + tracked
  const fetchSkills = React.useCallback(async () => {
    if (MOCK_UI) {
      setSkillsLoading(true); setSkillsError('');
      try {
        setTrackedSkillsDash([
          { skillId: 'clarity', title: 'Clarity', currentLevel: 7 },
          { skillId: 'pacing', title: 'Pacing', currentLevel: 2 },
        ]);
        setAllSkillsDash([
          { id: 'storytelling', title: 'Storytelling' },
          { id: 'brevity', title: 'Brevity' },
          { id: 'confidence', title: 'Confidence' },
        ]);
      } finally { setSkillsLoading(false); }
      return;
    }
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
    if (MOCK_UI) {
      const found = allSkillsDash.find(s => s.id === skillId);
      if (found) {
        setTrackedSkillsDash(prev => (prev.find(p => p.skillId === skillId) ? prev : [...prev, { skillId, title: found.title, currentLevel: 1 }]).slice(0, 2));
        setAllSkillsDash(prev => prev.filter(s => s.id !== skillId));
      }
      return;
    }
    try {
      const headers = await buildAuthHeaders({ 'content-type': 'application/json' });
      const res = await fetch('/api/v1/skills/track', { method: 'POST', headers, body: JSON.stringify({ skillId }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || `track failed: ${res.status}`);
      await fetchSkills();
    } catch (e) { setSkillsError(e instanceof Error ? e.message : String(e)); }
  }, [buildAuthHeaders, fetchSkills, allSkillsDash]);

  // Untrack a skill
  const untrackSkill = React.useCallback(async (skillId: string) => {
    if (MOCK_UI) {
      const found = trackedSkillsDash.find(s => s.skillId === skillId);
      if (found) {
        setTrackedSkillsDash(prev => prev.filter(s => s.skillId !== skillId));
        setAllSkillsDash(prev => [{ id: found.skillId, title: found.title || found.skillId }, ...prev]);
      }
      return;
    }
    try {
      const headers = await buildAuthHeaders({ 'content-type': 'application/json' });
      const res = await fetch('/api/v1/skills/untrack', { method: 'POST', headers, body: JSON.stringify({ skillId }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || `untrack failed: ${res.status}`);
      await fetchSkills();
    } catch (e) { setSkillsError(e instanceof Error ? e.message : String(e)); }
  }, [buildAuthHeaders, fetchSkills, trackedSkillsDash]);



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
      logger.error('Failed to add goal', {
        userId,
        goalTitle: title,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }, [userId, fetchGoals, buildAuthHeaders]);

  // Update goal
  const updateGoal = React.useCallback(async (goalId: string, updates: Partial<{ goalId: string; title: string; description?: string; status?: string }>) => {
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
      logger.error('Failed to update goal', {
        userId,
        goalId,
        updates,
        error: error instanceof Error ? error.message : String(error)
      });
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
      logger.error('Failed to delete goal', {
        userId,
        goalId,
        error: error instanceof Error ? error.message : String(error)
      });
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
      logger.error('Failed to update profile', {
        userId,
        displayName,
        bioLength: bio.length,
        error: error instanceof Error ? error.message : String(error)
      });
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
    logger.info('Manual chat function called');
    if (!manualChatInput.trim() || manualChatStatus !== "idle") {
      logger.debug('Manual chat early return - input empty or status not idle', {
        hasInput: !!manualChatInput.trim(),
        status: manualChatStatus
      });
      return;
    }

    const inputText = manualChatInput.trim();
    logger.info('Starting manual chat', {
      inputLength: inputText.length,
      sessionId
    });
    
    // Seed prompt preview locally so the debug panel is not empty
    try {
      const systemText = typeof (fresh as any)?.text === 'string' ? String((fresh as any).text) : '';
      logger.debug('Seeding prompt preview from manual chat', {
        systemTextLength: systemText.length,
        promptLength: inputText.length
      });
      setPromptPreview({
        system: systemText,
        summary: undefined as any,
        summaryLen: undefined as any,
        recentMessages: undefined as any,
        prompt: inputText,
        createdAt: Date.now(),
      });
    } catch (error) {
      logger.error('Error setting prompt preview', {
        error: error instanceof Error ? error.message : String(error)
      });
    }
    
    setManualChatInput("");
    setManualChatStatus("chat");
    setManualChatResponse("");

    // Update mic context to show the user input in debug panel
    logger.debug('Setting mic context for manual chat', {
      inputLength: inputText.length,
      transcriptPreview: inputText.substring(0, 50)
    });
    mic.setTranscript(inputText);
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
            logger.info('Model updated during manual chat', {
              oldModel: selectedModel,
              newModel: model
            });
            setSelectedModel(model);
            try { localStorage.setItem("chat:model", model); } catch {}
          }
        }
      };

      // Call chatToTextStreaming with history
      logger.debug('Starting chat request', {
        inputLength: inputText.length,
        model: selectedModel
      });
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
          logger.debug('User interaction persisted', {
            status: res?.status,
            sessionId: effSid
          });
        }
      } catch (e) {
        logger.error('Failed to persist user interaction', {
          sessionId,
          error: e instanceof Error ? e.message : String(e)
        });
      }

      const reply = await convo.chatToTextStreaming(inputText, (chunk) => {
        logger.debug('Received chat chunk', {
          chunkLength: chunk.length,
          chunkPreview: chunk.substring(0, 50)
        });
      }, chatOptions);
      logger.info('Chat response received', {
        responseLength: reply?.length || 0,
        sessionId
      });

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
          logger.debug('Assistant interaction persisted', {
            status: res2?.status,
            sessionId: effSid2
          });
        }
      } catch (e) {
        logger.error('Failed to persist assistant interaction', {
          sessionId,
          error: e instanceof Error ? e.message : String(e)
        });
      }

      if (!reply || reply.trim().length === 0) {
        throw new Error('Empty response from chat API');
      }

      // Voice/TTS disabled: just show text response without audio playback
      setManualChatResponse(reply);
      setManualChatStatus("idle");

      // Record this turn into the conversation history
      try {
        if (typeof convo.recordTurn === 'function') {
          convo.recordTurn(inputText, reply);
        }
      } catch (recordError) {
        logger.warn('Failed to record turn', {
          error: recordError instanceof Error ? recordError.message : String(recordError)
        });
      }

    } catch (error) {
      logger.error('Manual chat failed', {
        sessionId,
        inputLength: inputText?.length || 0,
        error: error instanceof Error ? error.message : String(error)
      });
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
    <div className="min-h-screen p-4" style={{
      background: 'linear-gradient(180deg, #fdfaf7 0%, #faf3ee 100%)'
    }}>
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
          className="fixed top-4 left-1/2 transform -translate-x-1/2 p-3 rounded-full bg-theme border border-theme hover:bg-gray-50 transition-colors z-40"
          title="Open dashboard"
        >
          <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
            <polyline points="9,22 9,12 15,12 15,22"/>
          </svg>
        </button>
      )}



      {/* Dashboard Content */}
      {showDashboard && (
        <div className="px-6 pt-10 pb-32">
          {/* New wireframe dashboard */}
          <div className="max-w-md mx-auto space-y-8">
            {/* Welcome + Score + Progress */}
            <section
              className="transform-gpu will-change-transform transition-all duration-[600ms] ease-out"
              style={{ opacity: dashAnim ? 1 : 0, transform: dashAnim ? "translateY(0)" : "translateY(-120vh)" }}
            >
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-2xl font-semibold">Welcome back, {profile?.displayName || user?.firstName || 'there'}!</h2>
                <div className="p-2 rounded border border-theme">🖼️</div>
              </div>
              <div className="flex flex-col items-center gap-6">
                <div className="w-56 h-56 rounded-full border border-[#e6ded5] flex items-center justify-center outline outline-1 -outline-offset-1 outline-[#efe7df]" style={{ background: 'radial-gradient(circle at 35% 30%, rgba(255,252,246,0.78), rgba(252,243,232,0.66))' }}>
                  <div className="text-[120px] leading-none font-semibold">
                    {(() => {
                      const levels = (trackedSkillsDash || []).map(s => Number(s.currentLevel)).filter(n => Number.isFinite(n));
                      if (levels.length === 0) return 5;
                      const avg = Math.round(levels.reduce((a, b) => a + b, 0) / levels.length);
                      return Math.max(0, Math.min(10, avg));
                    })()}
                  </div>
                </div>
                <div className="w-full">
                  <div className="relative h-6 rounded-full border border-[#e2dace] overflow-hidden outline outline-2 -outline-offset-1 outline-[#efe9e2]" style={{ background: 'linear-gradient(180deg, rgba(255,253,250,0.6) 0%, rgba(255,250,245,0.55) 100%)' }}>
                    <div
                      className="absolute left-0 top-0 h-full transition-all duration-500"
                      style={{
                        width: '55%',
                        background: 'linear-gradient(90deg, rgba(98,144,255,0.22) 0%, rgba(74,120,255,0.32) 100%)'
                      }}
                    />
                    <div className="absolute inset-0 flex items-center justify-center text-[11px] font-mono">
                      11/20
                    </div>
                  </div>
                </div>
              </div>
            </section>

            {/* Skills List */}
            <section
              className="transform-gpu will-change-transform transition-all duration-[700ms] ease-out"
              style={{ opacity: dashAnim ? 1 : 0, transform: dashAnim ? "translateY(0)" : "translateY(-120vh)", transitionDelay: dashAnim ? "80ms" : "0ms" }}
            >
              <div className="mb-2 flex items-center justify-between">
                <div className="text-sm font-semibold uppercase tracking-wide">SKILLS</div>
                <button type="button" onClick={() => setWfShowUntracked(v => !v)}>{wfShowUntracked ? '▾' : '▸'}</button>
              </div>
              <div className="space-y-2">
                {/* Tracked Skills - Always visible */}
                {trackedSkillsDash.length > 0 ? trackedSkillsDash.map((s: any) => (
                  <SoftCard key={String(s.skillId || s.id)} className="w-full px-4 py-2">
                    <div className="flex items-center gap-3">
                      <div className="text-base leading-none font-semibold">{Number.isFinite(Number(s.currentLevel)) ? s.currentLevel : 0}</div>
                      <div className="text-sm">{s.title || s.skillId || 'Skill'}</div>
                    </div>
                  </SoftCard>
                )) : (
                  // Fallback demo skills if no tracked skills
                  [{ skillId: 'clarity', title: 'Clarity', currentLevel: 7 }, { skillId: 'pacing', title: 'Pacing', currentLevel: 2 }, { skillId: 'storytelling', title: 'Storytelling', currentLevel: 3 }].map((s: any) => (
                    <SoftCard key={String(s.skillId || s.id)} className="w-full px-4 py-2">
                      <div className="flex items-center gap-3">
                        <div className="text-base leading-none font-semibold">{Number.isFinite(Number(s.currentLevel)) ? s.currentLevel : 0}</div>
                        <div className="text-sm">{s.title || s.skillId || 'Skill'}</div>
                      </div>
                    </SoftCard>
                  ))
                )}

                {/* Available Skills - Only when expanded */}
                {wfShowUntracked && allSkillsDash.length > 0 && (() => {
                  const trackedIds = new Set(trackedSkillsDash.map((t) => t.skillId));
                  const untracked = allSkillsDash.filter((s) => s.id && !trackedIds.has(s.id));
                  return untracked.length > 0 ? (
                    <div className="mt-4 space-y-2">
                      {untracked.slice(0, 10).map((s: any) => (
                        <SoftCard key={String(s.id)} className="w-full px-4 py-2 flex items-center gap-2">
                          <div className="w-6 h-6 rounded-full border border-theme flex items-center justify-center text-xs bg-theme">+</div>
                          <div className="flex-1 text-sm">{s.title || s.id || 'Skill'}</div>
                          <button type="button" onClick={() => trackSkill(s.id)} className="px-2 py-1 text-xs border border-theme rounded-[12px] hover:bg-theme">Track</button>
                        </SoftCard>
                      ))}
                    </div>
                  ) : null;
                })()}
              </div>
            </section>

            {/* Log Section */}
            <section
              className="transform-gpu will-change-transform transition-all duration-[700ms] ease-out"
              style={{ opacity: dashAnim ? 1 : 0, transform: dashAnim ? "translateY(0)" : "translateY(-120vh)", transitionDelay: dashAnim ? "140ms" : "0ms" }}
            >
              <div className="mb-2 flex items-center justify-between">
                <div className="text-sm font-semibold uppercase tracking-wide">LOG</div>
                <button type="button" onClick={() => setWfLogOpen(v => !v)}>{wfLogOpen ? '▾' : '▸'}</button>
              </div>
              {wfLogOpen && (
                <div className="space-y-3">
                  {[1,2].map((n) => (
                    <SoftCard key={n} className="w-full px-3 py-1.5">
                      <div className="flex items-center gap-2">
                        <select className="flex-1 bg-transparent">
                          <option>{`Session ${n} — ${n === 1 ? 'Wednesday' : 'Tuesday'}`}</option>
                        </select>
                        <div className="flex items-center gap-1">
                          {[1,2,3].map((_, i) => (
                            <div key={i} className="w-5 h-5 rounded-full border border-theme text-[10px] flex items-center justify-center">{i+1}</div>
                          ))}
                        </div>
                        <div className="text-muted-foreground">▾</div>
                      </div>
                    </SoftCard>
                  ))}
                  {/* Expanded Session */}
                  <SoftCard className="p-3">
                    <div className="flex items-center justify-between">
                      <div className="text-sm font-medium">Session 3</div>
                      <button type="button" onClick={() => setWfSession3Open(v => !v)}>{wfSession3Open ? '▾' : '▸'}</button>
                    </div>
                    <div className="mt-2 text-xs">Tuesday 7:15-8:15</div>
                    {wfSession3Open && (
                      <div className="mt-3">
                        <SoftCard key="assessment-1" className="w-full px-3 py-1.5">
                          <div className="flex items-center gap-2">
                            <select className="flex-1 bg-transparent">
                              <option>Assessment 1</option>
                            </select>
                            <div className="flex items-center gap-1">
                              {[1,2,3].map((_, i) => (
                                <div key={i} className="w-5 h-5 rounded-full border border-theme text-[10px] flex items-center justify-center">{i+1}</div>
                              ))}
                            </div>
                            <div className="text-muted-foreground">▾</div>
                          </div>
                        </SoftCard>
                        <div className="mt-2">
                          <select className="w-full border rounded px-3 py-1.5 text-sm bg-theme">
                            <option>Assessment 2</option>
                          </select>
                        </div>
                        <div className="mt-2 text-center text-muted-foreground">...</div>
                      </div>
                    )}
                  </SoftCard>
                </div>
              )}
            </section>
          </div>
          {/* Old dashboard disabled */}
          <div className="max-w-md mx-auto mb-6" style={{ display: 'none' }}>
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-semibold">Dashboard</h2>
            </div>
          </div>

          {/* Real dashboard sections (hidden) */}
          <div className="max-w-md mx-auto space-y-6" style={{ display: 'none' }}>
            {/* Profile Section */}
            <section
              className="transform-gpu will-change-transform transition-all duration-[600ms] ease-out"
              style={{
                opacity: dashAnim ? 1 : 0,
                transform: dashAnim ? "translateY(0)" : "translateY(-120vh)"
              }}
            >
              <div className="rounded-2xl border border-theme bg-theme p-4 shadow-sm">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-lg font-semibold">Profile</h3>
                  {profile && !editingProfile && (
                    <button
                      onClick={() => {
                        setEditingProfile(true);
                        setProfileDisplayName(profile.displayName || '');
                        setProfileBio(profile.bio || '');
                      }}
                      className="p-1 text-muted-foreground hover:text-blue-600"
                      title="Edit profile"
                    >
                      ✏️
                    </button>
                  )}
                </div>
                {profileLoading ? (
                  <div className="text-center py-4">
                    <div className="animate-pulse text-muted-foreground">Loading profile...</div>
                  </div>
                ) : editingProfile ? (
                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium mb-1">Display Name</label>
                      <input
                        type="text"
                        value={profileDisplayName}
                        onChange={(e) => setProfileDisplayName(e.target.value)}
                        placeholder="Enter your display name..."
                        className="w-full px-3 py-1.5 border border-theme rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-1">Bio</label>
                      <textarea
                        value={profileBio}
                        onChange={(e) => setProfileBio(e.target.value)}
                        placeholder="Tell us about yourself..."
                        rows={3}
                        className="w-full px-3 py-1.5 border border-theme rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
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
                      <label className="block text-sm font-medium mb-1">Display Name</label>
                      <div className="text-lg font-semibold">{profile.displayName || 'No display name set'}</div>
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-1">Bio</label>
                      <div className="text-sm whitespace-pre-wrap">{profile.bio || 'No bio set'}</div>
                    </div>
                  </div>
                ) : (
                  <div className="text-center py-4 text-muted-foreground">
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
              <div className="rounded-2xl border border-theme bg-theme p-4 shadow-sm">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-lg font-semibold">Skills</h3>
                  <button
                    type="button"
                    onClick={() => fetchSkills()}
                    className="px-2 py-1 text-xs border border-theme rounded hover:bg-gray-50"
                  >
                    Refresh
                  </button>
                </div>
                {skillsLoading ? (
                  <div className="text-center py-4 text-muted-foreground">Loading skills…</div>
                ) : skillsError ? (
                  <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded p-2">{skillsError}</div>
                ) : (
                  <div className="space-y-4">
                    {/* Tracked */}
                    <div>
                      <div className="text-sm font-medium mb-2">Tracked ({trackedSkillsDash.length}/2)</div>
                      {trackedSkillsDash.length === 0 ? (
                        <div className="text-sm">No tracked skills yet.</div>
                      ) : (
                        <div className="space-y-2">
                          {trackedSkillsDash.map((t) => (
                            <div key={t.skillId} className="flex items-center justify-between border border-gray-200 rounded p-2 bg-gray-50">
                              <div className="text-sm">
                                {t.title || t.skillId}
                                <span className="ml-2 text-xs">Lv {Number.isFinite(Number(t.currentLevel)) ? t.currentLevel : '-'}</span>
                              </div>
                              <button
                                type="button"
                                onClick={() => untrackSkill(t.skillId)}
                                className="px-2 py-1 text-xs border border-theme rounded hover:bg-theme"
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
                      <div className="text-sm font-medium mb-2">Available</div>
                      {(() => {
                        const trackedIds = new Set(trackedSkillsDash.map((t) => t.skillId));
                        const untracked = allSkillsDash.filter((s) => s.id && !trackedIds.has(s.id));
                        if (untracked.length === 0) return <div className="text-sm text-muted-foreground">No more available skills.</div>;
                        const reachedMax = trackedSkillsDash.length >= 2;
                        return (
                          <div className="space-y-2">
                            {untracked.slice(0, 20).map((s) => (
                              <div key={s.id} className="flex items-center justify-between border border-gray-200 rounded p-2">
                                <div className="text-sm">
                                  {s.title || s.id}
                                  {s.category ? <span className="ml-2 text-xs">{s.category}</span> : null}
                                </div>
                                <button
                                  type="button"
                                  disabled={reachedMax}
                                  onClick={() => trackSkill(s.id)}
                                  className={`px-2 py-1 text-xs border border-theme rounded ${reachedMax ? 'bg-gray-50 cursor-not-allowed' : 'hover:bg-theme'}`}
                                  title={reachedMax ? 'Maximum of 2 tracked skills reached' : 'Track'}
                                >
                                  Track
                                </button>
                              </div>
                            ))}
                            {untracked.length > 20 ? (
                              <div className="text-xs text-muted-foreground">Showing first 20. Use /skills for full list.</div>
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
              <div className="rounded-2xl border border-theme bg-theme p-4 shadow-sm">
                <h3 className="text-lg font-semibold mb-3">Goals</h3>

                {/* Goals list */}
                {goalsLoading ? (
                  <div className="text-center py-4">
                    <div className="animate-pulse text-muted-foreground">Loading goals...</div>
                  </div>
                ) : goals.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    No goals yet. Add your first goal above!
                  </div>
                ) : (
                  <div className="space-y-3">
                    {goals.map((goal) => (
                      <div key={goal.goalId} className="border border-gray-200 rounded-lg p-3 bg-gray-50">
                        {editingGoal?.goalId === goal.goalId ? (
                          <div className="space-y-3">
                            <div>
                              <label className="block text-xs font-medium mb-1">Title</label>
                              <input
                                type="text"
                                value={editingGoal.title}
                                onChange={(e) => setEditingGoal({ ...editingGoal, title: e.target.value })}
                                className="w-full px-2 py-1 border border-theme rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                              />
                            </div>
                            <div>
                              <label className="block text-xs font-medium mb-1">Description</label>
                              <textarea
                                value={editingGoal.description || ''}
                                onChange={(e) => setEditingGoal({ ...editingGoal, description: e.target.value })}
                                rows={2}
                                className="w-full px-2 py-1 border border-theme rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
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
                              <div className="font-medium text-foreground">{goal.title}</div>
                              {goal.description && (
                                <div className="text-sm text-muted-foreground mt-1">{goal.description}</div>
                              )}
                              <div className="text-xs text-muted-foreground mt-2">
                                Status: <span className={`px-2 py-0.5 rounded text-xs ${
                                  goal.status === 'active' ? 'bg-green-100 text-green-800' :
                                  goal.status === 'completed' ? 'bg-blue-100 text-blue-800' :
                                  'bg-gray-100 text-foreground'
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
                                className="p-1 text-muted-foreground hover:text-blue-600"
                                title="Edit goal"
                              >
                                ✏️
                              </button>
                              <button
                                onClick={() => deleteGoal(goal.goalId)}
                                className="p-1 text-muted-foreground hover:text-red-600"
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
                          <label className="block text-sm font-medium mb-1">Title</label>
                          <input
                            type="text"
                            value={newGoalTitle}
                            onChange={(e) => setNewGoalTitle(e.target.value)}
                            placeholder="Enter goal title..."
                            className="w-full px-3 py-1.5 border border-theme rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-medium mb-1">Description</label>
                          <textarea
                            value={newGoalDescription}
                            onChange={(e) => setNewGoalDescription(e.target.value)}
                            placeholder="Describe your goal (optional)..."
                            rows={2}
                            className="w-full px-3 py-1.5 border border-theme rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
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
                        className="w-full px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors"
                      >
                        + Add New Goal
                      </button>
                    )}
                  </div>
                )}

                {/* Show limit message when 2 goals reached */}
                {goals.length >= 2 && (
                  <div className="mt-4 pt-4 border-t border-gray-200">
                    <div className="text-center text-sm text-muted-foreground">
                      You&apos;ve reached the maximum of 2 goals. Complete or delete existing goals to add more.
                    </div>
                  </div>
                )}
              </div>
            </section>


          </div>
        </div>
      )}


      {/* Floating Mic Button */}
      <div style={{ pointerEvents: showDashboard ? 'auto' as const : 'none' as const }}>
        <MicMinButton
          showDashboard={showDashboard}
          onDashboardClick={() => setShowDashboard(false)}
        />
      </div>
    </div>
  );
}



export default App;
