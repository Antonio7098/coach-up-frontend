/**
 * Skill Assessment Integration Tests
 * Tests the complete skill assessment flow from recording to results
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

describe('Skill Assessment Integration', () => {
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

  describe('Complete Skill Assessment Flow', () => {
    it('should complete full skill assessment from recording to results', async () => {
      // 1. Setup test user and session
      const user = createTestUser({
        goals: ['improve presentation skills', 'build confidence']
      })
      await mockConvexBackend.seedUser(user)

      const session = createTestSession(user.id, {
        metadata: { type: 'presentation', goals: ['presentation skills'] }
      })
      await mockConvexBackend.seedSession(session)

      // 2. Simulate voice recording upload
      const audioFile = testAudioFiles['presentation-sample.wav']
      const uploadResult = await mockStorageService.uploadFile(
        `audio/${session.id}/recording.wav`,
        audioFile.content,
        { contentType: 'audio/wav', duration: audioFile.duration }
      )

      // 3. Transcribe audio
      const transcription = await mockAIAPI.transcribe(audioFile.content)
      expect(transcription.text).toBeTruthy()
      expect(transcription.confidence).toBeGreaterThan(0.8)

      // 4. Run skill assessment on transcript
      const assessment = await mockAIAPI.assess(transcription.text, ['clarity', 'confidence', 'engagement'])

      // 5. Validate assessment results
      expect(assessment.skillAssessments).toHaveLength(3)
      expect(assessment.meta.processingTime).toBeGreaterThan(0)
      expect(assessment.meta.confidence).toBeGreaterThan(0.8)

      // 6. Store assessment results
      const storedAssessment = {
        id: `assessment-${Date.now()}`,
        sessionId: session.id,
        userId: user.id,
        skillAssessments: assessment.skillAssessments,
        overallScore: assessment.skillAssessments.reduce((sum, skill) => sum + skill.score, 0) / assessment.skillAssessments.length,
        feedback: 'Assessment completed successfully',
        createdAt: new Date()
      }

      await mockConvexBackend.seedAssessment(storedAssessment)

      // 7. Verify data persistence
      const retrievedAssessment = await mockConvexBackend.query('assessments:get', { sessionId: session.id })
      expect(retrievedAssessment).toBeTruthy()
      expect(retrievedAssessment.skillAssessments).toHaveLength(3)
      expect(retrievedAssessment.overallScore).toBeGreaterThan(0)

      // 8. Verify skill scores are within expected ranges
      assessment.skillAssessments.forEach(skill => {
        expect(skill.score).toBeGreaterThanOrEqual(0)
        expect(skill.score).toBeLessThanOrEqual(1)
        expect(skill.confidence).toBeGreaterThan(0.7)
        expect(skill.highlights).toHaveLength(3)
        expect(skill.recommendations).toHaveLength(3)
      })
    })

    it('should handle multiple skill types in single assessment', async () => {
      const user = createTestUser()
      await mockConvexBackend.seedUser(user)

      const session = createTestSession(user.id)
      await mockConvexBackend.seedSession(session)

      // Test with comprehensive skill set
      const skillsToAssess = [
        'clarity', 'confidence', 'empathy', 'engagement',
        'activeListening', 'bodyLanguage', 'tone'
      ]

      const transcript = 'This is a comprehensive presentation covering multiple communication aspects.'
      const assessment = await mockAIAPI.assess(transcript, skillsToAssess)

      expect(assessment.skillAssessments).toHaveLength(skillsToAssess.length)

      // Verify all skills are assessed
      const assessedSkillIds = assessment.skillAssessments.map(s => s.skillId)
      skillsToAssess.forEach(skill => {
        expect(assessedSkillIds).toContain(skill)
      })

      // Verify score distribution makes sense (not all identical)
      const scores = assessment.skillAssessments.map(s => s.score)
      const uniqueScores = new Set(scores)
      expect(uniqueScores.size).toBeGreaterThan(1) // Should have some variation
    })

    it('should track assessment progress in real-time', async () => {
      const user = createTestUser()
      await mockConvexBackend.seedUser(user)

      const session = createTestSession(user.id)
      await mockConvexBackend.seedSession(session)

      // Track real-time updates
      const progressUpdates: string[] = []

      // Subscribe to assessment updates
      const unsubscribe = mockConvexBackend.subscribe(
        'assessments:watch',
        { sessionId: session.id },
        (update) => {
          progressUpdates.push(update.status)
        }
      )

      // Step 1: Start assessment
      await mockConvexBackend.mutation('assessments:start', {
        sessionId: session.id,
        status: 'processing'
      })

      // Allow time for subscription to process
      await new Promise(resolve => setTimeout(resolve, 20))
      expect(progressUpdates).toContain('processing')

      // Step 2: Transcription complete
      await mockConvexBackend.mutation('assessments:update', {
        sessionId: session.id,
        status: 'transcribing'
      })

      await new Promise(resolve => setTimeout(resolve, 20))
      expect(progressUpdates).toContain('transcribing')

      // Step 3: Analysis complete
      await mockConvexBackend.mutation('assessments:update', {
        sessionId: session.id,
        status: 'analyzing'
      })

      await new Promise(resolve => setTimeout(resolve, 20))
      expect(progressUpdates).toContain('analyzing')

      // Step 4: Assessment complete
      const finalAssessment = await mockAIAPI.assess('Test transcript', ['clarity', 'confidence'])
      await mockConvexBackend.mutation('assessments:complete', {
        sessionId: session.id,
        assessment: finalAssessment,
        status: 'completed'
      })

      await new Promise(resolve => setTimeout(resolve, 20))
      expect(progressUpdates).toContain('completed')

      unsubscribe()
    })
  })

  describe('Skill Tracking Integration', () => {
    it('should track skill progress across multiple sessions', async () => {
      const user = createTestUser({
        goals: ['improve presentation skills', 'build confidence']
      })
      await mockConvexBackend.seedUser(user)

      // Session 1: Initial assessment (baseline)
      const session1 = createTestSession(user.id, {
        metadata: { type: 'presentation', goals: ['presentation skills'] }
      })
      await mockConvexBackend.seedSession(session1)

      const baselineAssessment = await mockAIAPI.assess(
        'Initial presentation with some hesitations and unclear parts.',
        ['clarity', 'confidence', 'engagement']
      )

      await mockConvexBackend.seedAssessment({
        id: `assessment-session1-${Date.now()}`,
        sessionId: session1.id,
        userId: user.id,
        skillAssessments: baselineAssessment.skillAssessments.map(skill => ({
          ...skill,
          improvement: 0 // Baseline
        })),
        overallScore: baselineAssessment.skillAssessments.reduce((sum, s) => sum + s.score, 0) / baselineAssessment.skillAssessments.length,
        feedback: 'Initial assessment completed',
        createdAt: new Date()
      })

      // Session 2: Improved performance
      const session2 = createTestSession(user.id, {
        metadata: { type: 'presentation', goals: ['presentation skills'] }
      })
      await mockConvexBackend.seedSession(session2)

      const improvedAssessment = await mockAIAPI.assess(
        'Much improved presentation with clear structure and confident delivery.',
        ['clarity', 'confidence', 'engagement']
      )

      await mockConvexBackend.seedAssessment({
        id: `assessment-session2-${Date.now()}`,
        sessionId: session2.id,
        userId: user.id,
        skillAssessments: improvedAssessment.skillAssessments.map(skill => ({
          ...skill,
          improvement: 0.25 // 25% improvement
        })),
        overallScore: improvedAssessment.skillAssessments.reduce((sum, s) => sum + s.score, 0) / improvedAssessment.skillAssessments.length,
        feedback: 'Significant improvement observed',
        createdAt: new Date()
      })

      // Verify progress tracking
      const progress = await mockConvexBackend.query('skills:getUserProgress', {
        userId: user.id
      })

      expect(progress).toBeTruthy()
      expect(progress.sessionsCompleted).toBe(2)

      // Check improvement tracking
      progress.skillAssessments.forEach((skill: any) => {
        expect(skill.improvement).toBeGreaterThan(0)
        expect(skill.baselineScore).toBeDefined()
        expect(skill.currentScore).toBeDefined()
        expect(skill.currentScore).toBeGreaterThanOrEqual(skill.baselineScore)
      })
    })

    it('should provide personalized recommendations based on skill gaps', async () => {
      const user = createTestUser({
        goals: ['improve communication skills']
      })
      await mockConvexBackend.seedUser(user)

      // Create assessment with clear skill gaps
      const assessment = await mockAIAPI.assess(
        'Presentation with low confidence and unclear delivery.',
        ['clarity', 'confidence', 'engagement']
      )

      // Simulate low confidence score
      const modifiedAssessment = {
        ...assessment,
        skillAssessments: assessment.skillAssessments.map(skill =>
          skill.skillId === 'confidence' ? { ...skill, score: 0.3 } : skill
        )
      }

      await mockConvexBackend.seedAssessment({
        id: `assessment-gaps-${Date.now()}`,
        sessionId: 'session-gaps',
        userId: user.id,
        skillAssessments: modifiedAssessment.skillAssessments,
        overallScore: 0.5,
        feedback: 'Needs improvement in confidence',
        createdAt: new Date()
      })

      // Get personalized recommendations
      const recommendations = await mockConvexBackend.query('recommendations:get', {
        userId: user.id,
        assessmentId: 'assessment-gaps'
      })

      expect(recommendations).toBeTruthy()
      expect(recommendations.prioritySkills).toContain('confidence')
      expect(recommendations.exercises).toBeDefined()
      expect(recommendations.exercises.length).toBeGreaterThan(0)

      // Verify recommendations are specific to low-scoring skills
      const confidenceExercises = recommendations.exercises.filter((ex: any) =>
        ex.targetSkill === 'confidence'
      )
      expect(confidenceExercises.length).toBeGreaterThan(0)
    })
  })
})
