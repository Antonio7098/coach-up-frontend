/**
 * Mock services for integration tests
 * Provides reliable simulation of external dependencies
 */

import { vi } from 'vitest'
import {
  TestUser,
  TestSession,
  TestAssessment,
  SkillAssessment,
  TestTranscript
} from '../fixtures/integration-data'

// Mock AI API Service
export class MockAIAPI {
  private assessments: Map<string, TestAssessment> = new Map()
  private transcripts: Map<string, TestTranscript> = new Map()

  constructor() {
    this.setupDefaultData()
  }

  private setupDefaultData() {
    // Setup default mock data
    this.assessments.set('session-integration-1', {
      id: 'assessment-mock-1',
      sessionId: 'session-integration-1',
      userId: 'user-integration-1',
      skillAssessments: [
        {
          skillId: 'clarity',
          skillName: 'Clarity',
          score: 0.85,
          confidence: 0.90,
          highlights: ['Clear structure', 'Good pacing'],
          recommendations: ['More pauses', 'Practice transitions'],
          improvement: 0.15
        },
        {
          skillId: 'confidence',
          skillName: 'Confidence',
          score: 0.78,
          confidence: 0.85,
          highlights: ['Strong voice', 'Good posture'],
          recommendations: ['Reduce filler words', 'Eye contact'],
          improvement: 0.22
        }
      ],
      overallScore: 0.82,
      feedback: 'Strong presentation with room for confidence improvement.',
      createdAt: new Date()
    })
  }

  async assess(transcript: string, skills: string[] = ['clarity', 'confidence', 'empathy']): Promise<{
    skillAssessments: SkillAssessment[]
    meta: {
      processingTime: number
      model: string
      confidence: number
    }
  }> {
    // Simulate realistic API response time (100-200ms)
    await new Promise(resolve => setTimeout(resolve, 100 + Math.random() * 100))

    const skillAssessments: SkillAssessment[] = skills.map(skillId => ({
      skillId,
      skillName: skillId.charAt(0).toUpperCase() + skillId.slice(1),
      score: 0.7 + Math.random() * 0.3, // 0.7-1.0
      confidence: 0.8 + Math.random() * 0.2, // 0.8-1.0
      highlights: [
        'Good example of ' + skillId,
        'Clear improvement area',
        'Strong foundation'
      ],
      recommendations: [
        'Practice more consistently',
        'Focus on key techniques',
        'Seek feedback regularly'
      ],
      improvement: Math.random() * 0.3 // 0-30% improvement
    }))

    return {
      skillAssessments,
      meta: {
        processingTime: 150 + Math.random() * 50,
        model: 'gpt-4-mock',
        confidence: 0.85 + Math.random() * 0.1
      }
    }
  }

  async transcribe(audioData: Uint8Array, language: string = 'en'): Promise<{
    text: string
    confidence: number
    duration: number
  }> {
    // Simulate STT processing time
    await new Promise(resolve => setTimeout(resolve, 200 + Math.random() * 300))

    return {
      text: 'This is a mock transcript from the audio file. It contains sample text for testing purposes.',
      confidence: 0.92 + Math.random() * 0.08,
      duration: audioData.length / 16000 // Assume 16kHz sample rate
    }
  }

  async generateSpeech(text: string, voice: string = 'professional-female'): Promise<{
    audioUrl: string
    duration: number
  }> {
    // Simulate TTS processing time
    await new Promise(resolve => setTimeout(resolve, 150 + Math.random() * 200))

    return {
      audioUrl: 'https://mock-storage.example.com/audio/generated-speech.mp3',
      duration: text.length * 0.1 // Rough estimate: 100ms per character
    }
  }
}

// Mock Convex Backend
export class MockConvexBackend {
  private data: Map<string, any> = new Map()
  private subscriptions: Map<string, Set<(data: any) => void>> = new Map()

  constructor() {
    this.setupDefaultData()
  }

  private setupDefaultData() {
    // Setup default user and session data
    this.data.set('users:get:user-integration-1', {
      id: 'user-integration-1',
      email: 'alice@example.com',
      goals: ['improve presentation skills']
    })

    this.data.set('sessions:get:session-integration-1', {
      id: 'session-integration-1',
      userId: 'user-integration-1',
      status: 'active',
      createdAt: new Date().toISOString()
    })
  }

  async mutation(path: string, args: any): Promise<{ success: boolean }> {
    // Simulate database operation time
    await new Promise(resolve => setTimeout(resolve, 20 + Math.random() * 30))

    const key = `${path}:${JSON.stringify(args)}`
    this.data.set(key, { ...args, timestamp: Date.now() })

    // Notify subscribers if this affects any subscriptions
    this.notifySubscribers(path, args)

    return { success: true }
  }

