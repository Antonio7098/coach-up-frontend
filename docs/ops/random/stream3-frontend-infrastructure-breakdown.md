# 🟡 **STREAM 3: Frontend Test Infrastructure** - Detailed Task Breakdown
*Priority: HIGH | Timeline: 3-4 days | Target: Resolve execution conflicts and establish reliable testing*

## **🎯 Mission Overview**
Resolve version conflicts and establish reliable frontend test execution with comprehensive coverage analysis.

---

## **🔍 CURRENT ISSUES ANALYSIS**

### **Primary Blockers**
1. **Version Conflict**: Vitest 1.6.1 ↔ @vitest/coverage-v8 3.2.4
2. **Missing Exports**: `parseAstAsync` not available in current Vitest
3. **Coverage Integration**: Coverage provider cannot load

### **Secondary Issues**
1. **Test Discovery**: 28+ unit tests, 17+ E2E tests status unknown
2. **Mock Setup**: Convex and external API mocking
3. **Performance**: Test execution time optimization

---

## **🚀 EXECUTION PLAN**

### **Day 1: Version Conflict Resolution** (4-6 hours)

#### **1.1 Dependency Analysis**
```bash
# Current problematic versions
vitest: 1.6.1
@vitest/coverage-v8: 3.2.4 (incompatible)

# Compatible alternatives
Option A: vitest@1.6.1 + @vitest/coverage-v8@1.6.1
Option B: vitest@latest + @vitest/coverage-v8@latest
Option C: Alternative coverage tools
```

#### **1.2 Resolution Strategies**

**Strategy A: Downgrade Coverage Tool**
```bash
npm uninstall @vitest/coverage-v8
npm install --save-dev @vitest/coverage-v8@1.6.1
```

**Strategy B: Upgrade Vitest**
```bash
npm install --save-dev vitest@latest @vitest/coverage-v8@latest
# Update vite.config.ts accordingly
```

**Strategy C: Alternative Coverage**
```bash
# Use c8 or istanbul instead
npm install --save-dev c8
# Update package.json scripts
```

#### **1.3 Validation Steps**
```bash
# Test basic execution
npm run test:unit

# Test with coverage
npm run test:unit -- --coverage

# Validate coverage output
ls -la coverage/
cat coverage/lcov-report/index.html
```

---

### **Day 2: Test Execution & Coverage Analysis** (6-8 hours)

#### **2.1 Unit Test Assessment**
```typescript
// vitest.config.ts - Ensure proper configuration
export default defineConfig({
  test: {
    environment: 'jsdom',
    setupFiles: ['./tests/setup.vitest.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        'dist/',
        'coverage/',
        '.next/',
        '**/*.d.ts'
      ]
    }
  }
})
```

**Coverage Analysis Script**:
```bash
#!/bin/bash
# Run tests with coverage and analyze results
npm run test:unit -- --coverage --reporter=verbose

# Generate coverage report
npx istanbul report --include coverage/coverage-final.json html

# Analyze coverage gaps
npx istanbul check-coverage \
  --statements 80 \
  --branches 75 \
  --functions 80 \
  --lines 80
```

#### **2.2 Coverage Gap Identification**
```typescript
// Expected coverage by component type
const COVERAGE_TARGETS = {
  // Core business logic - 90%+ required
  'app/api/**/*.ts': 90,
  'components/**/*.tsx': 85,
  'hooks/**/*.ts': 90,
  'context/**/*.tsx': 80,

  // Utility functions - 80%+ required
  'lib/**/*.ts': 80,

  // Configuration - 70%+ acceptable
  'middleware.ts': 70,
  'next.config.ts': 50,
}
```

---

### **Day 3: Mock Infrastructure & Integration Tests** (6-8 hours)

#### **3.1 Convex Mocking Setup**
```typescript
// tests/setup.vitest.ts
import { vi } from 'vitest'
import { mockConvexReact } from './mocks/convex'

// Mock Convex globally
vi.mock('convex/react', () => mockConvexReact)

// Mock external APIs
vi.mock('@/lib/auth', () => ({
  useAuth: () => ({ user: mockUser, isLoading: false })
}))
```

**Convex Mock Implementation**:
```typescript
// tests/mocks/convex.ts
export const mockConvexReact = {
  useQuery: vi.fn(),
  useMutation: vi.fn(),
  useAction: vi.fn(),
}

export const mockConvexClient = {
  query: vi.fn(),
  mutation: vi.fn(),
  action: vi.fn(),
}
```

#### **3.2 API Integration Mocks**
```typescript
// tests/mocks/api.ts
export const mockFetch = (url: string, options?: RequestInit) => {
  if (url.includes('/api/assessments')) {
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve({
        sessionId: 'test-session',
        scores: { clarity: 0.85 }
      })
    })
  }

  if (url.includes('/api/speech')) {
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve({
        transcript: 'Mocked transcript',
        confidence: 0.92
      })
    })
  }

  return Promise.reject(new Error('Unknown endpoint'))
}
```

#### **3.3 Test Data Fixtures**
```typescript
// tests/fixtures/index.ts
export const mockUser = {
  id: 'user-123',
  email: 'test@example.com',
  name: 'Test User'
}

export const mockSession = {
  id: 'session-123',
  userId: 'user-123',
  createdAt: new Date(),
  updatedAt: new Date()
}

export const mockTranscript = {
  id: 'transcript-123',
  sessionId: 'session-123',
  content: 'Hello, this is a test transcript',
  speaker: 'user',
  timestamp: new Date()
}
```

---

### **Day 4: E2E Test Infrastructure & Performance** (6-8 hours)

