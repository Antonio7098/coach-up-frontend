import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';

// Define routes that should be public (no auth required)
const isPublicRoute = createRouteMatcher([
  '/sign-in(.*)',
  '/sign-up(.*)',
  '/api/uploadthing(.*)',
  '/api/webhooks(.*)',
]);

// Define routes that should be protected (require auth)
const isProtectedRoute = createRouteMatcher([
  '/dashboard(.*)',
  '/settings(.*)',
  '/coach-min(.*)',
  '/api/v1/interactions(.*)',
]);

export default clerkMiddleware(async (auth, req) => {
  const session = await auth();
  const userId = session?.userId;
  const path = req.nextUrl.pathname;
  const isProduction = process.env.NODE_ENV === 'production';

  // In production, redirect root to /coach-min
  if (isProduction && path === '/') {
    return NextResponse.redirect(new URL('/coach-min', req.url));
  }

  // If it's a public route, allow access
  if (isPublicRoute(req)) {
    return NextResponse.next();
  }

  // If user is signed in and the route is protected, allow access
  if (userId && isProtectedRoute(req)) {
    return NextResponse.next();
  }

  // If user is not signed in and the route is protected, redirect to sign-in
  if (!userId && isProtectedRoute(req)) {
    const signInUrl = new URL('/sign-in', req.url);
    signInUrl.searchParams.set('redirect_url', req.url);
    return NextResponse.redirect(signInUrl);
  }

  // Allow access to all other routes
  return NextResponse.next();
});

// Configure which routes the middleware should run on
export const config = {
  matcher: [
    '/((?!.+\\.[\\w]+$|_next).*)',
    '/',
    '/(api|trpc)(.*)',
  ],
};