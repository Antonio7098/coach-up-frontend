#!/usr/bin/env node

/**
 * Integration Test Runner Script
 * Provides a convenient way to run the comprehensive integration test suite
 */

const { spawn } = require('child_process')
const path = require('path')

const TEST_SUITES = {
  all: 'tests/integration/',
  'skill-assessment': 'tests/integration/skill-assessment/',
  'voice-processing': 'tests/integration/voice-processing/',
  'realtime-data': 'tests/integration/realtime-data/',
  'complete-journey': 'tests/integration/complete-journey/',
  'error-recovery': 'tests/integration/error-recovery/'
}

function showUsage() {
  console.log(`
🧪 CoachUp Integration Test Runner

Usage: node scripts/run-integration-tests.js [options] [suite]

Options:
  --watch          Run tests in watch mode
  --parallel       Run tests in parallel (default: true)
  --coverage       Generate coverage report
  --verbose        Show detailed output
  --bail           Stop on first failure
  --timeout <ms>   Set test timeout (default: 60000)
  --workers <n>    Number of parallel workers (default: 4)

Suites:
  all                    Run all integration tests
  skill-assessment      Test skill assessment flow
  voice-processing      Test STT/TTS pipeline
  realtime-data         Test Convex real-time features
  complete-journey      Test full user journey
  error-recovery        Test error handling and recovery

Examples:
  npm run test:integration                    # Run all tests
  npm run test:integration:skill-assessment  # Run skill assessment tests
  node scripts/run-integration-tests.js skill-assessment --watch
  node scripts/run-integration-tests.js all --parallel --coverage
`)
}

function parseArgs() {
  const args = process.argv.slice(2)
  const options = {
    suite: 'all',
    watch: false,
    parallel: true,
    coverage: false,
    verbose: false,
    bail: false,
    timeout: 60000,
    workers: 4
  }

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]

    switch (arg) {
      case '--watch':
        options.watch = true
        break
      case '--parallel':
        options.parallel = true
        break
      case '--sequential':
        options.parallel = false
        break
      case '--coverage':
        options.coverage = true
        break
      case '--verbose':
        options.verbose = true
        break
      case '--bail':
        options.bail = true
        break
      case '--timeout':
        options.timeout = parseInt(args[++i])
        break
      case '--workers':
        options.workers = parseInt(args[++i])
        break
      default:
        if (!arg.startsWith('--') && !options.suite) {
          options.suite = arg
        }
        break
    }
  }

  return options
}

function buildVitestCommand(options) {
  const cmd = ['npx', 'vitest']
  const config = ['--config', 'vitest.integration.config.ts']

  if (options.watch) {
    cmd.push('watch')
  } else {
    cmd.push('run')
  }

  cmd.push(...config)

  // Add test path
  const testPath = TEST_SUITES[options.suite] || TEST_SUITES.all
  cmd.push(testPath)

  // Add options
  if (options.coverage) {
    cmd.push('--coverage')
  }

  if (options.verbose) {
    cmd.push('--reporter', 'verbose')
  }

  if (options.bail) {
    cmd.push('--bail', '1')
  }

  return cmd
}

function runTests(options) {
  const cmd = buildVitestCommand(options)

  console.log(`🚀 Running ${options.suite} integration tests...`)
  console.log(`Command: ${cmd.join(' ')}\n`)

  const testProcess = spawn(cmd[0], cmd.slice(1), {
    cwd: path.join(__dirname, '..'),
    stdio: 'inherit',
    env: {
      ...process.env,
      INTEGRATION_TEST: 'true',
      TEST_PARALLEL: options.parallel.toString(),
      TEST_TIMEOUT: options.timeout.toString(),
      MAX_WORKERS: options.workers.toString(),
      NODE_ENV: 'test'
    }
  })

  testProcess.on('close', (code) => {
    if (code === 0) {
      console.log('\n✅ Integration tests passed!')
    } else {
      console.log(`\n❌ Integration tests failed with exit code ${code}`)
    }
    process.exit(code)
  })

  testProcess.on('error', (error) => {
    console.error('Failed to start test process:', error)
    process.exit(1)
  })
}

function main() {
  const args = process.argv.slice(2)

  if (args.includes('--help') || args.includes('-h')) {
    showUsage()
    return
  }

  const options = parseArgs()

  if (!TEST_SUITES[options.suite]) {
    console.error(`❌ Unknown test suite: ${options.suite}`)
    console.log('Available suites:', Object.keys(TEST_SUITES).join(', '))
    process.exit(1)
  }

  runTests(options)
}

if (require.main === module) {
  main()
}

module.exports = { TEST_SUITES, buildVitestCommand, parseArgs }
