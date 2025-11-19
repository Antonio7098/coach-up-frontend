import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server'

const isProtectedRoute = createRouteMatcher([
  '/coach(.*)',
  '/coach-min(.*)',
  '/settings(.*)',
  '/chat(.*)',
  '/skills(.*)',
])

export default clerkMiddleware(async (auth, req) => {
  const startTime = Date.now();

  console.log(`middleware: processing request for ${req.nextUrl.pathname}`, {
    method: req.method,
    userAgent: req.headers.get('user-agent'),
    isProtected: isProtectedRoute(req),
    isApiRoute: req.nextUrl.pathname.startsWith('/api/')
  });

  // Skip authentication for API routes in mock mode
  if (req.nextUrl.pathname.startsWith('/api/')) {
    console.log(`middleware: skipping auth for API route`, {
      path: req.nextUrl.pathname,
      processingTimeMs: Date.now() - startTime
    });
    return
  }

  // Protect routes that require authentication
  if (isProtectedRoute(req)) {
    console.log(`middleware: protecting route`, {
      path: req.nextUrl.pathname,
      beforeAuthTimeMs: Date.now() - startTime
    });
    await auth.protect()
    console.log(`middleware: auth protection completed`, {
      path: req.nextUrl.pathname,
      totalProcessingTimeMs: Date.now() - startTime
    });
  }
})

export const config = {
  matcher: [
    // Run middleware for app routes only; explicitly exclude /api and /trpc
    '/((?!.+\\.[\\w]+$|_next|api|trpc).*)',
    '/',
  ],
}
