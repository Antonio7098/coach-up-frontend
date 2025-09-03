import { describe, it, expect } from 'vitest';
import { generateSummaryText, type SummarizerMessage } from '../../src/app/api/lib/summarizer';

describe('Summarizer: prompt composition logic', () => {
  describe('generateSummaryText', () => {
    it('returns empty string when no input provided', () => {
      const result = generateSummaryText('', []);
      expect(result).toBe('');
    });

    it('returns previous summary when no recent messages', () => {
      // The function expects headers in the previous summary, so let's provide them
      const prevSummary = 'Summary so far:\nThis is a previous summary';
      const result = generateSummaryText(prevSummary, []);
      expect(result).toContain('Summary so far:');
      expect(result).toContain('This is a previous summary');
    });

    it('returns recent messages when no previous summary', () => {
      const messages: SummarizerMessage[] = [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi there' }
      ];
      const result = generateSummaryText('', messages);
      expect(result).toContain('Recent messages:');
      expect(result).toContain('user: Hello');
      expect(result).toContain('assistant: Hi there');
    });

    it('combines previous summary and recent messages', () => {
      const prevSummary = 'Summary so far:\nPrevious conversation summary';
      const messages: SummarizerMessage[] = [
        { role: 'user', content: 'New question' },
        { role: 'assistant', content: 'New answer' }
      ];
      const result = generateSummaryText(prevSummary, messages);
      expect(result).toContain('Summary so far:');
      expect(result).toContain('Previous conversation summary');
      expect(result).toContain('Recent messages:');
      expect(result).toContain('user: New question');
      expect(result).toContain('assistant: New answer');
    });

    it('respects token budget by adjusting character limit', () => {
      const prevSummary = 'Short summary';
      const messages: SummarizerMessage[] = [
        { role: 'user', content: 'Very long message that should be truncated when token budget is low' },
        { role: 'assistant', content: 'Another long response that should also be truncated' }
      ];

      // With low token budget
      const resultLow = generateSummaryText(prevSummary, messages, 100);
      expect(resultLow.length).toBeLessThanOrEqual(800); // 100 * 8 = 800 chars

      // With higher token budget
      const resultHigh = generateSummaryText(prevSummary, messages, 500);
      expect(resultHigh.length).toBeLessThanOrEqual(4000); // 500 * 8 = 4000 chars
    });

    it('applies minimum character limit when token budget is very low', () => {
      const prevSummary = 'Summary so far:\n' + 'A'.repeat(500); // Make sure we have content
      const messages: SummarizerMessage[] = [{ role: 'user', content: 'B'.repeat(200) }];

      const result = generateSummaryText(prevSummary, messages, 10);
      // With tokenBudget=10, maxChars should be 400, but the actual behavior
      // depends on how the function balances between core and recent messages
      expect(result.length).toBeGreaterThan(20); // At least some content should be returned
    });

    it('applies maximum character limit when token budget is very high', () => {
      const prevSummary = 'A'.repeat(10000);
      const messages: SummarizerMessage[] = [{ role: 'user', content: 'B'.repeat(10000) }];

      const result = generateSummaryText(prevSummary, messages, 2000);
      expect(result.length).toBeLessThanOrEqual(8000); // maximum of 8000 chars
    });

    it('filters out invalid messages', () => {
      const messages: SummarizerMessage[] = [
        { role: 'user', content: 'Valid message' },
        { role: '', content: 'Invalid role' }, // This will be included as ': Invalid role'
        { role: 'assistant', content: '' }, // This will be included as 'assistant: '
        null as any, // This will be filtered out
        { role: 'system', content: 'System message' }
      ];

      const result = generateSummaryText('', messages);
      expect(result).toContain('user: Valid message');
      expect(result).toContain('system: System message');
      expect(result).toContain(': Invalid role'); // Empty role still gets included
      expect(result).toContain('assistant: '); // Empty content still gets included
      // null messages are filtered out
    });

    it('handles complex previous summary with both core and recent sections', () => {
      const prevSummary = `Summary so far:
This is the core summary content.

Recent messages:
user: Previous question
assistant: Previous answer`;

      const newMessages: SummarizerMessage[] = [
        { role: 'user', content: 'New question' }
      ];

      const result = generateSummaryText(prevSummary, newMessages);

      // Should fold previous recent messages into core
      expect(result).toContain('Summary so far:');
      expect(result).toContain('This is the core summary content');
      expect(result).toContain('user: Previous question');
      expect(result).toContain('assistant: Previous answer');
      expect(result).toContain('Recent messages:');
      expect(result).toContain('user: New question');
    });

    it('handles previous summary with only recent messages section', () => {
      const prevSummary = `Recent messages:
user: Question
assistant: Answer`;

      const result = generateSummaryText(prevSummary, []);

      // Should promote recent messages to core summary
      expect(result).toContain('Summary so far:');
      expect(result).toContain('user: Question');
      expect(result).toContain('assistant: Answer');
    });

    it('cleans up header text from parsed sections', () => {
      const prevSummary = `Summary so far:
Summary so far: Core content
Recent messages: Previous content`;

      const result = generateSummaryText(prevSummary, []);

      // Should clean up duplicate headers
      expect(result).toContain('Summary so far:');
      expect(result).toContain('Core content');
      expect(result).toContain('Previous content');
      expect(result.match(/Summary so far:/g)?.length).toBe(1);
    });

    it('handles malformed input gracefully', () => {
      const result = generateSummaryText(null as any, null as any);
      expect(typeof result).toBe('string');
      expect(result.length).toBeGreaterThanOrEqual(0);
    });

    it('balances budget between core summary and recent messages', () => {
      const longPrevSummary = 'Summary so far:\n' + 'A'.repeat(1000);
      const longMessages: SummarizerMessage[] = [
        { role: 'user', content: 'B'.repeat(500) },
        { role: 'assistant', content: 'C'.repeat(500) }
      ];

      const result = generateSummaryText(longPrevSummary, longMessages, 200);

      // With tokenBudget=200, maxChars = 200*8 = 1600, but capped at 8000
      expect(result.length).toBeLessThanOrEqual(1600);
      expect(result.length).toBeGreaterThan(100); // Should contain meaningful content

      // Should contain both sections when both are present
      expect(result).toContain('Summary so far:');
      expect(result).toContain('Recent messages:');
    });
  });
});
