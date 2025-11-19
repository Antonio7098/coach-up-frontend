"use client";

import React, { useEffect } from "react";
import { usePathname } from "next/navigation";
import GlobalMicButton from "./GlobalMicButton";
import { useMic } from "../context/MicContext";
import { useConversation } from "../context/ConversationContext";
import { useVoice } from "../context/VoiceContext";
import { useAudio } from "../context/AudioContext";
import { devLog } from "../app/api/lib/observability";

export default function GlobalMicGate() {
  const pathname = usePathname();
  const mic = useMic();
  const convo = useConversation();
  const voice = useVoice();
  const audio = useAudio();

  devLog("debug", "GlobalMicGate: component initialized", {
    pathname,
    timestamp: new Date().toISOString()
  });

  useEffect(() => {
    const isCoachPage = pathname?.startsWith("/coach-min") || pathname?.startsWith("/coach-debug") || pathname?.startsWith("/coach-new");
    devLog("debug", "GlobalMicGate: pathname changed", { pathname, isCoachPage });

    if (isCoachPage) {
      devLog("info", "GlobalMicGate: entering coach page, cleaning up state");
      try { mic.setVoiceLoop(false); } catch {}
      try { mic.stopRecording(); } catch {}
      try { convo.cancelActiveChatStream(); } catch {}
      try { voice.cancelTTS(); } catch {}
      try { audio.stopPlaybackAndClear(); } catch {}
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  const isCoachPage = pathname?.startsWith("/coach-min") || pathname?.startsWith("/coach-debug") || pathname?.startsWith("/coach-new");

  if (isCoachPage) {
    devLog("debug", "GlobalMicGate: hiding mic button on coach page", { pathname });
    return null;
  }

  devLog("debug", "GlobalMicGate: showing mic button", { pathname });
  return <GlobalMicButton />;
}


