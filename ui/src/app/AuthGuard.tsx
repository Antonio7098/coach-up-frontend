"use client";

import { SignedIn, SignedOut, SignInButton, SignUpButton } from "@clerk/nextjs";
import { ChatProvider } from "../context/ChatContext";
import { MicProvider } from "../context/MicContext";
import { AudioProvider } from "../context/AudioContext";
import { VoiceProvider } from "../context/VoiceContext";
import { ConversationProvider } from "../context/ConversationContext";
import GlobalMicGate from "../components/GlobalMicGate";
import NavDirListener from "./NavDirListener";
import { MicUIProvider } from "../context/MicUIContext";
import ConvexClientProvider from "./ConvexClientProvider";

interface AuthGuardProps {
  children: React.ReactNode;
}

export default function AuthGuard({ children }: AuthGuardProps) {
  return (
    <>
      <SignedIn>
        <ConvexClientProvider>
          <ChatProvider>
            <VoiceProvider>
              <AudioProvider>
                <ConversationProvider>
                  <MicProvider>
                    <MicUIProvider>
                      {/* Global listener to mark popstate as 'back' for entry animations */}
                      <NavDirListener />
                      {children}
                      {/* Hide global mic on /coach-min to avoid confusion */}
                      <GlobalMicGate />
                    </MicUIProvider>
                  </MicProvider>
                </ConversationProvider>
              </AudioProvider>
            </VoiceProvider>
          </ChatProvider>
        </ConvexClientProvider>
      </SignedIn>

      <SignedOut>
        <div className="min-h-screen flex items-center justify-center bg-background">
          <div className="max-w-md w-full space-y-8 p-8">
            <div className="text-center">
              <h1 className="text-3xl font-bold text-foreground">Welcome to CoachUp</h1>
              <p className="mt-2 text-muted-foreground">
                Sign in to access your AI-powered speech coaching platform
              </p>
            </div>
            <div className="space-y-4">
              <SignInButton mode="modal">
                <button className="w-full bg-primary text-primary-foreground py-3 px-4 rounded-lg font-medium hover:bg-primary/90 transition-colors">
                  Sign In
                </button>
              </SignInButton>
              <SignUpButton mode="modal">
                <button className="w-full bg-secondary text-secondary-foreground py-3 px-4 rounded-lg font-medium hover:bg-secondary/90 transition-colors">
                  Sign Up
                </button>
              </SignUpButton>
            </div>
          </div>
        </div>
      </SignedOut>
    </>
  );
}
