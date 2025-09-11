# 🟢 **STREAM 4: New Feature Integration Tests** - Detailed Task Breakdown
*Priority: MEDIUM | Timeline: 4-6 days | Target: End-to-end validation of recent features*

## **🎯 Mission Overview**
Create comprehensive integration tests for recently added features including skill assessments, per-skill fanout, and cross-system interactions.

---

## **🔍 RECENT FEATURES ANALYSIS**

### **Major New Features (Last 6-12 months)**
1. **Per-Skill Assessment System** - Individual skill evaluation and tracking
2. **V2 Payload Format** - Enhanced assessment data structure
3. **Skill Fanout Processing** - Concurrent skill assessment execution
4. **Real-time Convex Integration** - Live database synchronization
5. **Voice Processing Pipeline** - Speech-to-text and text-to-speech
6. **Multi-Context Architecture** - Complex state management

### **Integration Points**
- AI API ↔ Frontend communication
- Database persistence ↔ Real-time updates
- Voice processing ↔ Assessment pipeline
- Skill tracking ↔ User progress

---

## **🚀 EXECUTION PLAN**

### **Day 1-2: Skill Assessment Integration** (8-10 hours)

#### **1.1 Per-Skill Assessment Flow**
**Test Scenario**: Complete skill assessment from recording to results

```typescript
// tests/integration/skill-assessment-flow.spec.ts
describe('Skill Assessment Integration', () => {
  test('complete skill assessment flow', async () => {
    // 1. Setup user session
    const { user, session } = await setupTestUser()

    // 2. Start voice recording
    await page.goto('/coach')
    await page.click('[data-testid="start-recording"]')
    await page.waitForSelector('[data-testid="recording-active"]')

    // 3. Simulate speech input
    await mockSpeechInput('I need to improve my presentation skills for the upcoming meeting')

    // 4. Stop recording and trigger assessment
    await page.click('[data-testid="stop-recording"]')
    await page.click('[data-testid="run-assessment"]')

    // 5. Wait for assessment completion
    await page.waitForSelector('[data-testid="assessment-complete"]')

    // 6. Validate results
    const clarityScore = await page.locator('[data-testid="clarity-score"]').textContent()
    const empathyScore = await page.locator('[data-testid="empathy-score"]').textContent()

    expect(parseFloat(clarityScore)).toBeGreaterThan(0)
    expect(parseFloat(empathyScore)).toBeGreaterThan(0)

    // 7. Validate persistence
    const savedAssessment = await convexClient.query('assessments:get', {
      sessionId: session.id
    })
    expect(savedAssessment.skillAssessments).toHaveLength(2)
  })
})
```

#### **1.2 Skill Tracking Integration**
```typescript
describe('Skill Tracking Integration', () => {
  test('skill progress tracking across sessions', async () => {
    const { user } = await setupTestUser()

    // Session 1: Initial assessment
    const session1 = await createSession(user.id)
    await runSkillAssessment(session1.id, {
      clarity: 0.6,
      empathy: 0.7,
      confidence: 0.5
    })

    // Session 2: Improved performance
    const session2 = await createSession(user.id)
    await runSkillAssessment(session2.id, {
      clarity: 0.8,
      empathy: 0.8,
      confidence: 0.7
    })

    // Validate progress tracking
    const progress = await convexClient.query('skills:getUserProgress', {
      userId: user.id
    })

    expect(progress.clarity.improvement).toBeGreaterThan(0)
    expect(progress.empathy.improvement).toBeGreaterThan(0)
    expect(progress.confidence.improvement).toBeGreaterThan(0)
  })
})
```

---

### **Day 3: Voice Processing Integration** (6-8 hours)

