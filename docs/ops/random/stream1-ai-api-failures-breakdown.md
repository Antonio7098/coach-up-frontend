# 🔴 **STREAM 1: AI API Critical Failures** - Detailed Task Breakdown
*Priority: CRITICAL | Timeline: 3-5 days | Target: 28 failures → 0*

## **🎯 Mission Overview**
Fix all 28 failing AI API tests to establish reliable foundation for parallel work streams.

---

## **📋 FAILURE ANALYSIS**

### **1. Google Classifier Integration** (8 failures)
**Files**: `test_google_classifier_integration.py`
**Issue**: Logic mismatches in practice detection decisions

#### **Failing Tests**:
1. `test_one_off_greeting_practice` - Expected `start` → got `continue`
2. `test_multi_turn_sales_practice_start` - Expected `start` → got `continue`
3. `test_multi_turn_sales_practice_continue` - Expected `continue` → got `one_off`
4. `test_multi_turn_sales_practice_end` - Expected `end/continue` → got `one_off`

#### **Root Cause**:
- Context handling logic in Google classifier
- Decision thresholds for practice detection
- Multi-turn conversation state management

#### **Solution Strategy**:
```python
# Update decision logic to handle context properly
def classify(self, role: str, content: str, turn_count: int, request_id: Optional[str] = None, context: Optional[list] = None) -> dict:
    if context and turn_count > 0:
        # Consider previous interactions for decision making
        previous_decisions = [msg.get('decision') for msg in context if msg.get('decision')]
        if 'start' in previous_decisions:
            return {"decision": "continue", "confidence": 0.9, "reasons": "..."}
    # ... rest of logic
```

---

### **2. Skill Assessment Fanout** (6 failures)
**Files**: `test_skill_assessments.py`, `test_persist_v2.py`
**Issue**: Per-skill assessment processing and aggregation

#### **Failing Tests**:
1. `test_per_skill_fanout_aggregation_and_metrics` - Metric assertion failures
2. `test_per_skill_partial_failure_emits_error_metric` - Missing error metrics
3. `test_persistence_includes_skill_assessments` - Empty skillAssessments array
4. `test_per_skill_latency_histogram` - Missing latency metrics

#### **Root Cause**:
- Skill assessment payload structure issues
- Missing error metric emission
- Concurrent processing coordination gaps

#### **Solution Strategy**:
```python
# Fix skill assessment payload structure
async def _run_assessment_job(self, session_id: str, group_id: str, request_id: str = None, return_summary: bool = True):
    # Ensure skillAssessments is properly populated
    skill_assessments = []
    for skill in tracked_skills:
        assessment = await self._assess_single_skill(transcript, skill)
        skill_assessments.append({
            "skillId": skill["id"],
            "skillName": skill["name"],
            "scores": assessment.get("scores", {}),
            "highlights": assessment.get("highlights", []),
            "recommendations": assessment.get("recommendations", [])
        })

    summary = {
        "skillAssessments": skill_assessments,  # This was empty
        "meta": {...}
    }
    return summary
```

---

### **3. V2 Payload Persistence** (5 failures)
**Files**: `test_persist_v2.py`
**Issue**: V2 assessment payload structure validation

#### **Failing Tests**:
1. `test_persist_v2_payload_shape` - Empty skillAssessments array
2. Related persistence validation tests

#### **Root Cause**:
- V2 payload format not properly constructed
- Skill assessment data not being included in persistence

#### **Solution Strategy**:
```python
# Ensure V2 payload includes skill assessments
def _build_v2_payload(summary: dict, session_id: str, group_id: str) -> dict:
    return {
        "sessionId": session_id,
        "groupId": group_id,
        "rubricVersion": "v2",
        "summary": {
            "skillAssessments": summary.get("skillAssessments", []),
            "meta": summary.get("meta", {})
        }
    }
```

---

### **4. Provider Fallbacks** (4 failures)
**Files**: `test_providers_factory.py`
**Issue**: Google provider fallback to mock not working

#### **Failing Tests**:
1. `test_get_classifier_client_google_missing_key_falls_back_to_mock` - Wrong instance type
2. `test_get_classifier_client_google_with_key_but_unimplemented_falls_back_to_mock` - No NotImplementedError

#### **Root Cause**:
- Provider factory logic issues
- Missing API key handling
- Import/caching problems

