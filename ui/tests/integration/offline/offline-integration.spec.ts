/**
 * Offline/Online Mode Transition Integration Tests
 * Tests seamless transitions between online and offline states
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
// Status: 0/13 tests passing (mock methods not implemented)
// TODO: Re-enable when mock implementations reach 80%+ pass rate
// Last updated: 2025-09-11
describe('Offline/Online Mode Transition Integration', () => {
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

  describe('Offline Mode Detection and Initialization', () => {
    it('should detect network connectivity changes', async () => {
      const user = createTestUser()
      await mockConvexBackend.seedUser(user)

      // Start in online mode
      let connectivityStatus = await mockConvexBackend.query('connectivity:getStatus', {})
      expect(connectivityStatus.online).toBe(true)
      expect(connectivityStatus.type).toBe('online')

      // Simulate going offline
      mockConvexBackend.setNetworkStatus(false)

      // Wait for detection
      await new Promise(resolve => setTimeout(resolve, 100))

      connectivityStatus = await mockConvexBackend.query('connectivity:getStatus', {})
      expect(connectivityStatus.online).toBe(false)
      expect(connectivityStatus.type).toBe('offline')

      // Simulate coming back online
      mockConvexBackend.setNetworkStatus(true)

      // Wait for detection
      await new Promise(resolve => setTimeout(resolve, 100))

      connectivityStatus = await mockConvexBackend.query('connectivity:getStatus', {})
      expect(connectivityStatus.online).toBe(true)
      expect(connectivityStatus.type).toBe('online')
    })

    it('should initialize offline mode capabilities', async () => {
      const user = createTestUser()
      await mockConvexBackend.seedUser(user)

      // Go offline
      mockConvexBackend.setNetworkStatus(false)

      // Check offline capabilities
      const offlineCapabilities = await mockConvexBackend.query('offline:getCapabilities', {
        userId: user.id
      })

      expect(offlineCapabilities).toBeDefined()
      expect(offlineCapabilities.available).toBe(true)
      expect(offlineCapabilities.storageAvailable).toBeGreaterThan(0)
      expect(offlineCapabilities.features).toBeDefined()

      // Verify offline features
      expect(offlineCapabilities.features.includes('basic_sessions')).toBe(true)
      expect(offlineCapabilities.features.includes('local_storage')).toBe(true)
      expect(offlineCapabilities.features.includes('queue_sync')).toBe(true)

      // Test offline storage limits
      const storageLimits = await mockConvexBackend.query('offline:getStorageLimits', {
        userId: user.id
      })

      expect(storageLimits).toBeDefined()
      expect(storageLimits.maxSessions).toBeGreaterThan(0)
      expect(storageLimits.maxStorage).toBeGreaterThan(0)
      expect(storageLimits.currentUsage).toBeDefined()
    })

    it('should handle offline initialization with existing data', async () => {
      const user = createTestUser()
      await mockConvexBackend.seedUser(user)

      // Create some data while online
      const session1 = await mockConvexBackend.mutation('sessions:create', {
        userId: user.id,
        type: 'presentation'
      })

      const session2 = await mockConvexBackend.mutation('sessions:create', {
        userId: user.id,
        type: 'conversation'
      })

      // Go offline
      mockConvexBackend.setNetworkStatus(false)

      // Verify data is available offline
      const offlineSessions = await mockConvexBackend.query('sessions:getUserSessions', {
        userId: user.id
      })

      expect(offlineSessions.length).toBe(2)
      expect(offlineSessions.find((s: any) => s.id === session1.sessionId)).toBeDefined()
      expect(offlineSessions.find((s: any) => s.id === session2.sessionId)).toBeDefined()

      // Test offline data integrity
      const offlineSession1 = await mockConvexBackend.query('sessions:get', {
        sessionId: session1.sessionId
      })

      expect(offlineSession1).toBeDefined()
      expect(offlineSession1.type).toBe('presentation')
      expect(offlineSession1.offline).toBe(true)
    })
  })

  describe('Offline Data Operations', () => {
    it('should support core functionality in offline mode', async () => {
      const user = createTestUser()
      await mockConvexBackend.seedUser(user)

      // Go offline
      mockConvexBackend.setNetworkStatus(false)

      // Test offline session creation
      const offlineSession = await mockConvexBackend.mutation('sessions:create', {
        userId: user.id,
        type: 'presentation',
        offline: true
      })

      expect(offlineSession.success).toBe(true)
      expect(offlineSession.offline).toBe(true)
      expect(offlineSession.syncStatus).toBe('pending')

      // Test offline audio recording simulation
      const audioData = new Uint8Array([1, 2, 3, 4, 5])
      const audioUpload = await mockStorageService.uploadFile(
        `offline/audio-${offlineSession.sessionId}.wav`,
        audioData,
        { userId: user.id, offline: true }
      )

      expect(audioUpload.key).toBeDefined()
      expect(audioUpload.offline).toBe(true)

      // Test offline transcript storage
      const transcriptStorage = await mockConvexBackend.mutation('sessions:storeTranscript', {
        sessionId: offlineSession.sessionId,
        userId: user.id,
        transcript: 'Offline recorded transcript content',
        offline: true
      })

      expect(transcriptStorage.success).toBe(true)
      expect(transcriptStorage.offline).toBe(true)

      // Test offline assessment (limited capabilities)
      const offlineAssessment = await mockConvexBackend.mutation('assessments:createOffline', {
        sessionId: offlineSession.sessionId,
        userId: user.id,
        transcript: 'Offline transcript',
        basicAnalysis: true
      })

      expect(offlineAssessment.success).toBe(true)
      expect(offlineAssessment.limited).toBe(true)
      expect(offlineAssessment.offline).toBe(true)
    })

    it('should queue operations for sync when offline', async () => {
      const user = createTestUser()
      await mockConvexBackend.seedUser(user)

      // Start offline
      mockConvexBackend.setNetworkStatus(false)

      // Perform various operations that should be queued
      const operations = []

      // Queue session creation
      operations.push(
        mockConvexBackend.mutation('sessions:create', {
          userId: user.id,
          type: 'presentation'
        })
      )

      // Queue profile update
      operations.push(
        mockConvexBackend.mutation('users:updateProfile', {
          userId: user.id,
          profile: { name: 'Offline Updated Name' }
        })
      )

      // Queue settings change
      operations.push(
        mockConvexBackend.mutation('settings:updateUI', {
          userId: user.id,
          settings: { theme: 'dark' }
        })
      )

      const results = await Promise.all(operations)

      // All operations should be queued successfully
      results.forEach(result => {
        expect(result.success).toBe(true)
        expect(result.queued).toBe(true)
        expect(result.offline).toBe(true)
      })

      // Check operation queue
      const queueStatus = await mockConvexBackend.query('offline:getQueueStatus', {
        userId: user.id
      })

      expect(queueStatus).toBeDefined()
      expect(queueStatus.queuedOperations).toBe(3)
      expect(queueStatus.pendingSync).toBe(true)
      expect(queueStatus.estimatedSyncTime).toBeDefined()

      // Verify queue contents
      const queueContents = await mockConvexBackend.query('offline:getQueueContents', {
        userId: user.id
      })

      expect(queueContents.operations).toHaveLength(3)
      expect(queueContents.operations[0].type).toBe('create_session')
      expect(queueContents.operations[1].type).toBe('update_profile')
      expect(queueContents.operations[2].type).toBe('update_settings')
    })

    it('should handle offline data conflicts and resolution', async () => {
      const user = createTestUser()
      await mockConvexBackend.seedUser(user)

      // Create initial data online
      const session = await mockConvexBackend.mutation('sessions:create', {
        userId: user.id,
        type: 'presentation',
        title: 'Original Title'
      })

      // Go offline
      mockConvexBackend.setNetworkStatus(false)

      // Modify data offline on "device 1"
      const offlineUpdate1 = await mockConvexBackend.mutation('sessions:updateTitle', {
        sessionId: session.sessionId,
        userId: user.id,
        title: 'Offline Title Device 1',
        offline: true,
        deviceId: 'device-1'
      })

      expect(offlineUpdate1.success).toBe(true)
      expect(offlineUpdate1.queued).toBe(true)

      // Modify same data offline on "device 2"
      const offlineUpdate2 = await mockConvexBackend.mutation('sessions:updateTitle', {
        sessionId: session.sessionId,
        userId: user.id,
        title: 'Offline Title Device 2',
        offline: true,
        deviceId: 'device-2'
      })

      expect(offlineUpdate2.success).toBe(true)
      expect(offlineUpdate2.queued).toBe(true)

      // Come back online and sync
      mockConvexBackend.setNetworkStatus(true)

      const syncResult = await mockConvexBackend.mutation('offline:syncQueuedOperations', {
        userId: user.id
      })

      expect(syncResult.success).toBe(true)
      expect(syncResult.conflictsDetected).toBeGreaterThan(0)
      expect(syncResult.conflictsResolved).toBeGreaterThan(0)

      // Check conflict resolution
      const conflictDetails = await mockConvexBackend.query('offline:getSyncConflicts', {
        userId: user.id
      })

      expect(conflictDetails).toBeDefined()
      expect(conflictDetails.conflicts).toHaveLength(1)
      expect(conflictDetails.conflicts[0].field).toBe('title')
      expect(conflictDetails.conflicts[0].resolution).toBeDefined()

      // Verify final state
      const finalSession = await mockConvexBackend.query('sessions:get', {
        sessionId: session.sessionId
      })

      expect(finalSession).toBeDefined()
      expect(['Offline Title Device 1', 'Offline Title Device 2']).toContain(finalSession.title)
    })
  })

  describe('Online/Offline Transition Handling', () => {
    it('should handle seamless transition from offline to online', async () => {
      const user = createTestUser()
      await mockConvexBackend.seedUser(user)

      // Start offline
      mockConvexBackend.setNetworkStatus(false)

      // Perform offline operations
      const offlineSession = await mockConvexBackend.mutation('sessions:create', {
        userId: user.id,
        type: 'presentation',
        offline: true
      })

      const offlineUpdate = await mockConvexBackend.mutation('sessions:updateNotes', {
        sessionId: offlineSession.sessionId,
        userId: user.id,
        notes: 'Offline notes',
        offline: true
      })

      // Come back online
      mockConvexBackend.setNetworkStatus(true)

      // Monitor transition
      const transitionStart = Date.now()
      const transitionResult = await mockConvexBackend.query('connectivity:monitorTransition', {
        userId: user.id,
        from: 'offline',
        to: 'online'
      })

      const transitionTime = Date.now() - transitionStart

      expect(transitionResult.success).toBe(true)
      expect(transitionTime).toBeLessThan(2000) // Transition should be quick
      expect(transitionResult.connectionEstablished).toBe(true)

      // Verify sync starts automatically
      const syncStatus = await mockConvexBackend.query('offline:getSyncStatus', {
        userId: user.id
      })

      expect(syncStatus.syncing).toBe(true)
      expect(syncStatus.queuedOperations).toBeGreaterThan(0)

      // Wait for sync completion
      let syncComplete = false
      let attempts = 0
      while (!syncComplete && attempts < 10) {
        const status = await mockConvexBackend.query('offline:getSyncStatus', {
          userId: user.id
        })

        if (!status.syncing) {
          syncComplete = true
        }

        await new Promise(resolve => setTimeout(resolve, 100))
        attempts++
      }

      expect(syncComplete).toBe(true)

      // Verify data consistency after sync
      const syncedSession = await mockConvexBackend.query('sessions:get', {
        sessionId: offlineSession.sessionId
      })

      expect(syncedSession).toBeDefined()
      expect(syncedSession.notes).toBe('Offline notes')
      expect(syncedSession.offline).toBeUndefined() // Should be cleared after sync
      expect(syncedSession.syncedAt).toBeDefined()
    })

    it('should handle transition from online to offline gracefully', async () => {
      const user = createTestUser()
      await mockConvexBackend.seedUser(user)

      // Start online with active operations
      const session = await mockConvexBackend.mutation('sessions:create', {
        userId: user.id,
        type: 'presentation'
      })

      // Simulate in-progress assessment
      const assessment = await mockAIAPI.assess('In-progress assessment', ['clarity'])
      await mockConvexBackend.seedAssessment({
        id: `inprogress-assessment-${Date.now()}`,
        sessionId: session.sessionId,
        userId: user.id,
        skillAssessments: assessment.skillAssessments,
        overallScore: 0.8,
        feedback: 'In-progress assessment',
        createdAt: new Date()
      })

      // Go offline during operation
      mockConvexBackend.setNetworkStatus(false)

      // Monitor offline transition
      const transitionResult = await mockConvexBackend.query('connectivity:monitorTransition', {
        userId: user.id,
        from: 'online',
        to: 'offline'
      })

      expect(transitionResult.success).toBe(true)
      expect(transitionResult.graceful).toBe(true)
      expect(transitionResult.dataPreserved).toBe(true)

      // Verify in-progress operations are handled
      const inProgressOps = await mockConvexBackend.query('offline:getInProgressOperations', {
        userId: user.id
      })

      expect(inProgressOps).toBeDefined()
      expect(inProgressOps.operations.length).toBeGreaterThan(0)

      // Test offline continuation of operations
      const offlineContinuation = await mockConvexBackend.mutation('offline:continueOperation', {
        userId: user.id,
        operationId: inProgressOps.operations[0].id
      })

      expect(offlineContinuation.success).toBe(true)
      expect(offlineContinuation.offlineMode).toBe(true)

      // Verify offline capabilities are available
      const offlineCaps = await mockConvexBackend.query('offline:getCapabilities', {
        userId: user.id
      })

      expect(offlineCaps.available).toBe(true)
      expect(offlineCaps.canContinueOperations).toBe(true)
    })

    it('should handle unstable network conditions', async () => {
      const user = createTestUser()
      await mockConvexBackend.seedUser(user)

      // Simulate unstable network (intermittent connectivity)
      const networkPattern = [
        { online: true, duration: 1000 },
        { online: false, duration: 500 },
        { online: true, duration: 800 },
        { online: false, duration: 300 },
        { online: true, duration: 1200 },
        { online: false, duration: 400 },
        { online: true, duration: 2000 } // Final stable connection
      ]

      const connectionEvents: any[] = []

      // Monitor connection stability
      for (const pattern of networkPattern) {
        mockConvexBackend.setNetworkStatus(pattern.online)
        connectionEvents.push({
          online: pattern.online,
          timestamp: Date.now(),
          duration: pattern.duration
        })

        await new Promise(resolve => setTimeout(resolve, pattern.duration))
      }

      // Analyze connection stability
      const stabilityAnalysis = await mockConvexBackend.query('connectivity:analyzeStability', {
        userId: user.id,
        events: connectionEvents
      })

      expect(stabilityAnalysis).toBeDefined()
      expect(stabilityAnalysis.uptimePercentage).toBeDefined()
      expect(stabilityAnalysis.averageDowntime).toBeDefined()
      expect(stabilityAnalysis.connectionSwitches).toBe(networkPattern.length - 1)

      // Test adaptive behavior under unstable conditions
      const adaptiveBehavior = await mockConvexBackend.query('offline:getAdaptiveBehavior', {
        userId: user.id,
        networkStability: stabilityAnalysis.uptimePercentage
      })

      expect(adaptiveBehavior).toBeDefined()
      expect(adaptiveBehavior.retryStrategy).toBeDefined()
      expect(adaptiveBehavior.offlineMode).toBe(true)
      expect(adaptiveBehavior.syncFrequency).toBeDefined()

      // Verify data integrity after unstable period
      const dataIntegrity = await mockConvexBackend.query('offline:verifyDataIntegrity', {
        userId: user.id
      })

      expect(dataIntegrity.intact).toBe(true)
      expect(dataIntegrity.conflictsResolved).toBeDefined()
      expect(dataIntegrity.syncOperations).toBeGreaterThan(0)
    })
  })

  describe('Offline Data Synchronization', () => {
    it('should synchronize offline data changes when coming online', async () => {
      const user = createTestUser()
      await mockConvexBackend.seedUser(user)

      // Go offline
      mockConvexBackend.setNetworkStatus(false)

      // Create offline data
      const offlineSession = await mockConvexBackend.mutation('sessions:create', {
        userId: user.id,
        type: 'presentation',
        offline: true
      })

      const offlineAssessment = await mockConvexBackend.mutation('assessments:createOffline', {
        sessionId: offlineSession.sessionId,
        userId: user.id,
        transcript: 'Offline assessment transcript',
        basicAnalysis: true
      })

      // Modify profile offline
      const offlineProfileUpdate = await mockConvexBackend.mutation('users:updateProfile', {
        userId: user.id,
        profile: { name: 'Offline Updated Name' },
        offline: true
      })

      // Come back online
      mockConvexBackend.setNetworkStatus(true)

      // Initiate sync
      const syncResult = await mockConvexBackend.mutation('offline:syncAllData', {
        userId: user.id
      })

      expect(syncResult.success).toBe(true)
      expect(syncResult.syncedItems).toBeGreaterThan(0)
      expect(syncResult.syncTime).toBeDefined()

      // Verify all data is synchronized
      const syncedSession = await mockConvexBackend.query('sessions:get', {
        sessionId: offlineSession.sessionId
      })

      expect(syncedSession).toBeDefined()
      expect(syncedSession.offline).toBeUndefined()
      expect(syncedSession.syncedAt).toBeDefined()

      const syncedProfile = await mockConvexBackend.query('users:getProfile', {
        userId: user.id
      })

      expect(syncedProfile.name).toBe('Offline Updated Name')

      // Check sync status
      const syncStatus = await mockConvexBackend.query('offline:getSyncStatus', {
        userId: user.id
      })

      expect(syncStatus.syncing).toBe(false)
      expect(syncStatus.lastSyncSuccessful).toBe(true)
      expect(syncStatus.syncedItems).toBe(syncResult.syncedItems)
    })

    it('should handle large offline datasets efficiently', async () => {
      const user = createTestUser()
      await mockConvexBackend.seedUser(user)

      // Go offline
      mockConvexBackend.setNetworkStatus(false)

      // Create large offline dataset
      const largeDatasetSize = 50
      const offlineItems: any[] = []

      for (let i = 0; i < largeDatasetSize; i++) {
        const session = await mockConvexBackend.mutation('sessions:create', {
          userId: user.id,
          type: 'presentation',
          offline: true
        })

        const assessment = await mockConvexBackend.mutation('assessments:createOffline', {
          sessionId: session.sessionId,
          userId: user.id,
          transcript: `Large offline transcript ${i} with substantial content that simulates real usage patterns and data volume.`,
          basicAnalysis: true
        })

        offlineItems.push({
          session: session.sessionId,
          assessment: assessment.id
        })
      }

      // Come back online and sync large dataset
      mockConvexBackend.setNetworkStatus(true)

      const syncStart = Date.now()
      const largeSyncResult = await mockConvexBackend.mutation('offline:syncLargeDataset', {
        userId: user.id,
        batchSize: 10,
        enableProgressTracking: true
      })

      const syncTime = Date.now() - syncStart

      expect(largeSyncResult.success).toBe(true)
      expect(largeSyncResult.totalItems).toBe(largeDatasetSize * 2) // Sessions + assessments
      expect(syncTime).toBeLessThan(10000) // Should complete within 10 seconds

      // Monitor sync progress
      const progressUpdates: any[] = []
      let syncComplete = false

      while (!syncComplete) {
        const progress = await mockConvexBackend.query('offline:getSyncProgress', {
          userId: user.id,
          syncId: largeSyncResult.syncId
        })

        progressUpdates.push(progress)

        if (progress.percentage >= 100) {
          syncComplete = true
        }

        await new Promise(resolve => setTimeout(resolve, 50))
      }

      // Verify progress tracking
      expect(progressUpdates.length).toBeGreaterThan(1)
      expect(progressUpdates[0].percentage).toBeLessThan(progressUpdates[progressUpdates.length - 1].percentage)

      // Verify all items synced
      for (const item of offlineItems) {
        const syncedSession = await mockConvexBackend.query('sessions:get', {
          sessionId: item.session
        })

        expect(syncedSession).toBeDefined()
        expect(syncedSession.offline).toBeUndefined()
      }
    })

    it('should handle sync conflicts and data merging', async () => {
      const user = createTestUser()
      await mockConvexBackend.seedUser(user)

      // Create base data online
      const session = await mockConvexBackend.mutation('sessions:create', {
        userId: user.id,
        type: 'presentation',
        title: 'Base Title',
        notes: 'Base notes'
      })

      // Go offline and make conflicting changes
      mockConvexBackend.setNetworkStatus(false)

      // Offline change 1: Update title
      await mockConvexBackend.mutation('sessions:updateTitle', {
        sessionId: session.sessionId,
        userId: user.id,
        title: 'Offline Title Change',
        offline: true,
        deviceId: 'device-1'
      })

      // Offline change 2: Update notes
      await mockConvexBackend.mutation('sessions:updateNotes', {
        sessionId: session.sessionId,
        userId: user.id,
        notes: 'Offline Notes Change',
        offline: true,
        deviceId: 'device-2'
      })

      // Make online change while offline
      mockConvexBackend.setNetworkStatus(true)
      await mockConvexBackend.mutation('sessions:updateTitle', {
        sessionId: session.sessionId,
        userId: user.id,
        title: 'Online Title Change'
      })

      // Come back online and sync
      const conflictSync = await mockConvexBackend.mutation('offline:syncWithConflictResolution', {
        userId: user.id,
        conflictStrategy: 'manual_review'
      })

      expect(conflictSync.success).toBe(true)
      expect(conflictSync.conflictsDetected).toBeGreaterThan(0)

      // Review and resolve conflicts
      const conflicts = await mockConvexBackend.query('offline:getSyncConflicts', {
        userId: user.id
      })

      expect(conflicts.conflicts).toHaveLength(1)
      expect(conflicts.conflicts[0].field).toBe('title')
      expect(conflicts.conflicts[0].conflictingValues).toHaveLength(2)

      // Resolve conflict manually
      const resolution = await mockConvexBackend.mutation('offline:resolveConflict', {
        userId: user.id,
        conflictId: conflicts.conflicts[0].id,
        resolution: 'keep_offline',
        reason: 'Offline change was more recent'
      })

      expect(resolution.success).toBe(true)

      // Complete sync
      const finalSync = await mockConvexBackend.mutation('offline:completeSync', {
        userId: user.id
      })

      expect(finalSync.success).toBe(true)

      // Verify final state
      const finalSession = await mockConvexBackend.query('sessions:get', {
        sessionId: session.sessionId
      })

      expect(finalSession.title).toBe('Offline Title Change') // Offline change kept
      expect(finalSession.notes).toBe('Offline Notes Change') // Offline change applied
      expect(finalSession.conflictResolved).toBe(true)
    })
  })

  describe('Offline Performance and Reliability', () => {
    it('should maintain performance in offline mode', async () => {
      const user = createTestUser()
      await mockConvexBackend.seedUser(user)

      // Measure online baseline performance
      mockConvexBackend.setNetworkStatus(true)

      const onlineStart = Date.now()
      const onlineOperations = []

      for (let i = 0; i < 20; i++) {
        onlineOperations.push(
          mockConvexBackend.query('users:getProfile', { userId: user.id })
        )
      }

      await Promise.all(onlineOperations)
      const onlineTime = Date.now() - onlineStart
      const onlineAvgTime = onlineTime / 20

      // Go offline and measure performance
      mockConvexBackend.setNetworkStatus(false)

      const offlineStart = Date.now()
      const offlineOperations = []

      for (let i = 0; i < 20; i++) {
        offlineOperations.push(
          mockConvexBackend.query('users:getProfile', { userId: user.id })
        )
      }

      await Promise.all(offlineOperations)
      const offlineTime = Date.now() - offlineStart
      const offlineAvgTime = offlineTime / 20

      // Offline performance should be comparable or better
      expect(offlineAvgTime).toBeLessThan(onlineAvgTime * 2)
      expect(offlineTime).toBeLessThan(onlineTime * 2)

      // Test offline caching effectiveness
      const cacheStats = await mockConvexBackend.query('offline:getCacheStats', {
        userId: user.id
      })

      expect(cacheStats).toBeDefined()
      expect(cacheStats.hitRate).toBeGreaterThan(0.8)
      expect(cacheStats.offlineHits).toBeGreaterThan(15)
    })

    it('should ensure data reliability in offline scenarios', async () => {
      const user = createTestUser()
      await mockConvexBackend.seedUser(user)

      // Go offline
      mockConvexBackend.setNetworkStatus(false)

      // Create critical data offline
      const criticalSession = await mockConvexBackend.mutation('sessions:create', {
        userId: user.id,
        type: 'presentation',
        title: 'Critical Presentation',
        offline: true
      })

      // Simulate data corruption scenario
      mockConvexBackend.simulateOfflineCorruption(criticalSession.sessionId)

      // Test data recovery mechanisms
      const recoveryResult = await mockConvexBackend.mutation('offline:recoverData', {
        userId: user.id,
        itemId: criticalSession.sessionId
      })

      expect(recoveryResult.success).toBe(true)
      expect(recoveryResult.recovered).toBe(true)
      expect(recoveryResult.integrityVerified).toBe(true)

      // Test offline backup creation
      const backupResult = await mockConvexBackend.mutation('offline:createBackup', {
        userId: user.id
      })

      expect(backupResult.success).toBe(true)
      expect(backupResult.backupId).toBeDefined()
      expect(backupResult.size).toBeGreaterThan(0)

      // Test backup restoration
      const restoreResult = await mockConvexBackend.mutation('offline:restoreFromBackup', {
        userId: user.id,
        backupId: backupResult.backupId
      })

      expect(restoreResult.success).toBe(true)
      expect(restoreResult.restoredItems).toBeGreaterThan(0)

      // Verify restored data integrity
      const restoredSession = await mockConvexBackend.query('sessions:get', {
        sessionId: criticalSession.sessionId
      })

      expect(restoredSession).toBeDefined()
      expect(restoredSession.title).toBe('Critical Presentation')
      expect(restoredSession.dataIntact).toBe(true)
    })
  })
})
