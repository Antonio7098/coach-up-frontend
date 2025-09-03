import { auth, getAuth } from "@clerk/nextjs/server";
import { verifyToken } from "@clerk/backend";

export type AuthResult = {
  ok: boolean;
  userId?: string;
  reason?: string;
};

// Optional gating: only enforced when CLERK_ENABLED=1
export async function requireAuth(request: Request): Promise<AuthResult> {
  try {
    const enabled = process.env.CLERK_ENABLED === "1";
    // Safe diagnostics: no secrets, only booleans and meta
    let path = "";
    let host = "";
    let query = "";
    try {
      const u = new URL(request.url);
      path = u.pathname;
      host = u.host;
      query = u.search;
    } catch {}
    
    const headersIn = new Headers((request as any)?.headers || {});
    const authHeader = headersIn.get("authorization") || headersIn.get("Authorization") || '';
    const hasAuthHeader = !!authHeader;
    const authHeaderPrefix = hasAuthHeader ? (authHeader.split(' ')[0] || '') : '';
    const cookieHeader = headersIn.get("cookie") || "";
    const hasClerkCookie = /(__session|Clerk)/i.test(cookieHeader);
    const hasPublishable = !!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
    const hasSecret = !!process.env.CLERK_SECRET_KEY;
    
    // Enhanced debug logging
    try { 
      console.log(JSON.stringify({ 
        level: 'debug', 
        where: 'requireAuth.entry', 
        path,
        query,
        method: (request as any)?.method,
        host, 
        enabled, 
        authHeaderPrefix,
        hasAuthHeader, 
        hasClerkCookie, 
        env: { 
          hasPublishable, 
          hasSecret,
          clerkEnabled: enabled,
          nodeEnv: process.env.NODE_ENV,
          vercelEnv: process.env.VERCEL_ENV
        } 
      })); 
    } catch {}
    if (!enabled) {
      return { ok: true, userId: "anonymous" };
    }

    // 1) Try verifying a Bearer token directly (does not require middleware)
    const authz = headersIn.get("authorization") || headersIn.get("Authorization");
    const token = authz?.toLowerCase().startsWith("bearer ") ? authz.slice(7).trim() : undefined;
    if (token && process.env.CLERK_SECRET_KEY) {
      try {
        const payload: any = await verifyToken(token, { secretKey: process.env.CLERK_SECRET_KEY });
        const userId = payload?.sub || payload?.userId;
        if (userId) {
          try { 
            console.log(JSON.stringify({ 
              level: 'info', 
              where: 'requireAuth.ok', 
              path,
              via: 'verifyToken',
              userId,
              tokenLength: token?.length,
              tokenPrefix: token?.substring(0, 10) + '...',
              timestamp: new Date().toISOString()
            })); 
          } catch {}
          return { ok: true, userId: String(userId) };
        }
      } catch (e: any) {
        try { console.log(JSON.stringify({ level: 'warn', where: 'requireAuth.verifyToken.fail', path, msg: e?.message })); } catch {}
      }
    }

    // 2) Try reading auth from the incoming Request (may throw if middleware missing)
    try {
      const fromReq = getAuth(request as any);
      try { console.log(JSON.stringify({ level: 'debug', where: 'requireAuth.getAuth', path, hasFromReq: !!fromReq, fromReqUserId: !!fromReq?.userId })); } catch {}
      if (fromReq?.userId) {
        try { console.log(JSON.stringify({ level: 'info', where: 'requireAuth.ok', path, via: 'getAuth(request)' })); } catch {}
        return { ok: true, userId: fromReq.userId };
      }
    } catch (e: any) {
      // Swallow, we'll try auth() next; report as debug only
      try { console.log(JSON.stringify({ level: 'debug', where: 'requireAuth.getAuth.catch', path, msg: e?.message })); } catch {}
    }

    // 3) Fallback to auth() (requires clerkMiddleware context)
    try {
      const { userId } = await auth();
      try { console.log(JSON.stringify({ level: 'debug', where: 'requireAuth.auth()', path, hasUserId: !!userId })); } catch {}
      if (userId) {
        try { console.log(JSON.stringify({ level: 'info', where: 'requireAuth.ok', path, via: 'auth()' })); } catch {}
        return { ok: true, userId };
      }
    } catch (e: any) {
      // No middleware context; don't fail yet
      try { console.log(JSON.stringify({ level: 'debug', where: 'requireAuth.auth.catch', path, msg: e?.message })); } catch {}
    }

    return { ok: false, reason: "unauthenticated" };
  } catch (e) {
    const errorMessage = e instanceof Error ? e.message : String(e);
    try { console.log(JSON.stringify({ level: 'error', where: 'requireAuth.catch', msg: errorMessage })); } catch {}
    try { console.error("[auth] error:", e); } catch {}
    return { ok: false, reason: "auth_error" };
  }
}
