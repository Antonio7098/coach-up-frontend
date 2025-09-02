import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

// Simple test middleware to verify it's running
export function middleware(request: NextRequest) {
  console.log(`[TEST-MW] ${request.method} ${request.nextUrl.pathname}`);

  // Add a custom header to verify middleware is running
  const response = NextResponse.next();
  response.headers.set('X-Middleware-Test', 'working');

  return response;
}

export const config = {
  matcher: [
    // Match all routes except static files
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
  ],
};