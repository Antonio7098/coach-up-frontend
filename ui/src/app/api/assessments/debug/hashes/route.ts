export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { makeConvex } from "../../../lib/convex";
import * as mockConvex from "../../../lib/mockConvex";
import { sha256Hex } from "../../../lib/hash";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Request-Id, Authorization",
  "Access-Control-Expose-Headers": "X-Request-Id",
};

function convexBaseUrl() {
  return process.env.CONVEX_URL || process.env.NEXT_PUBLIC_CONVEX_URL || "http://127.0.0.1:3210";
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders });
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const sessionId = String(url.searchParams.get('sessionId') || '').trim();
  if (!sessionId) {
    return new Response(JSON.stringify({ error: 'sessionId is required' }), { status: 400, headers: { 'content-type': 'application/json', ...corsHeaders } });
  }
  const useMock = process.env.MOCK_CONVEX === '1';
  const salt = (process.env.SKILL_HASH_SALT || process.env.NEXT_PUBLIC_SKILL_HASH_SALT || 'test_salt').trim();

  try {
    let skills: Array<{ id: string; title?: string; currentLevel?: number }> = [];
    if (useMock) {
      // Resolve mock session -> user -> tracked skills
      try {
        const sess: any = await mockConvex.getSessionById({ sessionId }).catch(() => null);
        const userId = String(sess?.userId || 'mock_user');
        const rows: any[] = await mockConvex.listTrackedSkillsForUser({ userId }).catch(() => []) as any[];
        skills = (Array.isArray(rows) ? rows : []).map(r => ({ id: String(r?.skillId || r?.skill?.id || r?.id || ''), title: String(r?.skill?.title || r?.title || ''), currentLevel: Number(r?.currentLevel ?? r?.level ?? 0) }));
      } catch {}
    } else {
      const client = makeConvex(convexBaseUrl());
      const sess: any = await client.query("functions/sessions:getBySessionId", { sessionId }).catch(() => null);
      const userId = String(sess?.userId || 'unknown');
      const rows: any[] = await client.query("functions/skills:getTrackedSkillsForUser", { userId }).catch(() => []) as any[];
      skills = (Array.isArray(rows) ? rows : []).map(r => ({ id: String(r?.skillId || r?.skill?.id || r?.id || ''), title: String(r?.skill?.title || r?.title || ''), currentLevel: Number(r?.currentLevel ?? r?.level ?? 0) }));
    }

    const computed = skills.filter(s => s.id).map(s => ({
      skillId: s.id,
      hash: sha256Hex(`${salt}:${s.id}`),
      title: s.title,
      currentLevel: s.currentLevel,
    }));

    return new Response(JSON.stringify({ sessionId, saltLen: salt.length, count: computed.length, items: computed }, null, 2), {
      status: 200,
      headers: { 'content-type': 'application/json; charset=utf-8', ...corsHeaders },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: 'debug_failed', detail: String(e || '') }), { status: 500, headers: { 'content-type': 'application/json', ...corsHeaders } });
  }
}
