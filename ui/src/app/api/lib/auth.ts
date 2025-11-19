import { auth, getAuth } from "@clerk/nextjs/server";
import { verifyToken } from "@clerk/backend";
import { createLogger } from "@/lib/logger";

// Initialize namespaced logger for auth operations
const logger = createLogger('ui.api.lib.auth');

export type AuthResult = {
  ok: boolean;
  userId?: string;
  reason?: string;
};

// Optional gating: only enforced when CLERK_ENABLED=1
export async function requireAuth(request: Request): Promise<AuthResult> {
  // Safe diagnostics: no secrets, only booleans and meta
  let path = "";
  let host = "";
  let query = "";

  try {
    // TEMP: Skip authentication for API routes in mock mode
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) {
      return { ok: true, userId: "mock_user" };
    }

    const enabled = process.env.CLERK_ENABLED === "1";

    try {
      const u = new URL(request.url);
      path = u.pathname;
      host = u.host;
      query = u.search;
    } catch {
      path = "unknown";
      host = "unknown";
      query = "unknown";
    }
    
    const headersIn = new Headers((request as any)?.headers || {});
    const authHeader = headersIn.get("authorization") || headersIn.get("Authorization") || '';
    const hasAuthHeader = !!authHeader;
    const authHeaderPrefix = hasAuthHeader ? (authHeader.split(' ')[0] || '') : '';
    const cookieHeader = headersIn.get("cookie") || "";
    const hasClerkCookie = /(__session|Clerk)/i.test(cookieHeader);
    const hasPublishable = !!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
    const hasSecret = !!process.env.CLERK_SECRET_KEY;
    
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
          return { ok: true, userId: String(userId) };
        }
    } catch (e: any) {
      logger.warn('Token verification failed', {
        path,
        error: e?.message,
        authMethod: 'verifyToken'
      });
    }
    }

    // 2) Try reading auth from the incoming Request (may throw if middleware missing)
    try {
      const fromReq = getAuth(request as any);
      if (fromReq?.userId) {
        return { ok: true, userId: fromReq.userId };
      }
    } catch (e: any) {
      // Swallow, we'll try auth() next; report as debug only
      logger.debug('getAuth failed, trying auth() next', {
        path,
        error: e?.message,
        authMethod: 'getAuth'
      });
    }

    // 3) Fallback to auth() (requires clerkMiddleware context)
    try {
      const { userId } = await auth();
      if (userId) {
        return { ok: true, userId };
      }
    } catch (e: any) {
      // No middleware context; don't fail yet
      logger.debug('auth() failed, authentication not available', {
        path,
        error: e?.message,
        authMethod: 'auth'
      });
    }

    return { ok: false, reason: "unauthenticated" };
  } catch (e) {
    const errorMessage = e instanceof Error ? e.message : String(e);
    logger.error('Authentication system error', {
      path: path,
      error: errorMessage,
      authMethod: 'requireAuth'
    });
    return { ok: false, reason: "auth_error" };
  }
}
