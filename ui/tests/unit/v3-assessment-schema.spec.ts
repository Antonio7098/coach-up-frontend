import { describe, it, expect } from 'vitest';

// Type definitions for testing
interface StructuredFeedback {
  primaryTakeaway: string;
  primaryFocus: {
    description: string;
    nextLevelCriteria: string;
    exampleToPractice?: string;
  };
  annotatedExamples: Array<{
    userQuote: string;
    annotation: string;
    classification: 'strength' | 'improvement_opportunity';
    relevantLevel: number;
  }>;
}

interface QuantitativeMetrics {
  averageTUnitLength?: number;
  subordinationIndex?: number;
  yngveScore?: number;
  nominalizationCount?: number;
  conjunctionVariety?: string[];
}

interface AssessmentMetadata {
  provider?: string;
  modelId?: string;
  promptVersion?: string;
  tokenCount?: number;
  costCents?: number;
  processingTimeMs?: number;
}

interface SourceContext {
  assessmentType?: string;
  interactionCount?: number;
  transcriptLength?: number;
  sessionDuration?: number;
}

interface SkillAssessmentV3 {
  assessmentId: string;
  userId: string;
  sessionId: string;
  groupId: string;
  skillId: string;
  skillHash: string;
  level: number;
  confidence?: number;
  structuredFeedback: StructuredFeedback;
  quantitativeMetrics?: QuantitativeMetrics;
  assessmentMetadata?: AssessmentMetadata;
  sourceContext?: SourceContext;
  createdAt: number;
  updatedAt: number;
}

interface AssessmentsV3 {
  userId: string;
  sessionId: string;
  groupId: string;
  results: {
    highlights: string[];
    recommendations: string[];
    rubricKeyPoints: string[];
    meta?: {
      skillsCount: number;
      provider?: string;
      modelId?: string;
    };
  };
  kpis?: {
    averageLevel?: number;
    totalScore?: number;
  };
  assessmentMetadata?: AssessmentMetadata;
  createdAt: number;
  updatedAt: number;
}

// Validation helper functions
function validateStructuredFeedback(feedback: StructuredFeedback): boolean {
  return (
    typeof feedback.primaryTakeaway === 'string' &&
    feedback.primaryTakeaway.length > 0 &&
    typeof feedback.primaryFocus === 'object' &&
    feedback.primaryFocus !== null &&
    typeof feedback.primaryFocus.description === 'string' &&
    feedback.primaryFocus.description.length > 0 &&
    typeof feedback.primaryFocus.nextLevelCriteria === 'string' &&
    feedback.primaryFocus.nextLevelCriteria.length > 0 &&
    (feedback.primaryFocus.exampleToPractice === undefined || typeof feedback.primaryFocus.exampleToPractice === 'string') &&
    Array.isArray(feedback.annotatedExamples) &&
    feedback.annotatedExamples.every((example) =>
      typeof example.userQuote === 'string' &&
      example.userQuote.length > 0 &&
      typeof example.annotation === 'string' &&
      example.annotation.length > 0 &&
      (example.classification === 'strength' || example.classification === 'improvement_opportunity') &&
      typeof example.relevantLevel === 'number' &&
      example.relevantLevel >= 0 &&
      example.relevantLevel <= 10 &&
      Number.isInteger(example.relevantLevel)
    )
  );
}

function validateQuantitativeMetrics(metrics?: QuantitativeMetrics): boolean {
  if (metrics === undefined) return true;

  return (
    (metrics.averageTUnitLength === undefined || (typeof metrics.averageTUnitLength === 'number' && metrics.averageTUnitLength > 0)) &&
    (metrics.subordinationIndex === undefined || (typeof metrics.subordinationIndex === 'number' && metrics.subordinationIndex >= 0 && metrics.subordinationIndex <= 1)) &&
    (metrics.yngveScore === undefined || (typeof metrics.yngveScore === 'number' && metrics.yngveScore > 0)) &&
    (metrics.nominalizationCount === undefined || (typeof metrics.nominalizationCount === 'number' && metrics.nominalizationCount >= 0 && Number.isInteger(metrics.nominalizationCount))) &&
    (metrics.conjunctionVariety === undefined || (Array.isArray(metrics.conjunctionVariety) && metrics.conjunctionVariety.every(item => typeof item === 'string')))
  );
}

