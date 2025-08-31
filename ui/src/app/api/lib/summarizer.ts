/* eslint-disable no-console */

export type SummarizerMessage = { role: string; content: string };

// Stub summarizer: combine previous summary and recent messages with a char cap.
// Later, replace with a real LLM call and richer policy.
export function generateSummaryText(prevSummary: string, recentMessages: SummarizerMessage[], tokenBudget?: number): string {
  const { core, prevRecents } = parsePrevSummary(String(prevSummary || ""));
  // Fold previous recents into the core so the summary progresses over time.
  const foldedCore = [core, prevRecents].filter(Boolean).join('\n').trim();
  const list = (Array.isArray(recentMessages) ? recentMessages : []);
  const messagesText = list
    .filter((m) => m && typeof m.role === 'string' && typeof m.content === 'string')
    .map((m) => `${m.role}: ${m.content}`)
    .join('\n');
  const hasRecents = messagesText.trim().length > 0;
  // Increase cap: allow up to ~8000 chars and scale tokenBudget more generously
  const maxChars = Math.max(400, Math.min(8000, tokenBudget ? tokenBudget * 8 : 2000));
  if (!foldedCore && !hasRecents) return '';
  if (foldedCore && !hasRecents) {
    const coreHeader = 'Summary so far:\n';
    const coreTrim = (coreHeader + foldedCore).slice(0, maxChars);
    return coreTrim;
  }
  if (!foldedCore && hasRecents) {
    const recentHeader = 'Recent messages:\n';
    const recentTrim = (recentHeader + messagesText).slice(0, maxChars);
    return recentTrim;
  }
  // Both present: reserve budget for recents first, then trim core to fit remaining
  const recentHeader = 'Recent messages:\n';
  const coreHeader = 'Summary so far:\n';
  // Reserve at least 200 chars or 40% of budget for recents
  const reservedForRecents = Math.max(200, Math.floor(maxChars * 0.4));
  const recentSectionFull = recentHeader + messagesText;
  const recentSection = recentSectionFull.slice(0, Math.min(reservedForRecents, maxChars));
  const remainingForCore = Math.max(0, maxChars - recentSection.length - 2); // account for \n\n
  let coreSection = '';
  if (remainingForCore > 0) {
    const coreFull = coreHeader + foldedCore;
    coreSection = coreFull.slice(0, remainingForCore);
  }
  const both = (coreSection ? coreSection + '\n\n' : '') + recentSection;
  return both.slice(0, maxChars);
}

function parsePrevSummary(input: string): { core: string; prevRecents: string } {
  try {
    let s = (input || '').trim();
    if (!s) return { core: '', prevRecents: '' };
    // If previous text already contains our headings, extract the core summary body and previous recent messages.
    // Pattern: "Summary so far:\n<core>\n\nRecent messages:\n<prevRecents>"
    const summaryHdr = 'Summary so far:';
    const recentHdr = 'Recent messages:';
    const idxSummary = s.indexOf(summaryHdr);
    const idxRecent = s.indexOf(recentHdr);
    let core = '';
    let prevRecents = '';
    if (idxSummary !== -1) {
      // Extract everything after "Summary so far:" as the core
      const afterSummary = s.slice(idxSummary + summaryHdr.length).trimStart();
      if (idxRecent !== -1 && idxRecent > idxSummary) {
        // Split into core (before "Recent messages:") and previous recent messages
        const beforeRecent = afterSummary.slice(0, afterSummary.indexOf(recentHdr)).trim();
        const afterRecent = afterSummary.slice(afterSummary.indexOf(recentHdr) + recentHdr.length).trim();
        core = beforeRecent;
        prevRecents = afterRecent;
      } else {
        // No "Recent messages:" section, so everything after "Summary so far:" is core
        core = afterSummary;
        prevRecents = '';
      }
    } else if (idxRecent !== -1) {
      // Previous text only had recent messages; promote that content to be the core summary body.
      core = s.slice(idxRecent + recentHdr.length).trim();
      prevRecents = '';
    }
    // Clean up any remaining header text that might have slipped through
    core = core.replace(/^(Summary so far:\s*)+/i, '').replace(/^(Recent messages:\s*)+/i, '').trim();
    prevRecents = prevRecents.replace(/^(Summary so far:\s*)+/i, '').replace(/^(Recent messages:\s*)+/i, '').trim();
    return { core, prevRecents };
  } catch {
    return { core: input, prevRecents: '' };
  }
}
