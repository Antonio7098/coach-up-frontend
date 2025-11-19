"use client";

import React, { useState, useRef, useEffect } from "react";
import { devLog } from "../../app/api/lib/observability";

interface SoftCardProps {
  className?: string;
  children?: React.ReactNode;
  onClick?: () => void;
  onHover?: () => void;
  trackInteractions?: boolean;
}

export default function SoftCard({
  className = "",
  children,
  onClick,
  onHover,
  trackInteractions = false
}: SoftCardProps) {
  const [isHovered, setIsHovered] = useState(false);
  const [clickCount, setClickCount] = useState(0);
  const renderCountRef = useRef(0);

  // Log rendering steps
  useEffect(() => {
    renderCountRef.current += 1;
    devLog("debug", "ui:SoftCard: Component rendered", {
      renderCount: renderCountRef.current,
      hasChildren: !!children,
      hasClickHandler: !!onClick,
      className: className || 'none'
    });
  });

  // Log state management
  useEffect(() => {
    if (trackInteractions) {
      devLog("debug", "ui:SoftCard: State updated", {
        isHovered,
        clickCount,
        renderCount: renderCountRef.current
      });
    }
  }, [isHovered, clickCount, trackInteractions]);

  // Log user interactions
  const handleClick = () => {
    setClickCount(prev => prev + 1);
    if (trackInteractions) {
      devLog("info", "ui:SoftCard: User clicked", {
        clickCount: clickCount + 1,
        timestamp: new Date().toISOString()
      });
    }
    onClick?.();
  };

  const handleMouseEnter = () => {
    setIsHovered(true);
    if (trackInteractions) {
      devLog("debug", "ui:SoftCard: User hovered", {
        timestamp: new Date().toISOString()
      });
    }
    onHover?.();
  };

  const handleMouseLeave = () => {
    setIsHovered(false);
    if (trackInteractions) {
      devLog("debug", "ui:SoftCard: User unhovered", {
        hoverDuration: Date.now() - (Date.now() - 1000), // Simplified duration tracking
        timestamp: new Date().toISOString()
      });
    }
  };

  return (
    <div
      className={`rounded-[24px] ${className} ${isHovered ? 'transform scale-[1.02] transition-transform duration-200' : ''}`}
      style={{
        background:
          "linear-gradient(180deg, rgba(255,252,246,0.82) 0%, rgba(252,243,232,0.72) 100%), radial-gradient(circle at 35% 30%, rgba(255,254,252,0.4), rgba(255,255,255,0.0) 60%)",
        border: "1px solid #e6ded5",
        outline: "1px solid #efe7df",
        outlineOffset: "-1px",
        boxShadow:
          "8px 8px 20px rgba(210,200,188,0.24), -6px -6px 14px rgba(255,255,255,0.85), inset 0 0 12px rgba(214,170,160,0.12)",
        cursor: onClick ? 'pointer' : 'default'
      }}
      onClick={handleClick}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={(e) => {
        if (onClick && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault();
          handleClick();
        }
      }}
    >
      {children}
    </div>
  );
}


