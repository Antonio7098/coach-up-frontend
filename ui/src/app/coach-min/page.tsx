"use client";

import React from "react";
import { MinimalAudioProvider, useMinimalAudio } from "../../context/minimal/MinimalAudioContext";
import { MinimalVoiceProvider } from "../../context/minimal/MinimalVoiceContext";
import { MinimalConversationProvider, useMinimalConversation } from "../../context/minimal/MinimalConversationContext";
import { useMinimalSession } from "../../context/minimal/MinimalSessionContext";
import { MinimalMicProvider, useMinimalMic } from "../../context/minimal/MinimalMicContext";
import { MinimalSessionProvider } from "../../context/minimal/MinimalSessionContext";
import MicMinButton from "../../components/MicMinButton";

function App() {
  // Profile and Goals data - moved to parent so it can be passed to MinimalMicProvider
  const [profile, setProfile] = React.useState<any>(null);
  const [goals, setGoals] = React.useState<any[]>([]);
  const [profileLoading, setProfileLoading] = React.useState<boolean>(false);
  const [goalsLoading, setGoalsLoading] = React.useState<boolean>(false);

  return (
    <MinimalAudioProvider>
      <MinimalSessionProvider>
        <MinimalVoiceProvider>
          <MinimalConversationProvider>
            <MinimalMicProvider userProfile={profile} userGoals={goals}>
              <Content
                profile={profile}
                setProfile={setProfile}
                goals={goals}
                setGoals={setGoals}
                profileLoading={profileLoading}
                setProfileLoading={setProfileLoading}
                goalsLoading={goalsLoading}
                setGoalsLoading={setGoalsLoading}
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
  setGoalsLoading
}: {
  profile: any;
  setProfile: React.Dispatch<React.SetStateAction<any>>;
  goals: any[];
  setGoals: React.Dispatch<React.SetStateAction<any[]>>;
  profileLoading: boolean;
  setProfileLoading: React.Dispatch<React.SetStateAction<boolean>>;
  goalsLoading: boolean;
  setGoalsLoading: React.Dispatch<React.SetStateAction<boolean>>;
}) {
  const mic = useMinimalMic();
  const audio = useMinimalAudio();
  const convo = useMinimalConversation();
  const { sessionId } = useMinimalSession();

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

  // Mock userId for now (in a real app this would come from auth context)
  const userId = "mock-user-id";

  // Fresh panel: independent state that directly calls the API
  const [fresh, setFresh] = React.useState<{ text: string; updatedAt: number; version: number; lastMessageTs?: number; thresholdTurns?: number; turnsSince?: number } | null>(null);
  const [freshStatus, setFreshStatus] = React.useState<"idle" | "loading" | "ready" | "error">("idle");
  const [freshErr, setFreshErr] = React.useState<string | undefined>(undefined);
  const [dbgOpen, setDbgOpen] = React.useState<boolean>(false);
  const [ingestTestStatus, setIngestTestStatus] = React.useState<string>("");
  const [dbgPrompt, setDbgPrompt] = React.useState<{ prevSummary: string; messages: Array<{ role: 'user'|'assistant'; content: string }> } | null>(null);
  const [promptPreview, setPromptPreview] = React.useState<any>(null);

  // Tab management for collapsible panel
  const [activeTab, setActiveTab] = React.useState<'status' | 'prompt' | 'summary' | 'transcript'>('status');
  const [panelCollapsed, setPanelCollapsed] = React.useState<boolean>(true);
  // Keep the latest prompt preview from SSE in sync automatically
  const lastSsePreview = convo.promptPreview;
  React.useEffect(() => {
    if (lastSsePreview && typeof lastSsePreview?.prompt === 'string' && lastSsePreview.prompt.trim().length > 0) {
      setPromptPreview(lastSsePreview);
    }
  }, [lastSsePreview]);
  // Local in-session history of summaries (ascending by version)
  const [history, setHistory] = React.useState<Array<{ version: number; updatedAt: number; text: string }>>([]);
  const [openMap, setOpenMap] = React.useState<Record<number, boolean>>({});
  // Local delta since last server cadence fetch
  const [sinceFetchDelta, setSinceFetchDelta] = React.useState<number>(0);
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
      const res = await fetch(`/api/v1/transcripts?sessionId=${encodeURIComponent(sessionId)}&limit=200`, {
        method: 'GET',
        headers: { accept: 'application/json', 'x-request-id': reqId },
        cache: 'no-store',
      });
      const data = await res.json().catch(() => ({} as any));
      if (!res.ok) throw new Error(data?.error || `transcripts failed: ${res.status}`);
      const items = Array.isArray(data?.items) ? data.items : [];
      const mapped = items.map((it: any) => ({ id: String(it.id || ''), role: String(it.role || ''), text: String(it.text || ''), createdAt: Number(it.createdAt || Date.now()) }));
      setServerTranscript(mapped);
      setServerTranscriptStatus('ready');
    } catch (e) {
      setServerTranscriptErr(e instanceof Error ? e.message : String(e));
      setServerTranscriptStatus('error');
    }
  }, [sessionId]);
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
      const res = await fetch(`/api/v1/sessions?sessionId=${encodeURIComponent(sessionId)}`, {
        method: 'GET',
        headers: { accept: 'application/json', 'x-request-id': reqId },
        cache: 'no-store',
      });
      const data = await res.json().catch(() => ({} as any));
      if (!res.ok) throw new Error(data?.error || `sessions failed: ${res.status}`);
      setSessionState(data?.session ?? null);
      setSessionStateStatus('ready');
    } catch (e) {
      setSessionStateErr(e instanceof Error ? e.message : String(e));
      setSessionStateStatus('error');
    }
  }, [sessionId]);
  // Track assistant-completed turns since last summary refresh to display turns-until-due
  const [turnsSince, setTurnsSince] = React.useState<number>(0);
  // Server-driven cadence values (fallbacks remain for local-only)
  const thresholdTurns = Number.isFinite(Number(fresh?.['thresholdTurns'])) ? Number((fresh as any)['thresholdTurns']) : (Number.parseInt(process.env.NEXT_PUBLIC_SUMMARY_REFRESH_TURNS || "8", 10) || 8);
  const refreshFresh = React.useCallback(async () => {
    if (!sessionId) return;
    setFreshStatus("loading");
    setFreshErr(undefined);
    try {
      try { console.log("[fresh] GET start", { sessionId }); } catch {}
      const reqId = Math.random().toString(36).slice(2);
      // Prefer UI API (Convex-backed) session summary
      const res = await fetch(`/api/v1/session-summary?sessionId=${encodeURIComponent(sessionId)}`, {
        method: "GET",
        headers: { accept: "application/json", "x-request-id": reqId },
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
      };
      try { console.log("[fresh] GET ok", { len: next.text.length, version: next.version, updatedAt: next.updatedAt }); } catch {}
      setFresh(next);
      setSinceFetchDelta(0);
      setHistory((cur) => {
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
  }, [sessionId]);
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
      const res = await fetch(`/api/v1/session-summary`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId, prevSummary: prev, messages: recentMessages, tokenBudget: 600 }),
      });
      const data = await res.json().catch(() => ({} as any));
      if (!res.ok) throw new Error(data?.error || `generate failed: ${res.status}`);
      // After ack, refresh to fetch latest text/version and transcript for diff
      await Promise.all([
        refreshFresh(),
        refreshServerTranscript(),
      ]);
      setFreshStatus("ready");
      try { console.log("[fresh] POST ok (ack)"); } catch {}
    } catch {}
  }, [sessionId, fresh?.text, fresh?.version, convo, mic.transcript, mic.assistantText]);
  // Server cadence: remove UI auto trigger; rely on backend via persisted interactions
  const lastAutoRef = React.useRef<number>(0);
  const autoInflightRef = React.useRef<boolean>(false);
  const meta = convo.getSummaryMeta();
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
  React.useEffect(() => {
    const cur = mic.assistantText || "";
    const prev = lastAssistantRef.current || "";
    if (cur && cur !== prev && !refreshInflightRef.current) {
      // Count a completed assistant turn
      setTurnsSince((n) => (Number.isFinite(n) ? n + 1 : 1));
      setSinceFetchDelta((d) => (Number.isFinite(d) ? d + 1 : 1));
      refreshInflightRef.current = true;
      lastAssistantRef.current = cur;
      setTimeout(() => {
        void Promise.all([
          refreshFresh(),
          refreshServerTranscript(),
          refreshSessionState(),
        ]).finally(() => { refreshInflightRef.current = false; });
      }, 1200);
    }
  }, [mic.assistantText, refreshFresh]);
  // Reset turn counter when a new summary arrives
  React.useEffect(() => {
    if (fresh?.updatedAt) setTurnsSince(0);
  }, [fresh?.updatedAt]);

  // Fetch profile data
  const fetchProfile = React.useCallback(async () => {
    setProfileLoading(true);
    try {
      const response = await fetch(`/api/v1/users/profile?userId=${encodeURIComponent(userId)}`);
      const data = await response.json();
      if (data.profile) {
        setProfile(data.profile);
      }
    } catch (error) {
      console.error('Failed to fetch profile:', error);
    } finally {
      setProfileLoading(false);
    }
  }, [userId]);

  // Fetch goals data
  const fetchGoals = React.useCallback(async () => {
    setGoalsLoading(true);
    try {
      const response = await fetch(`/api/v1/users/goals?userId=${encodeURIComponent(userId)}`);
      const data = await response.json();
      if (data.goals) {
        setGoals(data.goals);
      }
    } catch (error) {
      console.error('Failed to fetch goals:', error);
    } finally {
      setGoalsLoading(false);
    }
  }, [userId]);

  // Add new goal
  const addGoal = React.useCallback(async (title: string, description?: string) => {
    if (!title.trim()) return;
    try {
      const goalId = `goal_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      const response = await fetch('/api/v1/users/goals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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
  }, [userId, fetchGoals]);

  // Update goal
  const updateGoal = React.useCallback(async (goalId: string, updates: any) => {
    try {
      const response = await fetch('/api/v1/users/goals', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
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
  }, [userId, fetchGoals]);

  // Delete goal
  const deleteGoal = React.useCallback(async (goalId: string) => {
    try {
      const response = await fetch(`/api/v1/users/goals?userId=${encodeURIComponent(userId)}&goalId=${encodeURIComponent(goalId)}`, {
        method: 'DELETE'
      });
      if (response.ok) {
        await fetchGoals();
      }
    } catch (error) {
      console.error('Failed to delete goal:', error);
    }
  }, [userId, fetchGoals]);

  // Update profile
  const updateProfile = React.useCallback(async (displayName: string, bio: string) => {
    try {
      const response = await fetch('/api/v1/users/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
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
  }, [userId, fetchProfile]);

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
          className="fixed top-4 left-4 p-3 rounded-full bg-white border border-gray-300 shadow-sm hover:bg-gray-50 transition-colors z-40"
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
                      You've reached the maximum of 2 goals. Complete or delete existing goals to add more.
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
            [DEBUG]
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
            <div className="flex border-b border-gray-200 flex-shrink-0">
              <button
                type="button"
                onClick={() => setActiveTab('status')}
                className={`px-4 py-2 text-sm font-mono border-b-2 transition-colors ${
                  activeTab === 'status'
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                STATUS
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('prompt')}
                className={`px-4 py-2 text-sm font-mono border-b-2 transition-colors ${
                  activeTab === 'prompt'
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                LLM_PROMPT
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('summary')}
                className={`px-4 py-2 text-sm font-mono border-b-2 transition-colors ${
                  activeTab === 'summary'
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                SUMMARY
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('transcript')}
                className={`px-4 py-2 text-sm font-mono border-b-2 transition-colors ${
                  activeTab === 'transcript'
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                TRANSCRIPT
              </button>
            </div>

            {/* Tab Content */}
            <div className="p-4 bg-white text-black font-mono text-sm overflow-auto flex-1">
              {activeTab === 'status' && (
                <div className="space-y-3">
                  <div><span className="text-blue-600 font-semibold">&gt; USER:</span> {mic.transcript || <span className="text-gray-500">(none)</span>}</div>
                  <div><span className="text-blue-600 font-semibold">&gt; ASSISTANT:</span> {mic.assistantText || <span className="text-gray-500">(none)</span>}</div>
                  <div className="text-xs text-gray-600">status={mic.status} | loop={String(mic.vadLoop)} | recording={String(mic.recording)} | playing={String(audio.isPlaybackActive)}</div>
                  <div className="flex gap-2 flex-wrap">
                    {(() => {
                      const isAnyLoop = mic.vadLoop;
                      return (
                        <>
                          <button type="button" onClick={() => mic.startRecording()} disabled={isAnyLoop} className={`px-3 py-1.5 rounded border border-gray-300 text-gray-700 hover:bg-gray-50 ${isAnyLoop ? 'opacity-50 cursor-not-allowed' : ''}`}>[TAP_TO_SPEAK]</button>
                          <button type="button" onClick={() => mic.stopRecording()} disabled={isAnyLoop} className={`px-3 py-1.5 rounded border border-gray-300 text-gray-700 hover:bg-gray-50 ${isAnyLoop ? 'opacity-50 cursor-not-allowed' : ''}`}>[STOP]</button>
                          <button type="button" onClick={() => mic.toggleVadLoop()} className={`px-3 py-1.5 rounded border border-gray-300 text-gray-700 hover:bg-gray-50`}>[VAD_LOOP]: {mic.vadLoop ? 'ON' : 'OFF'}</button>
                          <button
                            type="button"
                            onClick={async () => {
                              if (!sessionId) { setIngestTestStatus('no sessionId'); return; }
                              try {
                                const now = Date.now();
                                const reqId = Math.random().toString(36).slice(2);
                                const body = { sessionId, messageId: `test_${now}`, role: 'user', contentHash: 'test', text: 'ping', ts: now };
                                const res = await fetch('/api/v1/interactions', { method: 'POST', headers: { 'content-type': 'application/json', 'x-request-id': reqId }, body: JSON.stringify(body) });
                                const data = await res.json().catch(() => ({} as any));
                                setIngestTestStatus(res.ok ? `ok id=${String(data?.id || '')}` : `err ${res.status}: ${String(data?.error || '')}`);
                              } catch (e) { setIngestTestStatus(e instanceof Error ? e.message : String(e)); }
                            }}
                            className={`px-3 py-1.5 rounded border border-gray-300 text-gray-700 hover:bg-gray-50`}
                          >[TEST_INGEST]</button>
                          <button type="button" onClick={() => (audio.isPaused ? audio.resume() : audio.pause())} className={`px-3 py-1.5 rounded border border-gray-300 text-gray-700 hover:bg-gray-50`}>[{audio.isPaused ? 'RESUME' : 'PAUSE'}_PLAYBACK]</button>
                        </>
                      );
                    })()}
                  </div>
                </div>
              )}

              {activeTab === 'prompt' && (
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <div className="text-sm font-mono text-blue-600 font-semibold">[LLM_PROMPT_DEBUG]</div>
                    <button type="button" onClick={() => { try { setPromptPreview(convo.getLastPromptPreview()); } catch {} }} className="px-2 py-1 text-xs border border-gray-300 rounded font-mono text-gray-700 hover:bg-gray-50">[REFRESH]</button>
                  </div>
                  <div className="text-xs text-gray-600 mb-2">{promptPreview ? 'STATUS: READY' : 'STATUS: EMPTY'}</div>
                  {promptPreview ? (
                    <div className="text-xs space-y-1">
                      <div className="text-blue-600 font-semibold">&gt; FULL_PROMPT_TO_LLM:</div>
                      <pre className="whitespace-pre-wrap bg-gray-50 border border-gray-200 p-3 rounded max-h-56 overflow-auto text-xs text-gray-800 font-mono">{promptPreview.prompt || ''}</pre>
                    </div>
                  ) : (
                    <div className="text-xs text-gray-500">(none)</div>
                  )}
                </div>
              )}

              {activeTab === 'summary' && (
                <div className="space-y-4">
                  {/* Fresh Summary */}
                  <div className="border border-gray-200 rounded p-3 bg-gray-50">
                    <div className="flex items-center justify-between mb-2">
                      <div className="text-sm font-mono text-blue-600 font-semibold">[FRESH_SUMMARY]</div>
                      <div className="flex gap-2">
                        <button type="button" onClick={refreshFresh} className="px-2 py-1 text-xs border border-gray-300 rounded font-mono text-gray-700 hover:bg-gray-100">[REFRESH]</button>
                        <button type="button" onClick={generateFresh} className="px-2 py-1 text-xs border border-gray-300 rounded font-mono text-gray-700 hover:bg-gray-100">[GENERATE]</button>
                      </div>
                    </div>
                    <div className="text-xs text-gray-600 mb-2">
                      status={freshStatus}
                      {fresh?.updatedAt ? ` | updated ${new Date(fresh.updatedAt).toLocaleTimeString()}` : ""}
                      {fresh ? ` | v${fresh.version}` : ""}
                      {(() => {
                        const serverTurnsSince = Number.isFinite(Number((fresh as any)?.turnsSince)) ? Number((fresh as any)?.turnsSince) : undefined;
                        const effectiveSince = serverTurnsSince !== undefined
                          ? Math.max(0, serverTurnsSince + (Number.isFinite(sinceFetchDelta) ? sinceFetchDelta : 0))
                          : (Number.isFinite(turnsSince) ? turnsSince : 0);
                        const suffix = serverTurnsSince !== undefined ? '' : ' (local)';
                        return ` | turns_until_due: ${Math.max(0, thresholdTurns - effectiveSince)}${suffix}`;
                      })()}
                    </div>
                    <div className="text-xs whitespace-pre-wrap min-h-[64px] text-gray-800">{fresh?.text || <span className="text-gray-500">(none)</span>}</div>

                    {/* Incorporated messages */}
                    <div className="mt-3">
                      <div className="text-xs text-gray-700 font-mono mb-2 font-semibold">&gt; MESSAGES_INCORPORATED_SINCE_LAST_CUTOFF:</div>
                      <div className="text-xs bg-white border border-gray-200 p-2 rounded max-h-40 overflow-auto font-mono">
                        {(() => {
                          const cutoff = fresh?.lastMessageTs || 0;
                          const msgs = serverTranscript
                            .filter(m => (m.createdAt ?? 0) > cutoff)
                            .map(m => `${m.role}: ${m.text}`);
                          if (!fresh || cutoff === 0 || msgs.length === 0) return <span className="text-gray-500">(none)</span>;
                          return <div className="space-y-1">{msgs.map((t, i) => (<div key={i} className="text-gray-800">{t}</div>))}</div>;
                        })()}
                      </div>
                    </div>

                    {freshErr ? <div className="text-xs text-red-600 mt-2 font-mono font-semibold">&gt; ERROR: {freshErr}</div> : null}

                    {/* Debug prompt details */}
                    <div className="mt-3">
                      <button type="button" onClick={() => setDbgOpen(o => !o)} className="px-2 py-1 text-xs border border-gray-300 rounded font-mono text-gray-700 hover:bg-gray-100">[{dbgOpen ? 'HIDE' : 'SHOW'}_LLM_PROMPT_DEBUG]</button>
                      {dbgOpen && (
                        <div className="mt-2 text-xs text-gray-700 space-y-2 font-mono">
                          <div className="text-blue-600 font-semibold">&gt; PREV_SUMMARY_PREVIEW:</div>
                          <div className="whitespace-pre-wrap bg-white border border-gray-200 p-2 rounded text-gray-800">{dbgPrompt?.prevSummary ? (dbgPrompt.prevSummary.length > 300 ? dbgPrompt.prevSummary.slice(0,300) + '…' : dbgPrompt.prevSummary) : '(none)'}</div>
                          <div className="text-blue-600 font-semibold mt-2">&gt; RECENT_MESSAGES ({dbgPrompt?.messages?.length ?? 0}):</div>
                          <div className="space-y-1">
                            {(dbgPrompt?.messages || []).slice(0, 6).map((m, i) => (
                              <div key={i} className="bg-white border border-gray-200 p-2 rounded">
                                <span className="text-blue-600 font-semibold">{m.role}:</span> <span className="text-gray-800">{m.content.length > 120 ? m.content.slice(0,120) + '…' : m.content}</span>
                              </div>
                            ))}
                            {(dbgPrompt?.messages || []).length > 6 ? <div className="text-gray-500">…and more</div> : null}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Summary History */}
                  <div className="border border-gray-200 rounded p-3 bg-gray-50">
                    <div className="flex items-center justify-between mb-2">
                      <div className="text-sm font-mono text-blue-600 font-semibold">[SUMMARY_HISTORY_LOCAL]</div>
                      <div className="text-xs text-gray-600">{history.length} versions</div>
                    </div>
                    {history.length === 0 ? (
                      <div className="text-xs text-gray-500">(empty)</div>
                    ) : (
                      <div className="space-y-2">
                        {history.map((h) => (
                          <div key={h.version} className="border border-gray-200 rounded bg-white">
                            <div className="flex items-center justify-between px-2 py-1 bg-gray-100">
                              <div className="text-xs text-gray-700 font-mono">v{h.version} | {new Date(h.updatedAt).toLocaleTimeString()}</div>
                              <button type="button" className="text-xs px-2 py-0.5 border border-gray-300 rounded font-mono text-gray-700 hover:bg-gray-200" onClick={() => setOpenMap((m) => ({ ...m, [h.version]: !m[h.version] }))}>[{openMap[h.version] ? 'HIDE' : 'SHOW'}]</button>
                            </div>
                            {openMap[h.version] ? (
                              <div className="p-2 text-xs whitespace-pre-wrap text-gray-800 font-mono">{h.text}</div>
                            ) : null}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {activeTab === 'transcript' && (
                <div className="space-y-4">
                  {/* Recent Messages */}
                  <div className="border border-gray-200 rounded p-3 bg-gray-50">
                    <div className="text-sm font-mono text-blue-600 font-semibold mb-2">[RECENT_MESSAGES]</div>
                    <div className="text-xs space-y-1 font-mono">
                      {convo.getImmediateHistory().length === 0 ? (
                        <div className="text-gray-500">(empty)</div>
                      ) : (
                        convo.getImmediateHistory().map((m, i) => (
                          <div key={i}><span className="text-blue-600 font-semibold">{m.role}:</span> <span className="text-gray-800">{m.content}</span></div>
                        ))
                      )}
                    </div>
                  </div>

                  {/* Server Transcript */}
                  <div className="border border-gray-200 rounded p-3 bg-gray-50">
                    <div className="flex items-center justify-between mb-2">
                      <div className="text-sm font-mono text-blue-600 font-semibold">[SERVER_TRANSCRIPT]</div>
                      <button type="button" onClick={refreshServerTranscript} className="px-2 py-1 text-xs border border-gray-300 rounded font-mono text-gray-700 hover:bg-gray-100">[REFRESH]</button>
                    </div>
                    <div className="text-xs text-gray-600 mb-1 font-mono">status={serverTranscriptStatus}</div>
                    <div className="text-xs space-y-1 max-h-56 overflow-auto font-mono">
                      {serverTranscript.length === 0 ? (
                        <div className="text-gray-500">(empty)</div>
                      ) : (
                        serverTranscript.map((m) => (
                          <div key={m.id}><span className="text-blue-600 font-semibold">{m.role}:</span> <span className="text-gray-800">{m.text || <span className="text-gray-500">(no text)</span>}</span></div>
                        ))
                      )}
                    </div>
                    {serverTranscriptErr ? <div className="text-xs text-red-600 mt-1 font-mono font-semibold">&gt; ERROR: {serverTranscriptErr}</div> : null}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Floating Mic Button */}
      <MicMinButton
        showDashboard={showDashboard}
        onDashboardClick={() => setShowDashboard(false)}
      />
    </div>
  );
}



export default App;