#### **2.1 Speech-to-Text Pipeline**
```typescript
// tests/integration/voice-processing.spec.ts
describe('Voice Processing Integration', () => {
  test('speech-to-text assessment flow', async () => {
    // Setup audio context
    await setupAudioContext()

    // Load test audio file
    const audioBlob = await loadTestAudio('presentation-sample.wav')

    // Upload and transcribe
    const uploadResponse = await page.request.post('/api/storage/audio/presign', {
      data: { filename: 'test.wav', contentType: 'audio/wav' }
    })

    const { uploadUrl, objectKey } = await uploadResponse.json()

    await page.request.put(uploadUrl, {
      data: audioBlob,
      headers: { 'Content-Type': 'audio/wav' }
    })

    // Transcribe audio
    const transcriptResponse = await page.request.post('/api/stt', {
      data: { objectKey, language: 'en' }
    })

    const { transcript, confidence } = await transcriptResponse.json()

    expect(transcript).toContain('presentation')
    expect(confidence).toBeGreaterThan(0.8)

    // Run assessment on transcript
    const assessmentResponse = await page.request.post('/api/assessments/run', {
      data: { sessionId: 'test-session', transcript }
    })

    expect(assessmentResponse.status()).toBe(200)
  })
})
```

#### **2.2 Text-to-Speech Integration**
```typescript
describe('Text-to-Speech Integration', () => {
  test('generated speech playback', async () => {
    const text = "Welcome to your presentation skills training"

    // Generate speech
    const ttsResponse = await page.request.post('/api/tts', {
      data: {
        text,
        voice: 'professional-female',
        speed: 1.0
      }
    })

    const { audioUrl } = await ttsResponse.json()

    // Validate audio file
    const audioResponse = await page.request.get(audioUrl)
    expect(audioResponse.status()).toBe(200)

    const audioBlob = await audioResponse.body()
    expect(audioBlob.length).toBeGreaterThan(1000) // Reasonable audio file size

    // Test audio playback in browser
    await page.evaluate(async (url) => {
      const audio = new Audio(url)
      return new Promise((resolve) => {
        audio.onloadeddata = () => resolve(audio.duration)
        audio.onerror = () => resolve(0)
      })
    }, audioUrl).then(duration => {
      expect(duration).toBeGreaterThan(2) // At least 2 seconds
    })
  })
})
```

---

### **Day 4: Real-time Data Integration** (6-8 hours)

#### **3.1 Convex Real-time Synchronization**
```typescript
// tests/integration/convex-realtime.spec.ts
describe('Convex Real-time Integration', () => {
  test('live assessment updates', async () => {
    const { user, session } = await setupTestUser()

    // Subscribe to assessment updates
    const assessmentPromise = new Promise((resolve) => {
      const unsubscribe = convexClient.subscribe('assessments:watch', {
        sessionId: session.id
      }, (assessment) => {
        if (assessment.status === 'completed') {
          unsubscribe()
          resolve(assessment)
        }
      })
    })

    // Trigger assessment
    await page.click('[data-testid="run-assessment"]')

    // Wait for real-time update
    const assessment = await assessmentPromise

    expect(assessment.status).toBe('completed')
    expect(assessment.skillAssessments).toBeDefined()
    expect(assessment.skillAssessments.length).toBeGreaterThan(0)
  })
})
```

#### **3.2 Cross-tab Synchronization**
```typescript
describe('Cross-tab Synchronization', () => {
  test('assessment state sync across tabs', async () => {
    const { user, session } = await setupTestUser()

    // Open first tab
    const page1 = await browser.newPage()
    await page1.goto('/coach')

    // Start assessment in first tab
    await page1.click('[data-testid="start-recording"]')

    // Open second tab
    const page2 = await browser.newPage()
    await page2.goto('/coach')

    // Wait for state synchronization
    await page2.waitForSelector('[data-testid="recording-active"]')

    // Verify both tabs show same state
    const page1State = await page1.locator('[data-testid="recording-status"]').textContent()
    const page2State = await page2.locator('[data-testid="recording-status"]').textContent()

    expect(page1State).toBe(page2State)
    expect(page1State).toBe('Recording...')

    // Stop recording in first tab
    await page1.click('[data-testid="stop-recording"]')

    // Verify sync in second tab
    await page2.waitForSelector('[data-testid="recording-stopped"]')
  })
})
```

---

### **Day 5-6: End-to-End User Journeys** (8-10 hours)

