# Logging System Guide - SPR-015 Implementation

## Overview

The CoachUp application uses a comprehensive, runtime-tunable logging system implemented in SPR-015. This system provides granular control over logging with namespaced loggers, multiple log levels, and environment-based configuration.

## Architecture

### Core Components

1. **devLog Function** - Main logging utility
2. **Environment-based Configuration** - Runtime log level control
3. **Namespaced Logging** - Hierarchical, contextual logging
4. **Multiple Log Levels** - Debug, Info, Warn, Error
5. **Structured Logging** - Rich contextual data

## Quick Start

### Basic Usage

```typescript
import { devLog } from './api/lib/observability';

// Simple logging
devLog("info", "User logged in", { userId: "12345" });

// With structured data
devLog("debug", "Processing payment", {
  amount: 99.99,
  currency: "USD",
  userId: "12345",
  timestamp: new Date().toISOString()
});
```

### Log Levels

- **debug**: Detailed diagnostic information
- **info**: General information about application flow
- **warn**: Warning messages for potentially harmful situations
- **error**: Error conditions that need attention

## Namespaced Logging

The logging system uses hierarchical namespaces for better organization:

```
ui:component:Button - UI component events
api:auth:sign-in - Authentication flows
test:stt:provider - Test execution
```

### Namespace Convention

- **ui:** - Frontend UI components and interactions
- **api:** - API endpoints and backend logic
- **test:** - Test execution and validation
- **auth:** - Authentication and authorization
- **db:** - Database operations
- **cache:** - Caching operations

## Environment Configuration

### Environment Variables

```bash
# Enable all logging (development default)
NODE_ENV=development

# Force logging in production
FORCE_DEV_LOGS=1

# Set specific log level
LOG_LEVEL=debug

# Enable performance marking
FORCE_PERF_MARKS=1
```

### Namespace filtering via environment variables (SPR-015)

You can filter logs by file/namespace using comma-separated glob patterns.

- API (FastAPI)
  - `LOG_LEVEL=debug|info|warn|error` (default: info)
  - `LOG_INCLUDE` — include filter globs (e.g., `api:*`, `api:http/*`, `api:services/auth`)
  - `LOG_EXCLUDE` — exclude filter globs (takes precedence)
  - `LOG_FORMAT=json|pretty` (default: json)
  - `LOG_MAX_FIELD_LEN` (default: 2000)
  - `LOG_SAMPLE_DEBUG` (0..1, default 1.0)

- UI (Next.js)
  - `NEXT_PUBLIC_LOG_LEVEL=debug|info|warn|error` (default: warn)
  - `NEXT_PUBLIC_LOG_INCLUDE` — include filter globs (e.g., `ui:context/*`, `ui:*`)
  - `NEXT_PUBLIC_LOG_EXCLUDE` — exclude filter globs
  - `NEXT_PUBLIC_LOG_FORMAT=pretty|json` (default: pretty)

Examples

```bash
# API: only HTTP-layer logs at debug
LOG_LEVEL=debug LOG_INCLUDE="api:http/*" uvicorn app.main:app

# API: include all API, exclude providers
LOG_INCLUDE="api:*" LOG_EXCLUDE="api:providers/*" uvicorn app.main:app

# UI: enable all UI logs except engine
NEXT_PUBLIC_LOG_LEVEL=debug \
NEXT_PUBLIC_LOG_INCLUDE="ui:*" \
NEXT_PUBLIC_LOG_EXCLUDE="ui:engine/*" \
npm run dev
```

### Runtime Control

The logging system automatically:
- Enables all logging in development
- Disables logging in production unless `FORCE_DEV_LOGS=1`
- Respects `NODE_ENV` and other environment flags

### Runtime controls (no redeploy)

- API
  - `GET /_debug/logging` — returns current `{ level, include, exclude, format, sample }`
  - `POST /_debug/logging` — updates runtime config (guarded)

- UI
  - `window.CU_LOG.set({ include: "ui:*", level: "debug" })`
  - `window.CU_LOG.enable("ui:context/*")` / `window.CU_LOG.disable("ui:context/*")`
  - URL param seed: `?debug=ui:context/*`
  - Local overrides: `localStorage["cu.log.include"]="ui:*"`

## Advanced Usage

### Contextual Logging

```typescript
// API endpoint logging
devLog("info", "api:auth:login:attempt", {
  email: userEmail,
  timestamp: new Date().toISOString(),
  userAgent: request.headers['user-agent']
});

// Component lifecycle logging
devLog("debug", "ui:component:Button:mounted", {
  componentId: this.id,
  props: Object.keys(this.props)
});

// Error handling with context
devLog("error", "api:payment:failed", {
  error: error.message,
  orderId: order.id,
  amount: order.amount,
  stack: error.stack
});
```

### Performance Monitoring

```typescript
import { perfMark, perfMeasure } from './api/lib/observability';

// Mark operation start
perfMark('api:payment:process');

// Your operation here
const result = await processPayment();

// Measure duration
perfMark('api:payment:complete', 'api:payment:process');
```

### Structured Data Best Practices

