/**
 * Complete Coaching Journey Integration Tests
 * Tests full user experience from onboarding to goal achievement
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import {
  createTestUser,
  createTestSession,
  testAudioFiles,
  expectedAssessmentResults
} from '../../fixtures/integration-data'
import {
  mockAIAPI,
  mockConvexBackend,
  mockStorageService,
  setupIntegrationMocks,
  cleanupIntegrationMocks
} from '../../mocks/integration-services'

describe('Complete Coaching Journey', () => {
  let cleanupMocks: () => void

  beforeAll(() => {
    cleanupMocks = setupIntegrationMocks()
  })

  afterAll(() => {
    cleanupMocks()
    cleanupIntegrationMocks()
  })

  beforeEach(() => {
    mockConvexBackend.clearData()
    mockStorageService.clearFiles()
  })

  describe('Full User Coaching Experience', () => {
    it('should complete comprehensive coaching journey from registration to goal achievement', async () => {
      // 1. User Registration & Onboarding
      const user = createTestUser({
        goals: ['improve presentation skills', 'build confidence in meetings', 'enhance communication clarity'],
        profile: {
          name: 'Sarah Johnson',
          experience: 'Mid-level marketing manager',
          industry: 'Technology'
        }
      })

      await mockConvexBackend.seedUser(user)

      // Verify user profile setup
      const storedUser = await mockConvexBackend.query('users:get', { userId: user.id })
      expect(storedUser.goals).toHaveLength(3)
      expect(storedUser.profile.industry).toBe('Technology')

      // 2. Initial Assessment (Baseline)
      const baselineSession = createTestSession(user.id, {
        metadata: {
          type: 'initial-assessment',
          goals: user.goals,
          assessmentType: 'comprehensive'
        }
      })
      await mockConvexBackend.seedSession(baselineSession)

      // Upload and process initial recording
      const baselineAudio = testAudioFiles['presentation-sample.wav']
      const baselineKey = `audio/${baselineSession.id}/baseline-recording.wav`
      await mockStorageService.uploadFile(baselineKey, baselineAudio.content, {
        contentType: 'audio/wav',
        userId: user.id,
        sessionId: baselineSession.id
      })

      // Transcribe and assess
      const baselineTranscript = await mockAIAPI.transcribe(baselineAudio.content)
      const baselineAssessment = await mockAIAPI.assess(baselineTranscript.text, [
        'clarity', 'confidence', 'engagement', 'empathy', 'activeListening'
      ])

      // Store baseline assessment
      const baselineAssessmentData = {
        id: `assessment-baseline-${Date.now()}`,
        sessionId: baselineSession.id,
        userId: user.id,
        skillAssessments: baselineAssessment.skillAssessments,
        overallScore: baselineAssessment.skillAssessments.reduce((sum, s) => sum + s.score, 0) / baselineAssessment.skillAssessments.length,
        feedback: 'Initial assessment completed. Areas for improvement identified.',
        createdAt: new Date(),
        type: 'baseline'
      }

      await mockConvexBackend.seedAssessment(baselineAssessmentData)

      // 3. Personalized Coaching Plan Generation
      const coachingPlan = await mockConvexBackend.query('goals:getCoachingPlan', {
        userId: user.id,
        assessmentId: baselineAssessmentData.id
      })

      expect(coachingPlan).toBeTruthy()
      expect(coachingPlan.skills).toContain('presentation')
      expect(coachingPlan.duration).toBeGreaterThan(7) // At least 1 week
      expect(coachingPlan.sessionsPerWeek).toBeGreaterThan(0)
      expect(coachingPlan.focusAreas).toHaveLength(baselineAssessment.skillAssessments.length)

      // 4. Practice Sessions (3 sessions with improvement tracking)
      const practiceSessions = []
      const practiceAssessments = []

      for (let i = 0; i < 3; i++) {
        // Create practice session
        const practiceSession = createTestSession(user.id, {
          metadata: {
            type: 'practice',
            sessionNumber: i + 1,
            focusSkill: coachingPlan.focusAreas[i % coachingPlan.focusAreas.length]
          }
        })
        await mockConvexBackend.seedSession(practiceSession)
        practiceSessions.push(practiceSession)

        // Simulate improved performance
        const improvement = (i + 1) * 0.15 // 15% improvement per session
        const practiceAudio = testAudioFiles['practice-session-1.wav']
        const practiceKey = `audio/${practiceSession.id}/practice-${i + 1}.wav`

        await mockStorageService.uploadFile(practiceKey, practiceAudio.content, {
          contentType: 'audio/wav',
          userId: user.id,
          sessionId: practiceSession.id
        })

        const practiceTranscript = await mockAIAPI.transcribe(practiceAudio.content)
        const practiceAssessment = await mockAIAPI.assess(practiceTranscript.text, [
          'clarity', 'confidence', 'engagement'
        ])

        // Apply improvement to scores
        const improvedAssessment = {
          ...practiceAssessment,
          skillAssessments: practiceAssessment.skillAssessments.map(skill => ({
            ...skill,
            score: Math.min(1.0, skill.score + improvement),
            improvement: improvement
          }))
        }

        const practiceAssessmentData = {
          id: `assessment-practice-${i + 1}-${Date.now()}`,
          sessionId: practiceSession.id,
          userId: user.id,
          skillAssessments: improvedAssessment.skillAssessments,
          overallScore: improvedAssessment.skillAssessments.reduce((sum, s) => sum + s.score, 0) / improvedAssessment.skillAssessments.length,
          feedback: `Practice session ${i + 1} completed with ${Math.round(improvement * 100)}% improvement.`,
          createdAt: new Date(),
          type: 'practice',
          sessionNumber: i + 1
        }

        await mockConvexBackend.seedAssessment(practiceAssessmentData)
        practiceAssessments.push(practiceAssessmentData)
      }

      // 5. Progress Tracking and Analytics
      const progressReport = await mockConvexBackend.query('progress:getReport', {
        userId: user.id,
        timeframe: 'week'
      })

      expect(progressReport).toBeTruthy()
      expect(progressReport.sessionsCompleted).toBe(4) // 1 baseline + 3 practice
      expect(progressReport.totalImprovement).toBeGreaterThan(0)
      expect(progressReport.averageImprovement).toBeGreaterThan(0)
      expect(progressReport.skillBreakdown).toBeDefined()

      // Verify improvement calculation
      const overallImprovement = progressReport.totalImprovement
      expect(overallImprovement).toBeGreaterThan(0.3) // At least 30% total improvement

      // 6. Goal Achievement Validation
      const goalsStatus = await mockConvexBackend.query('goals:getStatus', {
        userId: user.id
      })

      expect(goalsStatus).toBeTruthy()
      expect(goalsStatus.goals).toHaveLength(3)
      expect(goalsStatus.completedGoals).toContain('presentation-skills')

      // Check individual goal progress
      goalsStatus.goals.forEach((goal: any) => {
        expect(goal.progress).toBeGreaterThan(0)
        expect(goal.targetProgress).toBeDefined()
        if (goal.progress >= goal.targetProgress) {
          expect(goalsStatus.completedGoals).toContain(goal.id)
        }
      })

      // 7. Final Assessment and Certification
      const finalSession = createTestSession(user.id, {
        metadata: {
          type: 'final-assessment',
          goals: user.goals,
          assessmentType: 'comprehensive'
        }
      })
      await mockConvexBackend.seedSession(finalSession)

      const finalAudio = testAudioFiles['practice-session-2.wav']
      const finalKey = `audio/${finalSession.id}/final-recording.wav`
      await mockStorageService.uploadFile(finalKey, finalAudio.content, {
        contentType: 'audio/wav',
        userId: user.id,
        sessionId: finalSession.id
      })

      const finalTranscript = await mockAIAPI.transcribe(finalAudio.content)
      const finalAssessment = await mockAIAPI.assess(finalTranscript.text, [
        'clarity', 'confidence', 'engagement', 'empathy', 'activeListening'
      ])

      // Apply maximum improvement for final assessment
      const maxImprovement = 0.5 // 50% total improvement
      const finalAssessmentData = {
        id: `assessment-final-${Date.now()}`,
        sessionId: finalSession.id,
        userId: user.id,
        skillAssessments: finalAssessment.skillAssessments.map(skill => ({
          ...skill,
          score: Math.min(1.0, baselineAssessment.skillAssessments.find(b => b.skillId === skill.skillId)?.score || 0.5 + maxImprovement),
          improvement: maxImprovement
        })),
        overallScore: 0.85, // High final score
        feedback: 'Outstanding improvement! All goals achieved successfully.',
        createdAt: new Date(),
        type: 'final'
      }

      await mockConvexBackend.seedAssessment(finalAssessmentData)

      // 8. Journey Completion and Certification
      const completionCertificate = await mockConvexBackend.query('certificates:generate', {
        userId: user.id,
        journeyId: 'presentation-skills-journey',
        finalAssessmentId: finalAssessmentData.id
      })

      expect(completionCertificate).toBeTruthy()
      expect(completionCertificate.achievedSkills).toHaveLength(5)
      expect(completionCertificate.overallScore).toBeGreaterThan(0.8)
      expect(completionCertificate.completionDate).toBeDefined()
      expect(completionCertificate.skills).toContain('presentation')
    })

    it('should handle adaptive coaching based on user progress', async () => {
      const user = createTestUser({
        goals: ['improve communication skills']
      })
      await mockConvexBackend.seedUser(user)

      // Start with basic assessment
      const initialSession = createTestSession(user.id)
      await mockConvexBackend.seedSession(initialSession)

      const initialAudio = testAudioFiles['conversation-sample.wav']
      await mockStorageService.uploadFile(
        `audio/${initialSession.id}/initial.wav`,
        initialAudio.content
      )

      const initialTranscript = await mockAIAPI.transcribe(initialAudio.content)
      const initialAssessment = await mockAIAPI.assess(initialTranscript.text, ['clarity', 'confidence'])

      await mockConvexBackend.seedAssessment({
        id: `assessment-initial-${Date.now()}`,
        sessionId: initialSession.id,
        userId: user.id,
        skillAssessments: initialAssessment.skillAssessments,
        overallScore: initialAssessment.skillAssessments.reduce((sum, s) => sum + s.score, 0) / initialAssessment.skillAssessments.length,
        feedback: 'Initial assessment shows room for improvement in confidence.',
        createdAt: new Date()
      })

      // System should adapt coaching plan based on weak areas
      const adaptivePlan = await mockConvexBackend.query('coaching:getAdaptivePlan', {
        userId: user.id
      })

      expect(adaptivePlan).toBeTruthy()
      expect(adaptivePlan.adaptedExercises).toBeDefined()
      expect(adaptivePlan.focusAreas).toContain('confidence')

      // Simulate user struggling with specific skill
      const struggleSession = createTestSession(user.id, {
        metadata: { focusSkill: 'confidence', difficulty: 'high' }
      })
      await mockConvexBackend.seedSession(struggleSession)

      // Low improvement session
      const struggleAssessment = await mockAIAPI.assess(
        'Struggling with confidence in this presentation.',
        ['clarity', 'confidence']
      )

      const lowImprovementAssessment = {
        ...struggleAssessment,
        skillAssessments: struggleAssessment.skillAssessments.map(skill =>
          skill.skillId === 'confidence' ? { ...skill, score: 0.3, improvement: -0.05 } : skill
        )
      }

      await mockConvexBackend.seedAssessment({
        id: `assessment-struggle-${Date.now()}`,
        sessionId: struggleSession.id,
        userId: user.id,
        skillAssessments: lowImprovementAssessment.skillAssessments,
        overallScore: 0.4,
        feedback: 'Confidence decreased. Need simpler exercises.',
        createdAt: new Date()
      })

      // System should adapt to provide easier exercises
      const updatedPlan = await mockConvexBackend.query('coaching:getAdaptivePlan', {
        userId: user.id
      })

      expect(updatedPlan.difficulty).toBe('beginner')
      expect(updatedPlan.exerciseComplexity).toBeLessThanOrEqual(adaptivePlan.exerciseComplexity || 2)
      expect(updatedPlan.additionalSupport).toBe(true)
    })

    it('should provide comprehensive progress analytics and insights', async () => {
      const user = createTestUser()
      await mockConvexBackend.seedUser(user)

      // Create multiple sessions with varying performance
      const sessions = []
      const assessments = []

      for (let i = 0; i < 5; i++) {
        const session = createTestSession(user.id, {
          metadata: { sessionNumber: i + 1 }
        })
        await mockConvexBackend.seedSession(session)
        sessions.push(session)

        // Vary performance to create interesting analytics
        const baseScore = 0.5 + (i * 0.1) // Improving over time
        const variation = (Math.random() - 0.5) * 0.2 // Add some variation

        const assessment = await mockAIAPI.assess(
          `Session ${i + 1} performance assessment.`,
          ['clarity', 'confidence', 'engagement']
        )

        const variedAssessment = {
          ...assessment,
          skillAssessments: assessment.skillAssessments.map(skill => ({
            ...skill,
            score: Math.max(0.1, Math.min(1.0, baseScore + variation))
          }))
        }

        const assessmentData = {
          id: `assessment-analytics-${i + 1}-${Date.now()}`,
          sessionId: session.id,
          userId: user.id,
          skillAssessments: variedAssessment.skillAssessments,
          overallScore: variedAssessment.skillAssessments.reduce((sum, s) => sum + s.score, 0) / variedAssessment.skillAssessments.length,
          feedback: `Session ${i + 1} feedback.`,
          createdAt: new Date(Date.now() + i * 24 * 60 * 60 * 1000) // One day apart
        }

        await mockConvexBackend.seedAssessment(assessmentData)
        assessments.push(assessmentData)
      }

      // Get comprehensive analytics
      const analytics = await mockConvexBackend.query('analytics:getComprehensive', {
        userId: user.id,
        timeframe: 'month'
      })

      expect(analytics).toBeTruthy()

      // Verify trend analysis
      expect(analytics.trends).toBeDefined()
      expect(analytics.trends.overallImprovement).toBeGreaterThan(0)
      expect(analytics.trends.consistencyScore).toBeDefined()

      // Verify skill-specific insights
      expect(analytics.skillInsights).toHaveLength(3)
      analytics.skillInsights.forEach((skill: any) => {
        expect(skill.skillId).toBeDefined()
        expect(skill.progressRate).toBeDefined()
        expect(skill.strengths).toBeDefined()
        expect(skill.areasForImprovement).toBeDefined()
      })

      // Verify session patterns
      expect(analytics.sessionPatterns).toBeDefined()
      expect(analytics.sessionPatterns.bestPerformingDays).toBeDefined()
      expect(analytics.sessionPatterns.improvementVelocity).toBeDefined()

      // Verify predictive insights
      expect(analytics.predictions).toBeDefined()
      expect(analytics.predictions.projectedImprovement).toBeGreaterThan(0)
      expect(analytics.predictions.recommendedFocusAreas.length).toBeGreaterThan(0)
    })
  })
})
