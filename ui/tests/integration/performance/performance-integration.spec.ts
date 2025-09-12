/**
 * Performance Integration Tests
 * Tests system performance under various load conditions and scenarios
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
describe('Performance Integration', () => {
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

  describe('Response Time Benchmarks', () => {
    it('should meet response time SLAs for core operations', async () => {
      const user = createTestUser()
      await mockConvexBackend.seedUser(user)

      // Test user profile retrieval
      const profileStart = Date.now()
      const profile = await mockConvexBackend.query('users:getProfile', {
        userId: user.id
      })
      const profileTime = Date.now() - profileStart

      expect(profile).toBeDefined()
      expect(profileTime).toBeLessThan(100) // < 100ms SLA

      // Test session creation
      const sessionStart = Date.now()
      const session = await mockConvexBackend.mutation('sessions:create', {
        userId: user.id,
        type: 'presentation'
      })
      const sessionTime = Date.now() - sessionStart

      expect(session.success).toBe(true)
      expect(sessionTime).toBeLessThan(200) // < 200ms SLA

      // Test assessment processing
      const assessmentStart = Date.now()
      const assessment = await mockAIAPI.assess('Quick assessment test', ['clarity'])
      const assessmentTime = Date.now() - assessmentStart

      expect(assessment.skillAssessments).toHaveLength(1)
      expect(assessmentTime).toBeLessThan(500) // < 500ms SLA

      // Test file upload
      const uploadStart = Date.now()
      const audioData = new Uint8Array([1, 2, 3, 4])
      const upload = await mockStorageService.uploadFile(
        `performance-test/audio.wav`,
        audioData,
        { userId: user.id }
      )
      const uploadTime = Date.now() - uploadStart

      expect(upload.key).toBeDefined()
      expect(uploadTime).toBeLessThan(300) // < 300ms SLA
    })

    it('should maintain performance consistency under sustained load', async () => {
      const user = createTestUser()
      await mockConvexBackend.seedUser(user)

      const operationCount = 50
      const responseTimes: number[] = []

      // Perform sustained operations
      for (let i = 0; i < operationCount; i++) {
        const startTime = Date.now()

        await mockConvexBackend.query('users:getProfile', {
          userId: user.id
        })

        const endTime = Date.now()
        responseTimes.push(endTime - startTime)

        // Small delay to simulate realistic usage
        await new Promise(resolve => setTimeout(resolve, 10))
      }

      // Calculate performance metrics
      const avgResponseTime = responseTimes.reduce((sum, time) => sum + time, 0) / responseTimes.length
      const maxResponseTime = Math.max(...responseTimes)
      const minResponseTime = Math.min(...responseTimes)
      const p95ResponseTime = responseTimes.sort((a, b) => a - b)[Math.floor(responseTimes.length * 0.95)]

      // Performance assertions
      expect(avgResponseTime).toBeLessThan(150) // Average < 150ms
      expect(maxResponseTime).toBeLessThan(300) // Max < 300ms
      expect(p95ResponseTime).toBeLessThan(200) // 95th percentile < 200ms

      // Check performance stability (response time variance)
      const variance = responseTimes.reduce((sum, time) => sum + Math.pow(time - avgResponseTime, 2), 0) / responseTimes.length
      const standardDeviation = Math.sqrt(variance)

      expect(standardDeviation).toBeLessThan(50) // Low variance indicates stable performance
    })

    it('should handle concurrent requests without performance degradation', async () => {
      const userCount = 10
      const users = []
      const concurrentRequests = 20

      // Create multiple users
      for (let i = 0; i < userCount; i++) {
        const user = createTestUser({
          email: `perf${i}@coachup.example.com`
        })
        await mockConvexBackend.seedUser(user)
        users.push(user)
      }

      // Measure baseline performance (single request)
      const baselineStart = Date.now()
      await mockConvexBackend.query('users:getProfile', {
        userId: users[0].id
      })
      const baselineTime = Date.now() - baselineStart

      // Execute concurrent requests
      const concurrentPromises = []
      for (let i = 0; i < concurrentRequests; i++) {
        const userIndex = i % userCount
        concurrentPromises.push(
          mockConvexBackend.query('users:getProfile', {
            userId: users[userIndex].id
          })
        )
      }

      const concurrentStart = Date.now()
      const concurrentResults = await Promise.all(concurrentPromises)
      const concurrentTotalTime = Date.now() - concurrentStart

      // Verify all requests succeeded
      concurrentResults.forEach(result => {
        expect(result).toBeDefined()
      })

      // Calculate performance metrics
      const avgConcurrentTime = concurrentTotalTime / concurrentRequests
      const throughput = (concurrentRequests * 1000) / concurrentTotalTime // requests per second

      // Performance should not degrade significantly under concurrency
      expect(avgConcurrentTime).toBeLessThan(baselineTime * 3) // Max 3x degradation
      expect(throughput).toBeGreaterThan(10) // At least 10 requests/second

      // Test response time distribution
      const responseTimes: number[] = []
      const individualPromises = []

      for (let i = 0; i < concurrentRequests; i++) {
        const startTime = Date.now()
        const promise = mockConvexBackend.query('users:getProfile', {
          userId: users[i % userCount].id
        }).then(result => {
          const endTime = Date.now()
          responseTimes.push(endTime - startTime)
          return result
        })

        individualPromises.push(promise)
      }

      await Promise.all(individualPromises)

      const maxConcurrentResponseTime = Math.max(...responseTimes)
      const p95ConcurrentResponseTime = responseTimes.sort((a, b) => a - b)[Math.floor(responseTimes.length * 0.95)]

      expect(maxConcurrentResponseTime).toBeLessThan(500) // Max response time under concurrency
      expect(p95ConcurrentResponseTime).toBeLessThan(300) // 95th percentile under concurrency
    })
  })

  describe('Memory Usage and Resource Management', () => {
    it('should maintain stable memory usage under load', async () => {
      const user = createTestUser()
      await mockConvexBackend.seedUser(user)

      // Get baseline memory usage
      const baselineMemory = await mockConvexBackend.query('system:getMemoryUsage', {})

      const operationCount = 100
      const memoryCheckpoints: any[] = []

      // Perform memory-intensive operations
      for (let i = 0; i < operationCount; i++) {
        // Create session with large transcript
        const session = await mockConvexBackend.mutation('sessions:create', {
          userId: user.id,
          type: 'presentation'
        })

        // Simulate large assessment processing
        const largeTranscript = 'Large transcript content '.repeat(100) // ~2.5KB
        const assessment = await mockAIAPI.assess(largeTranscript, ['clarity', 'confidence', 'engagement'])

        await mockConvexBackend.seedAssessment({
          id: `memory-test-${i}-${Date.now()}`,
          sessionId: session.sessionId,
          userId: user.id,
          skillAssessments: assessment.skillAssessments,
          overallScore: 0.8,
          feedback: 'Memory test assessment',
          createdAt: new Date()
        })

        // Check memory usage periodically
        if (i % 10 === 0) {
          const memoryUsage = await mockConvexBackend.query('system:getMemoryUsage', {})
          memoryCheckpoints.push({
            operation: i,
            ...memoryUsage
          })
        }
      }

      // Analyze memory usage pattern
      const initialMemory = memoryCheckpoints[0]
      const finalMemory = memoryCheckpoints[memoryCheckpoints.length - 1]

      // Memory usage should not grow unbounded
      const memoryGrowth = finalMemory.used - initialMemory.used
      const memoryGrowthPercentage = (memoryGrowth / initialMemory.used) * 100

      expect(memoryGrowthPercentage).toBeLessThan(50) // Max 50% growth

      // Check for memory leaks (should stabilize after initial operations)
      const midMemory = memoryCheckpoints[Math.floor(memoryCheckpoints.length / 2)]
      const lateMemory = memoryCheckpoints[memoryCheckpoints.length - 2]

      const lateGrowth = lateMemory.used - midMemory.used
      expect(lateGrowth).toBeLessThan(memoryGrowth * 0.5) // Late growth should be minimal

      // Verify garbage collection effectiveness
      const gcResult = await mockConvexBackend.mutation('system:triggerGarbageCollection', {})
      expect(gcResult.success).toBe(true)

      const afterGCMemory = await mockConvexBackend.query('system:getMemoryUsage', {})
      expect(afterGCMemory.used).toBeLessThan(finalMemory.used) // Memory should decrease after GC
    })

    it('should efficiently manage database connections and caching', async () => {
      const userCount = 25
      const users = []

      // Create users
      for (let i = 0; i < userCount; i++) {
        const user = createTestUser({
          email: `cache${i}@coachup.example.com`
        })
        await mockConvexBackend.seedUser(user)
        users.push(user)
      }

      // Test connection pool efficiency
      const connectionStart = Date.now()
      const connectionPromises = users.map(user =>
        mockConvexBackend.query('users:getProfile', {
          userId: user.id
        })
      )

      await Promise.all(connectionPromises)
      const connectionTime = Date.now() - connectionStart

      // Test caching effectiveness
      const cacheStart = Date.now()
      // Repeat the same queries (should hit cache)
      const cachePromises = users.slice(0, 10).map(user =>
        mockConvexBackend.query('users:getProfile', {
          userId: user.id
        })
      )

      await Promise.all(cachePromises)
      const cacheTime = Date.now() - cacheStart

      // Cached queries should be significantly faster
      expect(cacheTime).toBeLessThan(connectionTime * 0.5)

      // Test cache invalidation
      const userToUpdate = users[0]
      await mockConvexBackend.mutation('users:updateProfile', {
        userId: userToUpdate.id,
        profile: { name: 'Updated Name' }
      })

      // Query should return updated data (cache invalidated)
      const updatedProfile = await mockConvexBackend.query('users:getProfile', {
        userId: userToUpdate.id
      })

      expect(updatedProfile.name).toBe('Updated Name')

      // Test cache statistics
      const cacheStats = await mockConvexBackend.query('system:getCacheStats', {})

      expect(cacheStats).toBeDefined()
      expect(cacheStats.hitRate).toBeGreaterThan(0.7) // At least 70% cache hit rate
      expect(cacheStats.totalRequests).toBeGreaterThan(userCount)
      expect(cacheStats.cacheSize).toBeGreaterThan(0)
    })

    it('should handle resource cleanup and prevent memory leaks', async () => {
      const user = createTestUser()
      await mockConvexBackend.seedUser(user)

      const initialResources = await mockConvexBackend.query('system:getResourceUsage', {})

      // Create many temporary resources
      const resourceCount = 50
      const createdResources: any[] = []

      for (let i = 0; i < resourceCount; i++) {
        const session = await mockConvexBackend.mutation('sessions:create', {
          userId: user.id,
          type: 'presentation'
        })

        createdResources.push(session)

        // Create temporary files
        const audioData = new Uint8Array([i, i + 1, i + 2])
        await mockStorageService.uploadFile(
          `temp-resource-${i}.wav`,
          audioData,
          { userId: user.id, temporary: true }
        )

        // Create temporary assessments
        const assessment = await mockAIAPI.assess(`Temp assessment ${i}`, ['clarity'])
        await mockConvexBackend.seedAssessment({
          id: `temp-assessment-${i}-${Date.now()}`,
          sessionId: session.sessionId,
          userId: user.id,
          skillAssessments: assessment.skillAssessments,
          overallScore: 0.7,
          feedback: `Temp feedback ${i}`,
          createdAt: new Date(),
          temporary: true
        })
      }

      const peakResources = await mockConvexBackend.query('system:getResourceUsage', {})

      // Trigger cleanup of temporary resources
      const cleanupResult = await mockConvexBackend.mutation('system:cleanupResources', {
        userId: user.id,
        resourceTypes: ['temporary_sessions', 'temporary_files', 'temporary_assessments']
      })

      expect(cleanupResult.success).toBe(true)
      expect(cleanupResult.cleanedResources).toBeGreaterThan(0)

      const afterCleanupResources = await mockConvexBackend.query('system:getResourceUsage', {})

      // Resources should be reduced after cleanup
      expect(afterCleanupResources.memoryUsage).toBeLessThanOrEqual(peakResources.memoryUsage)
      expect(afterCleanupResources.fileCount).toBeLessThan(peakResources.fileCount)
      expect(afterCleanupResources.databaseRecords).toBeLessThan(peakResources.databaseRecords)

      // Verify temporary resources are actually removed
      for (let i = 0; i < Math.min(5, resourceCount); i++) {
        const tempFile = await mockStorageService.downloadFile(`temp-resource-${i}.wav`)
        expect(tempFile).toBeUndefined() // Should be cleaned up

        const tempAssessment = await mockConvexBackend.query('assessments:get', {
          sessionId: createdResources[i].sessionId
        })
        expect(tempAssessment).toBeNull() // Should be cleaned up
      }

      // Test automatic cleanup scheduling
      const cleanupSchedule = await mockConvexBackend.query('system:getCleanupSchedule', {})

      expect(cleanupSchedule).toBeDefined()
      expect(cleanupSchedule.frequency).toBeDefined()
      expect(cleanupSchedule.nextRun).toBeDefined()
      expect(cleanupSchedule.resourceTypes).toContain('temporary')
    })
  })

  describe('Scalability Testing', () => {
    it('should scale efficiently with increasing user load', async () => {
      const userScales = [10, 25, 50, 100]
      const performanceMetrics: any[] = []

      for (const userScale of userScales) {
        const users = []

        // Create users for this scale
        for (let i = 0; i < userScale; i++) {
          const user = createTestUser({
            email: `scale${userScale}-${i}@coachup.example.com`
          })
          await mockConvexBackend.seedUser(user)
          users.push(user)
        }

        // Measure performance at this scale
        const startTime = Date.now()

        const operations = users.map(user =>
          mockConvexBackend.query('users:getProfile', {
            userId: user.id
          })
        )

        await Promise.all(operations)
        const totalTime = Date.now() - startTime

        const avgResponseTime = totalTime / userScale
        const throughput = (userScale * 1000) / totalTime

        performanceMetrics.push({
          userScale,
          avgResponseTime,
          throughput,
          totalTime
        })

        // Clean up for next scale
        mockConvexBackend.clearData()
      }

      // Analyze scaling performance
      for (let i = 1; i < performanceMetrics.length; i++) {
        const current = performanceMetrics[i]
        const previous = performanceMetrics[i - 1]

        // Response time should not degrade more than linearly
        const responseTimeDegradation = current.avgResponseTime / previous.avgResponseTime
        expect(responseTimeDegradation).toBeLessThan(3) // Max 3x degradation

        // Throughput should remain reasonable
        expect(current.throughput).toBeGreaterThan(5) // At least 5 req/sec even at high scale
      }

      // Overall scaling efficiency
      const firstScale = performanceMetrics[0]
      const lastScale = performanceMetrics[performanceMetrics.length - 1]
      const scaleFactor = lastScale.userScale / firstScale.userScale
      const performanceFactor = lastScale.avgResponseTime / firstScale.avgResponseTime

      // Performance degradation should be less than scale growth
      expect(performanceFactor).toBeLessThan(scaleFactor * 1.5)
    })

    it('should maintain performance during peak usage periods', async () => {
      const user = createTestUser()
      await mockConvexBackend.seedUser(user)

      // Simulate peak usage pattern
      const peakDuration = 30000 // 30 seconds
      const operationsPerSecond = 10
      const totalOperations = (peakDuration / 1000) * operationsPerSecond

      const operationTimes: number[] = []
      let operationCount = 0

      const peakStart = Date.now()

      while (operationCount < totalOperations && (Date.now() - peakStart) < peakDuration) {
        const operationStart = Date.now()

        // Mix of different operations to simulate real usage
        const operationType = operationCount % 4

        switch (operationType) {
          case 0:
            await mockConvexBackend.query('users:getProfile', { userId: user.id })
            break
          case 1:
            await mockConvexBackend.mutation('sessions:create', {
              userId: user.id,
              type: 'presentation'
            })
            break
          case 2:
            await mockAIAPI.assess('Peak load assessment', ['clarity'])
            break
          case 3:
            await mockStorageService.uploadFile(
              `peak-test-${operationCount}.wav`,
              new Uint8Array([1, 2, 3]),
              { userId: user.id }
            )
            break
        }

        const operationEnd = Date.now()
        operationTimes.push(operationEnd - operationStart)
        operationCount++

        // Small delay to control operation rate
        await new Promise(resolve => setTimeout(resolve, 10))
      }

      const peakEnd = Date.now()
      const actualDuration = peakEnd - peakStart

      // Performance analysis
      const avgOperationTime = operationTimes.reduce((sum, time) => sum + time, 0) / operationTimes.length
      const maxOperationTime = Math.max(...operationTimes)
      const p95OperationTime = operationTimes.sort((a, b) => a - b)[Math.floor(operationTimes.length * 0.95)]

      const actualThroughput = (operationCount * 1000) / actualDuration

      // Performance assertions for peak load
      expect(avgOperationTime).toBeLessThan(200) // Average < 200ms during peak
      expect(maxOperationTime).toBeLessThan(1000) // Max < 1s during peak
      expect(p95OperationTime).toBeLessThan(500) // 95th percentile < 500ms
      expect(actualThroughput).toBeGreaterThan(operationsPerSecond * 0.8) // At least 80% of target throughput

      // System health during peak
      const peakHealth = await mockConvexBackend.query('system:getHealth', {})
      expect(peakHealth.status).toBe('healthy')

      const peakResources = await mockConvexBackend.query('system:getResourceUsage', {})
      expect(peakResources.cpuUsage).toBeLessThan(90) // CPU < 90%
      expect(peakResources.memoryUsage).toBeLessThan(85) // Memory < 85%
    })

    it('should handle gradual load increases without breaking', async () => {
      const user = createTestUser()
      await mockConvexBackend.seedUser(user)

      const loadLevels = [5, 10, 20, 50, 20, 10, 5] // Ramp up then down
      const performanceHistory: any[] = []

      for (const loadLevel of loadLevels) {
        const operations = []

        // Create operations for this load level
        for (let i = 0; i < loadLevel; i++) {
          operations.push(
            mockConvexBackend.query('users:getProfile', {
              userId: user.id
            })
          )
        }

        const loadStart = Date.now()
        await Promise.all(operations)
        const loadTime = Date.now() - loadStart

        const avgResponseTime = loadTime / loadLevel

        performanceHistory.push({
          loadLevel,
          avgResponseTime,
          totalTime: loadTime
        })

        // Brief pause between load levels
        await new Promise(resolve => setTimeout(resolve, 100))
      }

      // Analyze performance stability during load changes
      for (let i = 1; i < performanceHistory.length; i++) {
        const current = performanceHistory[i]
        const previous = performanceHistory[i - 1]

        // Performance should be relatively stable
        const performanceChange = Math.abs(current.avgResponseTime - previous.avgResponseTime)
        const acceptableChange = Math.max(100, previous.avgResponseTime * 0.5) // Max 100ms or 50% change

        expect(performanceChange).toBeLessThan(acceptableChange)
      }

      // Recovery test: performance should return to baseline after load decrease
      const initialPerformance = performanceHistory[0].avgResponseTime
      const finalPerformance = performanceHistory[performanceHistory.length - 1].avgResponseTime

      expect(finalPerformance).toBeLessThan(initialPerformance * 1.5) // Should recover close to baseline
    })
  })

  describe('Load Testing Scenarios', () => {
    it('should handle realistic user behavior patterns', async () => {
      const userCount = 20
      const users = []

      // Create users with different behavior patterns
      for (let i = 0; i < userCount; i++) {
        const user = createTestUser({
          email: `behavior${i}@coachup.example.com`
        })
        await mockConvexBackend.seedUser(user)
        users.push(user)
      }

      // Simulate realistic usage patterns
      const simulationDuration = 15000 // 15 seconds
      const startTime = Date.now()
      const userActivity: any[] = []

      while (Date.now() - startTime < simulationDuration) {
        // Random user performs random activity
        const randomUser = users[Math.floor(Math.random() * users.length)]
        const activityType = Math.floor(Math.random() * 5) // 0-4

        const activityStart = Date.now()

        switch (activityType) {
          case 0: // Profile view
            await mockConvexBackend.query('users:getProfile', {
              userId: randomUser.id
            })
            userActivity.push({ user: randomUser.id, activity: 'profile_view', duration: Date.now() - activityStart })
            break

          case 1: // Session creation
            await mockConvexBackend.mutation('sessions:create', {
              userId: randomUser.id,
              type: 'presentation'
            })
            userActivity.push({ user: randomUser.id, activity: 'session_create', duration: Date.now() - activityStart })
            break

          case 2: // Assessment processing
            await mockAIAPI.assess('Realistic assessment content', ['clarity'])
            userActivity.push({ user: randomUser.id, activity: 'assessment', duration: Date.now() - activityStart })
            break

          case 3: // File upload
            await mockStorageService.uploadFile(
              `realistic-${randomUser.id}-${Date.now()}.wav`,
              new Uint8Array([1, 2, 3, 4]),
              { userId: randomUser.id }
            )
            userActivity.push({ user: randomUser.id, activity: 'file_upload', duration: Date.now() - activityStart })
            break

          case 4: // Settings update
            await mockConvexBackend.mutation('settings:updateUI', {
              userId: randomUser.id,
              settings: { theme: 'dark' }
            })
            userActivity.push({ user: randomUser.id, activity: 'settings_update', duration: Date.now() - activityStart })
            break
        }

        // Random delay between activities (100-500ms)
        await new Promise(resolve => setTimeout(resolve, 100 + Math.random() * 400))
      }

      // Analyze realistic usage patterns
      const totalActivities = userActivity.length
      const avgActivityDuration = userActivity.reduce((sum, activity) => sum + activity.duration, 0) / totalActivities
      const maxActivityDuration = Math.max(...userActivity.map(a => a.duration))

      const activityBreakdown = userActivity.reduce((acc, activity) => {
        acc[activity.activity] = (acc[activity.activity] || 0) + 1
        return acc
      }, {} as any)

      // Performance assertions for realistic usage
      expect(avgActivityDuration).toBeLessThan(250) // Average activity < 250ms
      expect(maxActivityDuration).toBeLessThan(1000) // Max activity < 1s
      expect(totalActivities).toBeGreaterThan(50) // Sufficient activity volume

      // Activity distribution should be realistic
      expect(activityBreakdown.profile_view).toBeGreaterThan(0)
      expect(activityBreakdown.session_create).toBeGreaterThan(0)
      expect(activityBreakdown.assessment).toBeGreaterThan(0)

      // System should remain stable throughout
      const finalHealth = await mockConvexBackend.query('system:getHealth', {})
      expect(finalHealth.status).toBe('healthy')
    })

    it('should handle burst traffic patterns', async () => {
      const user = createTestUser()
      await mockConvexBackend.seedUser(user)

      // Simulate burst traffic: periods of high activity followed by low activity
      const burstPattern = [
        { duration: 2000, intensity: 15 }, // 2s high burst
        { duration: 3000, intensity: 2 },  // 3s low activity
        { duration: 2000, intensity: 20 }, // 2s very high burst
        { duration: 3000, intensity: 1 },  // 3s very low activity
        { duration: 2000, intensity: 10 }  // 2s moderate burst
      ]

      const burstResults: any[] = []

      for (const burst of burstPattern) {
        const burstStart = Date.now()
        const operations = []

        // Create operations for this burst
        for (let i = 0; i < burst.intensity; i++) {
          operations.push(
            mockConvexBackend.query('users:getProfile', {
              userId: user.id
            })
          )
        }

        const burstOpStart = Date.now()
        await Promise.all(operations)
        const burstOpTime = Date.now() - burstOpStart

        burstResults.push({
          duration: burst.duration,
          intensity: burst.intensity,
          totalTime: burstOpTime,
          avgResponseTime: burstOpTime / burst.intensity,
          throughput: (burst.intensity * 1000) / burstOpTime
        })

        // Wait for next burst
        const remainingTime = burst.duration - (Date.now() - burstStart)
        if (remainingTime > 0) {
          await new Promise(resolve => setTimeout(resolve, remainingTime))
        }
      }

      // Analyze burst handling performance
      const highBurstResults = burstResults.filter(r => r.intensity >= 15)
      const lowBurstResults = burstResults.filter(r => r.intensity <= 2)

      // High burst performance
      highBurstResults.forEach(result => {
        expect(result.avgResponseTime).toBeLessThan(300) // High burst still < 300ms avg
        expect(result.throughput).toBeGreaterThan(10) // Maintain decent throughput
      })

      // Recovery after bursts
      for (let i = 1; i < burstResults.length; i++) {
        const current = burstResults[i]
        const previous = burstResults[i - 1]

        if (previous.intensity > current.intensity) {
          // After high burst, performance should recover
          expect(current.avgResponseTime).toBeLessThan(previous.avgResponseTime * 1.2)
        }
      }

      // Overall system stability
      const avgResponseTime = burstResults.reduce((sum, r) => sum + r.avgResponseTime, 0) / burstResults.length
      const maxResponseTime = Math.max(...burstResults.map(r => r.avgResponseTime))

      expect(avgResponseTime).toBeLessThan(200) // Overall average < 200ms
      expect(maxResponseTime).toBeLessThan(400) // Max burst response < 400ms
    })

    it('should gracefully handle resource exhaustion scenarios', async () => {
      const user = createTestUser()
      await mockConvexBackend.seedUser(user)

      // Set restrictive resource limits
      await mockConvexBackend.mutation('system:setResourceLimits', {
        maxMemoryUsage: 50, // 50MB
        maxConcurrentRequests: 5,
        maxFileStorage: 10 * 1024 * 1024, // 10MB
        maxDatabaseConnections: 3
      })

      // Attempt to exhaust resources
      const exhaustionPromises = []
      const exhaustionCount = 20

      for (let i = 0; i < exhaustionCount; i++) {
        exhaustionPromises.push(
          mockConvexBackend.query('users:getProfile', {
            userId: user.id
          })
        )
      }

      const exhaustionStart = Date.now()
      const exhaustionResults = await Promise.allSettled(exhaustionPromises)
      const exhaustionTime = Date.now() - exhaustionStart

      // Analyze graceful degradation
      const fulfilledCount = exhaustionResults.filter(r => r.status === 'fulfilled').length
      const rejectedCount = exhaustionResults.filter(r => r.status === 'rejected').length

      // Some requests should succeed, some should be gracefully rejected
      expect(fulfilledCount).toBeGreaterThan(0)
      expect(rejectedCount).toBeGreaterThan(0)
      expect(fulfilledCount + rejectedCount).toBe(exhaustionCount)

      // Check rejection reasons
      const rejectionReasons = exhaustionResults
        .filter(r => r.status === 'rejected')
        .map(r => (r as PromiseRejectedResult).reason)

      const resourceExhaustionReasons = rejectionReasons.filter(reason =>
        reason.includes('resource') || reason.includes('limit') || reason.includes('capacity')
      )

      expect(resourceExhaustionReasons.length).toBeGreaterThan(0)

      // System should recover after resource exhaustion
      await new Promise(resolve => setTimeout(resolve, 1000))

      const recoveryTest = await mockConvexBackend.query('users:getProfile', {
        userId: user.id
      })

      expect(recoveryTest).toBeDefined() // System should recover

      // Check resource cleanup
      const resourceStatus = await mockConvexBackend.query('system:getResourceStatus', {})

      expect(resourceStatus.memoryUsage).toBeLessThan(80) // Memory should be cleaned up
      expect(resourceStatus.activeConnections).toBeLessThan(10) // Connections should be cleaned up
    })
  })
})
