'use client';

import { SignUp } from '@clerk/nextjs';

export default function Page() {
  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-background">
      <SignUp afterSignUpUrl="/coach-min" afterSignInUrl="/coach-min" />
    </div>
  );
}
