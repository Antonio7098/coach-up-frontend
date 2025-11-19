# Assessment System Testing Guide

This document provides comprehensive testing strategies and curl commands to verify the new LLM-powered skill assessment system with polling capabilities.

## Overview of New Assessment Flow

The new assessment flow works as follows:

1. **Triage** → Interactions are triaged and grouped
2. **Orchestrator** → `finalizeAssessmentsForGroups` is called for each group
3. **AI API Trigger** → POST `/api/assessments/run` queues AI assessment job
4. **Polling** → GET `/api/assessments/results` polls for LLM results (with timeout/fallback)
5. **Finalize** → POST `/api/assessments/convex/finalize` stores enriched results + group metadata
6. **UI Display** → ASSESS tab shows real LLM feedback and group-level insights

## Environment Setup

First, configure your `.env.local` with these key variables:

```bash
# Enable polling (set to 0 to use legacy direct approach)
ASSESS_RESULTS_POLL=1
ASSESS_RESULTS_POLL_TIMEOUT_MS=5000
ASSESS_RESULTS_POLL_MAX_ATTEMPTS=5
ASSESS_RESULTS_POLL_INTERVAL_MS=1000

# Skill hash alignment (must match AI API)
SKILL_HASH_SALT=your_secret_salt
NEXT_PUBLIC_SKILL_HASH_SALT=your_secret_salt

# Server-to-server auth
PERSIST_ASSESSMENTS_SECRET=your_secret_key

# AI API configuration
AI_API_BASE_URL=http://127.0.0.1:8000
```

## Test Scenarios

### 1. Polling Success Test

Test that polling works when AI API returns results quickly.

**Setup**: Start AI API that returns mock results within 2-3 seconds.

**Test Command**:
```bash
# First, trigger triage (this will eventually call orchestrator)
curl -X POST "http://127.0.0.1:3000/api/v1/interactions" \
  -H "Content-Type: application/json" \
  -d '{
    "sessionId": "test_session_123",
    "message": {
      "role": "user", 
      "content": "I practiced presenting today and felt more confident"
    },
    "isVoice": false
  }'
```

**Expected Behavior**:
- Logs show `assess_poll_start`, `assess_poll_success` events
- `assess_llm_results_ok` with actual skill count > 0
- `assess_finalize_result` with status 200
- ASSESS tab shows real LLM feedback instead of skeleton

### 2. Polling Timeout/Fallback Test

Test that system falls back to skeleton when AI API is slow/unavailable.

**Setup**: 
- Set `ASSESS_RESULTS_POLL_TIMEOUT_MS=2000` (short timeout)
- Stop AI API or make it return results after 5+ seconds

**Test Command**:
```bash
curl -X POST "http://127.0.0.1:3000/api/v1/interactions" \
  -H "Content-Type: application/json" \
  -d '{
    "sessionId": "test_timeout_456", 
    "message": {
      "role": "user",
      "content": "Today I worked on my communication skills"
    },
    "isVoice": false
  }'
```

**Expected Behavior**:
- Logs show `assess_poll_start`, multiple `assess_poll_attempt`, then `assess_poll_timeout`
- Falls back to skeleton results (level matches current tracked skill levels)
- System continues working, no crashes
- `assess_finalize_result` still shows status 200

### 3. Group-Level Metadata Test

Test that group-level highlights/recommendations are stored and displayed.

**Prerequisites**: AI API must return results like:
```json
{
  "sessionId": "test_session",
  "groupId": "group_123", 
  "results": {
    "skillAssessments": [
      {
        "skillId": "communication",
        "skillHash": "abc123...",
        "level": 7,
        "levelFeedback": {
          "currentLevel": 7,
          "strengths": ["Clear articulation", "Good eye contact"],
          "improvements": ["Reduce filler words"],
          "nextLevelCriteria": ["Present to larger audiences"],
          "focus": ["Practice advanced techniques"]
        }
      }
    ],
    "highlights": ["Strong improvement in confidence", "Consistent practice showing results"],
    "recommendations": ["Continue daily practice", "Record presentations for self-review"],
    "rubricKeyPoints": ["Focus on delivery", "Work on content structure"],
    "meta": {"skillsCount": 1, "sessionDuration": 300}
  }
}
```

**Test Commands**:
```bash
# 1. Test results endpoint directly
curl "http://127.0.0.1:3000/api/assessments/results?sessionId=test_session&groupId=group_123"

# 2. Check stored assessment
curl "http://127.0.0.1:3000/api/assessments/convex/assessments/latest?sessionId=test_session"
```

**Expected Results**:
- Results endpoint returns normalized data with group-level fields
- Latest assessment contains non-empty highlights, recommendations, rubricKeyPoints
- UI ASSESS tab shows group-level insights section

### 4. Hash Alignment Test

Test that skill hashes match between UI, Convex, and AI API.

