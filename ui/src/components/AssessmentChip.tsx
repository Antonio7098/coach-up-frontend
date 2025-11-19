"use client";

import React, { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { devLog } from "../app/api/lib/observability";

interface AssessmentChipProps {
  sessionId?: string;
  latestInteraction?: any;
  onAssessmentTriggered?: () => void;
  onAssessmentCompleted?: (result: any) => void;
  onAssessmentError?: () => void;
  // Allow parent to control state for better synchronization
  externalState?: 'idle' | 'loading' | 'completed' | 'error';
  externalExpanded?: boolean;
  externalResult?: any;
  onStateChange?: (state: 'idle' | 'loading' | 'completed' | 'error') => void;
  onExpandedChange?: (expanded: boolean) => void;
}

type AssessmentState = 'idle' | 'loading' | 'completed' | 'error';

interface AssessmentResult {
  assessment?: any;
  results?: any[];
  latestAssessmentId?: string;
}

export default function AssessmentChip({
  sessionId,
  latestInteraction,
  onAssessmentTriggered,
  onAssessmentCompleted,
  onAssessmentError,
  externalState,
  externalExpanded,
  externalResult,
  onStateChange,
  onExpandedChange
}: AssessmentChipProps) {
  const [mounted, setMounted] = useState(false);
  const [internalState, setInternalState] = useState<AssessmentState>('idle');
  const [internalResult, setInternalResult] = useState<AssessmentResult | null>(null);
  const [internalExpanded, setInternalExpanded] = useState(false);

  // Use external state if provided, otherwise use internal state
  const assessmentState = externalState ?? internalState;
  const assessmentResult = externalResult ?? internalResult;
  const isExpanded = externalExpanded ?? internalExpanded;

  // All hooks must be called before any early returns
  useEffect(() => {
    setMounted(true);
    return () => setMounted(false);
  }, []);

  if (!mounted) return null;

  const hasAssessmentForLatest = assessmentResult?.assessment &&
    latestInteraction &&
    assessmentResult.assessment.groupId === latestInteraction.id;

  const triggerAssessment = async () => {
    if (!sessionId || !latestInteraction || assessmentState === 'loading') {
      devLog('warn', 'AssessmentChip: cannot trigger assessment', {
        hasSessionId: !!sessionId,
        hasLatestInteraction: !!latestInteraction,
        currentState: assessmentState
      });
      return;
    }

    // Use external state setter if provided, otherwise use internal
    if (onStateChange) {
      onStateChange('loading');
    } else {
      setInternalState('loading');
    }
    onAssessmentTriggered?.();

    try {
      const response = await fetch('/api/assessments/run', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Request-Id': Math.random().toString(36).slice(2),
        },
        body: JSON.stringify({
          sessionId,
          groupId: latestInteraction.id,
          rubricVersion: 'v3'
        }),
      });

      if (response.ok) {
        // Assessment triggered successfully, poll for results
        pollForAssessmentResults();
      } else {
        const errorText = await response.text().catch(() => 'Unknown error');
        throw new Error(`Failed to trigger assessment: ${response.status} - ${errorText}`);
      }
    } catch (error) {
      devLog('error', 'AssessmentChip: assessment trigger failed', { error: String(error), sessionId });
      // Use external state setter if provided, otherwise use internal
      if (onStateChange) {
        onStateChange('error');
      } else {
        setInternalState('error');
      }
      onAssessmentError?.();
    }
  };

  const pollForAssessmentResults = async () => {
    if (!sessionId) return;

    const maxAttempts = 20; // Poll for up to 20 seconds
    let attempts = 0;

    const poll = async () => {
      try {
        const response = await fetch(`/api/assessments/results?sessionId=${encodeURIComponent(sessionId)}&groupId=${encodeURIComponent(latestInteraction.id)}`);
        const data = await response.json();

        if (response.ok && data.results && data.results.skillAssessments && data.results.skillAssessments.length > 0) {
          // Use external result setter if provided, otherwise use internal
          if (externalResult === undefined) {
            setInternalResult(data);
          }

          // Use external state setter if provided, otherwise use internal
          if (onStateChange) {
            onStateChange('completed');
          } else {
            setInternalState('completed');
          }

          onAssessmentCompleted?.(data);
          return;
        }

        attempts++;
        if (attempts < maxAttempts) {
          setTimeout(poll, 1000); // Poll every second
        } else {
          // Use external state setter if provided, otherwise use internal
          if (onStateChange) {
            onStateChange('error');
          } else {
            setInternalState('error');
          }
          onAssessmentError?.();
        }
      } catch (error) {
        devLog('error', 'AssessmentChip: polling failed', { error: String(error), sessionId, attempts });
        attempts++;
        if (attempts < maxAttempts) {
          setTimeout(poll, 1000);
        } else {
          setInternalState('error');
        }
      }
    };

    poll();
  };

  const getChipColor = () => {
    switch (assessmentState) {
      case 'loading':
        return 'bg-blue-500 border-blue-400 text-white animate-pulse';
      case 'completed':
        return 'bg-green-500 border-green-400 text-white';
      case 'error':
        return 'bg-red-500 border-red-400 text-white';
      default:
        return hasAssessmentForLatest
          ? 'bg-green-100 border-green-300 text-green-700 hover:bg-green-200'
          : 'bg-gray-100 border-gray-300 text-gray-500 hover:bg-gray-50';
    }
  };

  const handleClick = () => {
    if (assessmentState === 'idle' && !hasAssessmentForLatest) {
      triggerAssessment();
    } else if (assessmentState === 'completed' || hasAssessmentForLatest) {
      const newExpanded = !isExpanded;
      // Use external expanded setter if provided, otherwise use internal
      if (onExpandedChange) {
        onExpandedChange(newExpanded);
      } else {
        setInternalExpanded(newExpanded);
      }
    }
  };

  // Get tooltip text based on current state
  const getTooltipText = () => {
    switch (assessmentState) {
      case 'loading':
        return 'Assessment in progress...';
      case 'completed':
        return 'Assessment complete - click to view details';
      case 'error':
        return 'Assessment failed - click to retry';
      default:
        return hasAssessmentForLatest ? 'View latest assessment' : 'Click to assess latest interaction';
    }
  };

  // Only render the portal if we're in the browser
  const chipElement = (
    <button
      type="button"
      onClick={handleClick}
      title={getTooltipText()}
      className={`
        fixed z-50 w-16 h-16 rounded-full
        flex items-center justify-center shadow-lg hover:shadow-xl
        transition-all duration-300 ease-in-out border-2
        ${getChipColor()}
        ${assessmentState === 'idle' && !hasAssessmentForLatest ? 'hover:bg-gray-50 cursor-pointer' : ''}
        ${isExpanded ? 'scale-110' : ''}
        ${assessmentState === 'loading' ? 'cursor-wait' : 'cursor-pointer'}
      `}
      style={{
        left: '50%',
        top: '50%',
        transform: `translate(-50%, clamp(18vh, 24vh, calc(50vh + 12rem + env(safe-area-inset-bottom))))`,
      }}
      disabled={assessmentState === 'loading'}
    >
      {/* Loading rotating ring */}
      {assessmentState === 'loading' && (
        <span
          aria-hidden
          className="absolute -inset-2 rounded-full pointer-events-none animate-spin"
          style={{
            background: "conic-gradient(from 0deg, rgba(59,130,246,0.0), rgba(59,130,246,0.4), rgba(16,185,129,0.4), rgba(59,130,246,0.0))",
            WebkitMask: "linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0)",
            WebkitMaskComposite: "xor",
            maskComposite: "exclude",
            padding: "6px",
          } as React.CSSProperties}
        />
      )}

      {/* A icon */}
      <span className="text-lg font-bold">A</span>

      {/* Assessment details (when expanded) */}
      {isExpanded && assessmentResult && (
        <div className="absolute top-full mt-2 left-1/2 transform -translate-x-1/2 bg-white rounded-lg shadow-xl border p-4 min-w-96 max-w-2xl z-60 max-h-96 overflow-auto">
          <h3 className="font-semibold text-gray-900 mb-2">Assessment Results (v3)</h3>
          {assessmentResult.results && assessmentResult.results.skillAssessments && assessmentResult.results.skillAssessments.length > 0 ? (
            <div className="space-y-3">
              <div className="text-sm font-semibold text-blue-600 mb-2">
                Group Summary: {assessmentResult.results.highlights?.length ? assessmentResult.results.highlights[0] : 'Assessment completed'}
              </div>
              {assessmentResult.results.skillAssessments.map((skill: any, index: number) => (
                <div key={index} className="border-l-4 border-green-500 pl-3 bg-gray-50 rounded-r">
                  <div className="font-semibold text-sm text-gray-800 mb-1">
                    {skill.skillId || 'Skill'} - Level {skill.level || 'N/A'}
                  </div>

                  {/* Primary Takeaway */}
                  {skill.structuredFeedback?.primaryTakeaway && (
                    <div className="text-xs text-blue-700 mb-2">
                      <span className="font-semibold">Takeaway:</span> {skill.structuredFeedback.primaryTakeaway}
                    </div>
                  )}

                  {/* Primary Focus */}
                  {skill.structuredFeedback?.primaryFocus && (
                    <div className="text-xs text-green-700 mb-2">
                      <span className="font-semibold">Focus:</span> {skill.structuredFeedback.primaryFocus.description}
                      {skill.structuredFeedback.primaryFocus.nextLevelCriteria && (
                        <div className="ml-2 mt-1 text-gray-600">
                          <span className="font-semibold">Next level:</span> {skill.structuredFeedback.primaryFocus.nextLevelCriteria}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Annotated Examples */}
                  {skill.structuredFeedback?.annotatedExamples && skill.structuredFeedback.annotatedExamples.length > 0 && (
                    <div className="text-xs text-purple-700 mb-2">
                      <span className="font-semibold">Examples:</span>
                      <div className="space-y-1 mt-1">
                        {skill.structuredFeedback.annotatedExamples.slice(0, 2).map((example: any, i: number) => (
                          <div key={i} className="border-l-2 border-purple-200 pl-2">
                            <div className={`text-xs px-1 py-0.5 inline-block rounded ${
                              example.classification === 'strength' ? 'bg-green-100 text-green-800' : 'bg-yellow-100 text-yellow-800'
                            }`}>
                              {example.classification}
                            </div>
                            <div className="italic text-gray-700">"{example.userQuote}"</div>
                            <div className="text-gray-600">{example.annotation}</div>
                          </div>
                        ))}
                        {skill.structuredFeedback.annotatedExamples.length > 2 && (
                          <div className="text-gray-500">...and {skill.structuredFeedback.annotatedExamples.length - 2} more</div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Quantitative Metrics */}
                  {skill.quantitativeMetrics && (
                    <div className="text-xs text-gray-600 mb-1">
                      <span className="font-semibold">Metrics:</span>
                      <div className="grid grid-cols-2 gap-1 mt-1">
                        {skill.quantitativeMetrics.averageTUnitLength && (
                          <div>T-Unit: {skill.quantitativeMetrics.averageTUnitLength.toFixed(1)}</div>
                        )}
                        {skill.quantitativeMetrics.subordinationIndex && (
                          <div>Subord: {skill.quantitativeMetrics.subordinationIndex.toFixed(2)}</div>
                        )}
                        {skill.quantitativeMetrics.yngveScore && (
                          <div>Yngve: {skill.quantitativeMetrics.yngveScore.toFixed(1)}</div>
                        )}
                        {skill.quantitativeMetrics.nominalizationCount && (
                          <div>Nominal: {skill.quantitativeMetrics.nominalizationCount}</div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className="text-sm text-gray-600">
              No assessment results available
            </div>
          )}
          <button
            onClick={() => {
              const newExpanded = false;
              // Use external expanded setter if provided, otherwise use internal
              if (onExpandedChange) {
                onExpandedChange(newExpanded);
              } else {
                setInternalExpanded(newExpanded);
              }
            }}
            className="mt-3 text-xs text-blue-600 hover:text-blue-800"
          >
            Close
          </button>
        </div>
      )}
    </button>
  );

  // Use createPortal to render at document body level
  if (typeof window === 'undefined') return null;

  return createPortal(chipElement, document.body);
}
