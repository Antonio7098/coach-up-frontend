"use client";

import React, { ReactNode } from "react";

export default function SectionCard({
  children,
  className = "",
  interactive = false,
}: {
  children?: ReactNode;
  className?: string;
  interactive?: boolean;
}) {
  return (
    <div
      className={[
        "rounded-2xl border-2 cu-border cu-surface p-4 shadow-sm",
        interactive ? "transition-all hover:shadow-md" : "",
        className,
      ].join(" ")}
    >
      {children}
    </div>
  );
}