**Test Commands**:
```bash
# 1. Check skill hash generation
curl -X POST "http://127.0.0.1:3000/api/assessments/convex/finalize" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your_secret_key" \
  -d '{
    "sessionId": "hash_test_789",
    "groupId": "group_hash_test", 
    "rubricVersion": "v2",
    "results": {
      "skillAssessments": [
        {
          "skillId": "communication",
          "skillHash": "EXPECTED_HASH_VALUE",
          "level": 6,
          "levelFeedback": {"currentLevel": 6, "strengths": [], "improvements": [], "nextLevelCriteria": [], "focus": []},
          "assessmentMetadata": {},
          "sourceContext": {"assessmentType": "single_qa_pair"}
        }
      ]
    }
  }'
```

**Expected Behavior**:
- No "skillHash not found" warnings in logs
- Level updates work properly (check `functions/skills:updateLevelFromRecentAssessments`)
- Skills tracked properly in UI

### 5. End-to-End Flow Test

Complete integration test from user message to UI display.

**Test Sequence**:
```bash
# 1. Start with clean session
SESSION_ID="e2e_test_$(date +%s)"

# 2. Send first message to establish session
curl -X POST "http://127.0.0.1:3000/api/v1/interactions" \
  -H "Content-Type: application/json" \
  -d "{
    \"sessionId\": \"$SESSION_ID\",
    \"message\": {\"role\": \"user\", \"content\": \"Hello, I want to practice my presentation skills\"},
    \"isVoice\": false
  }"

# 3. Send assessment-triggering message
curl -X POST "http://127.0.0.1:3000/api/v1/interactions" \
  -H "Content-Type: application/json" \
  -d "{
    \"sessionId\": \"$SESSION_ID\",
    \"message\": {\"role\": \"user\", \"content\": \"I just finished practicing my presentation and I think I did well with eye contact and speaking clearly\"},
    \"isVoice\": false
  }"

# 4. Wait for processing, then check results
sleep 3
curl "http://127.0.0.1:3000/api/assessments/convex/assessments/latest?sessionId=$SESSION_ID"

# 5. Verify UI display by visiting:
echo "Check UI at: http://127.0.0.1:3000?sessionId=$SESSION_ID"
echo "Navigate to ASSESS tab to verify display"
```

**Expected End-to-End Results**:
- User message triggers triage
- Triage calls orchestrator with polling
- AI API processes and returns enriched results
- Results stored with group-level metadata
- UI shows real feedback instead of skeleton
- No errors in browser console or server logs

### 6. Performance Test

Test system behavior under concurrent load.

**Test Commands**:
```bash
# Run multiple sessions concurrently
for i in {1..5}; do
  SESSION_ID="load_test_${i}_$(date +%s)"
  (
    curl -X POST "http://127.0.0.1:3000/api/v1/interactions" \
      -H "Content-Type: application/json" \
      -d "{
        \"sessionId\": \"$SESSION_ID\",
        \"message\": {\"role\": \"user\", \"content\": \"Load test message $i for skill assessment\"},
        \"isVoice\": false
      }" &
  )
done
wait
```

**Monitor**:
- Server memory/CPU usage
- AI API response times
- Database connection pool usage
- No request timeouts or 500 errors

## Debugging Commands

### Check System Health
```bash
# 1. Verify AI API is reachable
curl "http://127.0.0.1:8000/health" 2>/dev/null || echo "AI API down"

# 2. Check Convex connection
curl "http://127.0.0.1:3000/api/assessments/convex/assessments/latest?sessionId=debug_test" 

# 3. Test results proxy
curl "http://127.0.0.1:3000/api/assessments/results?sessionId=debug&groupId=debug"
```

### Log Analysis
```bash
# Watch for assessment events (in development console)
# Look for these event types:
# - assess_cadence_started
# - assess_poll_start, assess_poll_attempt, assess_poll_success/timeout
# - assess_llm_trigger_ok/error
# - assess_finalize_result

# Check for errors:
# - assess_poll_error
# - assess_llm_error  
# - skillHash not found warnings
```

## Troubleshooting

### Common Issues

1. **Polling always times out**
   - Check AI API is running and reachable
   - Verify AI API implements `/assessments/results` endpoint
   - Check firewall/network connectivity

2. **skillHash not found warnings**
   - Ensure `SKILL_HASH_SALT` matches across UI, Convex, and AI API
   - Verify skill catalog is populated in Convex
   - Check skill IDs match between systems

3. **No group-level metadata displayed**
   - Verify AI API returns highlights/recommendations in results
   - Check finalize route logs for successful storage
   - Ensure UI correctly reads from latest assessment

4. **System falls back to skeleton too often**
   - Increase `ASSESS_RESULTS_POLL_TIMEOUT_MS`
   - Check AI API processing times
   - Verify polling interval isn't too frequent

### Debug Mode

Enable verbose logging:
```bash
export LOG_LEVEL=debug
export ASSESS_RESULTS_POLL=1
export ASSESS_RESULTS_POLL_TIMEOUT_MS=10000  # Longer timeout for debugging
```

This comprehensive testing approach ensures the new polling-based assessment system works reliably across all scenarios and gracefully handles failures.