```typescript
// Good: Specific, searchable data
devLog("info", "api:order:created", {
  orderId: "ord_12345",
  customerId: "cust_67890",
  amount: 99.99,
  currency: "USD",
  itemCount: 3
});

// Avoid: Generic, unsearchable data
devLog("info", "Order created", { data: order }); // ❌ Too generic
```

## Implementation Examples

### Authentication Flow

```typescript
// Sign-in attempt
devLog("info", "auth:sign-in:attempt", {
  email: credentials.email,
  timestamp: new Date().toISOString()
});

// Success
devLog("info", "auth:sign-in:success", {
  userId: user.id,
  redirectUrl: "/dashboard"
});

// Failure
devLog("warn", "auth:sign-in:failed", {
  reason: "invalid_credentials",
  attemptCount: 3
});
```

### API Request/Response

```typescript
// Request start
devLog("debug", "api:users:get:request", {
  userId: params.userId,
  endpoint: "/api/v1/users/profile"
});

// Response
devLog("debug", "api:users:get:response", {
  status: response.status,
  duration: Date.now() - startTime,
  dataSize: JSON.stringify(response.data).length
});
```

### Component Interactions

```typescript
// Button click
const handleClick = () => {
  devLog("info", "ui:button:click", {
    buttonId: "submit-order",
    page: "checkout",
    timestamp: new Date().toISOString()
  });
  // Handle click logic
};
```

## Configuration Options

### Log Level Filtering

The system supports runtime log level filtering:

```typescript
// Only show info and above
// Set via LOG_LEVEL=info

// Show all levels
// Set via LOG_LEVEL=debug

// Custom filtering
if (shouldLog('debug')) {
  devLog("debug", "api:detailed:info", { data });
}
```

### Performance Impact

- **Development**: Full logging enabled
- **Production**: Logging disabled by default
- **Performance**: Minimal overhead when disabled

## Best Practices

### 1. Use Descriptive Namespaces

```typescript
// ✅ Good
devLog("info", "api:payment:stripe:charge", { amount: 99.99 });

// ❌ Avoid
devLog("info", "Payment processed", { amount: 99.99 });
```

### 2. Include Relevant Context

```typescript
// ✅ Good - searchable and contextual
devLog("error", "api:payment:failed", {
  orderId: "ord_123",
  amount: 99.99,
  errorCode: "CARD_DECLINED",
  userId: "user_456"
});

// ❌ Poor - lacks context
devLog("error", "Payment failed", { error: "Card declined" });
```

### 3. Use Appropriate Log Levels

- **debug**: Development diagnostics, detailed flow
- **info**: Important business events, user actions
- **warn**: Recoverable issues, deprecated features
- **error**: Failures, exceptions, critical issues

### 4. Structure Data for Searchability

```typescript
// ✅ Good - structured for querying
devLog("info", "api:user:registered", {
  userId: "user_123",
  email: "user@example.com",
  signupMethod: "email",
  timestamp: new Date().toISOString()
});

// ❌ Poor - unstructured
devLog("info", "User signed up", { user: userData });
```

### 5. Performance Considerations

```typescript
// ✅ Good - lazy evaluation
devLog("debug", "api:expensive:operation", () => ({
  result: expensiveComputation(),
  duration: performance.now() - start
}));

// ❌ Poor - always evaluates
devLog("debug", "api:expensive:operation", {
  result: expensiveComputation(), // Always runs!
  duration: performance.now() - start
});
```

## Migration Checklist

### Files Updated in SPR-015

#### Frontend (`/ui/src/`)
- ✅ **Authentication**: Sign-in/Sign-up pages with auth flow logging
- ✅ **Components**: SoftCard with interaction tracking
- ✅ **API Clients**: Convex client with query/mutation logging
- ✅ **Test Files**: STT/TTS tests with execution logging
- ✅ **Orchestration**: Assessment orchestration with step-by-step logging
- ✅ **Streaming**: Triage streaming with real-time event logging

#### Backend (`/coach-up-ai-api/`)
- ✅ **Core**: Main application with startup/shutdown logging
- ✅ **HTTP**: All endpoints with request/response logging
- ✅ **Configuration**: Environment validation logging
- ✅ **Data Maintenance**: Processing pipeline logging

## Troubleshooting

### Common Issues

1. **Logs not appearing in production**
   - Set `FORCE_DEV_LOGS=1` environment variable
   - Check `NODE_ENV` is not set to `production`

2. **Performance impact in development**
   - Logs are designed to have minimal impact
   - Use debug level for verbose diagnostics only

3. **Log volume too high**
   - Use appropriate log levels (debug for detailed, info for important)
   - Consider log sampling for high-frequency events

### Debug Mode

Enable verbose logging for troubleshooting:

```bash
NODE_ENV=development FORCE_DEV_LOGS=1 LOG_LEVEL=debug npm run dev
```

## Future Enhancements

- **Centralized Log Aggregation**: Send logs to external services
- **Log Sampling**: Reduce high-frequency log volume
- **Custom Log Transports**: Database, file, or remote logging
- **Performance Correlation**: Link logs to performance metrics
