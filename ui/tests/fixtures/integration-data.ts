/**
 * Comprehensive test data fixtures for integration tests
 * Based on Stream 4 Integration Tests breakdown
 */

export interface TestUser {
  id: string
  email: string
  goals: string[]
  profile: {
    name: string
    experience: string
    industry: string
  }
}

export interface TestSession {
  id: string
  userId: string
  createdAt: Date
  status: 'active' | 'completed' | 'failed'
  metadata: Record<string, any>
}

export interface TestAssessment {
  id: string
  sessionId: string
  userId: string
  skillAssessments: SkillAssessment[]
  overallScore: number
  feedback: string
  createdAt: Date
}

export interface SkillAssessment {
  skillId: string
  skillName: string
  score: number // 0-1
  confidence: number // 0-1
  highlights: string[]
  recommendations: string[]
  improvement: number // percentage improvement from baseline
}

export interface TestAudioFile {
  name: string
  path: string
  content: Uint8Array
  duration: number // seconds
  transcript: string
}

export interface TestTranscript {
  id: string
  sessionId: string
  text: string
  confidence: number
  language: string
  createdAt: Date
}

// Test Users
export const testUsers: TestUser[] = [
  {
    id: 'user-integration-1',
    email: 'alice.coachup@example.com',
    goals: ['improve presentation skills', 'build confidence in meetings'],
    profile: {
      name: 'Alice Johnson',
      experience: 'Mid-level manager',
      industry: 'Technology'
    }
  },
  {
    id: 'user-integration-2',
    email: 'bob.coachup@example.com',
    goals: ['enhance communication skills', 'reduce filler words'],
    profile: {
      name: 'Bob Smith',
      experience: 'Sales representative',
      industry: 'Finance'
    }
  }
]

// Test Audio Files (simulated)
export const testAudioFiles: Record<string, TestAudioFile> = {
  'presentation-sample.wav': {
    name: 'presentation-sample.wav',
    path: '/test/audio/presentation-sample.wav',
    content: new Uint8Array([1, 2, 3, 4, 5]), // Mock content
    duration: 45,
    transcript: 'I am excited to present our quarterly results to the team today. We have achieved significant growth in our key metrics.'
  },
  'conversation-sample.wav': {
    name: 'conversation-sample.wav',
    path: '/test/audio/conversation-sample.wav',
    content: new Uint8Array([6, 7, 8, 9, 10]),
    duration: 32,
    transcript: 'Hello, how are you today? I hope you are doing well. I wanted to discuss our upcoming project timeline.'
  },
  'practice-session-1.wav': {
    name: 'practice-session-1.wav',
    path: '/test/audio/practice-session-1.wav',
    content: new Uint8Array([11, 12, 13, 14, 15]),
    duration: 60,
    transcript: 'Good morning everyone. Today I will be presenting our new product strategy and the roadmap for the next quarter.'
  },
  'practice-session-2.wav': {
    name: 'practice-session-2.wav',
    path: '/test/audio/practice-session-2.wav',
    content: new Uint8Array([16, 17, 18, 19, 20]),
    duration: 55,
    transcript: 'Thank you for joining this meeting. Let me walk you through the key points of our proposal.'
  }
}

// Expected Assessment Results
export const expectedAssessmentResults = {
  presentation: {
    clarity: 0.85,
    confidence: 0.78,
    engagement: 0.82,
    empathy: 0.75,
    activeListening: 0.70
  },
  conversation: {
    empathy: 0.90,
    clarity: 0.75,
    activeListening: 0.85,
    confidence: 0.80,
    engagement: 0.88
  },
  feedback: {
    clarity: 0.82,
    confidence: 0.85,
    empathy: 0.95,
    activeListening: 0.92,
    engagement: 0.90
  }
}

// Test Sessions
export const testSessions: TestSession[] = [
  {
    id: 'session-integration-1',
    userId: 'user-integration-1',
    createdAt: new Date('2024-01-15T10:00:00Z'),
    status: 'active',
    metadata: {
      type: 'presentation',
      duration: 45,
      goals: ['presentation skills']
    }
  },
  {
    id: 'session-integration-2',
    userId: 'user-integration-2',
    createdAt: new Date('2024-01-15T11:00:00Z'),
    status: 'completed',
    metadata: {
      type: 'conversation',
      duration: 32,
      goals: ['communication skills']
    }
  }
]

// Test Assessments
export const testAssessments: TestAssessment[] = [
  {
    id: 'assessment-integration-1',
    sessionId: 'session-integration-1',
    userId: 'user-integration-1',
    skillAssessments: [
      {
        skillId: 'clarity',
        skillName: 'Clarity',
        score: 0.85,
        confidence: 0.90,
        highlights: ['Clear introduction', 'Well-structured content'],
        recommendations: ['Practice transitions', 'Use more visual aids'],
        improvement: 0.15
      },
      {
        skillId: 'confidence',
        skillName: 'Confidence',
        score: 0.78,
        confidence: 0.85,
        highlights: ['Good eye contact', 'Strong voice projection'],
        recommendations: ['Reduce filler words', 'Practice breathing techniques'],
        improvement: 0.22
      }
    ],
    overallScore: 0.82,
    feedback: 'Great presentation with room for improvement in delivery confidence.',
    createdAt: new Date('2024-01-15T10:45:00Z')
  }
]

// Test Transcripts
export const testTranscripts: Record<string, TestTranscript> = {
  presentation: {
    id: 'transcript-presentation-1',
    sessionId: 'session-integration-1',
    text: 'I am excited to present our quarterly results to the team today. We have achieved significant growth in our key metrics.',
    confidence: 0.95,
    language: 'en',
    createdAt: new Date('2024-01-15T10:02:00Z')
  },
  conversation: {
    id: 'transcript-conversation-1',
    sessionId: 'session-integration-2',
    text: 'Hello, how are you today? I hope you are doing well. I wanted to discuss our upcoming project timeline.',
    confidence: 0.92,
    language: 'en',
    createdAt: new Date('2024-01-15T11:02:00Z')
  },
  feedback: {
    id: 'transcript-feedback-1',
    sessionId: 'session-integration-1',
    text: 'I appreciate your detailed feedback on my presentation. This will help me improve significantly.',
    confidence: 0.98,
    language: 'en',
    createdAt: new Date('2024-01-15T10:50:00Z')
  }
}

// Helper functions for test setup
export function createTestUser(overrides: Partial<TestUser> = {}): TestUser {
  return {
    id: `user-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    email: `test-${Date.now()}@example.com`,
    goals: ['improve communication skills'],
    profile: {
      name: 'Test User',
      experience: 'Professional',
      industry: 'Technology'
    },
    ...overrides
  }
}

export function createTestSession(userId: string, overrides: Partial<TestSession> = {}): TestSession {
  return {
    id: `session-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    userId,
    createdAt: new Date(),
    status: 'active',
    metadata: {},
    ...overrides
  }
}

export function createTestAssessment(sessionId: string, userId: string, overrides: Partial<TestAssessment> = {}): TestAssessment {
  return {
    id: `assessment-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    sessionId,
    userId,
    skillAssessments: [],
    overallScore: 0.75,
    feedback: 'Good performance with areas for improvement.',
    createdAt: new Date(),
    ...overrides
  }
}