#### **4.1 Complete Coaching Session**
```typescript
// tests/integration/complete-coaching-journey.spec.ts
describe('Complete Coaching Journey', () => {
  test('full user coaching experience', async () => {
    // 1. User Registration & Onboarding
    const user = await createTestUser({
      goals: ['improve presentation skills', 'build confidence']
    })

    // 2. Initial Assessment
    await page.goto('/coach')
    await completeVoiceAssessment('presentation-introduction.wav')
    const baselineScores = await getAssessmentScores()

    // 3. Personalized Coaching Plan
    const coachingPlan = await convexClient.query('goals:getCoachingPlan', {
      userId: user.id
    })
    expect(coachingPlan.skills).toContain('presentation')
    expect(coachingPlan.duration).toBeGreaterThan(7) // At least 1 week

    // 4. Practice Sessions
    for (let i = 0; i < 3; i++) {
      await runPracticeSession(`practice-session-${i}.wav`)
      const progressScores = await getAssessmentScores()

      // Validate improvement
      expect(progressScores.clarity).toBeGreaterThan(baselineScores.clarity - 0.1)
    }

    // 5. Progress Tracking
    const progressReport = await convexClient.query('progress:getReport', {
      userId: user.id,
      timeframe: 'week'
    })
    expect(progressReport.sessionsCompleted).toBe(3)
    expect(progressReport.averageImprovement).toBeGreaterThan(0)

    // 6. Goal Achievement
    const goalsStatus = await convexClient.query('goals:getStatus', {
      userId: user.id
    })
    expect(goalsStatus.completedGoals).toContain('presentation-skills')
  })
})
```

#### **4.2 Error Recovery & Resilience**
```typescript
describe('Error Recovery Integration', () => {
  test('network failure recovery', async () => {
    // Setup network interception
    await page.route('**/api/assessments/**', (route) => {
      if (Math.random() < 0.3) { // 30% failure rate
        route.abort('failed')
      } else {
        route.continue()
      }
    })

    // Run assessment with intermittent failures
    await page.click('[data-testid="run-assessment"]')

    // System should retry and eventually succeed
    await page.waitForSelector('[data-testid="assessment-complete"]', {
      timeout: 30000 // Allow time for retries
    })

    // Validate final success
    const assessment = await getLatestAssessment()
    expect(assessment.status).toBe('completed')
    expect(assessment.retryCount).toBeGreaterThan(0)
  })

  test('partial failure handling', async () => {
    // Simulate skill assessment partial failure
    mockSkillAssessmentFailure('empathy-assessment')

    await runMultiSkillAssessment()

    // System should complete other skills and report partial success
    await page.waitForSelector('[data-testid="assessment-partial-success"]')

    const results = await getAssessmentResults()
    expect(results.completedSkills).toContain('clarity')
    expect(results.failedSkills).toContain('empathy')
    expect(results.overallStatus).toBe('partial_success')
  })
})
```

---

## **🧪 TESTING INFRASTRUCTURE**

### **Test Data Management**
```typescript
// tests/fixtures/integration-data.ts
export const testAudioFiles = {
  'presentation-sample.wav': 'path/to/presentation-sample.wav',
  'conversation-sample.wav': 'path/to/conversation-sample.wav',
  'practice-session-1.wav': 'path/to/practice-1.wav',
  'practice-session-2.wav': 'path/to/practice-2.wav'
}

export const testTranscripts = {
  presentation: 'I am excited to present our quarterly results...',
  conversation: 'Hello, how are you today? I hope you are doing well.',
  feedback: 'I appreciate your detailed feedback on my presentation.'
}

export const expectedAssessmentResults = {
  presentation: {
    clarity: 0.85,
    confidence: 0.78,
    engagement: 0.82
  },
  conversation: {
    empathy: 0.90,
    clarity: 0.75,
    activeListening: 0.85
  }
}
```

### **Mock Services**
```typescript
// tests/mocks/integration-services.ts
export class MockAIAPI {
  async assess(transcript: string, skills: string[]) {
    // Simulate realistic API response times
    await new Promise(resolve => setTimeout(resolve, 100 + Math.random() * 200))

    return {
      skillAssessments: skills.map(skill => ({
        skillId: skill,
        score: 0.7 + Math.random() * 0.3,
        highlights: ['Good example', 'Area for improvement'],
        recommendations: ['Practice more', 'Focus on clarity']
      })),
      meta: {
        processingTime: 150,
        model: 'gpt-4',
        confidence: 0.85
      }
    }
  }
}

export class MockConvexBackend {
  private data: Map<string, any> = new Map()

  async mutation(path: string, args: any) {
    // Simulate database operations
    await new Promise(resolve => setTimeout(resolve, 50))

    const key = `${path}:${JSON.stringify(args)}`
    this.data.set(key, { ...args, timestamp: Date.now() })

    return { success: true }
  }

  async query(path: string, args: any) {
    const key = `${path}:${JSON.stringify(args)}`
    return this.data.get(key) || null
  }
}
```

