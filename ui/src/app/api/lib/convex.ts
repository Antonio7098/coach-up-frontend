import { ConvexHttpClient } from "convex/browser";
import { devLog } from "./observability";

export type ConvexCaller = {
  mutation(name: string, args: unknown): Promise<unknown>;
  query(name: string, args: unknown): Promise<unknown>;
};

// Mock Convex client that uses the shared mock server
class MockConvexClient implements ConvexCaller {
  private baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
    devLog("info", "ConvexClient: Mock client initialized", { baseUrl });
  }

  async mutation(name: string, args: unknown): Promise<unknown> {
    const [module, method] = name.split(':');
    devLog("debug", "ConvexClient: Mock mutation called", { name, module, method });

    // Map Convex mutations to our mock server endpoints
    switch (name) {
      case 'assessments:recordSkillAssessmentV2':
        return this.callMockServer('/api/assessments/finalize', 'POST', {
          sessionId: (args as any).sessionId,
          groupId: (args as any).groupId,
          rubricVersion: 'v3',
          summary: {
            skillAssessments: [{
              skillId: (args as any).skillId,
              skillHash: (args as any).skillHash,
              level: (args as any).level,
              confidence: (args as any).confidence,
              levelFeedback: (args as any).levelFeedback,
              assessmentMetadata: (args as any).assessmentMetadata,
              sourceContext: (args as any).sourceContext
            }]
          }
        });
      
      case 'functions/sessions:getBySessionId':
        return this.callMockServer(`/api/sessions/${(args as any).sessionId}`, 'GET');
      
      case 'functions/skills:updateLevelFromRecentAssessments':
        // Mock level update - just return success
        return { ok: true, updated: false };
      
      case 'assessments:checkFinalizeIdempotency':
        // Mock idempotency check - always allow
        return null;
      
      case 'assessments:markFinalizeCompleted':
        // Mock completion - just return success
        return { ok: true };
      
      case 'events:logEvent':
        return this.callMockServer('/api/events', 'POST', args);
      
      case 'assessments:persistAssessmentResultsV2':
        // Mock results persistence - just return success
        return { ok: true };
      
      case 'functions/users:upsertUserProfile':
        return this.callMockServer(`/api/users/${(args as any).userId}/profile`, 'POST', args);
      
      case 'functions/users:addOrUpdateGoal':
        return this.callMockServer(`/api/users/${(args as any).userId}/goals`, 'POST', args);
      
      case 'functions/users:deleteGoal':
        return this.callMockServer(`/api/users/${(args as any).userId}/goals?goalId=${(args as any).goalId}`, 'DELETE');
      
      case 'functions/skills:trackSkill':
        return this.callMockServer(`/api/users/${(args as any).userId}/skills/track`, 'POST', args);
      
      case 'functions/skills:untrackSkill':
        // Mock untrack - just return success
        return { ok: true };
      
      case 'functions/sessions:updateSessionState':
        return this.callMockServer('/api/sessions/state', 'POST', args);
      
      case 'functions/interactions:appendInteraction':
        return this.callMockServer('/api/interactions', 'POST', args);
      
      case 'functions/events:logEvent':
        return this.callMockServer('/api/events', 'POST', args);

      case 'functions/triage:enqueueJob':
        return this.callMockServer('/api/triage/enqueueJob', 'POST', args);

      case 'functions/summaries:ensureJob':
        // Mock summary job - return accepted with version 1
        return {
          accepted: true,
          version: 1,
          cutoffIndex: 1,
          reason: 'accepted'
        };

      default:
        console.warn(`[MockConvex] Unknown mutation: ${name}`);
        return { ok: true };
    }
  }

  async query(name: string, args: unknown): Promise<unknown> {
    const [module, method] = name.split(':');
    
    // Map Convex queries to our mock server endpoints
    switch (name) {
      case 'functions/sessions:getBySessionId':
        return this.callMockServer(`/api/sessions/${(args as any).sessionId}`, 'GET');
      
      case 'assessments:checkFinalizeIdempotency':
        // Mock idempotency check - always allow
        return null;
      
      case 'assessments:getLatestAssessmentResults':
        return this.callMockServer(`/api/session-summary/${(args as any).sessionId}`, 'GET');

      case 'assessments:getLatestBySession':
        return this.callMockServer(`/api/assessments/latest?sessionId=${(args as any).sessionId}`, 'GET');
      
      case 'functions/users:getUserProfile':
        return this.callMockServer(`/api/users/${(args as any).userId}/profile`, 'GET');
      
      case 'functions/users:listUserGoals':
        return this.callMockServer(`/api/users/${(args as any).userId}/goals`, 'GET');
      
      case 'functions/skills:listActiveSkills':
        return this.callMockServer('/api/skills/active', 'GET');
      
      case 'functions/skills:listTrackedSkillsForUser':
        return this.callMockServer(`/api/users/${(args as any).userId}/skills/tracked`, 'GET');

      case 'functions/skills:getTrackedSkillsForUser':
        return this.callMockServer(`/api/users/${(args as any).userId}/skills/tracked`, 'GET');

      case 'functions/interactions:listInteractionsBySession':
        return this.callMockServer(`/api/interactions?sessionId=${(args as any).sessionId}&limit=${(args as any).limit || 50}`, 'GET');
      
      case 'functions/interactions:listInteractionsByGroup':
        return this.callMockServer(`/api/interactions?groupId=${(args as any).groupId}&limit=${(args as any).limit || 50}`, 'GET');

      case 'functions/interactions:listBySession':
        return this.callMockServer(`/api/interactions?sessionId=${(args as any).sessionId}&limit=${(args as any).limit || 50}`, 'GET');

      case 'functions/summaries:getStatus':
        // Mock summary status - return empty status for now
        return {
          lastSummary: null,
          latest: null,
          assistantSince: 1,
          thresholdTurns: 4,
          ageSec: 0,
          lastJobAt: null
        };

      case 'functions/summaries:getLatest':
        // Mock latest summary - return null for now
        return null;

      default:
        console.warn(`[MockConvex] Unknown query: ${name}`);
        return null;
    }
  }

  private async callMockServer(endpoint: string, method: string, body?: unknown): Promise<unknown> {
    try {
      const response = await fetch(`${this.baseUrl}${endpoint}`, {
        method,
        headers: {
          'Content-Type': 'application/json',
        },
        body: body ? JSON.stringify(body) : undefined,
      });

      if (!response.ok) {
        throw new Error(`Mock server error: ${response.status} ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      console.error(`[MockConvex] Error calling ${endpoint}:`, error);
      throw error;
    }
  }
}

export const makeConvex = (url: string): ConvexCaller => {
  devLog("info", "ConvexClient: makeConvex called", { url, mockMode: process.env.MOCK_CONVEX === '1' });

  // Check if we should use the shared mock server
  if (process.env.MOCK_CONVEX === '1') {
    const mockServerUrl = process.env.MOCK_CONVEX_SERVER_URL || 'http://localhost:3211';
    devLog("info", "ConvexClient: Using mock server", { mockServerUrl });
    return new MockConvexClient(mockServerUrl);
  }

  devLog("info", "ConvexClient: Using real Convex server", { url });
  const client = new ConvexHttpClient(url);
  
  // Create a wrapper that matches our ConvexCaller interface
  return {
  async query(name: string, args: unknown): Promise<unknown> {
    devLog("debug", "ConvexClient: Query called", { name, args: typeof args === 'object' ? Object.keys(args as any) : typeof args });
    const result = await (client as any).query(name, args);
    devLog("debug", "ConvexClient: Query completed", { name, hasResult: result !== undefined });
    return result;
  },
    async mutation(name: string, args: unknown): Promise<unknown> {
      devLog("debug", "ConvexClient: Mutation called", { name, args: typeof args === 'object' ? Object.keys(args as any) : typeof args });
      const result = await (client as any).mutation(name, args);
      devLog("debug", "ConvexClient: Mutation completed", { name, hasResult: result !== undefined });
      return result;
    }
  };
};
