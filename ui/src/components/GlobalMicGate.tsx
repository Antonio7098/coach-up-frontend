"use client";

import React, { useEffect } from "react";
import { usePathname } from "next/navigation";
import GlobalMicButton from "./GlobalMicButton";
import { useMic } from "../context/MicContext";
import { useConversation } from "../context/ConversationContext";
import { useVoice } from "../context/VoiceContext";
import { useAudio } from "../context/AudioContext";

export default function GlobalMicGate() {
  const pathname = usePathname();
  const mic = useMic();
  const convo = useConversation();
  const voice = useVoice();
  const audio = useAudio();

  useEffect(() => {
    if (pathname?.startsWith("/coach-min") || pathname?.startsWith("/coach-debug")) {
      try { mic.setVoiceLoop(false); } catch {}
      try { mic.stopRecording(); } catch {}
      try { convo.cancelActiveChatStream(); } catch {}
      try { voice.cancelTTS(); } catch {}
      try { audio.stopPlaybackAndClear(); } catch {}
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  if (pathname?.startsWith("/coach-min") || pathname?.startsWith("/coach-debug")) return null;
  return <GlobalMicButton />;
}


