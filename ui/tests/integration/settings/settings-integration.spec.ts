/**
 * Settings & Preferences Integration Tests
 * Tests complete settings management and user preferences
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import { createTestUser } from '../../fixtures/integration-data'
import {
  mockAIAPI,
  mockConvexBackend,
  mockStorageService,
  setupIntegrationMocks,
  cleanupIntegrationMocks
} from '../../mocks/integration-services'

// TEMPORARILY DISABLED IN CI/CD
// Status: 1/8 tests passing (notification/privacy/API/audio sync issues)
// TODO: Re-enable when mock implementations reach 80%+ pass rate
// Last updated: 2025-09-11
describe('Settings & Preferences Integration', () => {
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

  describe('Notification Settings', () => {
    it('should manage comprehensive notification preferences', async () => {
      const user = createTestUser()
      await mockConvexBackend.seedUser(user)

      // 1. Set up initial notification preferences
      const initialSettings = {
        emailNotifications: {
          sessionReminders: true,
          weeklyProgress: true,
          goalAchievements: true,
          systemUpdates: false
        },
        pushNotifications: {
          sessionReminders: true,
          assessmentComplete: true,
          goalMilestones: true,
          socialInteractions: false
        },
        inAppNotifications: {
          achievements: true,
          recommendations: true,
          systemMessages: true
        },
        notificationSchedule: {
          quietHours: {
            enabled: true,
            start: '22:00',
            end: '08:00'
          },
          timezone: 'America/New_York'
        }
      }

      const setupResult = await mockConvexBackend.mutation('settings:updateNotifications', {
        userId: user.id,
        settings: initialSettings
      })

      expect(setupResult.success).toBe(true)

      // 2. Test notification delivery during active hours
      mockConvexBackend.setCurrentTime('14:00') // During active hours

      const sessionReminder = await mockConvexBackend.mutation('notifications:sendSessionReminder', {
        userId: user.id,
        sessionId: 'test-session-1'
      })

      expect(sessionReminder.delivered).toBe(true)
      expect(sessionReminder.channels).toContain('email')
      expect(sessionReminder.channels).toContain('push')

      // 3. Test notification blocking during quiet hours
      mockConvexBackend.setCurrentTime('23:00') // During quiet hours

      const quietHourReminder = await mockConvexBackend.mutation('notifications:sendSessionReminder', {
        userId: user.id,
        sessionId: 'test-session-2'
      })

      expect(quietHourReminder.delivered).toBe(false)
      expect(quietHourReminder.reason).toContain('quiet hours')

      // 4. Update notification preferences
      const updatedSettings = {
        ...initialSettings,
        emailNotifications: {
          ...initialSettings.emailNotifications,
          sessionReminders: false
        },
        pushNotifications: {
          ...initialSettings.pushNotifications,
          sessionReminders: false
        }
      }

      const updateResult = await mockConvexBackend.mutation('settings:updateNotifications', {
        userId: user.id,
        settings: updatedSettings
      })

      expect(updateResult.success).toBe(true)

      // 5. Verify updated preferences are respected
      mockConvexBackend.setCurrentTime('15:00') // Back to active hours

      const updatedReminder = await mockConvexBackend.mutation('notifications:sendSessionReminder', {
        userId: user.id,
        sessionId: 'test-session-3'
      })

      expect(updatedReminder.delivered).toBe(false)
      expect(updatedReminder.reason).toContain('disabled')

      // 6. Test notification history and management
      const notificationHistory = await mockConvexBackend.query('notifications:getHistory', {
        userId: user.id,
        limit: 10
      })

      expect(notificationHistory).toBeDefined()
      expect(notificationHistory.notifications.length).toBeGreaterThan(0)

      // Verify history includes both delivered and blocked notifications
      const deliveredCount = notificationHistory.notifications.filter((n: any) => n.delivered).length
      const blockedCount = notificationHistory.notifications.filter((n: any) => !n.delivered).length

      expect(deliveredCount).toBeGreaterThan(0)
      expect(blockedCount).toBeGreaterThan(0)
    })

    it('should handle notification delivery failures and retries', async () => {
      const user = createTestUser()
      await mockConvexBackend.seedUser(user)

      // Setup notification preferences
      await mockConvexBackend.mutation('settings:updateNotifications', {
        userId: user.id,
        settings: {
          emailNotifications: { sessionReminders: true },
          pushNotifications: { sessionReminders: true }
        }
      })

      // Simulate email delivery failure
      mockConvexBackend.setNotificationFailure('email', true)

      const failedNotification = await mockConvexBackend.mutation('notifications:sendSessionReminder', {
        userId: user.id,
        sessionId: 'failure-test-session'
      })

      expect(failedNotification.emailDelivered).toBe(false)
      expect(failedNotification.pushDelivered).toBe(true) // Push should still work
      expect(failedNotification.retryScheduled).toBe(true)

      // Simulate retry mechanism
      mockConvexBackend.setNotificationFailure('email', false) // Fix email

      const retryResult = await mockConvexBackend.mutation('notifications:processRetries', {
        userId: user.id
      })

      expect(retryResult.processed).toBeGreaterThan(0)
      expect(retryResult.successfulRetries).toBeGreaterThan(0)

      // Verify final delivery status
      const finalStatus = await mockConvexBackend.query('notifications:getDeliveryStatus', {
        userId: user.id,
        notificationId: failedNotification.id
      })

      expect(finalStatus.finalStatus).toBe('delivered')
      expect(finalStatus.retryCount).toBeGreaterThan(0)
    })
  })

  describe('Privacy & Security Settings', () => {
    it('should manage comprehensive privacy controls', async () => {
      const user = createTestUser()
      await mockConvexBackend.seedUser(user)

      // 1. Set privacy preferences
      const privacySettings = {
        profileVisibility: 'private',
        dataSharing: {
          analytics: false,
          marketing: false,
          research: true
        },
        sessionRecording: {
          audioStorage: true,
          transcriptStorage: true,
          aiProcessing: true
        },
        dataRetention: {
          sessions: 365, // days
          assessments: 730,
          analytics: 90
        }
      }

      const privacyResult = await mockConvexBackend.mutation('settings:updatePrivacy', {
        userId: user.id,
        settings: privacySettings
      })

      expect(privacyResult.success).toBe(true)

      // 2. Test data sharing controls
      // Simulate analytics data collection attempt
      const analyticsAttempt = await mockConvexBackend.mutation('analytics:collectUserData', {
        userId: user.id,
        data: { sessionDuration: 30, skillsAssessed: ['clarity'] }
      })

      expect(analyticsAttempt.collected).toBe(false)
      expect(analyticsAttempt.reason).toContain('privacy settings')

      // 3. Test session recording controls
      const session = await mockConvexBackend.mutation('sessions:createWithPrivacy', {
        userId: user.id,
        type: 'presentation'
      })

      expect(session.created).toBe(true)

      // Simulate audio recording
      const audioData = new Uint8Array([1, 2, 3, 4, 5])
      const audioUpload = await mockStorageService.uploadFile(
        `audio/${session.id}/recording.wav`,
        audioData,
        { userId: user.id, sessionId: session.id }
      )

      // Verify privacy-compliant storage
      const storedAudio = await mockStorageService.downloadFile(audioUpload.key)
      expect(storedAudio).toEqual(audioData) // Should be stored normally with privacy controls

      // 4. Test data retention enforcement
      const oldDate = new Date(Date.now() - 400 * 24 * 60 * 60 * 1000) // 400 days ago
      const oldSession = await mockConvexBackend.mutation('sessions:createHistorical', {
        userId: user.id,
        createdAt: oldDate
      })

      const retentionCheck = await mockConvexBackend.query('settings:checkDataRetention', {
        userId: user.id
      })

      expect(retentionCheck.sessionsToArchive.length).toBeGreaterThan(0)
      expect(retentionCheck.assessmentsToArchive.length).toBeGreaterThan(0)

      // 5. Test privacy audit trail
      const auditTrail = await mockConvexBackend.query('privacy:getAuditTrail', {
        userId: user.id
      })

      expect(auditTrail).toBeDefined()
      expect(auditTrail.events.length).toBeGreaterThan(0)

      // Verify audit events for privacy changes
      const privacyEvents = auditTrail.events.filter((e: any) => e.type === 'privacy_setting_changed')
      expect(privacyEvents.length).toBeGreaterThan(0)
    })

    it('should handle two-factor authentication setup and usage', async () => {
      const user = createTestUser()
      await mockConvexBackend.seedUser(user)

      // 1. Enable 2FA
      const enable2FAResult = await mockConvexBackend.mutation('auth:enable2FA', {
        userId: user.id
      })

      expect(enable2FAResult.success).toBe(true)
      expect(enable2FAResult.secret).toBeDefined()
      expect(enable2FAResult.qrCode).toBeDefined()

      // 2. Verify 2FA setup
      const verificationCode = '123456' // Mock TOTP code
      const verify2FAResult = await mockConvexBackend.mutation('auth:verify2FA', {
        userId: user.id,
        code: verificationCode
      })

      expect(verify2FAResult.success).toBe(true)

      // 3. Test login with 2FA required
      const loginAttempt = await mockConvexBackend.mutation('auth:login', {
        email: user.email,
        password: 'password123!'
      })

      expect(loginAttempt.requires2FA).toBe(true)
      expect(loginAttempt.sessionToken).toBeUndefined()

      // 4. Complete login with 2FA
      const completeLogin = await mockConvexBackend.mutation('auth:complete2FALogin', {
        sessionId: loginAttempt.tempSessionId,
        code: verificationCode
      })

      expect(completeLogin.success).toBe(true)
      expect(completeLogin.sessionToken).toBeDefined()

      // 5. Test backup codes
      const backupCodesResult = await mockConvexBackend.mutation('auth:generateBackupCodes', {
        userId: user.id
      })

      expect(backupCodesResult.success).toBe(true)
      expect(backupCodesResult.codes).toHaveLength(10)

      // 6. Test backup code usage
      const backupCodeLogin = await mockConvexBackend.mutation('auth:loginWithBackupCode', {
        email: user.email,
        backupCode: backupCodesResult.codes[0]
      })

      expect(backupCodeLogin.success).toBe(true)
      expect(backupCodeLogin.sessionToken).toBeDefined()

      // 7. Disable 2FA
      const disable2FAResult = await mockConvexBackend.mutation('auth:disable2FA', {
        userId: user.id,
        password: 'password123!'
      })

      expect(disable2FAResult.success).toBe(true)

      // 8. Verify 2FA is disabled
      const normalLogin = await mockConvexBackend.mutation('auth:login', {
        email: user.email,
        password: 'password123!'
      })

      expect(normalLogin.requires2FA).toBe(false)
      expect(normalLogin.sessionToken).toBeDefined()
    })

    it('should manage API keys and third-party integrations', async () => {
      const user = createTestUser()
      await mockConvexBackend.seedUser(user)

      // 1. Generate API key
      const apiKeyResult = await mockConvexBackend.mutation('settings:generateApiKey', {
        userId: user.id,
        name: 'My Integration',
        permissions: ['read_sessions', 'read_assessments']
      })

      expect(apiKeyResult.success).toBe(true)
      expect(apiKeyResult.apiKey).toBeDefined()
      expect(apiKeyResult.keyId).toBeDefined()

      const apiKey = apiKeyResult.apiKey

      // 2. Test API key authentication
      const apiAccess = await mockConvexBackend.query('sessions:list', {
        apiKey: apiKey
      })

      expect(apiAccess).toBeDefined()
      expect(apiAccess.userId).toBe(user.id)

      // 3. Test API key permissions
      const unauthorizedAccess = await mockConvexBackend.mutation('admin:deleteUser', {
        apiKey: apiKey,
        targetUserId: 'other-user'
      })

      expect(unauthorizedAccess.success).toBe(false)
      expect(unauthorizedAccess.error).toContain('permission')

      // 4. Update API key permissions
      const updatePermissions = await mockConvexBackend.mutation('settings:updateApiKey', {
        userId: user.id,
        keyId: apiKeyResult.keyId,
        permissions: ['read_sessions', 'read_assessments', 'write_sessions']
      })

      expect(updatePermissions.success).toBe(true)

      // 5. Test updated permissions
      const authorizedWrite = await mockConvexBackend.mutation('sessions:create', {
        apiKey: apiKey,
        type: 'api-created-session'
      })

      expect(authorizedWrite.success).toBe(true)

      // 6. Revoke API key
      const revokeResult = await mockConvexBackend.mutation('settings:revokeApiKey', {
        userId: user.id,
        keyId: apiKeyResult.keyId
      })

      expect(revokeResult.success).toBe(true)

      // 7. Verify revoked key doesn't work
      const revokedAccess = await mockConvexBackend.query('sessions:list', {
        apiKey: apiKey
      })

      expect(revokedAccess).toBeNull()

      // 8. List all API keys
      const apiKeysList = await mockConvexBackend.query('settings:listApiKeys', {
        userId: user.id
      })

      expect(apiKeysList).toBeDefined()
      expect(apiKeysList.keys).toHaveLength(0) // Should be empty after revocation
    })
  })

  describe('Interface & Experience Settings', () => {
    it('should customize user interface preferences', async () => {
      const user = createTestUser()
      await mockConvexBackend.seedUser(user)

      // 1. Set UI preferences
      const uiSettings = {
        theme: 'dark',
        language: 'en-US',
        timezone: 'America/New_York',
        dateFormat: 'MM/DD/YYYY',
        timeFormat: '12h',
        dashboard: {
          defaultView: 'progress',
          widgetsOrder: ['recent-sessions', 'upcoming-goals', 'skill-progress'],
          compactMode: false
        },
        accessibility: {
          highContrast: false,
          largeText: false,
          reduceMotion: false,
          screenReader: false
        }
      }

      const uiResult = await mockConvexBackend.mutation('settings:updateUI', {
        userId: user.id,
        settings: uiSettings
      })

      expect(uiResult.success).toBe(true)

      // 2. Test theme application
      const themeApplication = await mockConvexBackend.query('ui:getTheme', {
        userId: user.id
      })

      expect(themeApplication.theme).toBe('dark')
      expect(themeApplication.cssVariables).toBeDefined()

      // 3. Test language/localization
      const localization = await mockConvexBackend.query('ui:getLocalization', {
        userId: user.id,
        locale: 'en-US'
      })

      expect(localization).toBeDefined()
      expect(localization.translations).toBeDefined()
      expect(localization.dateTimeFormats).toBeDefined()

      // 4. Test dashboard customization
      const dashboardConfig = await mockConvexBackend.query('ui:getDashboardConfig', {
        userId: user.id
      })

      expect(dashboardConfig.defaultView).toBe('progress')
      expect(dashboardConfig.widgetsOrder).toEqual(['recent-sessions', 'upcoming-goals', 'skill-progress'])

      // 5. Update dashboard layout
      const layoutUpdate = await mockConvexBackend.mutation('settings:updateDashboard', {
        userId: user.id,
        layout: {
          widgetsOrder: ['skill-progress', 'recent-sessions', 'upcoming-goals'],
          hiddenWidgets: ['achievements']
        }
      })

      expect(layoutUpdate.success).toBe(true)

      // 6. Test accessibility settings
      const accessibilityUpdate = await mockConvexBackend.mutation('settings:updateAccessibility', {
        userId: user.id,
        settings: {
          highContrast: true,
          largeText: true,
          reduceMotion: true
        }
      })

      expect(accessibilityUpdate.success).toBe(true)

      const accessibilityConfig = await mockConvexBackend.query('ui:getAccessibilityConfig', {
        userId: user.id
      })

      expect(accessibilityConfig.highContrast).toBe(true)
      expect(accessibilityConfig.largeText).toBe(true)
      expect(accessibilityConfig.reduceMotion).toBe(true)
    })

    it('should manage audio and voice settings', async () => {
      const user = createTestUser()
      await mockConvexBackend.seedUser(user)

      // 1. Configure audio input settings
      const audioInputSettings = {
        microphone: {
          deviceId: 'default',
          sampleRate: 44100,
          channels: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: false
        },
        recording: {
          format: 'wav',
          quality: 'high',
          maxDuration: 300, // 5 minutes
          autoStopOnSilence: true,
          silenceThreshold: -40 // dB
        }
      }

      const audioInputResult = await mockConvexBackend.mutation('settings:updateAudioInput', {
        userId: user.id,
        settings: audioInputSettings
      })

      expect(audioInputResult.success).toBe(true)

      // 2. Configure audio output settings
      const audioOutputSettings = {
        speaker: {
          deviceId: 'default',
          volume: 80
        },
        playback: {
          speed: 1.0,
          pitch: 0,
          voice: 'professional-female'
        },
        feedback: {
          sessionComplete: true,
          assessmentReady: true,
          goalAchieved: true
        }
      }

      const audioOutputResult = await mockConvexBackend.mutation('settings:updateAudioOutput', {
        userId: user.id,
        settings: audioOutputSettings
      })

      expect(audioOutputResult.success).toBe(true)

      // 3. Test audio device enumeration
      const audioDevices = await mockConvexBackend.query('audio:getDevices', {
        userId: user.id
      })

      expect(audioDevices).toBeDefined()
      expect(audioDevices.inputs).toBeDefined()
      expect(audioDevices.outputs).toBeDefined()

      // 4. Test audio settings validation
      const invalidSettings = await mockConvexBackend.mutation('settings:updateAudioInput', {
        userId: user.id,
        settings: {
          microphone: {
            sampleRate: 999999 // Invalid sample rate
          }
        }
      })

      expect(invalidSettings.success).toBe(false)
      expect(invalidSettings.error).toContain('sample rate')

      // 5. Test audio settings persistence
      const savedSettings = await mockConvexBackend.query('settings:getAudioSettings', {
        userId: user.id
      })

      expect(savedSettings.input).toEqual(audioInputSettings)
      expect(savedSettings.output).toEqual(audioOutputSettings)

      // 6. Test audio settings reset
      const resetResult = await mockConvexBackend.mutation('settings:resetAudioSettings', {
        userId: user.id
      })

      expect(resetResult.success).toBe(true)

      const resetSettings = await mockConvexBackend.query('settings:getAudioSettings', {
        userId: user.id
      })

      expect(resetSettings.input.microphone.sampleRate).not.toBe(44100) // Should be default
    })

    it('should handle settings synchronization across devices', async () => {
      const user = createTestUser()
      await mockConvexBackend.seedUser(user)

      // 1. Update settings on device 1
      const device1Settings = {
        theme: 'dark',
        notifications: { email: true, push: false },
        audio: { volume: 75, voice: 'professional-male' }
      }

      const device1Update = await mockConvexBackend.mutation('settings:updateAll', {
        userId: user.id,
        deviceId: 'device-1',
        settings: device1Settings,
        sync: true
      })

      expect(device1Update.success).toBe(true)
      expect(device1Update.syncTimestamp).toBeDefined()

      // 2. Sync settings to device 2
      const device2Sync = await mockConvexBackend.query('settings:syncFromCloud', {
        userId: user.id,
        deviceId: 'device-2',
        lastSyncTimestamp: 0
      })

      expect(device2Sync.settings).toEqual(device1Settings)
      expect(device2Sync.syncTimestamp).toBe(device1Update.syncTimestamp)

      // 3. Update settings on device 2
      const device2Settings = {
        ...device1Settings,
        theme: 'light',
        notifications: { email: false, push: true }
      }

      const device2Update = await mockConvexBackend.mutation('settings:updateAll', {
        userId: user.id,
        deviceId: 'device-2',
        settings: device2Settings,
        sync: true
      })

      expect(device2Update.success).toBe(true)

      // 4. Resolve sync conflict (device 1 settings should win due to timestamp)
      const conflictResolution = await mockConvexBackend.mutation('settings:resolveSyncConflict', {
        userId: user.id,
        deviceId: 'device-1',
        serverTimestamp: device2Update.syncTimestamp,
        localTimestamp: device1Update.syncTimestamp,
        resolution: 'server_wins'
      })

      expect(conflictResolution.success).toBe(true)

      // 5. Verify final synced state
      const finalSync = await mockConvexBackend.query('settings:getSyncedSettings', {
        userId: user.id
      })

      expect(finalSync.settings.theme).toBe('light') // Server (device 2) wins
      expect(finalSync.lastSyncTimestamp).toBeDefined()

      // 6. Test offline settings changes
      mockConvexBackend.setNetworkStatus(false) // Simulate offline

      const offlineUpdate = await mockConvexBackend.mutation('settings:updateOffline', {
        userId: user.id,
        deviceId: 'device-1',
        settings: { theme: 'auto' }
      })

      expect(offlineUpdate.success).toBe(true)
      expect(offlineUpdate.queuedForSync).toBe(true)

      // 7. Test sync when back online
      mockConvexBackend.setNetworkStatus(true)

      const onlineSync = await mockConvexBackend.mutation('settings:syncQueuedChanges', {
        userId: user.id,
        deviceId: 'device-1'
      })

      expect(onlineSync.success).toBe(true)
      expect(onlineSync.syncedChanges).toBeGreaterThan(0)
    })
  })
})
