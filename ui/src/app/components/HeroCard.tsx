"use client";

import React, { ReactNode } from "react";

export default function HeroCard({
  label,
  title,
  subtitle,
  children,
  className = "",
}: {
  label?: string;
  title?: ReactNode;
  subtitle?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div className={["relative overflow-hidden rounded-3xl border-2 cu-border cu-surface shadow-sm", className].join(" ")}> 
      <div
        className="absolute inset-0 opacity-40 pointer-events-none"
        aria-hidden
        style={{
          background:
            "radial-gradient(800px 280px at 5% -10%, rgba(99,102,241,0.35), transparent 60%), " +
            "radial-gradient(700px 280px at 105% 110%, rgba(16,185,129,0.25), transparent 60%)",
        }}
      />
      <div className="absolute inset-0 backdrop-blur-[2px] opacity-[0.35] pointer-events-none" aria-hidden />
      <div className="relative p-5">
        {label && <div className="text-xs font-semibold uppercase tracking-wide cu-muted">{label}</div>}
        {title && <h1 className="mt-1 text-2xl font-semibold tracking-tight">{title}</h1>}
        {subtitle && <p className="mt-1 text-sm cu-muted">{subtitle}</p>}
        {children}
      </div>
    </div>
  );
}