#### **Solution Strategy**:
```python
# Fix provider factory fallback logic
def get_classifier_client() -> BaseClassifierClient:
    provider = os.getenv("AI_PROVIDER_CLASSIFIER", "mock")

    if provider == "google":
        try:
            client = GoogleClassifierClient()
            # Test the client to ensure it works
            if hasattr(client, '_available') and not client._available:
                logger.warning("Google classifier unavailable, falling back to mock")
                return MockClassifierClient()
            return client
        except Exception as e:
            logger.warning(f"Google classifier failed: {e}, falling back to mock")
            return MockClassifierClient()
    elif provider == "mock":
        return MockClassifierClient()
    else:
        raise ValueError(f"Unknown classifier provider: {provider}")
```

---

### **5. Transcript Persistence** (3 failures)
**Files**: `test_transcript_persist.py`
**Issue**: Convex mutation path mismatches

#### **Failing Tests**:
1. `test_persist_interaction_session_only_excludes_group_id` - Wrong mutation path
2. `test_persist_interaction_includes_group_id_when_present` - Missing groupId

#### **Root Cause**:
- Incorrect Convex mutation function paths
- Group ID parameter handling issues

#### **Solution Strategy**:
```python
# Fix Convex mutation paths and parameters
async def _persist_interaction_if_configured(
    session_id: str,
    group_id: Optional[str],
    message_id: str,
    role: str,
    content: str,
    ts_ms: int
):
    if group_id:
        # Include groupId when present
        await _convex_mutation(
            "functions/sessions:updateActivity",  # Correct path
            {
                "sessionId": session_id,
                "groupId": group_id,
                "incInteractionCount": 1,
                "lastActivityAt": ts_ms,
                "llmCostCentsDelta": 1
            }
        )
    else:
        # Session-only path
        await _convex_mutation(
            "functions/interactions:appendInteraction",  # Correct path
            {
                "sessionId": session_id,
                "messageId": message_id,
                "role": role,
                "content": content,
                "tsMs": ts_ms
            }
        )
```

---

## **🚀 EXECUTION PLAN**

### **Day 1: Triage & Planning**
- [ ] Analyze all 28 failures with detailed error logs
- [ ] Categorize failures by root cause
- [ ] Create test reproduction scripts
- [ ] Set up isolated test environments

### **Day 2: Provider Fallbacks (4 failures)**
- [ ] Fix `get_classifier_client` factory logic
- [ ] Add proper error handling for missing API keys
- [ ] Test fallback mechanisms
- [ ] Validate mock provider functionality

### **Day 3: Transcript Persistence (3 failures)**
- [ ] Fix Convex mutation paths
- [ ] Correct parameter handling for group IDs
- [ ] Add proper error handling
- [ ] Test both session-only and group-inclusive scenarios

### **Day 4: Skill Assessment Fanout (6 failures)**
- [ ] Fix skill assessment payload structure
- [ ] Add proper metric emission
- [ ] Test concurrent processing
- [ ] Validate aggregation logic

### **Day 5: V2 Payload & Integration (5 failures)**
- [ ] Fix V2 payload construction
- [ ] Test persistence integration
- [ ] Validate end-to-end flow
- [ ] Run full test suite regression

---

## **🧪 TESTING STRATEGY**

### **Unit Tests**
- Mock external dependencies (Google API, Convex)
- Test individual function logic
- Validate error conditions

### **Integration Tests**
- Test with real provider clients (where safe)
- Validate data flow between components
- Test error propagation

### **Regression Tests**
- Run full AI API test suite after each fix
- Monitor for new failures introduced
- Validate performance impact

---

## **📊 SUCCESS METRICS**

### **Quantitative**
- ✅ 28 failures → 0 failures
- ✅ Coverage: 58% → 75%+
- ✅ Test execution time < 2 minutes

### **Qualitative**
- ✅ All critical paths tested
- ✅ Error handling validated
- ✅ Provider fallbacks working
- ✅ Data persistence reliable

---

## **⚠️ DEPENDENCIES & BLOCKERS**

### **External Dependencies**
- Google API key for integration tests
- Convex backend availability
- Database connectivity

### **Internal Dependencies**
- Mock provider implementations
- Test data fixtures
- Configuration management

### **Contingency Plans**
- Use mock providers for all external dependencies
- Create isolated test environments
- Implement circuit breaker patterns for flaky services

---

## **📋 DELIVERABLES**

1. **Fixed Test Suite**: All 28 tests passing
2. **Improved Coverage**: 58% → 75%+ coverage
3. **Documentation**: Root cause analysis and fix explanations
4. **Test Infrastructure**: Enhanced mocking and test utilities
5. **Regression Suite**: Automated validation of fixes

---

*This breakdown provides specific, actionable tasks for fixing each category of failures. Focus on one category at a time to maintain momentum and validate fixes incrementally.*
