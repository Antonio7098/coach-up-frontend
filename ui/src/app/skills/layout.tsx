"use client";

import React, { useEffect, useLayoutEffect, useState } from "react";
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

  return (
    <div
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
