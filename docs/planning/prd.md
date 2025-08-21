# COACH UP

 📄 Product Requirements Document (PRD)

 - Purpose: a language learning app designed to provide a personalized, adaptive learning experience through speech and text chat. It helps users improve fluency by identifying mistakes, analyzing error patterns, and tailoring lessons to each user’s progress.
 - Version: 1.0
 - Date: Aug 17th, 2025
 - Status: Started - Draft, to be launched
 
 ## Table of Contents
 - [1. Overview](#1-overview)
   - [1.1 Purpose](#11-purpose)
   - [1.2 Background & Problem Statement](#12-background--problem-statement)
   - [1.3 Goals & Objectives](#13-goals--objectives)
   - [1.4 Target Audience](#14-target-audience)
 - [2. Key Features & Scope](#2-key-features--scope)
   - [2.1 Core Features](#21-core-features)
   - [2.2 Optional / Nice-to-Have Features](#22-optional--nice-to-have-features)
   - [2.3 Out of Scope](#23-out-of-scope)
 - [3. User Stories & Flows](#3-user-stories--flows)
 - [4. Example User Interactions](#4-example-user-interactions)
 - [5. Functional Requirements](#5-functional-requirements)
 - [6. Non-Functional Requirements](#6-non-functional-requirements)
 - [7. UX/UI Requirements](#7-uxui-requirements)
 - [8. Technical Requirements](#8-technical-requirements)
 - [9. Success Metrics (KPIs)](#9-success-metrics-kpis)
 - [10. Timeline & Milestones](#10-timeline--milestones)
 - [11. Risks & Assumptions](#11-risks--assumptions)
 - [12. Market and competition](#12-market-and-competition)
 - [13. Test Plan](#13-test-plan)

## 1. Overview

### What burning user problem are we solving right now?

Facilitating english language expert learning on demand at a affordable cost, replacing the need for expensive tutor or classes which limits the market for:

- Time & Accessibility: Coach/Teacher time involvement is limited
- Cost : Our solution is less expensive
- Product-Market fit : Users ought to have basic or advanced level of english to improve it, thus market we aim such as executives, sales, directors, phd student, teachers, are more likely to be open for self-serving and online access

### If our app disappeared in three months, what would users miss most?

Their tracked progress on what they have fixed, custom build notes included with data and what they should focus on for their next improvements when they speak daily.

### What’s the elevator pitch in 2 sentences?

Coach Up is an AI-powered speaking coach that gives instant, context-aware feedback while you practice real conversations by voice or text. It tracks mistakes, surfaces patterns, and adapts lessons so professionals can measurably improve fluency in minutes a day.

### Who will use this first—students, travelers, job-seekers, etc.? What’s the fastest way to get feedback from this core audience?

Initial target: professionals who already operate in English and want polish and confidence (e.g., sales reps, founders, managers, lecturers). Fastest feedback: recruit 15–20 users via LinkedIn and warm network, run 10‑min onboarding calls, collect in‑app CSAT after each session, and conduct 3 user interviews weekly.

### 1.1 Purpose
Help motivated learners practice speaking in realistic scenarios and receive immediate, actionable feedback that compounds over time; become the fastest path from “I can get by” to “I sound like a pro.”

### 1.2 Background & Problem Statement
Existing apps focus on beginners, scripted drills, or passive content. Professionals need on‑demand coaching that fits busy schedules, with feedback beyond grammar: clarity, tone, and pragmatics. Traditional tutors are costly/time‑bound; Coach Up delivers scalable, personalized coaching with measurable outcomes.

### 1.3 Goals & Objectives
- Deliver real‑time corrective feedback (speech and text) without breaking conversation flow.
- Detect and track error patterns; adapt scenarios to target weaknesses.
- Provide session summaries and a progress dashboard with clear next steps.
- Achieve measurable learning signals within 2 weeks (reduced repeated errors, longer sessions, return usage).

### 1.4 Target Audience
Primary users: professionals who use English at work (sales, leadership, researchers, educators).

Personas:
- Sales Professional Sam: mid‑career, needs persuasive, concise language; pain points: filler words, weak closes.
- International Manager Maya: fluent but wants polish; pain points: tone, idioms, cultural pragmatics.
- Academic Alex (PhD/Teacher): strong reading/writing; pain points: spontaneous speaking, pronunciation clarity.

## 2. Key Features & Scope

### MVP Focus Decisions
 - Delight moment: real-time corrective feedback while speaking, without breaking flow.
 - 48-hour slice: auth, chat (text/voice), inline corrections, basic summary, lightweight dashboard.
 - Simplest AI delivery: web-first Next.js app with streaming text + TTS; optional STT.
 - Cost control: start with open/free tiers (Web Speech API, Whisper small), batch background analysis.
 - Fast, impactful feedback: inline micro-corrections + end-of-session summary with 1–10 score and a concise next-step tip (Focus Insights reserved for V2).
 - Simple predefined Skills with linear progression towards a goal. The user chooses up to 3 tracked skills and can switch them at any time. Managed via the [Tracked Skill model](./technical-overview.md#1-core-data-models) (up to 3 active, ordered).
 - Defer: payments, P2P practice, heavy gamification, offline mode, non-English UI.

### 2.1 Core Features

- Chat Interface (speech & text): Users interact in real conversations.
- Study Materials Integration: Lessons, exercises, and guided paths.
- Mistake Tracking & Error Pattern Analysis: System identifies recurring errors (grammar, pronunciation, vocabulary).
- Adaptive Responses: The app adjusts difficulty and feedback based on user patterns.
- Progress Dashboard: Visualization of improvements, streaks, and weaknesses.
- Gamification Elements: Points, badges, levels, or streaks to boost engagement.
- Voice Recognition: Speech-to-text & pronunciation scoring.

### 2.2 Optional / Nice-to-Have Features

- Focus Insights (V2 — non-MVP): actionable recommendations tied to tracked skills; derived from assessments and prioritized to drive progression.
- Peer-to-peer practice.
- AI tutor personality customization.
- Offline mode.

### 2.3 Out of Scope

- Payments/subscriptions (manual access only during MVP).
- Offline mode and full localization/internationalization.
- Peer‑to‑peer practice and tutor marketplace.
- Advanced gamification (leaderboards, complex quests).
- Non‑English instruction language support.

## 3. User Stories & Flows

### Decisions
 - Shortest path: email/social sign-in → pick goal → start chat in <30s.
 - 5‑minute session: 60–90s warm‑up → 2–3 min scenario → 30–60s summary + next step.
 - Level differences: beginner gets slower pace and more explicit grammar prompts; advanced gets tone/polish and scenario scoring.
 - Reduce friction: single primary CTA, default mic permissions flow, sensible defaults, optional text mode.
 - Delight: immediate “wins” in summary (strengths) and one focused recommendation.

#### User Story Examples:

- As a beginner learner, I want to practice conversational greetings so I can build confidence.
- As an advanced learner, I want the app to highlight subtle grammar mistakes so I can refine my fluency.

User Flow Diagrams: Registration → Onboarding → First Chat → Feedback → Dashboard.

```mermaid
flowchart LR
   A[Landing/Signup] --> B[Onboarding: goals + level]
   B --> C[Choose scenario or free chat]
   C --> D[Live chat (voice/text)]
   D --> E[Inline corrections + tips]
   E --> F[Post-chat summary + score]
   F --> G[Dashboard: trends + next focus]
   G --> C
```

## 4. Example User Interactions

Example:

[ai] Hi Oliver! Shall we get started by practicing assertive language in your sales pitch? Sell me this pencil.

[user] You want this pencil …
 
 Beginner (text)
 [user] Yesterday I go to the meeting.
 [ai] Suggestion: “went to the meeting.” Pattern: past tense errors.
 
 Advanced (speech)
 [user] (audio) I'd appreciate if you could revert back by EOD.
 [ai] Tone/polish: “revert” → “reply”; “by EOD” is fine internally; consider “by the end of the day” externally.
 
 Scenario closeout
 [ai] Summary: Strength in structure; focus: reduce hedging. Score: 7/10. Next: assertiveness drill.

[ai] Well done! You did …

…

## 5. Functional Requirements

### Decisions
 - Must-have reliability: auth, chat transport, streaming, STT/TTS fallback, assessment creation and storage.
 - Robustness: keep stateless API routes for chat; use queue for background analysis; retries with backoff.
 - Initial error types: grammar (tense, articles), vocabulary choice, tone/clarity; pronunciation optional.
 - Authentication: email + social via Clerk; SSO deferred.
 - Analytics now: sessions/day, turns/session, corrections accepted, D1/D7 retention.

- Authentication: Email, social, or SSO login.
- Chat System: Text + speech input/output.
- Content Delivery: Dynamic lesson modules.
- Error Analysis Engine: Logs mistakes, classifies error type, and adapts content.
- Analytics: Tracks daily usage, accuracy, retention.

Acceptance criteria (MVP):
- Users can sign up/login and start a chat in under 30s.
- p95 latency: text response ≤1.5s; TTS playback start ≤2.5s.
- STT word error rate ≤10% on clean audio; fallback to text if STT fails.
- At least one assessment per session with stored score, focus, and explanation.
- Dashboard shows last 7 days of sessions and top 3 focus areas.
- Basic analytics: sessions/day per user and average turns/session.

## 6. Non-Functional Requirements

 Targets summary:
 - Max response time: p95 text ≤1.5s, TTS start ≤2.5s.
 - Capacity this month: ~100 concurrent users; scale up with caching and queue tuning.
 - STT outage plan: switch to text input automatically, show banner, retry later.
 - Data we will NOT collect now: precise location, contacts, payment data.
 - Accessibility: adjustable font sizes, high-contrast theme, keyboard and screen-reader support, captions.

- Performance: Chat responses under 1.5s.
- Scalability: Support for ~100 concurrent users at MVP; scale horizontally thereafter.
- Security: User data privacy (GDPR/CCPA compliance).
- Reliability: 99.5% uptime.
- Accessibility: Multi-language UI, voice accessibility.
- Reliability: graceful degradation when STT/LLM is down (retry with backoff, show helpful error, offer text‑only mode).
- Privacy: store only necessary PII; redact raw audio after processing; encryption at rest and in transit.
- Observability: logs and trace IDs per session; alerts on latency/error thresholds. See [Monitoring & Observability](../ops/monitoring.md).

## 7. UX/UI Requirements

 Design decisions:
 - Always-visible primary CTA (Start/Resume Chat) on chat and dashboard.
 - Corrections as subtle inline chips; expandable panel for explanations/examples.
 - Progressive disclosure: basic tips inline, deeper detail in summary.
 - Mobile cues: large mic button, hold‑to‑talk option, visible session timer/progress bar.

- Clean, minimal chat-first interface.
- Intuitive error feedback (subtle, not overwhelming).
- Visual learning cues (color-coded corrections, tooltips).
- Mobile-first responsive design.

Screens (MVP):
- Auth (Sign up/in, forgot password)
- Chat (voice controls, transcript, corrections panel)
- Post‑chat summary
- Dashboard (history, trends, focus)
- Settings (microphone, language, privacy)

## 8. Technical Requirements

 Decisions:
 - Stack: Next.js + Convex + Clerk + shadcn/ui + Tailwind; Python FastAPI + LangChain for AI.
 - APIs: use provider SDKs with streaming; wrap with typed clients; feature flag vendor swaps.
 - Defer/stub: payments, advanced analytics, multi‑tenant orgs; add later behind flags.
 - Failure handling: retries, circuit breakers for AI calls, local cache for last transcript.
 - Deployment: Vercel for web; container host for Python service; environment-based configs.

 - Platform: Web‑first (desktop and mobile web).
 - Frontend: Next.js (React, App Router) with shadcn/ui + Tailwind.
 - Backend: Next.js API routes + Python FastAPI (AI service) with LangChain.
 - Database: Convex (realtime, typed) for users, sessions, interactions, assessments; object storage for audio.
 - AI/ML Integration: LLM chat; pluggable STT/TTS providers.
 - 3rd Party APIs: STT, TTS; payments deferred post‑MVP.

Recommended MVP approach:
 - Web-first: Next.js (App Router) + Tailwind + shadcn/ui.
 - Voice: Web Speech API where supported; fallback to cloud STT (e.g., Whisper/provider). TTS via Web Speech or provider.
 - Backend: Next.js API routes for chat/session; Python FastAPI for AI orchestration; queue for background analysis.
 - Data: Convex for users, sessions, interactions, assessments; S3‑compatible storage for audio.
  - See Technical Overview for architecture and data models: [Technical Overview](./technical-overview.md)
  - Related docs: [Monitoring & Observability](../ops/monitoring.md), [Benchmarking & LLM Provider Evaluation](../ops/benchmarking.md)

## 9. Success Metrics (KPIs)

 - Week 1 success: 20+ unique users complete ≥1 five‑minute session and rate feedback ≥4/5.
 - Learning metric: repeated mistake rate per user decreases ≥15% by session 4.
 - 7‑day go/no‑go: ≥25% D7 retention and ≥60% corrections marked helpful.
 - Feedback collection: in‑app CSAT after each session and a 3‑question survey on day 3.

- Daily active users (DAU).
- Average session length.
- Mistake reduction rate per user.
- Retention rate (Day 7, Day 30).
- Conversion to paid plan (if applicable).

Targets (first 2 weeks):
- 25 DAU, 100 total signups, ≥30% D7 retention.
- Median session length ≥5 minutes; median ≥2 sessions/user/week.
- ≥60% of corrections accepted or marked helpful.
- p95 response latency ≤1.5s (text), ≤2.5s (TTS start).

## 10. Timeline & Milestones

 Must‑launch features: auth, chat (voice/text), inline corrections, session summary, dashboard, metrics.
 Demo day plan: 3 scripted scenarios (sales pitch, status update, interview intro) + live correction demo.
 Ownership: to be assigned per feature (Auth, Chat, AI, Data, UI). Add owners in issue tracker.

 - 48h MVP slice (by Aug 21, 2025): voice/text chat, inline corrections, basic dashboard, metrics.
 - Alpha (Aug 26, 2025): 10 pilot users; bug fixes; STT/TTS fallback; analytics baseline.
 - Beta (Sep 2, 2025): 50 users; scenario assessments and post‑chat summaries.
 - Public preview (Sep 16, 2025): polish, landing page, feedback loop, opt‑in waitlist.

 See Sprint plan: [SPR-001 — MVP Chat Core](../ops/sprints/SPR-001.md)

## 11. Risks & Assumptions

 Top risks and assumptions listed below.

- Risk: Speech recognition accuracy varies by accent.
- Risk: LLM cost/scalability.
- Assumption: Users have internet access.

Mitigations:
- Accents/STT: show transcript confidence; allow quick edits; collect accent test set; offer text fallback.
- LLM cost: cache prompts/results; use smaller models for realtime; batch background analysis; set budget alarms.
- Data privacy: minimize PII; consent gating; auto‑delete audio after N days; DPAs with vendors.

## 12. Market and competition

 Positioning and borrowable ideas:
 - Borrow onboarding: quick goal selection and level self‑assessment from Duolingo.
 - Borrow UI: subtle streak and progress cues without gamification overload.
 - Focus messaging: professional polish and measurable feedback over generic vocabulary drills.

Competitive snapshot:
- Duolingo, Babbel: strong for beginners; weaker on professional scenarios and immediate, actionable speaking feedback.
- ELSA, Speechling: pronunciation focus; limited multi‑turn scenario coaching.
- Speak, TalkPal: scripted dialogs; less adaptive, limited error pattern tracking.
 - Our wedge: on‑demand coaching for professionals with measurable progress and scenario‑based assessments tied to goals.

Initial glossary terms:
- STT: Speech‑to‑Text (converts audio to text)
- TTS: Text‑to‑Speech (renders AI response as audio)
- DAU/WAU: Daily/Weekly Active Users
- Assessment: structured evaluation (score + explanation) of a turn or scenario
- Scenario: multi‑turn roleplay with a defined objective

## 13. Test Plan

- End-to-End happy path: Clerk sign-in → send chat message → receive streaming reply (text + optional TTS) → end-of-session summary saved → dashboard shows latest progress.
- Rubric unit tests: given sample turns, assert category/kind and score bucketing are stable across rubric versions.
- API contract: Next.js ↔ FastAPI Clerk JWT verification and requestId propagation.
- Rate limiting: exceed per-user quotas to verify 429 with Retry-After and graceful UI messaging.
- Audio guardrails: reject oversized/invalid audio; fallback to text mode with clear banner.
- Load smoke: 20 concurrent sessions streaming; p95 latency within targets; no dropped updates.
- Data constraints: Assessment write/read, groupId grouping for multi-turn, Tracked Skill constraints (max 3 active, ordering updates).
