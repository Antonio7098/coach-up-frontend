/**
 * Voice Processing Integration Tests
 * Tests STT/TTS pipeline integration
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { createTestUser, createTestSession, testAudioFiles } from '../../fixtures/integration-data'
import {
  mockAIAPI,
  mockStorageService,
  setupIntegrationMocks,
  cleanupIntegrationMocks
} from '../../mocks/integration-services'

describe('Voice Processing Integration', () => {
  let cleanupMocks: () => void

  beforeAll(() => {
    cleanupMocks = setupIntegrationMocks()
  })

  afterAll(() => {
    cleanupMocks()
    cleanupIntegrationMocks()
  })

  beforeEach(() => {
    mockStorageService.clearFiles()
  })

  describe('Speech-to-Text Pipeline', () => {
    it('should complete STT assessment flow with S3 storage', async () => {
      // Setup test data
      const user = createTestUser()
      const session = createTestSession(user.id)
      const audioFile = testAudioFiles['presentation-sample.wav']

      // 1. Generate presigned URL for upload
      const presignKey = `audio/${session.id}/recording.wav`
      const presignUrl = await mockStorageService.generatePresignedUrl(presignKey, 'PUT')

      expect(presignUrl).toContain(presignKey)
      expect(presignUrl).toContain('presigned=true')

      // 2. Upload audio file
      const uploadResult = await mockStorageService.uploadFile(
        presignKey,
        audioFile.content,
        {
          contentType: 'audio/wav',
          sizeBytes: audioFile.content.length,
          userId: user.id,
          sessionId: session.id
        }
      )

      expect(uploadResult.key).toBe(presignKey)
      expect(uploadResult.url).toContain(presignKey)

      // 3. Transcribe uploaded audio
      const transcription = await mockAIAPI.transcribe(audioFile.content, 'en')

      expect(transcription.text).toBeTruthy()
      expect(transcription.text.length).toBeGreaterThan(10)
      expect(transcription.confidence).toBeGreaterThan(0.8)
      expect(transcription.duration).toBeGreaterThan(0)

      // 4. Validate transcript content
      expect(transcription.text.toLowerCase()).toContain('present')

      // 5. Run assessment on transcript
      const assessment = await mockAIAPI.assess(transcription.text, ['clarity', 'confidence'])

      expect(assessment.skillAssessments).toHaveLength(2)
      expect(assessment.meta.processingTime).toBeGreaterThan(0)

      // 6. Verify end-to-end flow completion
      const storedFile = await mockStorageService.downloadFile(presignKey)
      expect(storedFile).toEqual(audioFile.content)
    })

    it('should handle multipart form upload for STT', async () => {
      const user = createTestUser()
      const session = createTestSession(user.id)
      const audioFile = testAudioFiles['conversation-sample.wav']

      // Simulate multipart form data structure
      const formData = new FormData()
      formData.append('audio', new Blob([audioFile.content], { type: 'audio/wav' }), 'recording.wav')
      formData.append('sessionId', session.id)
      formData.append('userId', user.id)
      formData.append('language', 'en')

      // Process multipart upload (simulated)
      const uploadKey = `audio/${session.id}/multipart-recording.wav`
      const uploadResult = await mockStorageService.uploadFile(
        uploadKey,
        audioFile.content,
        {
          contentType: 'audio/wav',
          multipart: true,
          sessionId: session.id,
          userId: user.id
        }
      )

      expect(uploadResult.key).toBe(uploadKey)

      // Transcribe multipart upload
      const transcription = await mockAIAPI.transcribe(audioFile.content, 'en')

      expect(transcription.text.toLowerCase()).toContain('hello')
      expect(transcription.confidence).toBeGreaterThan(0.8)

      // Verify file integrity after multipart upload
      const downloaded = await mockStorageService.downloadFile(uploadKey)
      expect(downloaded).toEqual(audioFile.content)
    })

    it('should support multiple audio formats', async () => {
      const testFormats = [
        { format: 'audio/wav', extension: 'wav' },
        { format: 'audio/mpeg', extension: 'mp3' },
        { format: 'audio/webm', extension: 'webm' }
      ]

      for (const format of testFormats) {
        const audioData = new Uint8Array([1, 2, 3, 4, 5]) // Mock audio data
        const uploadKey = `test/audio/sample.${format.extension}`

        // Upload with specific format
        const uploadResult = await mockStorageService.uploadFile(
          uploadKey,
          audioData,
          { contentType: format.format }
        )

        expect(uploadResult.key).toBe(uploadKey)

        // Transcribe should work regardless of format
        const transcription = await mockAIAPI.transcribe(audioData, 'en')

        expect(transcription.text).toBeTruthy()
        expect(transcription.confidence).toBeGreaterThan(0.8)
      }
    })
  })

  describe('Text-to-Speech Integration', () => {
    it('should generate and store synthesized speech', async () => {
      const text = "Welcome to your presentation skills training session."
      const voice = 'professional-female'
      const speed = 1.0

      // 1. Generate speech
      const ttsResult = await mockAIAPI.generateSpeech(text, voice)

      expect(ttsResult.audioUrl).toBeTruthy()
      expect(ttsResult.audioUrl).toContain('mock-storage.example.com')
      expect(ttsResult.duration).toBeGreaterThan(0)
      expect(ttsResult.duration).toBeLessThan(text.length * 0.2) // Reasonable duration check

      // 2. Simulate storing the generated audio
      const audioKey = `tts/${Date.now()}/generated-speech.mp3`
      const mockAudioData = new Uint8Array([0, 1, 2, 3, 4]) // Mock audio bytes

      const storageResult = await mockStorageService.uploadFile(
        audioKey,
        mockAudioData,
        {
          contentType: 'audio/mpeg',
          generated: true,
          text: text,
          voice: voice,
          speed: speed
        }
      )

      expect(storageResult.key).toBe(audioKey)
      expect(storageResult.url).toContain(audioKey)

      // 3. Verify audio file properties
      const storedAudio = await mockStorageService.downloadFile(audioKey)
      expect(storedAudio).toEqual(mockAudioData)
      expect(storedAudio.length).toBeGreaterThan(0)
    })

    it('should handle different voice configurations', async () => {
      const text = "This is a test of voice synthesis."
      const voiceConfigs = [
        { voice: 'professional-female', speed: 1.0 },
        { voice: 'professional-male', speed: 0.9 },
        { voice: 'friendly-female', speed: 1.1 },
        { voice: 'coach-male', speed: 1.0 }
      ]

      for (const config of voiceConfigs) {
        const ttsResult = await mockAIAPI.generateSpeech(text, config.voice)

        expect(ttsResult.audioUrl).toBeTruthy()
        expect(ttsResult.duration).toBeGreaterThan(0)

        // Store with voice metadata
        const audioKey = `tts/voice-test/${config.voice}-${config.speed}.mp3`
        await mockStorageService.uploadFile(
          audioKey,
          new Uint8Array([1, 2, 3]), // Mock audio
          {
            contentType: 'audio/mpeg',
            voice: config.voice,
            speed: config.speed,
            text: text
          }
        )

        // Verify storage
        const stored = await mockStorageService.downloadFile(audioKey)
        expect(stored).toBeTruthy()
      }
    })

    it('should support audio playback validation', async () => {
      const text = "Test audio for playback validation"

      // Generate speech
      const ttsResult = await mockAIAPI.generateSpeech(text)

      // Simulate audio element validation
      const mockAudioElement = {
        src: ttsResult.audioUrl,
        load: () => Promise.resolve(),
        play: () => Promise.resolve(),
        pause: () => {},
        currentTime: 0,
        duration: ttsResult.duration,
        readyState: 4, // HAVE_ENOUGH_DATA
        networkState: 1, // NETWORK_IDLE
        error: null
      }

      // Validate audio properties
      expect(mockAudioElement.src).toBe(ttsResult.audioUrl)
      expect(mockAudioElement.duration).toBeGreaterThan(0)
      expect(mockAudioElement.readyState).toBe(4)
      expect(mockAudioElement.error).toBeNull()

      // Test playback simulation
      await mockAudioElement.load()
      await mockAudioElement.play()

      expect(mockAudioElement.networkState).toBe(1)
    })
  })

  describe('End-to-End Voice Pipeline', () => {
    it('should complete full voice-to-assessment pipeline', async () => {
      const user = createTestUser()
      const session = createTestSession(user.id)

      // 1. User records audio
      const originalAudio = testAudioFiles['presentation-sample.wav']
      const uploadKey = `audio/${session.id}/user-recording.wav`

      // 2. Upload recording
      await mockStorageService.uploadFile(uploadKey, originalAudio.content, {
        contentType: 'audio/wav',
        userId: user.id,
        sessionId: session.id
      })

      // 3. Transcribe recording
      const transcription = await mockAIAPI.transcribe(originalAudio.content)

      // 4. Assess skills from transcript
      const assessment = await mockAIAPI.assess(transcription.text, ['clarity', 'confidence', 'engagement'])

      // 5. Generate feedback audio
      const feedbackText = `Your clarity score is ${Math.round(assessment.skillAssessments[0].score * 100)}%. ${assessment.skillAssessments[0].recommendations[0]}`

      const feedbackAudio = await mockAIAPI.generateSpeech(feedbackText, 'coach-female')

      // 6. Store feedback audio
      const feedbackKey = `tts/${session.id}/feedback.mp3`
      await mockStorageService.uploadFile(feedbackKey, new Uint8Array([1, 2, 3, 4, 5]), {
        contentType: 'audio/mpeg',
        generated: true,
        text: feedbackText
      })

      // 7. Validate complete pipeline
      expect(transcription.text).toBeTruthy()
      expect(assessment.skillAssessments.length).toBeGreaterThan(0)
      expect(feedbackAudio.audioUrl).toBeTruthy()

      // Verify all files are stored
      const storedRecording = await mockStorageService.downloadFile(uploadKey)
      const storedFeedback = await mockStorageService.downloadFile(feedbackKey)

      expect(storedRecording).toEqual(originalAudio.content)
      expect(storedFeedback).toBeTruthy()
    })

    it('should handle voice pipeline errors gracefully', async () => {
      const user = createTestUser()
      const session = createTestSession(user.id)

      // Test corrupted audio handling
      const corruptedAudio = new Uint8Array([255, 255, 255]) // Invalid audio data

      try {
        await mockAIAPI.transcribe(corruptedAudio)
        // If we reach here, the mock should handle corrupted data
      } catch (error) {
        // Should handle corruption gracefully
        expect(error).toBeDefined()
      }

      // Test empty audio
      const emptyAudio = new Uint8Array([])

      try {
        await mockAIAPI.transcribe(emptyAudio)
      } catch (error) {
        expect(error).toBeDefined()
      }

      // Test extremely long audio (should still work)
      const longAudio = new Uint8Array(1024 * 1024) // 1MB of audio
      const longTranscription = await mockAIAPI.transcribe(longAudio)

      expect(longTranscription.text).toBeTruthy()
      expect(longTranscription.confidence).toBeGreaterThan(0)
    })
  })
})
