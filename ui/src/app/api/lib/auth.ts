import { auth, getAuth } from "@clerk/nextjs/server";

export type AuthResult = {
  ok: boolean;
  userId?: string;
  reason?: string;
};

// Optional gating: only enforced when CLERK_ENABLED=1
export async function requireAuth(request: Request): Promise<AuthResult> {
  try {
    const enabled = process.env.CLERK_ENABLED === "1";
    if (!enabled) {
      return { ok: true, userId: "anonymous" };
    }

    // Prefer reading auth directly from the incoming Request (works without middleware)
    const fromReq = getAuth(request as any);
    if (fromReq?.userId) {
      return { ok: true, userId: fromReq.userId };
    }

    // Fallback to auth() (requires clerkMiddleware context)
    const { userId } = await auth();
    if (userId) {
      return { ok: true, userId };
    }

    return { ok: false, reason: "unauthenticated" };
  } catch (e) {
    const errorMessage = e instanceof Error ? e.message : String(e);
    if (errorMessage.includes("clerkMiddleware") || errorMessage.includes("cannot detect")) {
      return { ok: false, reason: "middleware_error" };
    }
    try { console.error("[auth] error:", e); } catch {}
    return { ok: false, reason: "auth_error" };
  }
}
