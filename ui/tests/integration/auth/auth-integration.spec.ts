/**
 * Authentication & Authorization Integration Tests
 * Tests complete user authentication flows and authorization controls
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
// Status: ~3/12 tests passing (session/user ID consistency issues)
// TODO: Re-enable when mock implementations reach 80%+ pass rate
// Last updated: 2025-09-11
describe('Authentication Integration', () => {
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

  describe('User Registration Flow', () => {
    it('should complete full user registration and onboarding', async () => {
      const newUser = {
        email: 'newuser@coachup.example.com',
        password: 'securePassword123!',
        profile: {
          name: 'John Doe',
          experience: 'Beginner',
          industry: 'Technology'
        },
        goals: ['improve presentation skills', 'build confidence']
      }

      // 1. User registration
      const registrationResult = await mockConvexBackend.mutation('auth:register', {
        email: newUser.email,
        password: newUser.password,
        profile: newUser.profile
      })

      expect(registrationResult.success).toBe(true)
      expect(registrationResult.userId).toBeDefined()
      const userId = registrationResult.userId

      // 2. Email verification
      const verificationResult = await mockConvexBackend.mutation('auth:verifyEmail', {
        userId,
        verificationToken: 'mock-verification-token'
      })

      expect(verificationResult.verified).toBe(true)

      // 3. Profile completion
      const profileResult = await mockConvexBackend.mutation('users:updateProfile', {
        userId,
        goals: newUser.goals,
        preferences: {
          notifications: true,
          language: 'en',
          timezone: 'UTC'
        }
      })

      expect(profileResult.success).toBe(true)

      // 4. Initial skill assessment setup
      const skillsResult = await mockConvexBackend.mutation('skills:initializeUser', {
        userId,
        baselineSkills: ['clarity', 'confidence', 'engagement']
      })

      expect(skillsResult.baselineCreated).toBe(true)

      // 5. Verify complete user setup
      const userData = await mockConvexBackend.query('users:get', { userId })
      expect(userData).toBeDefined()
      expect(userData.email).toBe(newUser.email)
      expect(userData.goals).toEqual(newUser.goals)
      expect(userData.verified).toBe(true)
    })

    it('should handle duplicate email registration gracefully', async () => {
      const existingUser = createTestUser({ email: 'existing@coachup.example.com' })
      await mockConvexBackend.seedUser(existingUser)

      // Attempt to register with same email
      const duplicateResult = await mockConvexBackend.mutation('auth:register', {
        email: existingUser.email,
        password: 'differentPassword456!',
        profile: { name: 'Different User', experience: 'Advanced', industry: 'Finance' }
      })

      expect(duplicateResult.success).toBe(false)
      expect(duplicateResult.error).toContain('already exists')
    })

    it('should validate registration data requirements', async () => {
      // Test missing email
      const missingEmailResult = await mockConvexBackend.mutation('auth:register', {
        password: 'password123!',
        profile: { name: 'Test User', experience: 'Beginner', industry: 'Tech' }
      })

      expect(missingEmailResult.success).toBe(false)
      expect(missingEmailResult.error).toContain('email')

      // Test invalid email format
      const invalidEmailResult = await mockConvexBackend.mutation('auth:register', {
        email: 'invalid-email',
        password: 'password123!',
        profile: { name: 'Test User', experience: 'Beginner', industry: 'Tech' }
      })

      expect(invalidEmailResult.success).toBe(false)
      expect(invalidEmailResult.error).toContain('email')

      // Test weak password
      const weakPasswordResult = await mockConvexBackend.mutation('auth:register', {
        email: 'test@coachup.example.com',
        password: '123',
        profile: { name: 'Test User', experience: 'Beginner', industry: 'Tech' }
      })

      expect(weakPasswordResult.success).toBe(false)
      expect(weakPasswordResult.error).toContain('password')
    })
  })

  describe('Login & Session Management', () => {
    it('should complete full login flow with session creation', async () => {
      const testUser = createTestUser({
        email: 'loginuser@coachup.example.com',
        password: 'hashedPassword123!'
      })
      await mockConvexBackend.seedUser(testUser)

      // 1. User login
      const loginResult = await mockConvexBackend.mutation('auth:login', {
        email: testUser.email,
        password: 'correctPassword123!'
      })

      expect(loginResult.success).toBe(true)
      expect(loginResult.sessionToken).toBeDefined()
      expect(loginResult.user).toBeDefined()
      const sessionToken = loginResult.sessionToken

      // 2. Session validation
      const sessionResult = await mockConvexBackend.query('auth:validateSession', {
        sessionToken
      })

      expect(sessionResult.valid).toBe(true)
      expect(sessionResult.userId).toBe(testUser.id)

      // 3. Access protected resources
      const userProfile = await mockConvexBackend.query('users:getProfile', {
        userId: testUser.id,
        sessionToken
      })

      expect(userProfile).toBeDefined()
      expect(userProfile.email).toBe(testUser.email)

      // 4. Session refresh
      const refreshResult = await mockConvexBackend.mutation('auth:refreshSession', {
        sessionToken
      })

      expect(refreshResult.success).toBe(true)
      expect(refreshResult.newSessionToken).toBeDefined()

      // 5. Logout
      const logoutResult = await mockConvexBackend.mutation('auth:logout', {
        sessionToken
      })

      expect(logoutResult.success).toBe(true)

      // 6. Verify session is invalidated
      const invalidatedSession = await mockConvexBackend.query('auth:validateSession', {
        sessionToken
      })

      expect(invalidatedSession.valid).toBe(false)
    })

    it('should handle invalid login attempts with security measures', async () => {
      const testUser = createTestUser({
        email: 'secureuser@coachup.example.com'
      })
      await mockConvexBackend.seedUser(testUser)

      // 1. Wrong password attempts
      for (let i = 1; i <= 3; i++) {
        const wrongPasswordResult = await mockConvexBackend.mutation('auth:login', {
          email: testUser.email,
          password: `wrongPassword${i}`
        })

        expect(wrongPasswordResult.success).toBe(false)
        expect(wrongPasswordResult.error).toContain('invalid')

        // Check if account is temporarily locked after multiple attempts
        if (i === 3) {
          const lockoutResult = await mockConvexBackend.query('auth:checkLockout', {
            email: testUser.email
          })
          expect(lockoutResult.locked).toBe(true)
          expect(lockoutResult.unlockTime).toBeDefined()
        }
      }

      // 2. Non-existent user
      const nonexistentResult = await mockConvexBackend.mutation('auth:login', {
        email: 'nonexistent@coachup.example.com',
        password: 'password123!'
      })

      expect(nonexistentResult.success).toBe(false)
      expect(nonexistentResult.error).toContain('not found')
    })

    it('should handle concurrent sessions and session limits', async () => {
      const testUser = createTestUser({
        email: 'multisession@coachup.example.com'
      })
      await mockConvexBackend.seedUser(testUser)

      const sessions: string[] = []

      // Create multiple concurrent sessions (up to limit)
      const maxSessions = 5
      for (let i = 0; i < maxSessions; i++) {
        const loginResult = await mockConvexBackend.mutation('auth:login', {
          email: testUser.email,
          password: 'password123!',
          deviceId: `device-${i}`
        })

        expect(loginResult.success).toBe(true)
        sessions.push(loginResult.sessionToken)
      }

      // Verify all sessions are valid
      for (const sessionToken of sessions) {
        const validation = await mockConvexBackend.query('auth:validateSession', {
          sessionToken
        })
        expect(validation.valid).toBe(true)
      }

      // Attempt to exceed session limit
      const exceedLimitResult = await mockConvexBackend.mutation('auth:login', {
        email: testUser.email,
        password: 'password123!',
        deviceId: 'device-exceed-limit'
      })

      expect(exceedLimitResult.success).toBe(false)
      expect(exceedLimitResult.error).toContain('session limit')

      // Logout from one session
      await mockConvexBackend.mutation('auth:logout', {
        sessionToken: sessions[0]
      })

      // Should now be able to create new session
      const newSessionResult = await mockConvexBackend.mutation('auth:login', {
        email: testUser.email,
        password: 'password123!',
        deviceId: 'device-new'
      })

      expect(newSessionResult.success).toBe(true)
    })
  })

  describe('Authorization & Access Control', () => {
    it('should enforce proper authorization for user data access', async () => {
      const user1 = createTestUser({ email: 'user1@coachup.example.com' })
      const user2 = createTestUser({ email: 'user2@coachup.example.com' })

      await mockConvexBackend.seedUser(user1)
      await mockConvexBackend.seedUser(user2)

      // Login both users
      const login1 = await mockConvexBackend.mutation('auth:login', {
        email: user1.email,
        password: 'password123!'
      })
      const login2 = await mockConvexBackend.mutation('auth:login', {
        email: user2.email,
        password: 'password123!'
      })

      // User 1 tries to access User 2's data
      const unauthorizedAccess = await mockConvexBackend.query('users:getProfile', {
        userId: user2.id,
        sessionToken: login1.sessionToken
      })

      expect(unauthorizedAccess).toBeNull()

      // User 1 tries to modify User 2's data
      const unauthorizedModify = await mockConvexBackend.mutation('users:updateProfile', {
        userId: user2.id,
        goals: ['hacked goals'],
        sessionToken: login1.sessionToken
      })

      expect(unauthorizedModify.success).toBe(false)
      expect(unauthorizedModify.error).toContain('unauthorized')

      // User 1 can access their own data
      const authorizedAccess = await mockConvexBackend.query('users:getProfile', {
        userId: user1.id,
        sessionToken: login1.sessionToken
      })

      expect(authorizedAccess).toBeDefined()
      expect(authorizedAccess.email).toBe(user1.email)
    })

    it('should handle role-based access control for admin features', async () => {
      const regularUser = createTestUser({ email: 'regular@coachup.example.com' })
      const adminUser = createTestUser({
        email: 'admin@coachup.example.com',
        role: 'admin'
      })

      await mockConvexBackend.seedUser(regularUser)
      await mockConvexBackend.seedUser(adminUser)

      // Login both users
      const regularLogin = await mockConvexBackend.mutation('auth:login', {
        email: regularUser.email,
        password: 'password123!'
      })
      const adminLogin = await mockConvexBackend.mutation('auth:login', {
        email: adminUser.email,
        password: 'password123!'
      })

      // Regular user tries to access admin-only features
      const adminFeatureAccess = await mockConvexBackend.query('admin:getSystemStats', {
        sessionToken: regularLogin.sessionToken
      })

      expect(adminFeatureAccess).toBeNull()

      // Admin can access admin features
      const adminAccess = await mockConvexBackend.query('admin:getSystemStats', {
        sessionToken: adminLogin.sessionToken
      })

      expect(adminAccess).toBeDefined()
      expect(adminAccess.userCount).toBeDefined()
      expect(adminAccess.sessionCount).toBeDefined()

      // Admin can modify system settings
      const adminModify = await mockConvexBackend.mutation('admin:updateSystemSettings', {
        settings: { maintenanceMode: false },
        sessionToken: adminLogin.sessionToken
      })

      expect(adminModify.success).toBe(true)
    })

    it('should handle expired sessions and token refresh', async () => {
      const testUser = createTestUser({ email: 'sessionuser@coachup.example.com' })
      await mockConvexBackend.seedUser(testUser)

      // Login and get session
      const loginResult = await mockConvexBackend.mutation('auth:login', {
        email: testUser.email,
        password: 'password123!'
      })

      const sessionToken = loginResult.sessionToken

      // Simulate session expiration by setting short expiry
      mockConvexBackend.expireSession(sessionToken)

      // Try to access with expired session
      const expiredAccess = await mockConvexBackend.query('users:getProfile', {
        userId: testUser.id,
        sessionToken
      })

      expect(expiredAccess).toBeNull()

      // Try to refresh expired session
      const refreshExpired = await mockConvexBackend.mutation('auth:refreshSession', {
        sessionToken
      })

      expect(refreshExpired.success).toBe(false)
      expect(refreshExpired.error).toContain('expired')

      // User needs to login again
      const reLogin = await mockConvexBackend.mutation('auth:login', {
        email: testUser.email,
        password: 'password123!'
      })

      expect(reLogin.success).toBe(true)

      // New session should work
      const newAccess = await mockConvexBackend.query('users:getProfile', {
        userId: testUser.id,
        sessionToken: reLogin.sessionToken
      })

      expect(newAccess).toBeDefined()
    })
  })

  describe('Security Integration', () => {
    it('should implement rate limiting for authentication endpoints', async () => {
      const testUser = createTestUser({ email: 'ratelimit@coachup.example.com' })
      await mockConvexBackend.seedUser(testUser)

      // Simulate multiple rapid login attempts
      const attempts = []
      const maxAttempts = 10

      for (let i = 0; i < maxAttempts; i++) {
        const attempt = await mockConvexBackend.mutation('auth:login', {
          email: testUser.email,
          password: `password${i}`,
          ipAddress: '192.168.1.100'
        })
        attempts.push(attempt)
      }

      // Count successful and rate-limited attempts
      const successfulAttempts = attempts.filter(a => a.success).length
      const rateLimitedAttempts = attempts.filter(a => a.error && a.error.includes('rate limit')).length

      expect(successfulAttempts).toBeLessThan(maxAttempts)
      expect(rateLimitedAttempts).toBeGreaterThan(0)

      // Verify rate limit headers are present
      const lastAttempt = attempts[attempts.length - 1]
      if (lastAttempt.error && lastAttempt.error.includes('rate limit')) {
        expect(lastAttempt.retryAfter).toBeDefined()
        expect(lastAttempt.retryAfter).toBeGreaterThan(0)
      }
    })

    it('should handle password reset flow securely', async () => {
      const testUser = createTestUser({ email: 'resetuser@coachup.example.com' })
      await mockConvexBackend.seedUser(testUser)

      // 1. Request password reset
      const resetRequest = await mockConvexBackend.mutation('auth:requestPasswordReset', {
        email: testUser.email
      })

      expect(resetRequest.success).toBe(true)
      expect(resetRequest.resetToken).toBeDefined()
      const resetToken = resetRequest.resetToken

      // 2. Verify reset token is valid
      const tokenValidation = await mockConvexBackend.query('auth:validateResetToken', {
        resetToken
      })

      expect(tokenValidation.valid).toBe(true)
      expect(tokenValidation.userId).toBe(testUser.id)

      // 3. Reset password with token
      const newPassword = 'newSecurePassword456!'
      const passwordReset = await mockConvexBackend.mutation('auth:resetPassword', {
        resetToken,
        newPassword
      })

      expect(passwordReset.success).toBe(true)

      // 4. Verify old password no longer works
      const oldPasswordLogin = await mockConvexBackend.mutation('auth:login', {
        email: testUser.email,
        password: 'oldPassword123!'
      })

      expect(oldPasswordLogin.success).toBe(false)

      // 5. Verify new password works
      const newPasswordLogin = await mockConvexBackend.mutation('auth:login', {
        email: testUser.email,
        password: newPassword
      })

      expect(newPasswordLogin.success).toBe(true)

      // 6. Verify reset token is invalidated after use
      const reuseToken = await mockConvexBackend.mutation('auth:resetPassword', {
        resetToken,
        newPassword: 'anotherPassword789!'
      })

      expect(reuseToken.success).toBe(false)
      expect(reuseToken.error).toContain('invalid')
    })

    it('should handle account lockout and recovery', async () => {
      const testUser = createTestUser({ email: 'lockout@coachup.example.com' })
      await mockConvexBackend.seedUser(testUser)

      // Simulate multiple failed login attempts
      const failedAttempts = 5
      for (let i = 0; i < failedAttempts; i++) {
        await mockConvexBackend.mutation('auth:login', {
          email: testUser.email,
          password: 'wrongPassword'
        })
      }

      // Account should be locked
      const lockoutCheck = await mockConvexBackend.query('auth:checkLockout', {
        email: testUser.email
      })

      expect(lockoutCheck.locked).toBe(true)
      expect(lockoutCheck.unlockTime).toBeDefined()

      // Attempts during lockout should fail
      const lockedLogin = await mockConvexBackend.mutation('auth:login', {
        email: testUser.email,
        password: 'correctPassword123!'
      })

      expect(lockedLogin.success).toBe(false)
      expect(lockedLogin.error).toContain('locked')

      // Simulate time passing (lockout expiry)
      mockConvexBackend.advanceTime(lockoutCheck.unlockTime - Date.now() + 1000)

      // Account should be unlocked
      const unlockedCheck = await mockConvexBackend.query('auth:checkLockout', {
        email: testUser.email
      })

      expect(unlockedCheck.locked).toBe(false)

      // Login should now work
      const successfulLogin = await mockConvexBackend.mutation('auth:login', {
        email: testUser.email,
        password: 'correctPassword123!'
      })

      expect(successfulLogin.success).toBe(true)
    })
  })
})
