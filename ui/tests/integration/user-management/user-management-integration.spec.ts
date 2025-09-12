/**
 * User Management Integration Tests
 * Tests complete user profile management and data operations
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

// TEMPORARILY DISABLED IN CI/CD
// Status: 0/15 tests passing (mock methods not implemented)
// TODO: Re-enable when mock implementations reach 80%+ pass rate
// Last updated: 2025-09-11
describe('User Management Integration', () => {
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

  describe('Profile Management', () => {
    it('should complete full profile creation and updates', async () => {
      const user = createTestUser({
        profile: {
          name: 'Initial Name',
          experience: 'Beginner',
          industry: 'Technology'
        },
        goals: ['learn basic skills']
      })
      await mockConvexBackend.seedUser(user)

      // 1. Initial profile verification
      const initialProfile = await mockConvexBackend.query('users:getProfile', {
        userId: user.id
      })

      expect(initialProfile.name).toBe('Initial Name')
      expect(initialProfile.experience).toBe('Beginner')
      expect(initialProfile.goals).toEqual(['learn basic skills'])

      // 2. Update basic profile information
      const updateResult = await mockConvexBackend.mutation('users:updateProfile', {
        userId: user.id,
        profile: {
          name: 'Updated Name',
          experience: 'Intermediate',
          industry: 'Technology',
          bio: 'Experienced professional looking to improve communication skills'
        }
      })

      expect(updateResult.success).toBe(true)

      // 3. Update goals and preferences
      const goalsUpdate = await mockConvexBackend.mutation('users:updateGoals', {
        userId: user.id,
        goals: [
          'improve presentation skills',
          'enhance public speaking',
          'build leadership presence'
        ]
      })

      expect(goalsUpdate.success).toBe(true)

      // 4. Add profile picture
      const profilePicUpload = await mockStorageService.uploadFile(
        `profile-pics/${user.id}/avatar.jpg`,
        new Uint8Array([1, 2, 3, 4, 5]), // Mock image data
        { contentType: 'image/jpeg', userId: user.id }
      )

      const picUpdate = await mockConvexBackend.mutation('users:updateProfilePicture', {
        userId: user.id,
        profilePictureUrl: profilePicUpload.url
      })

      expect(picUpdate.success).toBe(true)

      // 5. Verify all updates are persisted
      const updatedProfile = await mockConvexBackend.query('users:getProfile', {
        userId: user.id
      })

      expect(updatedProfile.name).toBe('Updated Name')
      expect(updatedProfile.experience).toBe('Intermediate')
      expect(updatedProfile.bio).toBe('Experienced professional looking to improve communication skills')
      expect(updatedProfile.goals).toEqual([
        'improve presentation skills',
        'enhance public speaking',
        'build leadership presence'
      ])
      expect(updatedProfile.profilePictureUrl).toBe(profilePicUpload.url)
    })

    it('should handle profile data validation and constraints', async () => {
      const user = createTestUser()
      await mockConvexBackend.seedUser(user)

      // Test name length validation
      const longName = 'A'.repeat(101) // Exceeds max length
      const longNameUpdate = await mockConvexBackend.mutation('users:updateProfile', {
        userId: user.id,
        profile: { name: longName }
      })

      expect(longNameUpdate.success).toBe(false)
      expect(longNameUpdate.error).toContain('name')

      // Test empty required fields
      const emptyNameUpdate = await mockConvexBackend.mutation('users:updateProfile', {
        userId: user.id,
        profile: { name: '' }
      })

      expect(emptyNameUpdate.success).toBe(false)
      expect(emptyNameUpdate.error).toContain('name')

      // Test valid updates
      const validUpdate = await mockConvexBackend.mutation('users:updateProfile', {
        userId: user.id,
        profile: { name: 'Valid Name' }
      })

      expect(validUpdate.success).toBe(true)
    })

    it('should track profile update history and versioning', async () => {
      const user = createTestUser({
        profile: { name: 'Version 1', experience: 'Beginner' }
      })
      await mockConvexBackend.seedUser(user)

      // Version 1
      await mockConvexBackend.mutation('users:updateProfile', {
        userId: user.id,
        profile: { name: 'Version 1', experience: 'Beginner' }
      })

      // Version 2
      await mockConvexBackend.mutation('users:updateProfile', {
        userId: user.id,
        profile: { name: 'Version 2', experience: 'Intermediate' }
      })

      // Version 3
      await mockConvexBackend.mutation('users:updateProfile', {
        userId: user.id,
        profile: { name: 'Version 3', experience: 'Advanced' }
      })

      // Get profile history
      const history = await mockConvexBackend.query('users:getProfileHistory', {
        userId: user.id
      })

      expect(history).toBeDefined()
      expect(history.versions.length).toBeGreaterThanOrEqual(3)

      // Verify chronological order (newest first)
      expect(history.versions[0].profile.name).toBe('Version 3')
      expect(history.versions[1].profile.name).toBe('Version 2')
      expect(history.versions[2].profile.name).toBe('Version 1')

      // Test profile rollback
      const rollbackResult = await mockConvexBackend.mutation('users:rollbackProfile', {
        userId: user.id,
        versionId: history.versions[1].id
      })

      expect(rollbackResult.success).toBe(true)

      const currentProfile = await mockConvexBackend.query('users:getProfile', {
        userId: user.id
      })

      expect(currentProfile.name).toBe('Version 2')
    })
  })

  describe('Progress Tracking & Analytics', () => {
    it('should track comprehensive user progress across all activities', async () => {
      const user = createTestUser({
        goals: ['improve presentation skills', 'build confidence']
      })
      await mockConvexBackend.seedUser(user)

      // 1. Create multiple sessions with different activities
      const sessions = []
      for (let i = 0; i < 5; i++) {
        const session = createTestSession(user.id, {
          metadata: {
            type: i % 2 === 0 ? 'presentation' : 'conversation',
            duration: 30 + i * 10
          }
        })
        await mockConvexBackend.seedSession(session)
        sessions.push(session)

        // Create assessment for each session
        const assessment = await mockAIAPI.assess(
          `Session ${i + 1} transcript content`,
          ['clarity', 'confidence', 'engagement']
        )

        await mockConvexBackend.seedAssessment({
          id: `assessment-session-${i}-${Date.now()}`,
          sessionId: session.id,
          userId: user.id,
          skillAssessments: assessment.skillAssessments,
          overallScore: assessment.skillAssessments.reduce((sum, s) => sum + s.score, 0) / assessment.skillAssessments.length,
          feedback: `Session ${i + 1} feedback`,
          createdAt: new Date()
        })
      }

      // 2. Get comprehensive progress report
      const progressReport = await mockConvexBackend.query('users:getProgressReport', {
        userId: user.id,
        timeframe: 'all'
      })

      expect(progressReport).toBeDefined()
      expect(progressReport.totalSessions).toBe(5)
      expect(progressReport.totalTimeSpent).toBeGreaterThan(0)
      expect(progressReport.skillProgress).toBeDefined()

      // 3. Verify skill-specific progress tracking
      expect(progressReport.skillProgress.clarity).toBeDefined()
      expect(progressReport.skillProgress.confidence).toBeDefined()
      expect(progressReport.skillProgress.engagement).toBeDefined()

      // 4. Check improvement trends
      const trends = await mockConvexBackend.query('users:getProgressTrends', {
        userId: user.id,
        skillId: 'clarity'
      })

      expect(trends).toBeDefined()
      expect(trends.improvementRate).toBeDefined()
      expect(trends.consistencyScore).toBeDefined()
    })

    it('should generate personalized insights and recommendations', async () => {
      const user = createTestUser()
      await mockConvexBackend.seedUser(user)

      // Create diverse assessment data
      const assessments = [
        { clarity: 0.6, confidence: 0.5, engagement: 0.7 },
        { clarity: 0.7, confidence: 0.6, engagement: 0.8 },
        { clarity: 0.8, confidence: 0.7, engagement: 0.6 },
        { clarity: 0.9, confidence: 0.8, engagement: 0.7 }
      ]

      for (let i = 0; i < assessments.length; i++) {
        const session = createTestSession(user.id)
        await mockConvexBackend.seedSession(session)

        const assessment = await mockAIAPI.assess(
          `Assessment ${i + 1} content`,
          ['clarity', 'confidence', 'engagement']
        )

        // Override scores to simulate improvement
        const modifiedAssessments = assessment.skillAssessments.map(skill => ({
          ...skill,
          score: assessments[i][skill.skillId as keyof typeof assessments[0]] || skill.score
        }))

        await mockConvexBackend.seedAssessment({
          id: `insights-assessment-${i}-${Date.now()}`,
          sessionId: session.id,
          userId: user.id,
          skillAssessments: modifiedAssessments,
          overallScore: modifiedAssessments.reduce((sum, s) => sum + s.score, 0) / modifiedAssessments.length,
          feedback: `Assessment ${i + 1} feedback`,
          createdAt: new Date()
        })
      }

      // Get personalized insights
      const insights = await mockConvexBackend.query('users:getPersonalInsights', {
        userId: user.id
      })

      expect(insights).toBeDefined()
      expect(insights.strengths).toBeDefined()
      expect(insights.areasForImprovement).toBeDefined()
      expect(insights.recommendedExercises).toBeDefined()
      expect(insights.progressVelocity).toBeDefined()

      // Verify insights are based on actual data
      expect(insights.strengths).toContain('engagement') // Highest average score
      expect(insights.areasForImprovement).toContain('confidence') // Lowest starting score

      // Get next recommended exercises
      const recommendations = await mockConvexBackend.query('users:getNextRecommendations', {
        userId: user.id
      })

      expect(recommendations).toBeDefined()
      expect(recommendations.priorityExercises.length).toBeGreaterThan(0)
      expect(recommendations.estimatedTimeToComplete).toBeDefined()
    })

    it('should handle goal tracking and achievement', async () => {
      const user = createTestUser({
        goals: [
          'improve presentation skills',
          'build confidence in meetings',
          'enhance active listening'
        ]
      })
      await mockConvexBackend.seedUser(user)

      // 1. Set specific, measurable goals
      const goalUpdates = await mockConvexBackend.mutation('goals:setSpecificGoals', {
        userId: user.id,
        goals: [
          {
            id: 'presentation-skill',
            title: 'Improve presentation skills',
            targetScore: 0.85,
            currentScore: 0.6,
            deadline: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
            exercises: ['breathing', 'posture', 'pace']
          },
          {
            id: 'confidence-building',
            title: 'Build confidence in meetings',
            targetScore: 0.80,
            currentScore: 0.5,
            deadline: new Date(Date.now() + 45 * 24 * 60 * 60 * 1000), // 45 days
            exercises: ['power-pose', 'voice-projection']
          }
        ]
      })

      expect(goalUpdates.success).toBe(true)

      // 2. Simulate progress towards goals
      for (let i = 0; i < 3; i++) {
        const session = createTestSession(user.id)
        await mockConvexBackend.seedSession(session)

        const assessment = await mockAIAPI.assess(
          `Goal progress session ${i + 1}`,
          ['clarity', 'confidence', 'engagement']
        )

        await mockConvexBackend.seedAssessment({
          id: `goal-assessment-${i}-${Date.now()}`,
          sessionId: session.id,
          userId: user.id,
          skillAssessments: assessment.skillAssessments,
          overallScore: assessment.skillAssessments.reduce((sum, s) => sum + s.score, 0) / assessment.skillAssessments.length,
          feedback: `Goal progress feedback ${i + 1}`,
          createdAt: new Date()
        })
      }

      // 3. Check goal progress
      const goalProgress = await mockConvexBackend.query('goals:getProgress', {
        userId: user.id
      })

      expect(goalProgress).toBeDefined()
      expect(goalProgress.goals.length).toBe(2)

      goalProgress.goals.forEach((goal: any) => {
        expect(goal.progressPercentage).toBeDefined()
        expect(goal.daysRemaining).toBeDefined()
        expect(goal.onTrack).toBeDefined()
      })

      // 4. Handle goal completion
      const completedGoals = goalProgress.goals.filter((g: any) => g.progressPercentage >= 100)
      if (completedGoals.length > 0) {
        const completionResult = await mockConvexBackend.mutation('goals:markCompleted', {
          userId: user.id,
          goalIds: completedGoals.map((g: any) => g.id)
        })

        expect(completionResult.success).toBe(true)

        // Verify completion certificate generation
        const certificates = await mockConvexBackend.query('certificates:getUserCertificates', {
          userId: user.id
        })

        expect(certificates.length).toBeGreaterThan(0)
        expect(certificates[0].goalId).toBe(completedGoals[0].id)
      }
    })
  })

  describe('Data Export & Privacy', () => {
    it('should export complete user data for GDPR compliance', async () => {
      const user = createTestUser({
        profile: { name: 'GDPR User', experience: 'Professional' },
        goals: ['privacy compliance testing']
      })
      await mockConvexBackend.seedUser(user)

      // Create user activity data
      const sessions = []
      for (let i = 0; i < 3; i++) {
        const session = createTestSession(user.id)
        await mockConvexBackend.seedSession(session)
        sessions.push(session)

        const assessment = await mockAIAPI.assess(
          `GDPR session ${i + 1} transcript`,
          ['clarity', 'confidence']
        )

        await mockConvexBackend.seedAssessment({
          id: `gdpr-assessment-${i}-${Date.now()}`,
          sessionId: session.id,
          userId: user.id,
          skillAssessments: assessment.skillAssessments,
          overallScore: 0.75,
          feedback: `GDPR assessment ${i + 1}`,
          createdAt: new Date()
        })
      }

      // Request data export
      const exportResult = await mockConvexBackend.mutation('users:requestDataExport', {
        userId: user.id
      })

      expect(exportResult.success).toBe(true)
      expect(exportResult.exportId).toBeDefined()

      // Get export status
      const exportStatus = await mockConvexBackend.query('users:getExportStatus', {
        userId: user.id,
        exportId: exportResult.exportId
      })

      expect(exportStatus.status).toBeDefined()

      // Simulate export completion
      mockConvexBackend.completeExport(exportResult.exportId)

      const completedExport = await mockConvexBackend.query('users:getExportStatus', {
        userId: user.id,
        exportId: exportResult.exportId
      })

      expect(completedExport.status).toBe('completed')
      expect(completedExport.downloadUrl).toBeDefined()

      // Verify exported data structure
      const exportedData = await mockConvexBackend.query('users:getExportedData', {
        userId: user.id,
        exportId: exportResult.exportId
      })

      expect(exportedData).toBeDefined()
      expect(exportedData.profile).toBeDefined()
      expect(exportedData.sessions).toBeDefined()
      expect(exportedData.assessments).toBeDefined()
      expect(exportedData.sessions.length).toBe(3)
      expect(exportedData.assessments.length).toBe(3)
    })

    it('should handle account deletion and data cleanup', async () => {
      const user = createTestUser({
        profile: { name: 'Deletion Test User' },
        goals: ['test account deletion']
      })
      await mockConvexBackend.seedUser(user)

      // Create user data
      const session = createTestSession(user.id)
      await mockConvexBackend.seedSession(session)

      const assessment = await mockAIAPI.assess('Deletion test transcript', ['clarity'])
      await mockConvexBackend.seedAssessment({
        id: `deletion-assessment-${Date.now()}`,
        sessionId: session.id,
        userId: user.id,
        skillAssessments: assessment.skillAssessments,
        overallScore: 0.7,
        feedback: 'Deletion test assessment',
        createdAt: new Date()
      })

      // Verify data exists before deletion
      const profileBefore = await mockConvexBackend.query('users:getProfile', {
        userId: user.id
      })
      expect(profileBefore).toBeDefined()

      const sessionsBefore = await mockConvexBackend.query('sessions:getUserSessions', {
        userId: user.id
      })
      expect(sessionsBefore.length).toBeGreaterThan(0)

      // Request account deletion
      const deletionRequest = await mockConvexBackend.mutation('users:requestDeletion', {
        userId: user.id,
        reason: 'Testing account deletion flow'
      })

      expect(deletionRequest.success).toBe(true)
      expect(deletionRequest.deletionToken).toBeDefined()

      // Confirm deletion (with token)
      const confirmDeletion = await mockConvexBackend.mutation('users:confirmDeletion', {
        userId: user.id,
        deletionToken: deletionRequest.deletionToken
      })

      expect(confirmDeletion.success).toBe(true)

      // Verify data is anonymized/cleaned up
      const profileAfter = await mockConvexBackend.query('users:getProfile', {
        userId: user.id
      })

      if (profileAfter) {
        // Data should be anonymized, not deleted
        expect(profileAfter.name).not.toBe('Deletion Test User')
        expect(profileAfter.email).toContain('deleted')
      }

      // Verify associated data is cleaned
      const sessionsAfter = await mockConvexBackend.query('sessions:getUserSessions', {
        userId: user.id
      })

      // Sessions might be anonymized or removed based on policy
      expect(sessionsAfter.length).toBeLessThanOrEqual(sessionsBefore.length)
    })

    it('should manage data retention and archival', async () => {
      const user = createTestUser({
        profile: { name: 'Retention Test User' }
      })
      await mockConvexBackend.seedUser(user)

      // Create old and new sessions
      const oldDate = new Date(Date.now() - 400 * 24 * 60 * 60 * 1000) // 400 days ago
      const recentDate = new Date()

      const oldSession = createTestSession(user.id)
      oldSession.createdAt = oldDate
      await mockConvexBackend.seedSession(oldSession)

      const recentSession = createTestSession(user.id)
      recentSession.createdAt = recentDate
      await mockConvexBackend.seedSession(recentSession)

      // Create assessments
      const oldAssessment = await mockAIAPI.assess('Old session transcript', ['clarity'])
      await mockConvexBackend.seedAssessment({
        id: `old-assessment-${Date.now()}`,
        sessionId: oldSession.id,
        userId: user.id,
        skillAssessments: oldAssessment.skillAssessments,
        overallScore: 0.6,
        feedback: 'Old assessment',
        createdAt: oldDate
      })

      const recentAssessment = await mockAIAPI.assess('Recent session transcript', ['clarity'])
      await mockConvexBackend.seedAssessment({
        id: `recent-assessment-${Date.now()}`,
        sessionId: recentSession.id,
        userId: user.id,
        skillAssessments: recentAssessment.skillAssessments,
        overallScore: 0.8,
        feedback: 'Recent assessment',
        createdAt: recentDate
      })

      // Check data retention policy
      const retentionPolicy = await mockConvexBackend.query('users:getRetentionPolicy', {
        userId: user.id
      })

      expect(retentionPolicy).toBeDefined()
      expect(retentionPolicy.dataRetentionPeriod).toBeDefined()

      // Get archivable data
      const archivableData = await mockConvexBackend.query('users:getArchivableData', {
        userId: user.id
      })

      expect(archivableData).toBeDefined()
      expect(archivableData.oldSessions.length).toBeGreaterThan(0)

      // Archive old data
      const archiveResult = await mockConvexBackend.mutation('users:archiveOldData', {
        userId: user.id,
        archiveThreshold: 365 // 365 days
      })

      expect(archiveResult.success).toBe(true)
      expect(archiveResult.archivedCount).toBeGreaterThan(0)

      // Verify archived data is still accessible but marked as archived
      const archivedSessions = await mockConvexBackend.query('sessions:getArchivedSessions', {
        userId: user.id
      })

      expect(archivedSessions.length).toBeGreaterThan(0)
      archivedSessions.forEach((session: any) => {
        expect(session.archived).toBe(true)
      })
    })
  })
})
