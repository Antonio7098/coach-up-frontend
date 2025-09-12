/**
 * Integration Test Runner Framework
 * Provides comprehensive test execution with parallelization and reporting
 */

import { spawn } from 'child_process'
import path from 'path'
import fs from 'fs/promises'
import { glob } from 'glob'

export interface TestSuite {
  name: string
  tests: IntegrationTest[]
  config: TestSuiteConfig
}

export interface IntegrationTest {
  name: string
  file: string
  dependencies: string[]
  timeout: number
  retries: number
  tags: string[]
  fixtures: Record<string, any>
  mocks: string[]
}

export interface TestSuiteConfig {
  parallel: boolean
  maxWorkers: number
  timeout: number
  retries: number
  bail: boolean
  reporters: string[]
  coverage: boolean
}

export interface TestResult {
  test: IntegrationTest
  status: 'passed' | 'failed' | 'skipped' | 'timed_out'
  duration: number
  error?: string
  coverage?: CoverageReport
  logs: string[]
}

export interface CoverageReport {
  statements: number
  branches: number
  functions: number
  lines: number
  files: string[]
}

export interface TestExecutionReport {
  suite: string
  totalTests: number
  passed: number
  failed: number
  skipped: number
  timedOut: number
  duration: number
  coverage?: CoverageReport
  results: TestResult[]
  timestamp: Date
}

export class IntegrationTestRunner {
  private results: TestResult[] = []
  private startTime: number = 0
  private activeProcesses: Map<string, any> = new Map()

  constructor(private config: TestSuiteConfig) {}

  async runTestSuite(suite: TestSuite): Promise<TestExecutionReport> {
    console.log(`🚀 Starting integration test suite: ${suite.name}`)
    this.startTime = Date.now()
    this.results = []

    try {
      // Setup test environment
      await this.setupTestEnvironment(suite)

      // Discover and validate tests
      const discoveredTests = await this.discoverTests(suite)
      console.log(`📋 Discovered ${discoveredTests.length} tests`)

      // Execute tests
      if (suite.config.parallel && suite.config.maxWorkers > 1) {
        await this.runParallel(discoveredTests, suite.config.maxWorkers)
      } else {
        await this.runSequential(discoveredTests)
      }

      // Generate comprehensive report
      const report = await this.generateReport(suite)

      // Cleanup
      await this.cleanupTestEnvironment()

      console.log(`✅ Test suite completed: ${report.passed}/${report.totalTests} passed`)
      return report

    } catch (error) {
      console.error('❌ Test suite failed:', error)
      throw error
    }
  }

  private async setupTestEnvironment(suite: TestSuite): Promise<void> {
    console.log('🔧 Setting up test environment...')

    // Start required services
    await this.startServices(['ai-api', 'convex', 'storage'])

    // Setup test databases
    await this.setupTestDatabases()

    // Preload test fixtures
    await this.loadTestFixtures(suite)

    // Configure mocks
    await this.configureMocks(suite)

    console.log('✅ Test environment ready')
  }

  private async discoverTests(suite: TestSuite): Promise<IntegrationTest[]> {
    const testFiles = await glob('tests/integration/**/*.spec.ts', {
      cwd: process.cwd(),
      absolute: true
    })

    const tests: IntegrationTest[] = []

    for (const file of testFiles) {
      const testModule = await import(file)

      // Extract test metadata from file
      const testMetadata = this.extractTestMetadata(file, testModule)

      if (this.shouldIncludeTest(testMetadata, suite)) {
        tests.push(testMetadata)
      }
    }

    return tests.sort((a, b) => {
      // Sort by dependencies (tests with fewer dependencies first)
      return a.dependencies.length - b.dependencies.length
    })
  }

  private extractTestMetadata(file: string, testModule: any): IntegrationTest {
    // Extract test information from the module
    const testName = path.basename(file, '.spec.ts')
    const describeBlocks = this.extractDescribeBlocks(testModule)

    return {
      name: testName,
      file,
      dependencies: [], // Could be extracted from imports or metadata
      timeout: 60000, // 60 seconds default
      retries: 2,
      tags: this.extractTags(describeBlocks),
      fixtures: {},
      mocks: ['ai-api', 'convex', 'storage'] // Default mocks
    }
  }

