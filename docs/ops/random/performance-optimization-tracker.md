# Performance Optimization Tracker - Low Latency Voice Chat

**Goal**: Implement incremental performance improvements for voice chat with manual validation at each step.

**Target**: Reduce end-to-end latency from current ~5-6s (p50) to <2s for conversational AI.

---

## Overview

This document tracks the implementation of performance optimizations based on the comprehensive analysis provided. The approach is incremental with manual testing validation at each checkpoint to ensure stability and measure impact.

### Current Baseline (from existing benchmarks)
- **E2E Time**: p50=5.1s, p95=5.9s
- **Backend Processing**: p50=4.5s, p95=5.3s  
- **STT Time**: p50=1.0s, p95=1.2s
- **Chat Time**: p50=2.7s, p95=3.1s (TTFT ~1.4s)
- **TTS Time**: p50=0.8s, p95=1.0s

---

## Phase 1: Frontend Caching & Prefetching (Week 1)

Progress update (2025-09-08):
- Implemented turn-only cadence for summaries (removed time-based threshold). This stabilizes "turns until due" and prevents time-based jitter.
- Added lightweight summary status endpoint already in use: `/api/v1/session-summary/lite` with `version`, `due`, `reservation.inProgress` (client cache consumes it at 3s staleTime).
- Integrated trailer events on assistant stream; client updates interactions and summary status caches immediately on trailer receipt.
- Interactions API supports ETag/304 and limit; since-cursor remains TODO.

Impact observed:
- Fewer summary ensures per minute (no time gate), cleaner logs, and reduced UI flicker on due state.
- Reduced redundant network calls after assistant completion thanks to trailer piggybacking.

### 1.1 Add Interactions Since-Cursor Endpoint
**Goal**: Enable incremental fetching of recent interactions to reduce payload size and latency.

**Tasks**:
- [x] **Backend**: Add `GET /api/v1/interactions?sessionId=...&sinceId=...&limit=50` endpoint
  - Return only new interactions since the specified ID
  - Include ETag support for 304 responses
  - Add `latestId` in response for client cache management
- [x] **Frontend**: Implement client-side cache for interactions
  - Cache key: `sessionId + lastSeenId`
  - SWR-style tuning: staleTime ~5-10s, revalidateOnFocus true
  - Debounce prefetch triggers to avoid network spam

**Manual Verification Checkpoint**:
- [ ] Test incremental fetch with 10+ interactions in session
- [x] Verify 304 responses work correctly
- [x] Confirm cache hit/miss behavior in browser dev tools
- [x] Measure payload size reduction vs full history fetch

**Expected Impact**: 20-30% reduction in chat payload size, faster prompt assembly

---

### 1.2 Compact Summary Status Endpoint
**Goal**: Reduce summary status payload and enable frequent polling without overhead.

**Tasks**:
- [x] **Backend**: Ensure `/api/v1/session-summary` returns compact format:
  ```json
  {
    "lastSummary": {
      "version": "v1",
      "cutoffIndex": 5,
      "createdAt": "2025-01-XX",
      "incorporatedMessageIds": ["msg1", "msg2"],
      "preview": "Summary preview..."
    },
    "due": true,
    "turnsSince": 3,
    "reservation": {
      "inProgress": false,
      "lastJobAt": "2025-01-XX",
      "version": "v1"
    }
  }
  ```
- [x] **Backend**: Add lightweight variant `/api/v1/session-summary/lite` with only:
  ```json
  {
    "due": true,
    "lastSummary": {"cutoffIndex": 5},
    "reservation": {"inProgress": false}
  }
  ```
- [x] **Frontend**: Implement summary status cache with 3-5s staleTime

**Manual Verification Checkpoint**:
- [ ] Test both full and lite endpoints return correct data
- [ ] Verify cache behavior with rapid UI transitions
- [ ] Confirm due/not-due status updates correctly
- [ ] Measure response size difference (full vs lite)

**Expected Impact**: 50-70% reduction in summary status payload, faster UI updates

---

