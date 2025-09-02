# VAD (Voice Activity Detection) Fixes Checklist

## Overview
This document outlines the identified issues with VAD in coach-min and coach-debug, along with a prioritized checklist of fixes to improve first-word detection and silence handling after short utterances.

## Identified Issues

### 1. First Word Detection Problem - Excessive Debounce
**Location**: `MinimalMicContext.tsx` lines 262-264, 287-288

**Problem**: VAD requires 180ms of continuous speech (100ms minimum + 80ms debounce) before detection, missing short words and barge-ins.

### 2. Silence Detection Issues After Short Words
**Location**: `MinimalMicContext.tsx` lines 311-318, 313

**Problems**:
- Inconsistent silence thresholds (700ms vs 400ms for barge-in)
- Silence accumulator resets immediately on any speech detection
- Aggressive RMS downsampling (every 32nd sample) misses brief audio spikes

### 3. State Management Complexity
**Location**: Throughout `MinimalMicContext.tsx`

**Problems**:
- Multiple refs for tracking state create potential race conditions
- Complex interaction between barge-in logic and regular VAD

## Recommended Fixes Checklist

### 🔴 HIGH PRIORITY (Immediate Impact)

#### [ ] Reduce Debounce Time for Faster Detection
- **File**: `MinimalMicContext.tsx`
- **Lines**: 262-264
- **Change**: Reduce `debounceMs` from 80ms to 30ms
- **Change**: Reduce `minSpeechMsBase` from 100ms to 80ms
- **Expected Impact**: Much more responsive to short words and barge-ins
- **Testing**: Verify "yes", "no", "hi", "ok" are detected reliably

#### [ ] Improve Silence Detection Hysteresis
- **File**: `MinimalMicContext.tsx`
- **Lines**: 311-318
- **Change**: Add hysteresis to prevent premature silence detection
- **Change**: Only reset silence counter when speech exceeds threshold + hysteresis
- **Expected Impact**: Prevents false silence detection after short words
- **Testing**: Speak short words and verify silence isn't detected immediately after

### 🟡 MEDIUM PRIORITY (Performance Optimization)

#### [ ] Optimize RMS Calculation Sampling
- **File**: `MinimalMicContext.tsx`
- **Lines**: 270-276
- **Change**: Reduce downsampling from every 32nd sample to every 8th sample
- **Expected Impact**: Better detection of brief audio spikes
- **Testing**: Test with very short utterances (<100ms)

#### [ ] Add Barge-in Specific Thresholds
- **File**: `MinimalMicContext.tsx`
- **Lines**: 291-305
- **Change**: Implement separate, lower thresholds for barge-in detection
- **Change**: Use `bargeInThreshold = speechThreshold * 0.8`
- **Change**: Use `bargeInMinFrames = 3` for faster barge-in detection
- **Expected Impact**: More responsive barge-in behavior
- **Testing**: Test barge-ins at different playback volumes

### 🟢 LOW PRIORITY (Advanced Features)

#### [ ] Add Adaptive Thresholds
- **File**: `MinimalMicContext.tsx`
- **Change**: Implement dynamic threshold adjustment based on ambient noise
- **Change**: Track background noise level and adjust speech threshold accordingly
- **Expected Impact**: Better performance in varying acoustic environments
- **Testing**: Test in quiet room vs noisy environment

#### [ ] Add VAD Calibration Phase
- **File**: `MinimalMicContext.tsx`
- **Change**: Add initial calibration to determine optimal thresholds
- **Change**: Record ambient noise for 1 second on startup
- **Change**: Store calibration data in localStorage
- **Expected Impact**: Personalized VAD tuning per user/environment
- **Testing**: Compare VAD performance before/after calibration

#### [ ] Improve State Management
- **File**: `MinimalMicContext.tsx`
- **Change**: Consolidate multiple refs into single state object
- **Change**: Add state validation to prevent race conditions
- **Expected Impact**: More reliable VAD behavior
- **Testing**: Stress test with rapid barge-ins and state changes

## Implementation Plan

### Phase 1: Critical Fixes (Week 1)
1. Reduce debounce time (30ms)
2. Improve silence detection hysteresis
3. Basic testing with short words

### Phase 2: Performance Optimization (Week 2)
1. Optimize RMS sampling
2. Add barge-in specific thresholds
3. Comprehensive testing across different scenarios

### Phase 3: Advanced Features (Week 3-4)
1. Adaptive thresholds
2. VAD calibration
3. State management improvements

## Testing Strategy

### Basic Tests
- [ ] Short words: "yes", "no", "hi", "ok", "stop", "go"
- [ ] Barge-in scenarios: interrupt playback with single words
- [ ] Silence handling: speak short word, verify silence detection timing

### Advanced Tests
- [ ] Different acoustic environments (quiet, noisy, echoey)
- [ ] Various playback volumes for barge-in testing
- [ ] Edge cases: very short utterances (<50ms), very long silence (>2s)

### Performance Tests
- [ ] CPU usage comparison before/after changes
- [ ] Battery impact on mobile devices
- [ ] Memory usage monitoring

## Monitoring and Metrics

### Key Metrics to Track
- VAD detection latency (time from speech start to detection)
- False positive rate (incorrect speech detection)
- False negative rate (missed speech detection)
- Silence detection accuracy after short words
- Barge-in responsiveness

### Logging Improvements
- Add detailed VAD state logging for debugging
- Track RMS values and threshold comparisons
- Monitor debounce and hysteresis behavior

## Risk Assessment

### Low Risk Changes
- Reducing debounce time
- Optimizing RMS sampling
- Adding barge-in specific thresholds

### Medium Risk Changes
- Improving silence detection hysteresis
- Adding adaptive thresholds

### High Risk Changes
- Major state management refactoring
- VAD calibration implementation

## Rollback Plan

1. **Quick Rollback**: Revert debounce changes (single line)
2. **Partial Rollback**: Keep debounce reduction, revert hysteresis changes
3. **Full Rollback**: Restore original VAD implementation entirely

## Success Criteria

- [ ] First-word detection rate >95% for words >50ms
- [ ] Silence detection after short words within 200-500ms
- [ ] Barge-in detection <100ms from speech start
- [ ] No increase in false positive detections
- [ ] Maintain existing performance characteristics

## Related Documents

- `voice-chat-stability-tracker.md` - Current VAD stability metrics
- `voice-chat-minimal-contexts.md` - VAD implementation details
- `monitoring.md` - Performance monitoring setup

---

**Document Version**: 1.0
**Last Updated**: $(date)
**Author**: VAD Analysis Team
**Status**: Ready for Implementation