function validateAssessmentMetadata(metadata?: AssessmentMetadata): boolean {
  if (metadata === undefined) return true;

  return (
    (metadata.provider === undefined || typeof metadata.provider === 'string') &&
    (metadata.modelId === undefined || typeof metadata.modelId === 'string') &&
    (metadata.promptVersion === undefined || typeof metadata.promptVersion === 'string') &&
    (metadata.tokenCount === undefined || (typeof metadata.tokenCount === 'number' && metadata.tokenCount > 0 && Number.isInteger(metadata.tokenCount))) &&
    (metadata.costCents === undefined || (typeof metadata.costCents === 'number' && metadata.costCents >= 0 && Number.isInteger(metadata.costCents))) &&
    (metadata.processingTimeMs === undefined || (typeof metadata.processingTimeMs === 'number' && metadata.processingTimeMs > 0 && Number.isInteger(metadata.processingTimeMs)))
  );
}

function validateSourceContext(context?: SourceContext): boolean {
  if (context === undefined) return true;

  return (
    (context.assessmentType === undefined || typeof context.assessmentType === 'string') &&
    (context.interactionCount === undefined || (typeof context.interactionCount === 'number' && context.interactionCount >= 0 && Number.isInteger(context.interactionCount))) &&
    (context.transcriptLength === undefined || (typeof context.transcriptLength === 'number' && context.transcriptLength >= 0 && Number.isInteger(context.transcriptLength))) &&
    (context.sessionDuration === undefined || (typeof context.sessionDuration === 'number' && context.sessionDuration > 0 && Number.isInteger(context.sessionDuration)))
  );
}

function validateSkillAssessmentV3(assessment: SkillAssessmentV3): boolean {
  return (
    typeof assessment.assessmentId === 'string' &&
    typeof assessment.userId === 'string' &&
    typeof assessment.sessionId === 'string' &&
    typeof assessment.groupId === 'string' &&
    typeof assessment.skillId === 'string' &&
    typeof assessment.skillHash === 'string' &&
    typeof assessment.level === 'number' &&
    assessment.level >= 0 &&
    assessment.level <= 10 &&
    Number.isInteger(assessment.level) &&
    (assessment.confidence === undefined || (typeof assessment.confidence === 'number' && assessment.confidence >= 0 && assessment.confidence <= 1)) &&
    validateStructuredFeedback(assessment.structuredFeedback) &&
    validateQuantitativeMetrics(assessment.quantitativeMetrics) &&
    validateAssessmentMetadata(assessment.assessmentMetadata) &&
    validateSourceContext(assessment.sourceContext) &&
    typeof assessment.createdAt === 'number' &&
    typeof assessment.updatedAt === 'number'
  );
}

function validateAssessmentsV3(assessment: AssessmentsV3): boolean {
  return (
    typeof assessment.userId === 'string' &&
    typeof assessment.sessionId === 'string' &&
    typeof assessment.groupId === 'string' &&
    Array.isArray(assessment.results.highlights) &&
    assessment.results.highlights.every(item => typeof item === 'string') &&
    Array.isArray(assessment.results.recommendations) &&
    assessment.results.recommendations.every(item => typeof item === 'string') &&
    Array.isArray(assessment.results.rubricKeyPoints) &&
    assessment.results.rubricKeyPoints.every(item => typeof item === 'string') &&
    (assessment.results.meta === undefined || (
      typeof assessment.results.meta.skillsCount === 'number' &&
      assessment.results.meta.skillsCount > 0 &&
      Number.isInteger(assessment.results.meta.skillsCount) &&
      (assessment.results.meta.provider === undefined || typeof assessment.results.meta.provider === 'string') &&
      (assessment.results.meta.modelId === undefined || typeof assessment.results.meta.modelId === 'string')
    )) &&
    (assessment.kpis === undefined || (
      (assessment.kpis.averageLevel === undefined || (typeof assessment.kpis.averageLevel === 'number' && assessment.kpis.averageLevel >= 0 && assessment.kpis.averageLevel <= 10)) &&
      (assessment.kpis.totalScore === undefined || (typeof assessment.kpis.totalScore === 'number' && assessment.kpis.totalScore >= 0 && assessment.kpis.totalScore <= 1))
    )) &&
    validateAssessmentMetadata(assessment.assessmentMetadata) &&
    typeof assessment.createdAt === 'number' &&
    typeof assessment.updatedAt === 'number'
  );
}