  async query(path: string, args: any): Promise<any> {
    await new Promise(resolve => setTimeout(resolve, 10 + Math.random() * 20))

    const key = `${path}:${JSON.stringify(args)}`
    return this.data.get(key) || null
  }

  subscribe(path: string, args: any, callback: (data: any) => void): () => void {
    const key = `${path}:${JSON.stringify(args)}`

    if (!this.subscriptions.has(key)) {
      this.subscriptions.set(key, new Set())
    }

    this.subscriptions.get(key)!.add(callback)

    // Return unsubscribe function
    return () => {
      const subs = this.subscriptions.get(key)
      if (subs) {
        subs.delete(callback)
        if (subs.size === 0) {
          this.subscriptions.delete(key)
        }
      }
    }
  }

  private notifySubscribers(path: string, data: any) {
    // Find all subscription keys that match this path
    for (const [key, callbacks] of this.subscriptions.entries()) {
      if (key.startsWith(path)) {
        callbacks.forEach(callback => callback(data))
      }
    }
  }

  // Helper methods for test setup
  async seedUser(user: TestUser) {
    await this.mutation('users:create', user)
  }

  async seedSession(session: TestSession) {
    await this.mutation('sessions:create', session)
  }

  async seedAssessment(assessment: TestAssessment) {
    await this.mutation('assessments:create', assessment)
  }

  clearData() {
    this.data.clear()
    this.subscriptions.clear()
    this.setupDefaultData()
  }
}

// Mock Storage Service (S3/LocalStack)
export class MockStorageService {
  private files: Map<string, { content: Uint8Array, metadata: any }> = new Map()

  async uploadFile(key: string, content: Uint8Array, metadata: any = {}): Promise<{ key: string, url: string }> {
    await new Promise(resolve => setTimeout(resolve, 50 + Math.random() * 100))

    this.files.set(key, { content, metadata })

    return {
      key,
      url: `https://mock-storage.example.com/${key}`
    }
  }

  async downloadFile(key: string): Promise<Uint8Array> {
    await new Promise(resolve => setTimeout(resolve, 30 + Math.random() * 50))

    const file = this.files.get(key)
    if (!file) {
      throw new Error(`File not found: ${key}`)
    }

    return file.content
  }

  async generatePresignedUrl(key: string, operation: 'GET' | 'PUT' = 'GET'): Promise<string> {
    return `https://mock-storage.example.com/${key}?presigned=true&op=${operation}`
  }

  clearFiles() {
    this.files.clear()
  }
}

// Mock WebSocket for real-time features
export class MockWebSocketService {
  private connections: Set<WebSocket> = new Set()
  private messageHandlers: Map<string, (data: any) => void> = new Map()

  connect(url: string): WebSocket {
    const mockWS = {
      send: (data: string) => {
        // Simulate sending message
        setTimeout(() => {
          const handler = this.messageHandlers.get('message')
          if (handler) {
            handler(JSON.parse(data))
          }
        }, 10)
      },
      close: () => {
        this.connections.delete(mockWS as any)
      },
      addEventListener: (event: string, handler: (event: any) => void) => {
        this.messageHandlers.set(event, handler)
      },
      removeEventListener: (event: string, handler: (event: any) => void) => {
        this.messageHandlers.delete(event)
      },
      readyState: 1, // OPEN
      onopen: null,
      onmessage: null,
      onclose: null,
      onerror: null
    } as any

    this.connections.add(mockWS)
    return mockWS
  }

  broadcast(message: any) {
    this.connections.forEach(ws => {
      const handler = this.messageHandlers.get('message')
      if (handler) {
        handler({ data: JSON.stringify(message) })
      }
    })
  }

  disconnectAll() {
    this.connections.clear()
    this.messageHandlers.clear()
  }
}

// Global mock instances for tests
export const mockAIAPI = new MockAIAPI()
export const mockConvexBackend = new MockConvexBackend()
export const mockStorageService = new MockStorageService()
export const mockWebSocketService = new MockWebSocketService()

// Helper to setup all mocks for integration tests
export function setupIntegrationMocks() {
  // Mock fetch for API calls
  const originalFetch = global.fetch
  global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString()

    // Mock AI API endpoints
    if (url.includes('/api/assessments/')) {
      const response = await mockAIAPI.assess('mock transcript', ['clarity', 'confidence'])
      return new Response(JSON.stringify(response), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })
    }

    // Mock Convex endpoints
    if (url.includes('/api/convex/')) {
      // Simulate Convex API responses
      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })
    }

    // Fall back to original fetch for other calls
    return originalFetch(input, init)
  })

  return () => {
    global.fetch = originalFetch
  }
}

// Cleanup function
export function cleanupIntegrationMocks() {
  mockConvexBackend.clearData()
  mockStorageService.clearFiles()
  mockWebSocketService.disconnectAll()
  vi.restoreAllMocks()
}
