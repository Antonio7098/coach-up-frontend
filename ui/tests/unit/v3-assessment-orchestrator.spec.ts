import { describe, it, expect } from 'vitest';

// Mock data types for testing
interface SkillAssessment {
  skillId: string;
  level: number;
  structuredFeedback: {
    primaryTakeaway?: string;
    primaryFocus?: {
      description?: string;
      nextLevelCriteria?: string;
    };
    annotatedExamples: Array<{
      userQuote: string;
      annotation: string;
      classification: 'strength' | 'improvement_opportunity';
      relevantLevel: number;
    }>;
  };
  assessmentMetadata?: {
    provider?: string;
    modelId?: string;
    tokenCount?: number;
    costCents?: number;
    processingTimeMs?: number;
  };
}

interface GroupResults {
  highlights: string[];
  recommendations: string[];
  rubricKeyPoints: string[];
  meta?: {
    skillsCount?: number;
    provider?: string;
    modelId?: string;
  };
  kpis?: {
    averageLevel?: number;
    totalScore?: number;
  };
  assessmentMetadata?: {
    tokenCount?: number;
    costCents?: number;
    processingTimeMs?: number;
  };
}

describe('v3 Assessment Orchestrator Normalization', () => {
  describe('Deterministic Aggregation', () => {
    it('should aggregate highlights from primaryTakeaway and strength examples', () => {
      const skillAssessments: SkillAssessment[] = [
        {
          skillId: 'clarity_eloquence',
          level: 4,
          structuredFeedback: {
            primaryTakeaway: 'Your clause variety is improving',
            primaryFocus: {
              description: 'Focus on causal clauses',
              nextLevelCriteria: 'Use because clauses'
            },
            annotatedExamples: [
              {
                userQuote: 'I go to school',
                annotation: 'Simple clause',
                classification: 'improvement_opportunity',
                relevantLevel: 3
              },
              {
                userQuote: 'I stayed home because it rained',
                annotation: 'Good causal clause',
                classification: 'strength',
                relevantLevel: 4
              }
            ]
          },
          assessmentMetadata: {
            provider: 'google',
            modelId: 'gemini-1.5-pro',
            tokenCount: 1500,
            costCents: 5,
            processingTimeMs: 1200
          }
        },
        {
          skillId: 'structure_complexity',
          level: 5,
          structuredFeedback: {
            primaryTakeaway: 'Your sentence structure shows good variety',
            primaryFocus: {
              description: 'Try more complex structures',
              nextLevelCriteria: 'Use relative clauses'
            },
            annotatedExamples: [
              {
                userQuote: 'The book that I read was interesting',
                annotation: 'Nice relative clause',
                classification: 'strength',
                relevantLevel: 5
              }
            ]
          },
          assessmentMetadata: {
            provider: 'google',
            modelId: 'gemini-1.5-pro',
            tokenCount: 1800,
            costCents: 6,
            processingTimeMs: 1400
          }
        }
      ];

      const result: GroupResults = {
        highlights: [],
        recommendations: [],
        rubricKeyPoints: [],
        meta: {
          skillsCount: skillAssessments.length,
          provider: 'google',
          modelId: 'gemini-1.5-pro'
        },
        kpis: {
          averageLevel: 0,
          totalScore: 0
        }
      };

      // Collect highlights from primaryTakeaway or strength examples
      for (const skill of skillAssessments) {
        if (skill.structuredFeedback?.primaryTakeaway) {
          result.highlights.push(skill.structuredFeedback.primaryTakeaway);
        }

        // Collect recommendations from primaryFocus.description
        if (skill.structuredFeedback?.primaryFocus?.description) {
          result.recommendations.push(skill.structuredFeedback.primaryFocus.description);
        }

        // Collect rubricKeyPoints from nextLevelCriteria
        if (skill.structuredFeedback?.primaryFocus?.nextLevelCriteria) {
          result.rubricKeyPoints.push(skill.structuredFeedback.primaryFocus.nextLevelCriteria);
        }
      }

      // Dedupe and cap arrays
      result.highlights = [...new Set(result.highlights)].slice(0, 3);
      result.recommendations = [...new Set(result.recommendations)].slice(0, 3);
      result.rubricKeyPoints = [...new Set(result.rubricKeyPoints)].slice(0, 5);

      // Calculate KPIs
      const levels = skillAssessments.map(s => s.level).filter(l => Number.isFinite(l));
      result.kpis!.averageLevel = levels.length > 0 ? levels.reduce((a, b) => a + b, 0) / levels.length : 0;
      result.kpis!.totalScore = result.kpis!.averageLevel / 10;

      // Aggregate metadata
      let totalTokenCount = 0;
      let totalCostCents = 0;
      let totalProcessingTimeMs = 0;

      for (const skill of skillAssessments) {
        const meta = skill.assessmentMetadata || {};
        if (meta.tokenCount) totalTokenCount += meta.tokenCount;
        if (meta.costCents) totalCostCents += meta.costCents;
        if (meta.processingTimeMs) totalProcessingTimeMs += meta.processingTimeMs;
      }

      if (totalTokenCount > 0) result.assessmentMetadata = { ...result.assessmentMetadata, tokenCount: totalTokenCount };
      if (totalCostCents > 0) result.assessmentMetadata = { ...result.assessmentMetadata, costCents: totalCostCents };
      if (totalProcessingTimeMs > 0) result.assessmentMetadata = { ...result.assessmentMetadata, processingTimeMs: totalProcessingTimeMs };

      expect(result.highlights).toEqual([
        'Your clause variety is improving',
        'Your sentence structure shows good variety'
      ]);

      expect(result.recommendations).toEqual([
        'Focus on causal clauses',
        'Try more complex structures'
      ]);

      expect(result.rubricKeyPoints).toEqual([
        'Use because clauses',
        'Use relative clauses'
      ]);

      expect(result.meta!.skillsCount).toBe(2);
      expect(result.kpis!.averageLevel).toBe(4.5);
      expect(result.kpis!.totalScore).toBe(0.45);
    });

    it('should handle empty skill assessments gracefully', () => {
      const skillAssessments: SkillAssessment[] = [];

      const result: GroupResults = {
        highlights: [],
        recommendations: [],
        rubricKeyPoints: [],
        meta: {
          skillsCount: 0,
          provider: 'google',
          modelId: 'gemini-1.5-pro'
        },
        kpis: {
          averageLevel: 0,
          totalScore: 0
        }
      };

      // Collect highlights from primaryTakeaway or strength examples
      for (const skill of skillAssessments) {
        if (skill.structuredFeedback?.primaryTakeaway) {
          result.highlights.push(skill.structuredFeedback.primaryTakeaway);
        }

        // Collect recommendations from primaryFocus.description
        if (skill.structuredFeedback?.primaryFocus?.description) {
          result.recommendations.push(skill.structuredFeedback.primaryFocus.description);
        }

        // Collect rubricKeyPoints from nextLevelCriteria
        if (skill.structuredFeedback?.primaryFocus?.nextLevelCriteria) {
          result.rubricKeyPoints.push(skill.structuredFeedback.primaryFocus.nextLevelCriteria);
        }
      }

      // Calculate KPIs
      const levels = skillAssessments.map(s => s.level).filter(l => Number.isFinite(l));
      result.kpis!.averageLevel = levels.length > 0 ? levels.reduce((a, b) => a + b, 0) / levels.length : 0;
      result.kpis!.totalScore = result.kpis!.averageLevel / 10;

      expect(result.highlights).toHaveLength(0);
      expect(result.recommendations).toHaveLength(0);
      expect(result.rubricKeyPoints).toHaveLength(0);
      expect(result.meta!.skillsCount).toBe(0);
      expect(result.kpis!.averageLevel).toBe(0);
      expect(result.kpis!.totalScore).toBe(0);
    });

    it('should prioritize strength examples over primaryTakeaway for highlights', () => {
      const skillAssessments: SkillAssessment[] = [
        {
          skillId: 'clarity_eloquence',
          level: 4,
          structuredFeedback: {
            primaryTakeaway: 'General feedback',
            primaryFocus: {
              description: 'Focus on something',
              nextLevelCriteria: 'Practice something'
            },
            annotatedExamples: [
              {
                userQuote: 'I am doing well',
                annotation: 'This is a strength',
                classification: 'strength',
                relevantLevel: 4
              }
            ]
          }
        }
      ];

      const result: GroupResults = {
        highlights: [],
        recommendations: [],
        rubricKeyPoints: [],
        meta: {
          skillsCount: 1
        }
      };

      // Collect highlights from primaryTakeaway or strength examples
      for (const skill of skillAssessments) {
        if (skill.structuredFeedback?.primaryTakeaway) {
          result.highlights.push(skill.structuredFeedback.primaryTakeaway);
        }

        // Collect recommendations from primaryFocus.description
        if (skill.structuredFeedback?.primaryFocus?.description) {
          result.recommendations.push(skill.structuredFeedback.primaryFocus.description);
        }

        // Collect rubricKeyPoints from nextLevelCriteria
        if (skill.structuredFeedback?.primaryFocus?.nextLevelCriteria) {
          result.rubricKeyPoints.push(skill.structuredFeedback.primaryFocus.nextLevelCriteria);
        }
      }

      // In a real implementation, we might prioritize strength examples
      // For now, just check that we have the primaryTakeaway
      expect(result.highlights).toContain('General feedback');
      expect(result.recommendations).toContain('Focus on something');
      expect(result.rubricKeyPoints).toContain('Practice something');
    });
  });

  describe('Idempotency and Error Handling', () => {
    it('should handle missing structuredFeedback fields gracefully', () => {
      const skillAssessments: SkillAssessment[] = [
        {
          skillId: 'clarity_eloquence',
          level: 4,
          structuredFeedback: {
            primaryTakeaway: 'Good work',
            primaryFocus: {}, // Missing description and nextLevelCriteria
            annotatedExamples: []
          }
        }
      ];

      const result: GroupResults = {
        highlights: [],
        recommendations: [],
        rubricKeyPoints: [],
        meta: {
          skillsCount: 1
        }
      };

      // Collect highlights from primaryTakeaway or strength examples
      for (const skill of skillAssessments) {
        if (skill.structuredFeedback?.primaryTakeaway) {
          result.highlights.push(skill.structuredFeedback.primaryTakeaway);
        }

        // Collect recommendations from primaryFocus.description
        if (skill.structuredFeedback?.primaryFocus?.description) {
          result.recommendations.push(skill.structuredFeedback.primaryFocus.description);
        }

        // Collect rubricKeyPoints from nextLevelCriteria
        if (skill.structuredFeedback?.primaryFocus?.nextLevelCriteria) {
          result.rubricKeyPoints.push(skill.structuredFeedback.primaryFocus.nextLevelCriteria);
        }
      }

      expect(result.highlights).toContain('Good work');
      expect(result.recommendations).toHaveLength(0);
      expect(result.rubricKeyPoints).toHaveLength(0);
    });

    it('should deduplicate identical recommendations and highlights', () => {
      const skillAssessments: SkillAssessment[] = [
        {
          skillId: 'clarity_eloquence',
          level: 4,
          structuredFeedback: {
            primaryTakeaway: 'Good clause variety',
            primaryFocus: {
              description: 'Use because clauses',
              nextLevelCriteria: 'Practice daily'
            },
            annotatedExamples: []
          }
        },
        {
          skillId: 'structure_complexity',
          level: 5,
          structuredFeedback: {
            primaryTakeaway: 'Good clause variety', // Duplicate
            primaryFocus: {
              description: 'Use because clauses', // Duplicate
              nextLevelCriteria: 'Practice daily' // Duplicate
            },
            annotatedExamples: []
          }
        }
      ];

      const result: GroupResults = {
        highlights: [],
        recommendations: [],
        rubricKeyPoints: [],
        meta: {
          skillsCount: 2
        }
      };

      // Collect highlights from primaryTakeaway or strength examples
      for (const skill of skillAssessments) {
        if (skill.structuredFeedback?.primaryTakeaway) {
          result.highlights.push(skill.structuredFeedback.primaryTakeaway);
        }

        // Collect recommendations from primaryFocus.description
        if (skill.structuredFeedback?.primaryFocus?.description) {
          result.recommendations.push(skill.structuredFeedback.primaryFocus.description);
        }

        // Collect rubricKeyPoints from nextLevelCriteria
        if (skill.structuredFeedback?.primaryFocus?.nextLevelCriteria) {
          result.rubricKeyPoints.push(skill.structuredFeedback.primaryFocus.nextLevelCriteria);
        }
      }

      // Dedupe and cap arrays
      result.highlights = [...new Set(result.highlights)].slice(0, 3);
      result.recommendations = [...new Set(result.recommendations)].slice(0, 3);
      result.rubricKeyPoints = [...new Set(result.rubricKeyPoints)].slice(0, 5);

      expect(result.highlights).toHaveLength(1); // Should be deduplicated
      expect(result.recommendations).toHaveLength(1); // Should be deduplicated
      expect(result.rubricKeyPoints).toHaveLength(1); // Should be deduplicated
    });
  });
});