### 1.3 Assistant Stream Trailer Integration
**Goal**: Eliminate separate round-trip for summary status by piggybacking on assistant stream.

**Tasks**:
- [x] **Backend**: Add trailer event to assistant stream completion:
  ```json
  {
    "type": "trailer",
    "data": {
      "latestInteractionId": "msg_123",
      "summaryStatusLite": {
        "due": true,
        "lastSummary": {"cutoffIndex": 5},
        "reservation": {"inProgress": false}
      }
    }
  }
  ```
- [x] **Frontend**: Parse trailer events and update cache immediately
- [x] **Frontend**: Remove separate summary status fetch after assistant completion

**Manual Verification Checkpoint**:
- [ ] Verify trailer events arrive after assistant stream completion
- [ ] Confirm cache updates immediately on trailer receipt
- [ ] Test that separate summary fetch is no longer needed
- [ ] Measure reduction in network requests per conversation turn

**Expected Impact**: Eliminate 1 network round-trip per assistant response

---

## Phase 2: Prefetching Strategy (Week 2)

Status (started 2025-09-08):
- 2.2 post-stream prefetch is effectively covered via trailer-triggered cache refresh and fire-and-forget refreshes in the conversation context.
- 2.3 STT finalization prompt assembly from cache is implemented; user turn submission does not wait for summary fetch.
- 2.1 stream-start prefetch TBD; we will add a guarded prefetch at SSE open.

Next actions for Phase 2:
- Implement stream-start prefetch hook in MinimalConversationContext: when SSE connects, prefetch interactions since latestId and summary getStatus in background (ensure de-dup and staleTime respected).
- Add prefetch telemetry: capture start/end, hit/miss, and errors.
- Expose cache freshness indicators in UI panel for debugging (optional).

### 2.1 Assistant Stream Start Prefetching
**Goal**: Warm cache before user needs the data, reducing perceived latency.

**Tasks**:
- [ ] **Frontend**: On assistant stream start, kick off background fetches:
  - Recent interactions since last known message ID
  - Summary status (getStatus)
- [ ] **Frontend**: Implement prefetch coordination to avoid duplicate requests
- [ ] **Frontend**: Add prefetch success/failure telemetry

**Manual Verification Checkpoint**:
- [ ] Monitor network tab during assistant streaming
- [ ] Verify prefetch requests start immediately when assistant begins
- [ ] Confirm no duplicate requests for same data
- [ ] Test prefetch behavior with rapid conversation turns

**Expected Impact**: Cache warmed for next user interaction

---

### 2.2 Assistant Stream End Prefetching
**Goal**: Ensure cache is fresh after assistant completion for subsequent actions.

**Tasks**:
- [x] **Frontend**: On assistant stream end, re-run background fetches:
  - Recent interactions (to capture persisted assistant turn)
  - Summary status (to capture any summary reservation/completion)
- [x] **Frontend**: Implement fire-and-forget refresh after sending user turn
- [ ] **Frontend**: Add cache freshness indicators in UI

**Manual Verification Checkpoint**:
- [ ] Verify cache refreshes after assistant completion
- [ ] Test that subsequent user turns use fresh data
- [ ] Confirm fire-and-forget doesn't block user interactions
- [ ] Measure cache hit rate improvement

**Expected Impact**: Always have fresh data for next interaction

---

### 2.3 STT Finalization Optimization
**Goal**: Assemble prompt from warmed cache immediately without network waits.

**Tasks**:
- [x] **Frontend**: When STT finalizes, assemble prompt from cache immediately
- [x] **Frontend**: Submit user turn without waiting for network
- [ ] **Frontend**: Fire-and-forget background refresh after sending
- [ ] **Frontend**: Add prompt assembly timing telemetry

**Manual Verification Checkpoint**:
- [ ] Measure time from STT completion to user turn submission
- [ ] Verify prompt assembly uses cached data
- [ ] Test that background refresh doesn't interfere with user flow
- [ ] Confirm no network waits during prompt assembly

**Expected Impact**: Eliminate network wait time for prompt assembly

---

## Phase 3: Robustness & Concurrency (Week 3)

