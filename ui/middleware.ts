import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

// Debug middleware - very simple to test if middleware runs at all
export function middleware(request: NextRequest) {
  // Force log to console.error to make sure it shows up
  console.error(`[DEBUG-MW] Running middleware for: ${request.method} ${request.nextUrl.pathname}`);

  const response = NextResponse.next();
  response.headers.set('X-Middleware-Debug', Date.now().toString());

  return response;
}

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico).*)'],
};