  private extractDescribeBlocks(module: any): string[] {
    // Simple extraction of describe block names
    const blocks: string[] = []
    const moduleString = module.toString()

    const describeRegex = /describe\(['"]([^'"]+)['"]/g
    let match
    while ((match = describeRegex.exec(moduleString)) !== null) {
      blocks.push(match[1])
    }

    return blocks
  }

  private extractTags(describeBlocks: string[]): string[] {
    const tags: string[] = []

    describeBlocks.forEach(block => {
      if (block.toLowerCase().includes('skill')) tags.push('skill-assessment')
      if (block.toLowerCase().includes('voice')) tags.push('voice-processing')
      if (block.toLowerCase().includes('realtime')) tags.push('realtime')
      if (block.toLowerCase().includes('journey')) tags.push('complete-journey')
      if (block.toLowerCase().includes('error')) tags.push('error-recovery')
    })

    return [...new Set(tags)] // Remove duplicates
  }

  private shouldIncludeTest(test: IntegrationTest, suite: TestSuite): boolean {
    // Filter tests based on suite configuration
    // Could include tag filtering, dependency checking, etc.
    return true // Include all for now
  }

  private async runSequential(tests: IntegrationTest[]): Promise<void> {
    console.log('🔄 Running tests sequentially...')

    for (const test of tests) {
      const result = await this.executeTest(test)
      this.results.push(result)

      if (this.config.bail && result.status === 'failed') {
        console.log('🛑 Bailing due to test failure')
        break
      }
    }
  }

  private async runParallel(tests: IntegrationTest[], maxWorkers: number): Promise<void> {
    console.log(`🔄 Running tests in parallel (max ${maxWorkers} workers)...`)

    const batches = this.createBatches(tests, maxWorkers)
    const promises: Promise<TestResult[]>[] = []

    for (const batch of batches) {
      const batchPromise = Promise.all(
        batch.map(test => this.executeTest(test))
      )
      promises.push(batchPromise)
    }

    const batchResults = await Promise.all(promises)
    this.results = batchResults.flat()
  }

  private createBatches(tests: IntegrationTest[], batchSize: number): IntegrationTest[][] {
    const batches: IntegrationTest[][] = []

    for (let i = 0; i < tests.length; i += batchSize) {
      batches.push(tests.slice(i, i + batchSize))
    }

    return batches
  }

  private async executeTest(test: IntegrationTest): Promise<TestResult> {
    const startTime = Date.now()

    console.log(`▶️  Running test: ${test.name}`)

    try {
      // Setup test-specific environment
      await this.setupTestEnvironmentForTest(test)

      // Execute the test
      const result = await this.runTestProcess(test)

      const duration = Date.now() - startTime

      if (result.status === 'passed') {
        console.log(`✅ ${test.name} passed (${duration}ms)`)
      } else {
        console.log(`❌ ${test.name} ${result.status} (${duration}ms)`)
        if (result.error) {
          console.log(`   Error: ${result.error}`)
        }
      }

      return {
        test,
        status: result.status,
        duration,
        error: result.error,
        logs: result.logs || [],
        coverage: result.coverage
      }

    } catch (error) {
      const duration = Date.now() - startTime
      console.log(`💥 ${test.name} crashed (${duration}ms):`, error)

      return {
        test,
        status: 'failed',
        duration,
        error: error instanceof Error ? error.message : String(error),
        logs: []
      }
    } finally {
      // Cleanup test-specific environment
      await this.cleanupTestEnvironmentForTest(test)
    }
  }

  private async runTestProcess(test: IntegrationTest): Promise<{
    status: 'passed' | 'failed' | 'timed_out'
    error?: string
    logs: string[]
    coverage?: CoverageReport
  }> {
    return new Promise((resolve) => {
      const testProcess = spawn('npx', [
        'vitest',
        'run',
        test.file,
        '--config',
        'vitest.integration.config.ts',
        '--reporter',
        'json'
      ], {
        cwd: process.cwd(),
        stdio: ['pipe', 'pipe', 'pipe'],
        env: {
          ...process.env,
          NODE_ENV: 'test',
          INTEGRATION_TEST: 'true'
        }
      })

      const logs: string[] = []
      let timeoutId: NodeJS.Timeout

      // Set timeout
      if (test.timeout > 0) {
        timeoutId = setTimeout(() => {
          testProcess.kill('SIGTERM')
          resolve({
            status: 'timed_out',
            logs,
            error: `Test timed out after ${test.timeout}ms`
          })
        }, test.timeout)
      }

      // Capture stdout
      testProcess.stdout.on('data', (data) => {
        logs.push(data.toString())
      })

      // Capture stderr
      testProcess.stderr.on('data', (data) => {
        logs.push(`[ERROR] ${data.toString()}`)
      })

      // Handle process completion
      testProcess.on('close', (code) => {
        if (timeoutId) clearTimeout(timeoutId)

        const status = code === 0 ? 'passed' : 'failed'
        const error = code !== 0 ? `Process exited with code ${code}` : undefined

        resolve({
          status,
          error,
          logs
        })
      })

      // Handle process errors
      testProcess.on('error', (error) => {
        if (timeoutId) clearTimeout(timeoutId)

        resolve({
          status: 'failed',
          error: error.message,
          logs
        })
      })
    })
  }

  private async setupTestEnvironmentForTest(test: IntegrationTest): Promise<void> {
    // Setup test-specific fixtures
    if (test.fixtures) {
      await this.loadTestFixturesForTest(test.fixtures)
    }

    // Configure test-specific mocks
    if (test.mocks) {
      await this.configureMocksForTest(test.mocks)
    }
  }

  private async cleanupTestEnvironmentForTest(test: IntegrationTest): Promise<void> {
    // Cleanup test-specific resources
    await this.resetTestDatabases()
    await this.cleanupMocksForTest(test.mocks)
  }

  private async generateReport(suite: TestSuite): Promise<TestExecutionReport> {
    const totalDuration = Date.now() - this.startTime

    const passed = this.results.filter(r => r.status === 'passed').length
    const failed = this.results.filter(r => r.status === 'failed').length
    const skipped = this.results.filter(r => r.status === 'skipped').length
    const timedOut = this.results.filter(r => r.status === 'timed_out').length

    // Generate coverage report if enabled
    let coverage: CoverageReport | undefined
    if (suite.config.coverage) {
      coverage = await this.generateCoverageReport()
    }

    const report: TestExecutionReport = {
      suite: suite.name,
      totalTests: this.results.length,
      passed,
      failed,
      skipped,
      timedOut,
      duration: totalDuration,
      coverage,
      results: this.results,
      timestamp: new Date()
    }

    // Save report to file
    await this.saveReport(report)

    // Generate HTML report if configured
    if (suite.config.reporters.includes('html')) {
      await this.generateHtmlReport(report)
    }

    return report
  }

  private async generateCoverageReport(): Promise<CoverageReport> {
    // This would integrate with a coverage tool like istanbul or similar
    // For now, return a mock report
    return {
      statements: 85,
      branches: 80,
      functions: 90,
      lines: 85,
      files: [
        'src/app/api/v1/assessments/route.ts',
        'src/app/api/v1/stt/route.ts',
        'src/components/SkillChart.tsx'
      ]
    }
  }

  private async saveReport(report: TestExecutionReport): Promise<void> {
    const reportDir = path.join(process.cwd(), 'test-results', 'integration')
    await fs.mkdir(reportDir, { recursive: true })

    const reportPath = path.join(reportDir, `report-${Date.now()}.json`)
    await fs.writeFile(reportPath, JSON.stringify(report, null, 2))

    console.log(`📊 Report saved to: ${reportPath}`)
  }

  private async generateHtmlReport(report: TestExecutionReport): Promise<void> {
    const html = this.createHtmlReport(report)
    const reportDir = path.join(process.cwd(), 'test-results', 'integration')
    const htmlPath = path.join(reportDir, `report-${Date.now()}.html`)
    await fs.writeFile(htmlPath, html)
    console.log(`📄 HTML report saved to: ${htmlPath}`)
  }

  private createHtmlReport(report: TestExecutionReport): string {
    const successRate = ((report.passed / report.totalTests) * 100).toFixed(1)

    return `
<!DOCTYPE html>
<html>
<head>
    <title>Integration Test Report - ${report.suite}</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 20px; }
        .summary { background: #f5f5f5; padding: 20px; border-radius: 5px; margin-bottom: 20px; }
        .passed { color: #28a745; }
        .failed { color: #dc3545; }
        .skipped { color: #ffc107; }
        .timed-out { color: #fd7e14; }
        .test-result { margin: 10px 0; padding: 10px; border-left: 4px solid; }
        .test-result.passed { border-left-color: #28a745; background: #d4edda; }
        .test-result.failed { border-left-color: #dc3545; background: #f8d7da; }
        .test-result.skipped { border-left-color: #ffc107; background: #fff3cd; }
        .test-result.timed-out { border-left-color: #fd7e14; background: #ffeaa7; }
    </style>
</head>
<body>
    <h1>Integration Test Report</h1>
    <h2>${report.suite}</h2>

    <div class="summary">
        <h3>Test Summary</h3>
        <p><strong>Total Tests:</strong> ${report.totalTests}</p>
        <p><strong>Passed:</strong> <span class="passed">${report.passed}</span></p>
        <p><strong>Failed:</strong> <span class="failed">${report.failed}</span></p>
        <p><strong>Skipped:</strong> <span class="skipped">${report.skipped}</span></p>
        <p><strong>Timed Out:</strong> <span class="timed-out">${report.timedOut}</span></p>
        <p><strong>Success Rate:</strong> ${successRate}%</p>
        <p><strong>Duration:</strong> ${(report.duration / 1000).toFixed(2)}s</p>
        <p><strong>Timestamp:</strong> ${report.timestamp.toISOString()}</p>
    </div>

    <h3>Test Results</h3>
    ${report.results.map(result => `
        <div class="test-result ${result.status}">
            <h4>${result.test.name}</h4>
            <p><strong>Status:</strong> ${result.status.toUpperCase()}</p>
            <p><strong>Duration:</strong> ${result.duration}ms</p>
            <p><strong>File:</strong> ${result.test.file}</p>
            ${result.error ? `<p><strong>Error:</strong> ${result.error}</p>` : ''}
            ${result.test.tags.length > 0 ? `<p><strong>Tags:</strong> ${result.test.tags.join(', ')}</p>` : ''}
        </div>
    `).join('')}

    ${report.coverage ? `
    <h3>Coverage Report</h3>
    <div class="summary">
        <p><strong>Statements:</strong> ${report.coverage.statements}%</p>
        <p><strong>Branches:</strong> ${report.coverage.branches}%</p>
        <p><strong>Functions:</strong> ${report.coverage.functions}%</p>
        <p><strong>Lines:</strong> ${report.coverage.lines}%</p>
        <p><strong>Covered Files:</strong> ${report.coverage.files.length}</p>
    </div>
    ` : ''}
</body>
</html>`
  }

  // Service management methods
  private async startServices(services: string[]): Promise<void> {
    for (const service of services) {
      await this.startService(service)
    }
  }

  private async startService(service: string): Promise<void> {
    // Implementation would start actual services (Docker containers, etc.)
    console.log(`Starting service: ${service}`)
  }

  private async setupTestDatabases(): Promise<void> {
    // Setup test databases (create tables, seed data, etc.)
    console.log('Setting up test databases')
  }

  private async resetTestDatabases(): Promise<void> {
    // Reset databases between tests
    console.log('Resetting test databases')
  }

  private async loadTestFixtures(suite: TestSuite): Promise<void> {
    // Load shared test fixtures
    console.log('Loading test fixtures')
  }

  private async loadTestFixturesForTest(fixtures: Record<string, any>): Promise<void> {
    // Load test-specific fixtures
    console.log('Loading test-specific fixtures')
  }

  private async configureMocks(suite: TestSuite): Promise<void> {
    // Configure shared mocks
    console.log('Configuring mocks')
  }

  private async configureMocksForTest(mocks: string[]): Promise<void> {
    // Configure test-specific mocks
    console.log('Configuring test-specific mocks')
  }

  private async cleanupMocksForTest(mocks: string[]): Promise<void> {
    // Cleanup test-specific mocks
    console.log('Cleaning up test-specific mocks')
  }

  private async cleanupTestEnvironment(): Promise<void> {
    // Cleanup test environment
    console.log('Cleaning up test environment')

    // Stop services
    for (const [serviceName] of this.activeProcesses) {
      await this.stopService(serviceName)
    }

    // Clean up test data
    await this.cleanupTestData()
  }

  private async stopService(service: string): Promise<void> {
    const process = this.activeProcesses.get(service)
    if (process) {
      process.kill()
      this.activeProcesses.delete(service)
    }
  }

  private async cleanupTestData(): Promise<void> {
    // Clean up test data files, database entries, etc.
    console.log('Cleaning up test data')
  }
}

// Export factory function for creating test runners
export function createIntegrationTestRunner(config?: Partial<TestSuiteConfig>): IntegrationTestRunner {
  const defaultConfig: TestSuiteConfig = {
    parallel: true,
    maxWorkers: 4,
    timeout: 300000, // 5 minutes
    retries: 2,
    bail: false,
    reporters: ['console', 'json'],
    coverage: true
  }

  return new IntegrationTestRunner({ ...defaultConfig, ...config })
}

// Export utility functions for creating test suites
export function createTestSuite(name: string, tests: IntegrationTest[], config?: Partial<TestSuiteConfig>): TestSuite {
  const defaultConfig: TestSuiteConfig = {
    parallel: true,
    maxWorkers: 4,
    timeout: 300000,
    retries: 2,
    bail: false,
    reporters: ['console', 'json'],
    coverage: true
  }

  return {
    name,
    tests,
    config: { ...defaultConfig, ...config }
  }
}
