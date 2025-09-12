/**
 * Data Synchronization Integration Tests
 * Tests complex data synchronization scenarios and edge cases
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
// Status: 0/16 tests passing (mock methods not implemented)
// TODO: Re-enable when mock implementations reach 80%+ pass rate
// Last updated: 2025-09-11
describe('Data Synchronization Integration', () => {
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

  describe('Cross-System Data Consistency', () => {
    it('should maintain data consistency across all system components', async () => {
      const user = createTestUser()
      await mockConvexBackend.seedUser(user)

      // Create a session
      const session = await mockConvexBackend.mutation('sessions:create', {
        userId: user.id,
        type: 'presentation'
      })

      // Upload audio file
      const audioData = new Uint8Array([1, 2, 3, 4, 5])
      const audioUpload = await mockStorageService.uploadFile(
        `audio/${session.sessionId}/recording.wav`,
        audioData,
        { userId: user.id, sessionId: session.sessionId }
      )

      // Transcribe audio
      const transcription = await mockAIAPI.transcribe(audioData)

      // Update session with transcript
      await mockConvexBackend.mutation('sessions:updateTranscript', {
        sessionId: session.sessionId,
        transcript: transcription.text,
        confidence: transcription.confidence
      })

      // Run assessment
      const assessment = await mockAIAPI.assess(transcription.text, ['clarity', 'confidence'])

      // Store assessment
      const assessmentData = {
        id: `assessment-${Date.now()}`,
        sessionId: session.sessionId,
        userId: user.id,
        skillAssessments: assessment.skillAssessments,
        overallScore: assessment.skillAssessments.reduce((sum, s) => sum + s.score, 0) / assessment.skillAssessments.length,
        feedback: 'Assessment completed',
        createdAt: new Date()
      }

      await mockConvexBackend.seedAssessment(assessmentData)

      // Verify data consistency across all systems
      const sessionData = await mockConvexBackend.query('sessions:get', {
        sessionId: session.sessionId
      })

      const assessmentFromDB = await mockConvexBackend.query('assessments:get', {
        sessionId: session.sessionId
      })

      const storedAudio = await mockStorageService.downloadFile(audioUpload.key)

      // Cross-system consistency checks
      expect(sessionData.transcript).toBe(transcription.text)
      expect(assessmentFromDB.skillAssessments.length).toBe(assessment.skillAssessments.length)
      expect(storedAudio).toEqual(audioData)
      expect(sessionData.status).toBe('completed')
      expect(assessmentFromDB.overallScore).toBe(assessmentData.overallScore)

      // Verify referential integrity
      expect(assessmentFromDB.sessionId).toBe(session.sessionId)
      expect(assessmentFromDB.userId).toBe(user.id)
      expect(sessionData.userId).toBe(user.id)
    })

    it('should handle transaction rollbacks and data cleanup', async () => {
      const user = createTestUser()
      await mockConvexBackend.seedUser(user)

      // Start a complex transaction
      const transactionId = await mockConvexBackend.mutation('transactions:start', {
        userId: user.id,
        type: 'assessment_pipeline'
      })

      // Create session within transaction
      const session = await mockConvexBackend.mutation('sessions:create', {
        userId: user.id,
        transactionId
      })

      // Upload audio within transaction
      const audioData = new Uint8Array([1, 2, 3])
      const audioUpload = await mockStorageService.uploadFile(
        `audio/${session.sessionId}/recording.wav`,
        audioData,
        { userId: user.id, transactionId }
      )

      // Simulate failure in the middle of the pipeline
      mockAIAPI.setNextCallToFail(true)

      try {
        await mockAIAPI.assess('This should fail', ['clarity'])
      } catch (error) {
        // Transaction should rollback
        const rollbackResult = await mockConvexBackend.mutation('transactions:rollback', {
          transactionId
        })

        expect(rollbackResult.success).toBe(true)

        // Verify data was cleaned up
        const sessionAfterRollback = await mockConvexBackend.query('sessions:get', {
          sessionId: session.sessionId
        })

        // Session should be marked as failed or cleaned up
        expect(sessionAfterRollback.status).toBe('failed')

        // Audio file should be cleaned up (or marked for cleanup)
        try {
          await mockStorageService.downloadFile(audioUpload.key)
          // If we get here, file should be marked for deletion
          const fileMetadata = await mockStorageService.getFileMetadata(audioUpload.key)
          expect(fileMetadata.pendingDeletion).toBe(true)
        } catch (error) {
          // File was properly cleaned up
          expect(error.message).toContain('not found')
        }

        // Transaction should be marked as rolled back
        const transactionStatus = await mockConvexBackend.query('transactions:getStatus', {
          transactionId
        })

        expect(transactionStatus.status).toBe('rolled_back')
      }
    })

    it('should handle concurrent data modifications with conflict resolution', async () => {
      const user = createTestUser()
      await mockConvexBackend.seedUser(user)

      // Create initial session
      const session = await mockConvexBackend.mutation('sessions:create', {
        userId: user.id,
        type: 'presentation'
      })

      // Simulate concurrent modifications
      const modifications = [
        { field: 'title', value: 'Title from Tab 1', version: 1 },
        { field: 'notes', value: 'Notes from Tab 2', version: 1 },
        { field: 'title', value: 'Updated Title from Tab 1', version: 2 },
        { field: 'tags', value: ['presentation', 'important'], version: 2 }
      ]

      // Apply modifications concurrently
      const modificationPromises = modifications.map(mod =>
        mockConvexBackend.mutation('sessions:updateField', {
          sessionId: session.sessionId,
          userId: user.id,
          field: mod.field,
          value: mod.value,
          version: mod.version
        })
      )

      const modificationResults = await Promise.all(modificationPromises)

      // Some modifications should succeed, some should conflict
      const successful = modificationResults.filter(r => r.success).length
      const conflicted = modificationResults.filter(r => !r.success && r.conflict).length

      expect(successful).toBeGreaterThan(0)
      expect(conflicted).toBeGreaterThan(0)

      // Verify conflict resolution
      const resolvedSession = await mockConvexBackend.query('sessions:get', {
        sessionId: session.sessionId
      })

      expect(resolvedSession).toBeDefined()
      expect(resolvedSession.version).toBeDefined()
      expect(resolvedSession.lastModified).toBeDefined()

      // Check conflict log
      const conflictLog = await mockConvexBackend.query('sessions:getConflictLog', {
        sessionId: session.sessionId
      })

      expect(conflictLog).toBeDefined()
      expect(conflictLog.conflicts.length).toBe(conflicted)
      expect(conflictLog.resolutions.length).toBe(conflicted)
    })
  })

  describe('Real-time Data Synchronization', () => {
    it('should synchronize real-time updates across multiple clients', async () => {
      const user = createTestUser()
      await mockConvexBackend.seedUser(user)

      // Simulate multiple client connections
      const client1 = { id: 'client-1', userId: user.id }
      const client2 = { id: 'client-2', userId: user.id }
      const client3 = { id: 'client-3', userId: user.id }

      // All clients subscribe to the same data
      const subscriptions = [client1, client2, client3].map(client =>
        mockConvexBackend.subscribe('users:profileUpdates', { userId: user.id }, (update) => {
          client.lastUpdate = update
        })
      )

      // Client 1 makes a change
      const update1 = await mockConvexBackend.mutation('users:updateProfile', {
        userId: user.id,
        clientId: client1.id,
        profile: { name: 'Updated by Client 1' }
      })

      expect(update1.success).toBe(true)

      // Wait for sync
      await new Promise(resolve => setTimeout(resolve, 50))

      // All clients should receive the update
      expect(client1.lastUpdate).toBeDefined()
      expect(client2.lastUpdate).toBeDefined()
      expect(client3.lastUpdate).toBeDefined()

      expect(client1.lastUpdate.profile.name).toBe('Updated by Client 1')
      expect(client2.lastUpdate.profile.name).toBe('Updated by Client 1')
      expect(client3.lastUpdate.profile.name).toBe('Updated by Client 1')

      // Client 2 makes a conflicting change
      const update2 = await mockConvexBackend.mutation('users:updateProfile', {
        userId: user.id,
        clientId: client2.id,
        profile: { name: 'Updated by Client 2' },
        baseVersion: client2.lastUpdate.version
      })

      expect(update2.success).toBe(true)

      // Wait for sync
      await new Promise(resolve => setTimeout(resolve, 50))

      // All clients should see Client 2's update
      expect(client1.lastUpdate.profile.name).toBe('Updated by Client 2')
      expect(client2.lastUpdate.profile.name).toBe('Updated by Client 2')
      expect(client3.lastUpdate.profile.name).toBe('Updated by Client 2')

      // Test disconnection and reconnection
      mockConvexBackend.disconnectClient(client3.id)

      // Client 1 makes another change
      const update3 = await mockConvexBackend.mutation('users:updateProfile', {
        userId: user.id,
        clientId: client1.id,
        profile: { name: 'Updated after Client 3 disconnect' }
      })

      await new Promise(resolve => setTimeout(resolve, 50))

      // Client 3 shouldn't have received the update
      expect(client3.lastUpdate.profile.name).toBe('Updated by Client 2')

      // Client 3 reconnects
      mockConvexBackend.reconnectClient(client3.id)

      // Should receive missed updates
      await new Promise(resolve => setTimeout(resolve, 50))

      expect(client3.lastUpdate.profile.name).toBe('Updated after Client 3 disconnect')

      // Cleanup subscriptions
      subscriptions.forEach(unsubscribe => unsubscribe())
    })

    it('should handle network interruptions and data reconciliation', async () => {
      const user = createTestUser()
      await mockConvexBackend.seedUser(user)

      // Create initial data
      const session = await mockConvexBackend.mutation('sessions:create', {
        userId: user.id,
        type: 'presentation'
      })

      // Simulate offline work
      mockConvexBackend.setNetworkStatus(false)

      // Make changes while offline
      const offlineChanges = []

      // Queue changes for when back online
      offlineChanges.push(
        mockConvexBackend.mutation('sessions:updateNotes', {
          sessionId: session.sessionId,
          userId: user.id,
          notes: 'Offline notes',
          offline: true
        })
      )

      offlineChanges.push(
        mockConvexBackend.mutation('sessions:addTags', {
          sessionId: session.sessionId,
          userId: user.id,
          tags: ['offline', 'test'],
          offline: true
        })
      )

      // Execute offline changes (they should be queued)
      const offlineResults = await Promise.all(offlineChanges)

      // Offline changes should be queued, not executed
      offlineResults.forEach(result => {
        expect(result.queued).toBe(true)
        expect(result.executed).toBe(false)
      })

      // Come back online
      mockConvexBackend.setNetworkStatus(true)

      // Process queued changes
      const syncResult = await mockConvexBackend.mutation('sync:processQueuedChanges', {
        userId: user.id
      })

      expect(syncResult.success).toBe(true)
      expect(syncResult.processedChanges).toBe(offlineChanges.length)

      // Verify changes were applied
      const updatedSession = await mockConvexBackend.query('sessions:get', {
        sessionId: session.sessionId
      })

      expect(updatedSession.notes).toBe('Offline notes')
      expect(updatedSession.tags).toEqual(['offline', 'test'])

      // Test conflict resolution for concurrent offline changes
      mockConvexBackend.setNetworkStatus(false)

      // Make conflicting offline changes from "different device"
      const conflictingChange1 = await mockConvexBackend.mutation('sessions:updateNotes', {
        sessionId: session.sessionId,
        userId: user.id,
        notes: 'Conflicting notes from device 1',
        offline: true,
        deviceId: 'device-1'
      })

      const conflictingChange2 = await mockConvexBackend.mutation('sessions:updateNotes', {
        sessionId: session.sessionId,
        userId: user.id,
        notes: 'Conflicting notes from device 2',
        offline: true,
        deviceId: 'device-2'
      })

      expect(conflictingChange1.queued).toBe(true)
      expect(conflictingChange2.queued).toBe(true)

      // Come back online
      mockConvexBackend.setNetworkStatus(true)

      // Process queued changes with conflict resolution
      const conflictSync = await mockConvexBackend.mutation('sync:processQueuedChanges', {
        userId: user.id,
        conflictResolution: 'last_wins' // Device 2 wins
      })

      expect(conflictSync.success).toBe(true)
      expect(conflictSync.conflictsResolved).toBe(1)

      // Verify conflict was resolved with correct winner
      const finalSession = await mockConvexBackend.query('sessions:get', {
        sessionId: session.sessionId
      })

      expect(finalSession.notes).toBe('Conflicting notes from device 2')
    })
  })

  describe('Data Migration and Schema Evolution', () => {
    it('should handle seamless data migration during schema updates', async () => {
      const user = createTestUser()
      await mockConvexBackend.seedUser(user)

      // Create data with old schema
      const oldSchemaData = {
        id: `legacy-session-${Date.now()}`,
        userId: user.id,
        type: 'presentation', // Old field name
        createdAt: new Date(),
        // Missing new required fields that will be added in migration
      }

      await mockConvexBackend.seedLegacyData('sessions', oldSchemaData)

      // Trigger schema migration
      const migrationResult = await mockConvexBackend.mutation('system:migrateSchema', {
        targetVersion: '2.0.0',
        affectedCollections: ['sessions']
      })

      expect(migrationResult.success).toBe(true)
      expect(migrationResult.migratedRecords).toBeGreaterThan(0)

      // Verify migrated data
      const migratedSession = await mockConvexBackend.query('sessions:get', {
        sessionId: oldSchemaData.id
      })

      expect(migratedSession).toBeDefined()
      expect(migratedSession.sessionType).toBe('presentation') // New field name
      expect(migratedSession.migrationVersion).toBe('2.0.0')
      expect(migratedSession.createdAt).toBe(oldSchemaData.createdAt)

      // Test backward compatibility
      const legacyQuery = await mockConvexBackend.query('sessions:getLegacy', {
        sessionId: oldSchemaData.id
      })

      expect(legacyQuery.type).toBe('presentation') // Old field name still accessible

      // Verify migration audit trail
      const migrationAudit = await mockConvexBackend.query('system:getMigrationAudit', {
        migrationId: migrationResult.migrationId
      })

      expect(migrationAudit).toBeDefined()
      expect(migrationAudit.status).toBe('completed')
      expect(migrationAudit.affectedRecords).toBeGreaterThan(0)
      expect(migrationAudit.rollbackAvailable).toBe(true)
    })

    it('should handle migration rollbacks and data restoration', async () => {
      const user = createTestUser()
      await mockConvexBackend.seedUser(user)

      // Create baseline data
      const baselineSession = await mockConvexBackend.mutation('sessions:create', {
        userId: user.id,
        type: 'presentation'
      })

      // Perform migration
      const migration = await mockConvexBackend.mutation('system:migrateSchema', {
        targetVersion: '3.0.0',
        affectedCollections: ['sessions']
      })

      expect(migration.success).toBe(true)

      // Verify migration was applied
      const migratedSession = await mockConvexBackend.query('sessions:get', {
        sessionId: baselineSession.sessionId
      })

      expect(migratedSession.schemaVersion).toBe('3.0.0')

      // Simulate migration failure requiring rollback
      const rollbackResult = await mockConvexBackend.mutation('system:rollbackMigration', {
        migrationId: migration.migrationId,
        reason: 'Critical bug in new schema'
      })

      expect(rollbackResult.success).toBe(true)

      // Verify rollback restored original data
      const rolledBackSession = await mockConvexBackend.query('sessions:get', {
        sessionId: baselineSession.sessionId
      })

      expect(rolledBackSession.schemaVersion).toBe('2.0.0') // Previous version
      expect(rolledBackSession.rolledBackFrom).toBe('3.0.0')

      // Verify rollback audit
      const rollbackAudit = await mockConvexBackend.query('system:getMigrationAudit', {
        migrationId: migration.migrationId
      })

      expect(rollbackAudit.rollbackStatus).toBe('completed')
      expect(rollbackAudit.rollbackReason).toBe('Critical bug in new schema')
      expect(rollbackAudit.dataRestored).toBe(true)
    })

    it('should handle large-scale data migrations with progress tracking', async () => {
      // Create large dataset for migration testing
      const largeDatasetSize = 1000
      const users = []

      for (let i = 0; i < largeDatasetSize; i++) {
        const user = createTestUser({
          email: `migration${i}@coachup.example.com`
        })
        await mockConvexBackend.seedUser(user)
        users.push(user)

        // Create session for each user
        await mockConvexBackend.seedLegacyData('sessions', {
          id: `legacy-session-${i}`,
          userId: user.id,
          type: 'presentation',
          createdAt: new Date()
        })
      }

      // Start large migration
      const largeMigration = await mockConvexBackend.mutation('system:migrateSchema', {
        targetVersion: '4.0.0',
        affectedCollections: ['sessions'],
        batchSize: 100,
        enableProgressTracking: true
      })

      expect(largeMigration.success).toBe(true)
      expect(largeMigration.totalRecords).toBe(largeDatasetSize)
      expect(largeMigration.progressTrackerId).toBeDefined()

      // Monitor migration progress
      let progressComplete = false
      let lastProgress = 0

      while (!progressComplete) {
        const progress = await mockConvexBackend.query('system:getMigrationProgress', {
          migrationId: largeMigration.migrationId
        })

        expect(progress.percentage).toBeGreaterThanOrEqual(lastProgress)
        lastProgress = progress.percentage

        if (progress.percentage >= 100) {
          progressComplete = true
        }

        // Simulate waiting for next batch
        await new Promise(resolve => setTimeout(resolve, 10))
      }

      // Verify final migration state
      const finalProgress = await mockConvexBackend.query('system:getMigrationProgress', {
        migrationId: largeMigration.migrationId
      })

      expect(finalProgress.percentage).toBe(100)
      expect(finalProgress.status).toBe('completed')
      expect(finalProgress.processedRecords).toBe(largeDatasetSize)
      expect(finalProgress.failedRecords).toBe(0)

      // Spot check migrated records
      for (let i = 0; i < Math.min(10, largeDatasetSize); i++) {
        const migratedSession = await mockConvexBackend.query('sessions:get', {
          sessionId: `legacy-session-${i}`
        })

        expect(migratedSession).toBeDefined()
        expect(migratedSession.schemaVersion).toBe('4.0.0')
      }
    })
  })

  describe('Data Integrity and Validation', () => {
    it('should maintain referential integrity across related data', async () => {
      const user = createTestUser()
      await mockConvexBackend.seedUser(user)

      // Create related data structure
      const session = await mockConvexBackend.mutation('sessions:create', {
        userId: user.id,
        type: 'presentation'
      })

      const assessment = await mockAIAPI.assess('Test transcript', ['clarity'])
      await mockConvexBackend.seedAssessment({
        id: `integrity-assessment-${Date.now()}`,
        sessionId: session.sessionId,
        userId: user.id,
        skillAssessments: assessment.skillAssessments,
        overallScore: 0.8,
        feedback: 'Integrity test',
        createdAt: new Date()
      })

      // Create feedback linked to assessment
      const feedback = await mockConvexBackend.mutation('feedback:create', {
        assessmentId: `integrity-assessment-${Date.now()}`,
        userId: user.id,
        content: 'Test feedback',
        rating: 4
      })

      // Verify referential links
      const sessionWithRelations = await mockConvexBackend.query('sessions:getWithRelations', {
        sessionId: session.sessionId
      })

      expect(sessionWithRelations.user).toBeDefined()
      expect(sessionWithRelations.user.id).toBe(user.id)
      expect(sessionWithRelations.assessment).toBeDefined()
      expect(sessionWithRelations.feedback).toBeDefined()

      // Test cascade delete protection
      const deleteUserResult = await mockConvexBackend.mutation('users:delete', {
        userId: user.id
      })

      expect(deleteUserResult.success).toBe(false)
      expect(deleteUserResult.error).toContain('related data')

      // Test with force delete
      const forceDeleteResult = await mockConvexBackend.mutation('users:forceDelete', {
        userId: user.id,
        cascade: true
      })

      expect(forceDeleteResult.success).toBe(true)

      // Verify all related data was cleaned up
      const deletedSession = await mockConvexBackend.query('sessions:get', {
        sessionId: session.sessionId
      })

      expect(deletedSession).toBeNull()

      const deletedAssessment = await mockConvexBackend.query('assessments:get', {
        sessionId: session.sessionId
      })

      expect(deletedAssessment).toBeNull()
    })

    it('should validate data consistency and detect corruption', async () => {
      const user = createTestUser()
      await mockConvexBackend.seedUser(user)

      // Create valid data
      const session = await mockConvexBackend.mutation('sessions:create', {
        userId: user.id,
        type: 'presentation'
      })

      // Introduce data corruption
      await mockConvexBackend.corruptData('sessions', session.sessionId, {
        userId: 'nonexistent-user-id'
      })

      // Attempt to access corrupted data
      const corruptedAccess = await mockConvexBackend.query('sessions:get', {
        sessionId: session.sessionId
      })

      // System should detect corruption
      expect(corruptedAccess.corruptionDetected).toBe(true)
      expect(corruptedAccess.issues).toContain('invalid user reference')

      // Trigger data repair
      const repairResult = await mockConvexBackend.mutation('system:repairData', {
        collection: 'sessions',
        recordId: session.sessionId,
        repairType: 'reference_fix'
      })

      expect(repairResult.success).toBe(true)
      expect(repairResult.issuesFixed).toBeGreaterThan(0)

      // Verify data is repaired
      const repairedSession = await mockConvexBackend.query('sessions:get', {
        sessionId: session.sessionId
      })

      expect(repairedSession.corruptionDetected).toBeUndefined()
      expect(repairedSession.userId).toBe(user.id)

      // Test checksum validation
      const checksumValidation = await mockConvexBackend.query('system:validateChecksums', {
        collection: 'sessions'
      })

      expect(checksumValidation.validRecords).toBeGreaterThan(0)
      expect(checksumValidation.corruptedRecords).toBe(0)
    })

    it('should handle data deduplication and merge conflicts', async () => {
      const user = createTestUser()
      await mockConvexBackend.seedUser(user)

      // Create duplicate data entries
      const originalSession = await mockConvexBackend.mutation('sessions:create', {
        userId: user.id,
        type: 'presentation',
        title: 'Original Title'
      })

      // Simulate duplicate creation (e.g., from sync issues)
      await mockConvexBackend.seedDuplicateData('sessions', {
        ...originalSession,
        id: `duplicate-${originalSession.sessionId}`,
        title: 'Duplicate Title',
        createdAt: new Date(Date.now() + 1000) // Slightly newer
      })

      // Detect duplicates
      const duplicatesFound = await mockConvexBackend.query('system:findDuplicates', {
        collection: 'sessions',
        userId: user.id
      })

      expect(duplicatesFound.duplicates).toHaveLength(1)
      expect(duplicatesFound.duplicates[0].originalId).toBe(originalSession.sessionId)
      expect(duplicatesFound.duplicates[0].duplicateIds).toHaveLength(1)

      // Merge duplicates
      const mergeResult = await mockConvexBackend.mutation('system:mergeDuplicates', {
        collection: 'sessions',
        originalId: originalSession.sessionId,
        duplicateIds: duplicatesFound.duplicates[0].duplicateIds,
        mergeStrategy: 'keep_newer'
      })

      expect(mergeResult.success).toBe(true)
      expect(mergeResult.mergedRecords).toBe(1)

      // Verify merged result
      const mergedSession = await mockConvexBackend.query('sessions:get', {
        sessionId: originalSession.sessionId
      })

      expect(mergedSession.title).toBe('Duplicate Title') // Newer title kept
      expect(mergedSession.mergeHistory).toBeDefined()
      expect(mergedSession.mergeHistory.mergedFrom).toContain(`duplicate-${originalSession.sessionId}`)

      // Verify duplicate is removed
      const duplicateSession = await mockConvexBackend.query('sessions:get', {
        sessionId: `duplicate-${originalSession.sessionId}`
      })

      expect(duplicateSession).toBeNull()
    })
  })
})