#### **4.1 Playwright Configuration**
```typescript
// playwright.config.ts - Optimize for CI/CD
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,

  use: {
    baseURL: process.env.BASE_URL || 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure'
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] }
    },
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] }
    }
  ]
})
```

#### **4.2 E2E Test Assessment**
```typescript
// tests/e2e/health-check.spec.ts
test.describe('Application Health', () => {
  test('should load homepage', async ({ page }) => {
    await page.goto('/')
    await expect(page.locator('h1')).toBeVisible()
  })

  test('should handle user authentication', async ({ page }) => {
    await page.goto('/auth/sign-in')
    // Test auth flow
  })

  test('should process speech assessment', async ({ page }) => {
    await page.goto('/coach')
    // Test voice recording and assessment
  })
})
```

#### **4.3 Performance Optimization**
```typescript
// Performance test utilities
export const measurePerformance = async (action: () => Promise<void>) => {
  const start = performance.now()
  await action()
  const end = performance.now()
  return end - start
}

test('assessment processing should be fast', async ({ page }) => {
  const duration = await measurePerformance(async () => {
    await page.goto('/coach')
    await page.click('button[start-recording]')
    await page.waitForSelector('[data-testid="assessment-complete"]')
  })

  expect(duration).toBeLessThan(5000) // 5 seconds
})
```

---

## **🧪 TESTING STRATEGY**

### **Unit Test Categories**
```typescript
// 1. Component Tests
test('Button component renders correctly', () => {
  render(<Button>Click me</Button>)
  expect(screen.getByText('Click me')).toBeInTheDocument()
})

// 2. Hook Tests
test('useSessionSummary returns correct data', () => {
  const { result } = renderHook(() => useSessionSummary('session-123'))
  expect(result.current.isLoading).toBe(true)
})

// 3. Utility Tests
test('cost calculator works correctly', () => {
  const cost = calculateCost(1000, 'gpt-4')
  expect(cost).toBe(0.03)
})

// 4. Integration Tests
test('full assessment flow', async () => {
  // Setup mocks
  mockConvexClient.query.mockResolvedValue(mockSession)

  // Render component
  render(<AssessmentFlow />, { wrapper: ConvexProvider })

  // Test flow
  await userEvent.click(screen.getByText('Start Assessment'))
  await waitFor(() => {
    expect(screen.getByText('Assessment Complete')).toBeInTheDocument()
  })
})
```

---

## **📊 SUCCESS METRICS**

### **Infrastructure Targets**
- ✅ **Test Execution**: All tests run without version conflicts
- ✅ **Coverage Reporting**: Automated coverage generation and reporting
- ✅ **Mock Stability**: Reliable mocking for all external dependencies
- ✅ **Execution Time**: < 5 minutes for full test suite

### **Coverage Targets**
- **Unit Tests**: 80%+ coverage
- **Integration Tests**: 85%+ coverage
- **Critical Paths**: 95%+ coverage

### **Quality Metrics**
- **Test Pass Rate**: 100%
- **Flaky Tests**: 0%
- **Debugging Time**: < 30 seconds per test failure

---

## **⚠️ DEPENDENCIES & BLOCKERS**

### **Critical Dependencies**
- **Node.js Version**: Compatible with chosen Vitest version
- **Package Manager**: npm vs yarn consistency
- **CI/CD Environment**: Matching local setup

### **Potential Blockers**
- **Version Lock**: If specific versions required by other dependencies
- **Breaking Changes**: Major version upgrades may require code changes
- **Browser Compatibility**: E2E tests may require specific browser versions

### **Contingency Plans**
- **Plan A**: Downgrade to compatible versions
- **Plan B**: Use alternative coverage tools (c8, istanbul)
- **Plan C**: Manual coverage analysis until automated solution found

---

## **📋 DELIVERABLES**

1. **Fixed Test Infrastructure**: Resolves all version conflicts
2. **Comprehensive Mock Framework**: Reusable mocks for all external dependencies
3. **Coverage Analysis**: Detailed coverage reports and gap analysis
4. **Performance Benchmarks**: Test execution time optimization
5. **CI/CD Integration**: Automated test execution in pipeline

---

## **🔗 INTEGRATION POINTS**

### **Dependencies on Other Streams**
- **Stream 4**: Provides real backend for integration testing
- **Stream 1**: Ensures API stability for frontend integration

### **Deliverables for Other Streams**
- **Test Utilities**: Mock frameworks and test helpers
- **Coverage Reports**: Frontend coverage metrics for overall reporting
- **Performance Data**: Frontend performance benchmarks

---

## **🛠️ TOOLS & SCRIPTS**

### **Utility Scripts**
```bash
# scripts/test-coverage.sh
#!/bin/bash
npm run test:unit -- --coverage
npm run test:e2e -- --grep "critical"
npx istanbul check-coverage --statements 80

# scripts/test-performance.sh
#!/bin/bash
npm run test:unit -- --reporter=json > test-results.json
node scripts/analyze-performance.js test-results.json
```

### **Configuration Files**
```typescript
// vitest.config.ts
export default defineConfig({
  test: {
    environment: 'jsdom',
    setupFiles: ['./tests/setup.vitest.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html', 'lcov'],
      exclude: ['node_modules/', 'dist/', '.next/'],
      thresholds: {
        global: {
          statements: 80,
          branches: 75,
          functions: 80,
          lines: 80
        }
      }
    }
  }
})
```

---

*This breakdown focuses on establishing a solid testing foundation that enables efficient parallel development across all frontend components while providing comprehensive coverage analysis.*
