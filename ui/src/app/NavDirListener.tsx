"use client";

import { useEffect } from "react";

export default function NavDirListener() {
  useEffect(() => {
    const onPopState = () => {
      try { window.sessionStorage.setItem("navDir", "back"); } catch {}
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);
  return null;
}
