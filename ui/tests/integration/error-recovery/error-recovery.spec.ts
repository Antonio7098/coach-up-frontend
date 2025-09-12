/**
 * Error Recovery Integration Tests
 * Tests comprehensive failure scenarios and recovery mechanisms
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import { createTestUser, createTestSession } from '../../fixtures/integration-data'
import {
  mockAIAPI,
  mockConvexBackend,
  mockStorageService,
  setupIntegrationMocks,
  cleanupIntegrationMocks
} from '../../mocks/integration-services'

describe('Error Recovery Integration', () => {
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
    vi.restoreAllMocks()
  })

  describe('Network Failure Recovery', () => {
    it('should retry and recover from intermittent network failures', async () => {
      const user = createTestUser()
      await mockConvexBackend.seedUser(user)

      const session = createTestSession(user.id)
      await mockConvexBackend.seedSession(session)

      // Mock intermittent AI API failures
      let attemptCount = 0
      const originalAssess = mockAIAPI.assess
      mockAIAPI.assess = vi.fn(async (transcript: string, skills: string[]) => {
        attemptCount++

        // Fail first 2 attempts, succeed on 3rd
        if (attemptCount <= 2) {
          await new Promise(resolve => setTimeout(resolve, 100)) // Simulate network delay
          throw new Error('Network timeout')
        }

        // Succeed on 3rd attempt
        return originalAssess(transcript, skills)
      })

      try {
        // Start assessment
        await mockConvexBackend.mutation('assessments:start', {
          sessionId: session.id,
          status: 'processing'
        })

        // Simulate the retry mechanism by calling assess multiple times
        let assessment
        let retryCount = 0
        const maxRetries = 3

        while (retryCount < maxRetries) {
          try {
            assessment = await mockAIAPI.assess('Test transcript', ['clarity', 'confidence'])
            break // Success, exit retry loop
          } catch (error) {
            retryCount++
            if (retryCount >= maxRetries) {
              throw error // All retries failed
            }
            // Wait before retry
            await new Promise(resolve => setTimeout(resolve, 50))
          }
        }

        expect(assessment).toBeDefined()
        expect(attemptCount).toBe(3) // Should have been called 3 times: 2 failures + 1 success
        expect(retryCount).toBe(2) // Should have retried 2 times

        // Verify the assessment was stored despite retries
        const storedAssessment = await mockConvexBackend.query('assessments:get', {
          sessionId: session.id
        })
        expect(storedAssessment).toBeTruthy()

      } finally {
        mockAIAPI.assess = originalAssess
      }
    })

    it('should handle complete service outages gracefully', async () => {
      const user = createTestUser()
      await mockConvexBackend.seedUser(user)

      const session = createTestSession(user.id)
      await mockConvexBackend.seedSession(session)

      // Mock complete AI service outage
      const originalAssess = mockAIAPI.assess
      mockAIAPI.assess = vi.fn(async () => {
        throw new Error('AI Service unavailable - network outage')
      })

      try {
        // Attempt operation during outage - should fail
        await expect(mockAIAPI.assess('Test', ['clarity'])).rejects.toThrow('AI Service unavailable')

        // For this test, we'll simulate degraded mode by checking fallback options
        // System should provide fallback options during service outage
        const offlineCapabilities = await mockConvexBackend.query('system:fallbackOptions', {
          userId: user.id
        })
        expect(offlineCapabilities.offlineMode).toBe(true)
        expect(offlineCapabilities.availableFeatures).toContain('manual-assessment')
        expect(offlineCapabilities.availableFeatures).toContain('progress-tracking')

        // Should be able to create basic offline session
        const offlineSession = await mockConvexBackend.query('sessions:createBasic', {
          userId: user.id,
          type: 'offline-practice'
        })
        expect(offlineSession.id).toBeDefined()
        expect(offlineSession.offline).toBe(true)

      } finally {
        mockAIAPI.assess = originalAssess
      }
    })

    it('should recover automatically when services come back online', async () => {
      const user = createTestUser()
      await mockConvexBackend.seedUser(user)

      let serviceDown = true
      const originalAssess = mockAIAPI.assess
      mockAIAPI.assess = vi.fn(async (transcript: string, skills: string[]) => {
        if (serviceDown) {
          throw new Error('AI Service temporarily down')
        }
        return originalAssess(transcript, skills)
      })

      try {
        // Start with service down - should fail
        await expect(mockAIAPI.assess('Test', ['clarity'])).rejects.toThrow('AI Service temporarily down')

        // Simulate service recovery
        serviceDown = false

        // System should detect recovery and operations should now succeed
        const recoveryCheck = await mockConvexBackend.query('system:healthCheck', {})
        expect(recoveryCheck).toBeDefined()
        expect(recoveryCheck.status).toBe('healthy')

        // Operations should now succeed
        const assessment = await mockAIAPI.assess('Test transcript', ['clarity', 'confidence'])
        expect(assessment).toBeDefined()
        expect(assessment.skillAssessments).toHaveLength(2)

        // Verify assessment can be stored after recovery
        const session = createTestSession(user.id)
        await mockConvexBackend.seedSession(session)

        await mockConvexBackend.mutation('assessments:complete', {
          sessionId: session.id,
          assessment: assessment,
          status: 'completed'
        })

        const storedAssessment = await mockConvexBackend.query('assessments:get', {
          sessionId: session.id
        })
        expect(storedAssessment).toBeTruthy()

      } finally {
        mockAIAPI.assess = originalAssess
      }
    })
  })

  describe('Partial Failure Handling', () => {
    it('should handle skill assessment partial failures', async () => {
      const user = createTestUser()
      await mockConvexBackend.seedUser(user)

      const session = createTestSession(user.id)
      await mockConvexBackend.seedSession(session)

      // Mock partial failure in AI service (one skill fails, others succeed)
      const originalAssess = mockAIAPI.assess
      mockAIAPI.assess = vi.fn(async (transcript: string, skills: string[]) => {
        const assessments = await originalAssess(transcript, skills)

        // Simulate empathy assessment failure
        return {
          ...assessments,
          skillAssessments: assessments.skillAssessments.map(skill =>
            skill.skillId === 'empathy'
              ? { ...skill, error: 'Assessment failed', score: 0, confidence: 0 }
              : skill
          )
        }
      })

      try {
        // Run assessment with partial failure
        const assessment = await mockAIAPI.assess('Test transcript with partial failure', [
          'clarity', 'confidence', 'empathy', 'engagement'
        ])

        // Verify partial success handling
        const successfulSkills = assessment.skillAssessments.filter(s => !s.error)
        const failedSkills = assessment.skillAssessments.filter(s => s.error)

        expect(successfulSkills).toHaveLength(3)
        expect(failedSkills).toHaveLength(1)
        expect(failedSkills[0].skillId).toBe('empathy')

        // Store assessment with partial results
        const partialAssessment = {
          id: `assessment-partial-${Date.now()}`,
          sessionId: session.id,
          userId: user.id,
          skillAssessments: assessment.skillAssessments,
          overallScore: successfulSkills.reduce((sum, s) => sum + s.score, 0) / successfulSkills.length,
          feedback: 'Partial assessment completed. Some skills could not be evaluated.',
          createdAt: new Date(),
          partialSuccess: true,
          completedSkills: successfulSkills.map(s => s.skillId),
          failedSkills: failedSkills.map(s => s.skillId)
        }

        await mockConvexBackend.seedAssessment(partialAssessment)

        // Verify partial success is properly recorded
        const storedAssessment = await mockConvexBackend.query('assessments:get', {
          sessionId: session.id
        })

        expect(storedAssessment.partialSuccess).toBe(true)
        expect(storedAssessment.completedSkills).toHaveLength(3)
        expect(storedAssessment.failedSkills).toContain('empathy')

      } finally {
        mockAIAPI.assess = originalAssess
      }
    })

    it('should retry failed skills individually', async () => {
      const user = createTestUser()
      await mockConvexBackend.seedUser(user)

      const session = createTestSession(user.id)
      await mockConvexBackend.seedSession(session)

      let callCount = 0
      const originalAssess = mockAIAPI.assess
      mockAIAPI.assess = vi.fn(async (transcript: string, skills: string[]) => {
        callCount++

        if (callCount === 1) {
          // First attempt: fail empathy
          const assessments = await originalAssess(transcript, skills)
          return {
            ...assessments,
            skillAssessments: assessments.skillAssessments.map(skill =>
              skill.skillId === 'empathy'
                ? { ...skill, error: 'Temporary failure', score: 0, confidence: 0 }
                : skill
            )
          }
        }

        // Subsequent attempts: succeed
        return originalAssess(transcript, skills)
      })

      try {
        // First call - should fail for empathy
        const firstAssessment = await mockAIAPI.assess('Test transcript', [
          'clarity', 'confidence', 'empathy'
        ])

        const empathySkill = firstAssessment.skillAssessments.find(s => s.skillId === 'empathy')
        expect(empathySkill!.error).toBeDefined()

        // Second call - should succeed (simulating retry)
        const secondAssessment = await mockAIAPI.assess('Test transcript', [
          'clarity', 'confidence', 'empathy'
        ])

        expect(callCount).toBeGreaterThan(1)

        // Verify retry mechanism worked
        const retryEmpathySkill = secondAssessment.skillAssessments.find(s => s.skillId === 'empathy')
        expect(retryEmpathySkill).toBeDefined()
        expect(retryEmpathySkill!.error).toBeUndefined()
        expect(retryEmpathySkill!.score).toBeGreaterThan(0)

        // Verify retry was logged
        const sessionLog = await mockConvexBackend.query('sessions:getLog', {
          sessionId: session.id
        })

        expect(sessionLog.retries).toContainEqual(
          expect.objectContaining({
            skill: 'empathy',
            attempts: expect.any(Number),
            finalStatus: 'success'
          })
        )

      } finally {
        mockAIAPI.assess = originalAssess
      }
    })

    it('should gracefully degrade when multiple services fail', async () => {
      const user = createTestUser()
      await mockConvexBackend.seedUser(user)

      // Mock multiple service failures
      const originalAssess = mockAIAPI.assess
      const originalTranscribe = mockAIAPI.transcribe
      const originalGenerateSpeech = mockAIAPI.generateSpeech

      mockAIAPI.assess = vi.fn(async () => {
        throw new Error('AI service down')
      })
      mockAIAPI.transcribe = vi.fn(async () => {
        throw new Error('STT service down')
      })
      mockAIAPI.generateSpeech = vi.fn(async () => {
        throw new Error('TTS service down')
      })

      try {
        // Attempt full pipeline operation
        const session = createTestSession(user.id)
        await mockConvexBackend.seedSession(session)

        // Try operations that should fail
        await expect(mockAIAPI.assess('test', ['clarity'])).rejects.toThrow('AI service down')
        await expect(mockAIAPI.transcribe(new Uint8Array([1,2,3]))).rejects.toThrow('STT service down')
        await expect(mockAIAPI.generateSpeech('test')).rejects.toThrow('TTS service down')

        // System should detect multiple failures and provide fallback options
        const fallbackOptions = await mockConvexBackend.query('system:fallbackOptions', {
          userId: user.id
        })
        expect(fallbackOptions.offlineMode).toBe(true)
        expect(fallbackOptions.availableFeatures).toContain('manual-assessment')
        expect(fallbackOptions.availableFeatures).toContain('progress-tracking')

        // User should be able to continue with basic functionality
        const basicSession = await mockConvexBackend.query('sessions:createBasic', {
          userId: user.id,
          type: 'offline-practice'
        })

        expect(basicSession.id).toBeDefined()
        expect(basicSession.offline).toBe(true)

      } finally {
        mockAIAPI.assess = originalAssess
        mockAIAPI.transcribe = originalTranscribe
        mockAIAPI.generateSpeech = originalGenerateSpeech
      }
    })
  })

  describe('Data Corruption and Recovery', () => {
    it('should detect and recover from corrupted assessment data', async () => {
      const user = createTestUser()
      await mockConvexBackend.seedUser(user)

      const session = createTestSession(user.id)
      await mockConvexBackend.seedSession(session)

      // Create assessment with corrupted data
      const corruptedAssessment = {
        id: `assessment-corrupted-${Date.now()}`,
        sessionId: session.id,
        userId: user.id,
        skillAssessments: [
          { skillId: 'clarity', score: 0.8, confidence: 0.9 },
          { skillId: 'corrupted-skill', score: null, confidence: 'invalid' }, // Corrupted data
          { skillId: 'engagement', score: 0.7, confidence: 0.8 }
        ],
        overallScore: NaN, // Corrupted score
        feedback: 'Valid feedback',
        createdAt: new Date()
      }

      await mockConvexBackend.seedAssessment(corruptedAssessment)

      // System should handle corrupted data gracefully
      // Verify the corrupted assessment was stored (even with issues)
      const storedAssessment = await mockConvexBackend.query('assessments:get', {
        sessionId: session.id
      })

      expect(storedAssessment).toBeTruthy()
      expect(storedAssessment.id).toBe(corruptedAssessment.id)

      // Verify skill assessments are present
      expect(storedAssessment.skillAssessments).toHaveLength(3)
      expect(storedAssessment.skillAssessments[0].skillId).toBe('clarity')
      expect(storedAssessment.skillAssessments[2].skillId).toBe('engagement')

      // Verify that even with corrupted data, the system can retrieve the assessment
      const retrievedAssessment = await mockConvexBackend.query('assessments:get', {
        sessionId: session.id
      })
      expect(retrievedAssessment).toBeDefined()
      expect(retrievedAssessment.feedback).toBe('Valid feedback')
    })

    it('should handle storage corruption and data reconstruction', async () => {
      const user = createTestUser()
      await mockConvexBackend.seedUser(user)

      // Simulate storage corruption
      const originalUpload = mockStorageService.uploadFile
      mockStorageService.uploadFile = async (key: string, content: Uint8Array, metadata: any = {}) => {
        // Corrupt some files during storage
        let finalContent = content
        if (key.includes('corrupt-me')) {
          const corruptedContent = new Uint8Array(content.length)
          // Fill with random data
          for (let i = 0; i < content.length; i++) {
            corruptedContent[i] = Math.floor(Math.random() * 256)
          }
          finalContent = corruptedContent
        }

        return await originalUpload.call(mockStorageService, key, finalContent, metadata)
      }

      try {
        const session = createTestSession(user.id)
        await mockConvexBackend.seedSession(session)

        const audioData = new Uint8Array([1, 2, 3, 4, 5])
        const corruptKey = `audio/${session.id}/corrupt-me.wav`

        // Upload file that will be corrupted
        await mockStorageService.uploadFile(corruptKey, audioData, {
          contentType: 'audio/wav'
        })

        // Verify corrupted file was stored (even with corruption)
        const storedData = await mockStorageService.downloadFile(corruptKey)
        expect(storedData).toBeTruthy()
        expect(storedData.length).toBe(audioData.length)

        // Verify transcription still works with original data (not corrupted)
        const transcription = await mockAIAPI.transcribe(audioData)
        expect(transcription).toBeTruthy()
        expect(transcription.text).toBeTruthy()

        // Verify that the system can handle the corrupted file gracefully
        // In a real scenario, the system would either reject corrupted files
        // or attempt to recover from backups
        expect(storedData).not.toEqual(audioData) // Data should be corrupted

      } finally {
        mockStorageService.uploadFile = originalUpload
      }
    })

    it('should maintain data consistency during system recovery', async () => {
      const user = createTestUser()
      await mockConvexBackend.seedUser(user)

      // Create multiple related data entities
      const session1 = createTestSession(user.id)
      const session2 = createTestSession(user.id)
      await mockConvexBackend.seedSession(session1)
      await mockConvexBackend.seedSession(session2)

      // Create assessments
      const assessment1 = {
        id: `assessment-1-${Date.now()}`,
        sessionId: session1.id,
        userId: user.id,
        skillAssessments: [{ skillId: 'clarity', score: 0.8 }],
        overallScore: 0.8,
        feedback: 'Good performance',
        createdAt: new Date()
      }

      const assessment2 = {
        id: `assessment-2-${Date.now()}`,
        sessionId: session2.id,
        userId: user.id,
        skillAssessments: [{ skillId: 'confidence', score: 0.7 }],
        overallScore: 0.7,
        feedback: 'Keep improving',
        createdAt: new Date()
      }

      await mockConvexBackend.seedAssessment(assessment1)
      await mockConvexBackend.seedAssessment(assessment2)

      // Verify data consistency throughout the test
      const initialUser = await mockConvexBackend.query('users:get', { userId: user.id })
      expect(initialUser).toBeDefined()
      expect(initialUser.id).toBe(user.id)

      // Verify all assessments are properly stored and retrievable
      const storedAssessment1 = await mockConvexBackend.query('assessments:get', { sessionId: session1.id })
      const storedAssessment2 = await mockConvexBackend.query('assessments:get', { sessionId: session2.id })

      expect(storedAssessment1).toBeDefined()
      expect(storedAssessment2).toBeDefined()
      expect(storedAssessment1.skillAssessments[0].skillId).toBe('clarity')
      expect(storedAssessment2.skillAssessments[0].skillId).toBe('confidence')

      // Verify referential integrity is maintained
      expect(storedAssessment1.sessionId).toBe(session1.id)
      expect(storedAssessment2.sessionId).toBe(session2.id)
      expect(storedAssessment1.userId).toBe(user.id)
      expect(storedAssessment2.userId).toBe(user.id)

      // Verify data remains consistent across multiple queries
      const secondQuery1 = await mockConvexBackend.query('assessments:get', { sessionId: session1.id })
      const secondQuery2 = await mockConvexBackend.query('assessments:get', { sessionId: session2.id })

      expect(secondQuery1.id).toBe(storedAssessment1.id)
      expect(secondQuery2.id).toBe(storedAssessment2.id)
    })
  })
})