describe('v3 Assessment Schema Validation', () => {
  describe('StructuredFeedback Schema', () => {
    it('should validate valid structured feedback', () => {
      const validFeedback: StructuredFeedback = {
        primaryTakeaway: 'Your clause variety is improving',
        primaryFocus: {
          description: 'Introduce clauses using because or when',
          nextLevelCriteria: 'Occasional use of subordinating conjunctions',
          exampleToPractice: 'I enjoy reading because it relaxes me'
        },
        annotatedExamples: [
          {
            userQuote: 'I go to school',
            annotation: 'Simple clause; consider adding a because-clause',
            classification: 'improvement_opportunity',
            relevantLevel: 3
          },
          {
            userQuote: 'I stayed home because it rained',
            annotation: 'Shows causal subordination (level 4)',
            classification: 'strength',
            relevantLevel: 4
          }
        ]
      };

      const result = validateStructuredFeedback(validFeedback);
      expect(result).toBe(true);
    });

    it('should reject invalid classification', () => {
      const invalidFeedback: StructuredFeedback = {
        primaryTakeaway: 'Good job',
        primaryFocus: {
          description: 'Keep practicing',
          nextLevelCriteria: 'Practice more'
        },
        annotatedExamples: [
          {
            userQuote: 'Test quote',
            annotation: 'Test annotation',
            classification: 'invalid' as any,
            relevantLevel: 5
          }
        ]
      };

      const result = validateStructuredFeedback(invalidFeedback);
      expect(result).toBe(false);
    });

    it('should allow empty annotated examples', () => {
      const validFeedback: StructuredFeedback = {
        primaryTakeaway: 'Assessment completed',
        primaryFocus: {
          description: 'Continue practicing',
          nextLevelCriteria: 'Practice regularly'
        },
        annotatedExamples: []
      };

      const result = validateStructuredFeedback(validFeedback);
      expect(result).toBe(true);
    });
  });

  describe('QuantitativeMetrics Schema', () => {
    it('should validate valid quantitative metrics', () => {
      const validMetrics: QuantitativeMetrics = {
        averageTUnitLength: 8.3,
        subordinationIndex: 0.28,
        yngveScore: 1.8,
        nominalizationCount: 2,
        conjunctionVariety: ['and', 'because', 'so']
      };

      const result = validateQuantitativeMetrics(validMetrics);
      expect(result).toBe(true);
    });

    it('should validate empty quantitative metrics', () => {
      const result = validateQuantitativeMetrics({});
      expect(result).toBe(true);
    });

    it('should reject invalid subordination index', () => {
      const invalidMetrics: QuantitativeMetrics = {
        subordinationIndex: 1.5 // Should be <= 1.0
      };

      const result = validateQuantitativeMetrics(invalidMetrics);
      expect(result).toBe(false);
    });
  });

  describe('Assessment Metadata Schema', () => {
    it('should validate valid assessment metadata', () => {
      const validMeta: AssessmentMetadata = {
        provider: 'google',
        modelId: 'gemini-1.5-pro',
        promptVersion: 'v3',
        tokenCount: 1500,
        costCents: 5,
        processingTimeMs: 1200
      };

      const result = validateAssessmentMetadata(validMeta);
      expect(result).toBe(true);
    });

    it('should validate empty assessment metadata', () => {
      const result = validateAssessmentMetadata({});
      expect(result).toBe(true);
    });

    it('should reject negative cost', () => {
      const invalidMeta: AssessmentMetadata = {
        costCents: -5
      };

      const result = validateAssessmentMetadata(invalidMeta);
      expect(result).toBe(false);
    });
  });

  describe('Skill Assessment V3 Schema', () => {
    it('should validate complete v3 skill assessment', () => {
      const validAssessment: SkillAssessmentV3 = {
        assessmentId: 'assessment_123',
        userId: 'user_456',
        sessionId: 'session_789',
        groupId: 'group_012',
        skillId: 'clarity_eloquence',
        skillHash: 'abc123def456',
        level: 4,
        confidence: 0.85,
        structuredFeedback: {
          primaryTakeaway: 'Your clause variety is improving',
          primaryFocus: {
            description: 'Introduce clauses using because or when',
            nextLevelCriteria: 'Occasional use of subordinating conjunctions',
            exampleToPractice: 'I enjoy reading because it relaxes me'
          },
          annotatedExamples: [
            {
              userQuote: 'I go to school',
              annotation: 'Simple clause; consider adding a because-clause',
              classification: 'improvement_opportunity',
              relevantLevel: 3
            }
          ]
        },
        quantitativeMetrics: {
          averageTUnitLength: 8.3,
          subordinationIndex: 0.28,
          conjunctionVariety: ['and', 'because']
        },
        assessmentMetadata: {
          provider: 'google',
          modelId: 'gemini-1.5-pro',
          tokenCount: 1500,
          costCents: 5,
          processingTimeMs: 1200
        },
        sourceContext: {
          assessmentType: 'single_qa_pair',
          interactionCount: 3,
          transcriptLength: 150,
          sessionDuration: 60000
        },
        createdAt: Date.now(),
        updatedAt: Date.now()
      };

      const result = validateSkillAssessmentV3(validAssessment);
      expect(result).toBe(true);
    });

    it('should validate minimal v3 skill assessment', () => {
      const minimalAssessment: SkillAssessmentV3 = {
        assessmentId: 'assessment_123',
        userId: 'user_456',
        sessionId: 'session_789',
        groupId: 'group_012',
        skillId: 'clarity_eloquence',
        skillHash: 'abc123def456',
        level: 4,
        structuredFeedback: {
          primaryTakeaway: 'Assessment completed',
          primaryFocus: {
            description: 'Continue practicing',
            nextLevelCriteria: 'Practice regularly'
          },
          annotatedExamples: []
        },
        createdAt: Date.now(),
        updatedAt: Date.now()
      };

      const result = validateSkillAssessmentV3(minimalAssessment);
      expect(result).toBe(true);
    });
  });

  describe('Group Assessment V3 Schema', () => {
    it('should validate complete v3 group assessment', () => {
      const validGroupAssessment: AssessmentsV3 = {
        userId: 'user_456',
        sessionId: 'session_789',
        groupId: 'group_012',
        results: {
          highlights: ['Strong causal clauses in later turn', 'Good clause variety'],
          recommendations: ['Vary sentence starters', 'Use more complex structures'],
          rubricKeyPoints: ['minimal-edit correction', 'tone: supportive'],
          meta: {
            skillsCount: 2,
            provider: 'google',
            modelId: 'gemini-1.5-pro'
          }
        },
        kpis: {
          averageLevel: 4.5,
          totalScore: 0.45
        },
        assessmentMetadata: {
          provider: 'google',
          modelId: 'gemini-1.5-pro',
          tokenCount: 3000,
          costCents: 10,
          processingTimeMs: 2400
        },
        createdAt: Date.now(),
        updatedAt: Date.now()
      };

      const result = validateAssessmentsV3(validGroupAssessment);
      expect(result).toBe(true);
    });

    it('should validate minimal v3 group assessment', () => {
      const minimalGroupAssessment: AssessmentsV3 = {
        userId: 'user_456',
        sessionId: 'session_789',
        groupId: 'group_012',
        results: {
          highlights: ['Assessment completed'],
          recommendations: ['Continue practicing'],
          rubricKeyPoints: ['Practice regularly'],
          meta: {
            skillsCount: 1
          }
        },
        createdAt: Date.now(),
        updatedAt: Date.now()
      };

      const result = validateAssessmentsV3(minimalGroupAssessment);
      expect(result).toBe(true);
    });
  });
});
