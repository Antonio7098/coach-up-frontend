import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

// Optional: protect all routes (except public) when enabled via env flag.
// Defaults to disabled to keep local dev and E2E flows working without sign-in.
const protectAll = process.env.CLERK_PROTECT_ALL === "1";
const isPublicRoute = createRouteMatcher([
  "/sign-in(.*)",
]);

export default clerkMiddleware(async (auth, req) => {
  // Always run middleware; only call protect() when the flag is enabled
  // and the current route is not public. This aligns with Clerk's App Router guide.
  try {
    // Light diagnostic to verify middleware execution and matcher coverage
    // Note: keep concise to avoid noisy logs in CI
    // eslint-disable-next-line no-console
    console.info(`[clerk-mw] ${req.method} ${req.nextUrl.pathname}`);
  } catch {}
  if (protectAll && !isPublicRoute(req)) {
    await auth.protect();
  }
});

export const config = {
  matcher: [
    // Skip Next.js internals and all static files, unless found in search params
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    // Always run for API routes
    "/(api|trpc)(.*)",
  ],
};
