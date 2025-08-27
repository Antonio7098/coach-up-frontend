"use client";

import React from "react";

export default function ProgressBar({
  value,
  max = 100,
  height = 20,
  showLabel = true,
  className = "",
  trackClassName = "cu-accent-soft-bg",
}: {
  value: number;
  max?: number;
  height?: number;
  showLabel?: boolean;
  className?: string;
  trackClassName?: string;
}) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <div className={["relative rounded-full overflow-hidden", className].join(" ")} style={{ height }}>
      <div className="absolute inset-0 pointer-events-none" aria-hidden style={{ background: "linear-gradient(90deg, rgba(255,255,255,0.12), rgba(255,255,255,0))" }} />
      <div className={["h-full", trackClassName].join(" ")}></div>
      <div className="absolute inset-y-0 left-0" style={{ width: `${pct}%`, background: "linear-gradient(90deg, rgba(99,102,241,1), rgba(16,185,129,1))" }} />
      {showLabel && (
        <div className="absolute inset-0 grid place-items-center text-[11px] font-medium text-foreground">
          {Math.round(value)}/{Math.round(max)}
        </div>
      )}
    </div>
  );
}
