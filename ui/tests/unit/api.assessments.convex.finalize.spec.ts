import { describe, it, expect, beforeEach } from 'vitest';
import { POST as finalizePOST } from '../../src/app/api/assessments/convex/finalize/route';
import { getLatestConvexClientMock, setConvexMockBehavior } from '../setup.vitest';

describe('API: POST /api/assessments/convex/finalize (v2)', () => {
  beforeEach(() => {
    setConvexMockBehavior({ queryReturn: undefined, queryThrow: null, mutationReturn: { ok: true }, mutationThrow: null });
    // Avoid bearer enforcement and ensure Convex URL present (client is mocked)
    delete (process.env as any).PERSIST_ASSESSMENTS_SECRET;
    (process.env as any).NEXT_PUBLIC_CONVEX_URL = 'http://example-convex.test';
  });

  it('returns 400 on invalid JSON', async () => {
    const req = new Request('http://localhost:3000/api/assessments/convex/finalize', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{"bad":',
    });
    const res = await finalizePOST(req);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Invalid JSON' });
  });

  it('returns 400 when rubricVersion is not v2', async () => {
    const payload = {
      sessionId: 's1',
      groupId: 'g1',
      rubricVersion: 'v1',
      summary: { skillAssessments: [] },
    };
    const req = new Request('http://localhost:3000/api/assessments/convex/finalize', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const res = await finalizePOST(req);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "rubricVersion must be 'v2'" });
  });

  it('returns 400 when skillAssessments is empty', async () => {
    const payload = {
      sessionId: 's1',
      groupId: 'g1',
      rubricVersion: 'v2',
      summary: { skillAssessments: [] },
    };
    const req = new Request('http://localhost:3000/api/assessments/convex/finalize', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const res = await finalizePOST(req);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "summary.skillAssessments must be a non-empty array" });
  });

  it('returns 400 when skillHash is empty', async () => {
    const payload = {
      sessionId: 's1',
      groupId: 'g1',
      rubricVersion: 'v2',
      summary: {
        skillAssessments: [
          { 
            skillId: 'test',
            skillHash: '', 
            level: 5, 
            confidence: 0.8,
            levelFeedback: {
              currentLevel: 5,
              nextLevelCriteria: [],
              strengths: [],
              improvements: [],
              focus: []
            },
            assessmentMetadata: {
              provider: 'test'
            },
            sourceContext: {}
          }
        ]
      },
    };
    const req = new Request('http://localhost:3000/api/assessments/convex/finalize', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const res = await finalizePOST(req);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "skillAssessments[0]: skillHash must be non-empty string" });
  });

  it('returns 400 when level is out of range', async () => {
    const payload = {
      sessionId: 's1',
      groupId: 'g1',
      rubricVersion: 'v2',
      summary: {
        skillAssessments: [
          { 
            skillId: 'test',
            skillHash: 'sh_test', 
            level: 15, 
            confidence: 0.8,
            levelFeedback: {
              currentLevel: 15,
              nextLevelCriteria: [],
              strengths: [],
              improvements: [],
              focus: []
            },
            assessmentMetadata: {
              provider: 'test'
            },
            sourceContext: {}
          }
        ]
      },
    };
    const req = new Request('http://localhost:3000/api/assessments/convex/finalize', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const res = await finalizePOST(req);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "skillAssessments[0]: level must be a number between 0 and 10" });
  });

  it('calls v2 Convex mutations and returns 200 with processed count', async () => {
    setConvexMockBehavior({
      queryReturn: { userId: 'u1' },
      queryThrow: null,
      mutationReturn: { ok: true },
      mutationThrow: null
    });
    const payload = {
      sessionId: 's_fin_ok',
      groupId: 'g_fin_ok',
      rubricVersion: 'v2',
      summary: {
        skillAssessments: [
          {
            skillId: 'communication',
            skillHash: 'sh_communication',
            level: 6,
            confidence: 0.85,
            levelFeedback: {
              currentLevel: 6,
              nextLevelCriteria: ['Be more concise'],
              strengths: ['Clear communication'],
              improvements: ['Work on brevity'],
              focus: ['Practice concise responses'],
              examples: ['Good work']
            },
            assessmentMetadata: {
              provider: 'google',
              modelId: 'gemini-1.5-flash',
              processingTimeMs: 1200,
              tokenCount: 450,
              costCents: 2
            },
            sourceContext: {
              interactionCount: 5,
              transcriptLength: 800,
              assessmentType: 'roleplay_scenario',
              sessionDuration: 1800000
            }
          }
        ]
      },
    };
    const req = new Request('http://localhost:3000/api/assessments/convex/finalize', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const res = await finalizePOST(req);
    expect(res.status).toBe(200);
    const response = await res.json();
    expect(response).toEqual({ status: 'ok', processed: 1, idempotent: false });
    const client = getLatestConvexClientMock();
    expect(client).toBeTruthy();
    expect(client.mutation).toHaveBeenCalledWith(
      'assessments:recordSkillAssessmentV2',
      expect.objectContaining({
        userId: 'u1',
        sessionId: 's_fin_ok',
        groupId: 'g_fin_ok',
        skillId: 'communication',
        skillHash: 'sh_communication',
        level: 6,
        confidence: 0.85,
        levelFeedback: expect.objectContaining({
          currentLevel: 6,
          nextLevelCriteria: ['Be more concise'],
          strengths: ['Clear communication'],
          improvements: ['Work on brevity'],
          focus: ['Practice concise responses'],
          examples: ['Good work']
        }),
        assessmentMetadata: expect.objectContaining({
          provider: 'google',
          modelId: 'gemini-1.5-flash'
        }),
        sourceContext: expect.objectContaining({
          interactionCount: 5,
          transcriptLength: 800
        }),
        rubricVersion: 'v2',
      }),
    );
    expect(client.mutation).toHaveBeenCalledWith(
      'functions/skills:updateLevelFromRecentAssessments',
      expect.objectContaining({
        userId: 'u1',
        sessionId: 's_fin_ok',
        groupId: 'g_fin_ok',
        skillHash: 'sh_communication',
      }),
    );
    expect(client.mutation).toHaveBeenCalledWith(
      'assessments:markFinalizeCompleted',
      expect.objectContaining({
        sessionId: 's_fin_ok',
        groupId: 'g_fin_ok',
      }),
    );
  });

  it('returns 200 with idempotent: true on duplicate (sessionId, groupId)', async () => {
    setConvexMockBehavior({
      queryReturn: { completedAt: Date.now(), expiresAt: Date.now() + 86400000 },
      queryThrow: null,
      mutationReturn: { ok: true },
      mutationThrow: null
    });
    const payload = {
      sessionId: 's_dup',
      groupId: 'g_dup',
      rubricVersion: 'v2',
      summary: {
        skillAssessments: [
          {
            skillHash: 'sh_test',
            level: 5,
            metCriteria: [],
            unmetCriteria: [],
            feedback: []
          }
        ]
      },
    };
    const req = new Request('http://localhost:3000/api/assessments/convex/finalize', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const res = await finalizePOST(req);
    expect(res.status).toBe(200);
    const response = await res.json();
    expect(response).toEqual({ status: 'ok', processed: 0, idempotent: true });
    const client = getLatestConvexClientMock();
    expect(client.query).toHaveBeenCalledWith(
      'assessments:checkFinalizeIdempotency',
      { sessionId: 's_dup', groupId: 'g_dup' },
    );
  });
});