---

## **📊 SUCCESS METRICS**

### **Coverage Targets**
- **Integration Test Coverage**: 80%+ of user journeys
- **API Endpoint Coverage**: 95%+ of integration points
- **Error Scenario Coverage**: 90%+ of failure modes

### **Performance Targets**
- **Test Execution Time**: < 15 minutes for full integration suite
- **Reliability**: < 5% flaky tests
- **Parallel Execution**: Support for 4+ concurrent test runners

### **Quality Metrics**
- **User Journey Completion**: 100% success rate for happy paths
- **Error Recovery**: 95%+ success rate for error scenarios
- **Data Consistency**: 100% validation of cross-system data flow

---

## **⚠️ DEPENDENCIES & BLOCKERS**

### **External Dependencies**
- **AI API Availability**: For assessment integration tests
- **Convex Backend**: For real-time integration tests
- **Audio Files**: Test audio samples for voice processing
- **Browser Compatibility**: Cross-browser testing requirements

### **Internal Dependencies**
- **Stream 1**: Fixed AI API for reliable integration testing
- **Stream 3**: Working frontend test infrastructure
- **Test Data**: Comprehensive test datasets and fixtures

### **Contingency Plans**
- **Offline Mode**: Use pre-recorded responses for external services
- **Simplified Scenarios**: Focus on core user journeys first
- **Staged Rollout**: Deploy integration tests incrementally

---

## **📋 DELIVERABLES**

1. **Integration Test Suite**: Comprehensive end-to-end test coverage
2. **Test Data Fixtures**: Reusable test data and mock services
3. **Performance Benchmarks**: Integration test performance metrics
4. **Error Recovery Validation**: Comprehensive failure scenario testing
5. **Cross-System Validation**: Data consistency and synchronization tests

---

## **🔗 INTEGRATION POINTS**

### **Dependencies on Other Streams**
- **Stream 1**: Provides stable AI API for integration testing
- **Stream 3**: Provides working frontend test infrastructure
- **Stream 2**: May use benchmarking data for performance validation

### **Deliverables for Other Streams**
- **Integration Test Framework**: Reusable patterns for other test suites
- **Mock Services**: Shared mocking utilities
- **Test Data**: Standardized test datasets
- **Performance Metrics**: End-to-end performance benchmarks

---

## **🛠️ CONTINUOUS INTEGRATION**

### **CI/CD Pipeline Integration**
```yaml
# .github/workflows/integration-tests.yml
name: Integration Tests
on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main]

jobs:
  integration-tests:
    runs-on: ubuntu-latest
    services:
      convex: # Setup Convex backend
      ai-api: # Setup AI API service

    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3

      - name: Install dependencies
        run: npm ci

      - name: Run integration tests
        run: npm run test:integration
        env:
          CONVEX_URL: ${{ secrets.CONVEX_URL }}
          AI_API_KEY: ${{ secrets.AI_API_KEY }}

      - name: Upload test results
        uses: actions/upload-artifact@v3
        with:
          name: integration-test-results
          path: test-results/
```

### **Test Execution Strategy**
```typescript
// tests/integration/test-runner.ts
export class IntegrationTestRunner {
  async runTestSuite(suite: TestSuite) {
    const results = []

    for (const test of suite.tests) {
      try {
        await this.setupTestEnvironment(test)
        const result = await this.executeTest(test)
        results.push(result)
      } catch (error) {
        await this.handleTestFailure(test, error)
      } finally {
        await this.cleanupTestEnvironment(test)
      }
    }

    return this.generateReport(results)
  }

  private async setupTestEnvironment(test: IntegrationTest) {
    // Setup databases, mocks, test data
    await this.resetDatabases()
    await this.seedTestData(test.fixtures)
    await this.startMockServices(test.mocks)
  }
}
```

---

*This breakdown focuses on validating the complex interactions between recently added features, ensuring they work together seamlessly in real-world scenarios.*