### 3.1 Idempotency & Retry Logic
**Goal**: Handle network failures and race conditions gracefully.

**Tasks**:
- [ ] **Backend**: Add client-generated messageId for user/assistant persistence
- [ ] **Backend**: Implement server-side deduplication on conflict
- [ ] **Frontend**: Add retry/backoff for Convex ensureJob calls (3 retries, 50-200ms jitter)
- [ ] **Frontend**: Implement single-flight reservations with TTL (60-120s)

**Manual Verification Checkpoint**:
- [ ] Test duplicate message submission (should be deduplicated)
- [ ] Simulate network failures and verify retry behavior
- [ ] Test reservation TTL expiration and re-reserve
- [ ] Verify no stuck jobs after TTL expiration

**Expected Impact**: Eliminate duplicate messages and stuck summary jobs

---

### 3.2 Abort Safety & Finalize Logic
**Goal**: Ensure server-side work completes even if client disconnects.

**Tasks**:
- [ ] **Backend**: Ensure all streaming endpoints use preventCancel semantics
- [ ] **Backend**: Add bounded budget (max generation time) for orphaned flows
- [ ] **Backend**: Implement finalize stage that runs after assistant completion:
  - Persist final assistant message if not yet persisted
  - Trigger ensureJob if due
  - Log durations and emit summary_status push
- [ ] **Backend**: Use monotonic time for thresholdSeconds to avoid jitter

**Manual Verification Checkpoint**:
- [ ] Test client disconnect during assistant streaming
- [ ] Verify server continues processing and completes work
- [ ] Confirm finalize logic runs even after disconnect
- [ ] Test bounded budget prevents infinite processing

**Expected Impact**: Reliable completion of server-side work

---

### 3.3 Hysteresis & Caching
**Goal**: Prevent thrashing and improve decision consistency.

**Tasks**:
- [ ] **Backend**: Add hysteresis on due checks
- [ ] **Backend**: Cache "not_due" decisions for 1-3s TTL
- [ ] **Frontend**: Implement debounced prefetch triggers
- [ ] **Frontend**: Add cache invalidation on state changes

**Manual Verification Checkpoint**:
- [ ] Test rapid UI transitions don't spam network
- [ ] Verify due/not-due decisions are consistent
- [ ] Test cache invalidation works correctly
- [ ] Measure reduction in unnecessary network requests

**Expected Impact**: Reduced network thrashing, consistent UI state

---

## Phase 4: Backend Performance Tuning (Week 4)

### 4.1 Connection Reuse & Pooling
**Goal**: Minimize connection overhead and improve throughput.

**Tasks**:
- [ ] **Backend**: Ensure HTTP keep-alive on frontend→Next.js and Next.js→FastAPI
- [ ] **Backend**: Tune connection pools for concurrent streams
- [ ] **Backend**: Optimize worker/process allocation for FastAPI
- [ ] **Backend**: Add connection pool monitoring

**Manual Verification Checkpoint**:
- [ ] Monitor connection reuse in network logs
- [ ] Test concurrent stream handling (5+ simultaneous)
- [ ] Verify no connection exhaustion under load
- [ ] Measure connection establishment time reduction

**Expected Impact**: Reduced connection overhead, better concurrency

---

### 4.2 Prompt Assembly Optimization
**Goal**: Reduce CPU overhead in hot paths.

**Tasks**:
- [ ] **Backend**: Prebuild stable prompt templates
- [ ] **Backend**: Avoid runtime heavy string concatenation
- [ ] **Backend**: Cache compiled prompts where possible
- [ ] **Backend**: Add prompt assembly timing metrics

**Manual Verification Checkpoint**:
- [ ] Measure prompt assembly time before/after optimization
- [ ] Test with various history depths and session lengths
- [ ] Verify prompt quality remains consistent
- [ ] Monitor CPU usage during prompt assembly

**Expected Impact**: Faster prompt assembly, reduced CPU usage

---

### 4.3 Model Warmup & Caching
**Goal**: Reduce cold start latency for model calls.

