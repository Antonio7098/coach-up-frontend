'use client';

import { SignIn } from '@clerk/nextjs';
import { devLog } from '../../../api/lib/observability';
import { useEffect } from 'react';

export default function Page() {
  useEffect(() => {
    devLog("info", "auth:sign-in: Page loaded", {
      timestamp: new Date().toISOString(),
      userAgent: typeof window !== 'undefined' ? window.navigator.userAgent : 'unknown'
    });
  }, []);

  const handleSignInSuccess = () => {
    devLog("info", "auth:sign-in: Authentication successful", {
      redirectUrl: "/coach-min",
      timestamp: new Date().toISOString()
    });
  };

  const handleSignInError = (error: any) => {
    devLog("warn", "auth:sign-in: Authentication failed", {
      error: error?.message || 'Unknown error',
      timestamp: new Date().toISOString()
    });
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-background">
      <SignIn
        afterSignInUrl="/coach-min"
        afterSignUpUrl="/coach-min"
      />
    </div>
  );
}
