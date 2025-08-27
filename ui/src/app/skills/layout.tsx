"use client";

import React, { useEffect, useLayoutEffect, useState, useRef } from "react";
import { usePathname } from "next/navigation";

export default function SkillsLayout({ children }: { children: React.ReactNode }) {
  const [enterDir, setEnterDir] = useState<"left" | "right" | null>(() => {
    if (typeof window === "undefined") return null;
    try {
      const reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      const d = window.sessionStorage.getItem("navDir");
      if (!reduce && (d === "back" || d === "forward")) {
        // Forward: page should enter from the right; Back: enter from the left
        return d === "forward" ? "right" : "left";
      }
    } catch {}
    return null;
  });
  const pathname = usePathname();
  const rootRef = useRef<HTMLDivElement | null>(null);

  // On mount and on every route change, read navDir and animate new content in
  useLayoutEffect(() => {
    try {
      const reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      // If we already have an enterDir from initializer, only animate to 0 and clear the flag.
      if (enterDir !== null) {
        const id = requestAnimationFrame(() => setEnterDir(null));
        // Clear navDir now that we've consumed it
        try { window.sessionStorage.removeItem("navDir"); } catch {}
        return () => cancelAnimationFrame(id);
      }
      // Otherwise, try to read navDir (e.g., on client navigations within the same layout)
      const d = window.sessionStorage.getItem("navDir");
      if (!reduce && (d === "back" || d === "forward")) {
        // Forward: page should enter from the right; Back: enter from the left
        setEnterDir(d === "forward" ? "right" : "left");
        const id = requestAnimationFrame(() => setEnterDir(null));
        try { window.sessionStorage.removeItem("navDir"); } catch {}
        return () => cancelAnimationFrame(id);
      }
    } catch {}
  }, [pathname, enterDir]);

  // When user clicks browser back/forward, mark direction as 'back' so the next page can animate entry
  useEffect(() => {
    function onPopState() {
      try { window.sessionStorage.setItem("navDir", "back"); } catch {}
    }
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  // Safety on mobile/BFCache: ensure container isn't left translated off-screen
  useEffect(() => {
    const resetPosition = () => {
      try {
        const el = rootRef.current;
        const rect = el ? el.getBoundingClientRect() : null;
        const comp = el ? window.getComputedStyle(el).transform : "";
        console.log("[skills] resetPosition: pre", { enterDir, rect, comp, vw: window.innerWidth, vh: window.innerHeight, dpr: window.devicePixelRatio, vis: document.visibilityState });
      } catch {}
      try { setEnterDir(null); } catch {}
      try {
        const el = rootRef.current;
        if (el) {
          // Force override any React-driven transform for this frame
          el.style.setProperty("transition", "none", "important");
          el.style.setProperty("transform", "translateX(0)", "important");
          requestAnimationFrame(() => {
            if (el) {
              // Allow React styles to take back control next paint
              el.style.removeProperty("transition");
              el.style.removeProperty("transform");
            }
            try {
              const rect2 = el.getBoundingClientRect();
              const comp2 = window.getComputedStyle(el).transform;
              console.log("[skills] resetPosition: post", { rect: rect2, comp: comp2 });
            } catch {}
          });
        }
      } catch {}
    };
    const onPageShow = () => { console.log("[skills] pageshow"); resetPosition(); };
    const onPop = () => { console.log("[skills] popstate"); resetPosition(); };
    const onVisibility = () => { console.log("[skills] visibilitychange", document.visibilityState); if (document.visibilityState === "visible") resetPosition(); };
    const onFocus = () => { console.log("[skills] focus"); resetPosition(); };
    const onResize = () => { console.log("[skills] resize", { vw: window.innerWidth, vh: window.innerHeight }); resetPosition(); };
    const onOrient = () => { console.log("[skills] orientationchange"); resetPosition(); };
    window.addEventListener("pageshow", onPageShow);
    window.addEventListener("popstate", onPop);
    window.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", onFocus);
    window.addEventListener("resize", onResize);
    window.addEventListener("orientationchange", onOrient as any);
    return () => {
      window.removeEventListener("pageshow", onPageShow);
      window.removeEventListener("popstate", onPop);
      window.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("orientationchange", onOrient as any);
    };
  }, []);

  return (
    <div
      ref={rootRef}
      className="overflow-x-hidden transform-gpu will-change-transform transition-transform duration-700 ease-in-out"
      style={{
        transform:
          enterDir === "left"
            ? "translateX(-120vw)"
            : enterDir === "right"
            ? "translateX(120vw)"
            : "translateX(0)",
      }}
    >
      {children}
    </div>
  );
}