**Tasks**:
- [ ] **Backend**: Keep warm context or pre-load provider clients
- [ ] **Backend**: Implement model warmup on server start
- [ ] **Backend**: Add KV cache reuse for similar prompts
- [ ] **Backend**: Monitor warmup status and cache hit rates

**Manual Verification Checkpoint**:
- [ ] Measure first request latency vs subsequent requests
- [ ] Test model warmup on server restart
- [ ] Verify KV cache hit rates for similar prompts
- [ ] Monitor memory usage for warmup overhead

**Expected Impact**: Reduced first-token latency, better cache utilization

---

## Phase 5: UI/UX Optimizations (Week 5)

### 5.1 Optimistic UI Updates
**Goal**: Show immediate feedback while background work completes.

**Tasks**:
- [ ] **Frontend**: Show "updating summary..." with spinner after assistant ends
- [ ] **Frontend**: Replace with pushed/prefetched status when available
- [ ] **Frontend**: Implement optimistic interaction updates
- [ ] **Frontend**: Add loading states for all async operations

**Manual Verification Checkpoint**:
- [ ] Test optimistic updates feel responsive
- [ ] Verify loading states are clear and informative
- [ ] Test error handling for failed optimistic updates
- [ ] Measure perceived latency improvement

**Expected Impact**: Improved perceived performance, better UX

---

### 5.2 Coalesced Refreshes
**Goal**: Prevent layout thrash from multiple simultaneous updates.

**Tasks**:
- [ ] **Frontend**: Coalesce interactions and summary refreshes
- [ ] **Frontend**: Batch UI updates into single commit
- [ ] **Frontend**: Implement update queuing for rapid changes
- [ ] **Frontend**: Add update batching telemetry

**Manual Verification Checkpoint**:
- [ ] Test rapid conversation turns don't cause UI thrash
- [ ] Verify updates are batched and smooth
- [ ] Test update queuing under high load
- [ ] Measure UI update frequency reduction

**Expected Impact**: Smoother UI, reduced layout thrash

---

### 5.3 Backpressure Handling
**Goal**: Prevent system overload during rapid interactions.

**Tasks**:
- [ ] **Frontend**: Queue next send if previous assistant stream still finalizing
- [ ] **Frontend**: Add backpressure indicators in UI
- [ ] **Frontend**: Implement graceful degradation under load
- [ ] **Frontend**: Add backpressure telemetry

**Manual Verification Checkpoint**:
- [ ] Test rapid user interactions (barge-in scenarios)
- [ ] Verify queuing works correctly under load
- [ ] Test graceful degradation when overloaded
- [ ] Measure system stability under stress

**Expected Impact**: Better system stability, graceful handling of load

---

## Phase 6: Observability & Monitoring (Week 6)

### 6.1 Correlation IDs & Tracing
**Goal**: Enable end-to-end request tracing for debugging.

**Tasks**:
- [ ] **Backend**: Thread sessionId + turnId through all logs
- [ ] **Backend**: Add correlation ID to all requests
- [ ] **Frontend**: Include correlation ID in all API calls
- [ ] **Backend**: Implement distributed tracing

**Manual Verification Checkpoint**:
- [ ] Test correlation IDs flow through entire request chain
- [ ] Verify logs can be correlated across services
- [ ] Test tracing works for complex multi-service flows
- [ ] Measure debugging time improvement

**Expected Impact**: Faster debugging, better observability

---

### 6.2 Timing Spans & Metrics
**Goal**: Measure performance improvements and identify bottlenecks.

**Tasks**:
- [ ] **Backend**: Add timing spans for key operations:
  - assistant_start → assistant_end
  - assistant_end → summary_reserved
  - summary_reserved → summary_completed
  - client_disconnect → server_finalize_done
- [ ] **Backend**: Add error counters for OCC retries, reservation TTL expirations
- [ ] **Frontend**: Add client-side timing metrics
- [ ] **Backend**: Export metrics to Prometheus/Grafana

