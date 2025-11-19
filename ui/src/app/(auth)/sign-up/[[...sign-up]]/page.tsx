'use client';

import { SignUp } from '@clerk/nextjs';
import { devLog } from '../../../api/lib/observability';
import { useEffect } from 'react';

export default function Page() {
  useEffect(() => {
    devLog("info", "auth:sign-up: Page loaded", {
      timestamp: new Date().toISOString(),
      userAgent: typeof window !== 'undefined' ? window.navigator.userAgent : 'unknown'
    });
  }, []);

  const handleSignUpSuccess = (user: any) => {
    devLog("info", "auth:sign-up: Registration successful", {
      userId: user?.id || 'unknown',
      email: user?.primaryEmailAddress?.emailAddress || 'unknown',
      redirectUrl: "/coach-min",
      timestamp: new Date().toISOString()
    });
  };

  const handleSignUpError = (error: any) => {
    devLog("warn", "auth:sign-up: Registration failed", {
      error: error?.message || 'Unknown error',
      timestamp: new Date().toISOString()
    });
  };

  const handleEmailVerification = () => {
    devLog("info", "auth:sign-up: Email verification initiated", {
      timestamp: new Date().toISOString()
    });
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-background">
      <SignUp
        afterSignUpUrl="/coach-min"
        afterSignInUrl="/coach-min"
      />
    </div>
  );
}