**Manual Verification Checkpoint**:
- [ ] Verify all timing spans are captured correctly
- [ ] Test error counters increment on failures
- [ ] Confirm metrics appear in Grafana dashboards
- [ ] Measure performance improvement over time

**Expected Impact**: Better performance visibility, data-driven optimization

---

## Success Metrics & Targets

### Primary Targets
- [ ] **E2E Latency**: <2s (p50), <3s (p95) - down from current 5.1s/5.9s
- [ ] **Backend Processing**: <1.5s (p50), <2s (p95) - down from current 4.5s/5.3s
- [ ] **Chat TTFT**: <800ms (p50), <1.2s (p95) - down from current 1.4s
- [ ] **Cache Hit Rate**: >80% for interactions, >90% for summary status

### Secondary Targets
- [ ] **Network Requests**: <3 per conversation turn (down from current 5-6)
- [ ] **Payload Size**: <50% of current size for interactions/summary
- [ ] **Error Rate**: <1% for all operations
- [ ] **User Satisfaction**: Improved perceived responsiveness

---

## Testing Strategy

### Manual Testing Protocol
1. **Before each phase**: Run baseline benchmark to establish current performance
2. **During implementation**: Test each feature individually with manual verification
3. **After each phase**: Run full benchmark suite and compare results
4. **Weekly**: Run 10+ conversation turns and measure p50/p95 latencies
5. **Before production**: Load test with 10+ concurrent users

### Automated Testing
- [ ] Add E2E audio pipeline pytest (skipped by default)
- [ ] Enable in CI on demand with performance thresholds
- [ ] Track results over time in `benchmarking/results/audio_pipeline/`
- [ ] Set up alerts for pipeline stage regressions

---

## Risk Mitigation

### High-Risk Changes
- **Cache invalidation logic**: Could cause stale data issues
- **Prefetching strategy**: Could increase network usage
- **Connection pooling**: Could cause resource exhaustion
- **Optimistic updates**: Could cause UI inconsistencies

### Mitigation Strategies
- [ ] Feature flags for all new functionality
- [ ] Gradual rollout with monitoring
- [ ] Rollback plan for each phase
- [ ] A/B testing for performance-critical changes

---

## Changelog

### 2025-01-XX - Phase 1: Frontend Caching & Prefetching
- [ ] Added interactions since-cursor endpoint
- [ ] Implemented compact summary status endpoint
- [ ] Integrated assistant stream trailer events
- [ ] Added client-side caching for interactions and summary status

### 2025-01-XX - Phase 2: Prefetching Strategy
- [ ] Implemented assistant stream start prefetching
- [ ] Added assistant stream end prefetching
- [ ] Optimized STT finalization with cache assembly

### 2025-01-XX - Phase 3: Robustness & Concurrency
- [ ] Added idempotency and retry logic
- [ ] Implemented abort safety and finalize logic
- [ ] Added hysteresis and caching improvements

### 2025-01-XX - Phase 4: Backend Performance Tuning
- [ ] Optimized connection reuse and pooling
- [ ] Improved prompt assembly performance
- [ ] Added model warmup and caching

### 2025-01-XX - Phase 5: UI/UX Optimizations
- [ ] Implemented optimistic UI updates
- [ ] Added coalesced refreshes
- [ ] Implemented backpressure handling

### 2025-01-XX - Phase 6: Observability & Monitoring
- [ ] Added correlation IDs and tracing
- [ ] Implemented timing spans and metrics
- [ ] Set up performance monitoring dashboards

---

## Next Steps

1. **Start with Phase 1**: Focus on frontend caching and prefetching
2. **Measure impact**: Run benchmarks after each phase
3. **Iterate based on results**: Adjust approach based on actual performance gains
4. **Document learnings**: Update this tracker with real-world insights
5. **Plan production rollout**: Gradual deployment with monitoring

---

## References

- [Voice Chat Audit](./voice_chat_audit.md) - Current system analysis
- [Chat Performance Checklist](./chat-performance-checklist.md) - Detailed performance metrics
- [Audio Pipeline Benchmark](../benchmarking/examples/audio_pipeline_benchmark.py) - Performance testing tool
