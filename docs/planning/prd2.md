# Product Requirements Document: CoachUp – AI Speech Coach

- Version: 1.0
- Date: Aug 21st, 2025
- Status: Draft – In Development

## 1. Overview

### 1.1 Purpose
CoachUp is an AI-powered speech coach providing real-time, personalized feedback during natural conversation. Unlike static feedback tools, it uses a background assessment engine to continuously track, score, and visualize user progress across chosen focus skills (e.g., stutter reduction, prosody, sales pitch delivery). Designed for personal development, it offers a seamless coaching experience at a fraction of the cost of live tutors.

### 1.2 Background & Problem Statement
Existing apps (Orai, Yoodli, Ummo) primarily focus on filler word counts, speed, and basic summaries. They lack depth of assessment (intonation, stuttering, prosody) and are often enterprise/team oriented. Professionals, students, and advanced learners require continuous coaching, not just reports. Live tutors are expensive, inconsistent, and limited in availability. CoachUp addresses these gaps with on-demand tutoring, structured skill progression, and detailed tracking.

### 1.3 Goals & Objectives
- Seamless conversation coaching with background assessment.
- Transparent, gamified progress tracking (points, medals, levels).
- User-selected skills from a broad indexed library.
- Encourage daily practice with challenges, leaderboards, and scenarios.

### 1.4 Target Audience
- Professionals: Sales reps, executives, teachers, lawyers, academics
- Students & Researchers: Fluent English presentation skills
- Job Seekers: Interview preparation
- Non-native Speakers: Advanced English users seeking polish

Personas:
- Sofia (26, PhD student): Needs clear presentation skills for conferences.
- Raj (34, Sales Manager): Wants persuasive, confident delivery with fewer fillers.
- Elena (41, Teacher): Aims to cut pauses and speak fluently in lectures.

## 2. Key Features & Scope

### 2.1 Core Features
- Real-Time Chat Coaching: Live chat is the main point of interaction, with inline feedback and background assessments.
- Language Skills Engine: Coaches on sophistication, clarity, persuasiveness, and contextual adaptation.
- Speech Analysis: Evaluates stutters, filler words, pacing, and prosody; feeds into assessment and skill progression. (Post-MVP for audio signal features; MVP uses transcript-based approximations only.)
- Background Assessment Agent: Detects assessable speech events and creates structured assessment records.
- Skill Index: Users choose up to 3 tracked skills (MVP; expand to 3–4+ in paid tiers) (e.g., stutter, prosody, sales tone).
- Focus Areas: Specific, actionable steps to improve your score in your chosen skill.
- Skill Ranking System: Each skill scored 1–10 with detailed criteria.
- Gamification: Medals (Bronze/Silver/Gold for 8–10/10), XP points, overall level.
- Progress Dashboard: Visualizes graphs, medals, streaks, and improvements.
- Scenarios: Pre-built or user-generated challenges tied to skills.
- Courses: Pre-built (can be in collaboration with experts/famous people) paths with unique skills.
- Daily Challenges & Leaderboards: Motivational community layer.
- Transparency & Control: Users can review and edit assessments manually.

#### 2.1.1 Skill Scoring Example: “Clarity/Eloquence”
Definition: Ability to express ideas clearly, avoiding ambiguity and jargon.

| Level | Description                         | Example                                                                                                               | Medal   |
|------:|-------------------------------------|-----------------------------------------------------------------------------------------------------------------------|---------|
| 1–3   | Often confusing or disorganized     | “So, we’ve implemented a new synergistic paradigm leveraging our backend architecture…”                                | –       |
| 4–6   | Generally understandable            | “We made a change to how the app gets data… it’s asynchronous so it should feel a bit faster.”                         | –       |
| 7–8   | Clear, direct; simplifies complexity| “We fetch data in the background, so the interface stays responsive and feels faster.”                                 | Bronze  |
| 9     | Consistently exceptional clarity    | “Data now loads asynchronously, eliminating UI freezes and ensuring a seamless experience.”                            | Silver  |
| 10    | Effortless, memorable communication | “The app is instantly responsive because data loads silently in the background.”                                       | Gold    |

### 2.2 Optional / Nice-to-Have Features
- Voice clone tutors (famous speakers)
- Peer-to-peer practice
- Offline mode
- Custom AI tutor personalities
- Enterprise/team analytics
- Advanced AR/VR coaching

### 2.3 MVP (Minimum Viable Product) Scope
Focus: Voice interaction via basic STT with text-based analysis (immediate feedback on transcribed speech; no audio signal analysis)

Core MVP Features:
- Chatbot Tutor (Voice + Text input; text-based analysis from STT transcript): Real-time feedback on clarity, style, persuasiveness, vocabulary, and disfluency markers.
- Voice interaction: Basic speech-to-text for user input; TTS playback for responses.
- Assessment Agent (Text Analysis): Logs chats, tracks chosen skills, scores 1–10, updates actionable focuses.
- Skill System & Progression: Up to 3 tracked skills; medals awarded; total points contribute to user level.
- Gamification & Tracking: Dashboard with graphs, medals, levels; simple text-based scenarios.
- Monetization (Basic): Free tier (1 skill), premium tiers unlock more skills; daily assessment quota.

Out of Scope for MVP:
- Audio signal analysis (pacing, stutters, tone/prosody). MVP records audio only for STT transcription.
- Intonation/prosody scoring
- Advanced adaptive audience feedback

Rationale:
- Text-based analysis MVP with voice interaction validates core experience cost-effectively.
- Differentiates via text-based sophistication and persuasive feedback.
- Smooth path to V2 with audio analysis features later.

## 3. User Stories & Flows

### 3.1 User Stories
- Real-time feedback while speaking.
- Track stutter frequency (post-MVP via audio analysis; MVP may approximate via transcript artifacts only).
- Unlock skill levels for motivation.
- Earn points for scenario creation.
- Suggest sophisticated and compelling word choices.
- Persuasiveness feedback for sales executives.

### 3.2 User Flow (5-minute session)
1) User opens app and starts a chat.  
2) AI engages in conversation.  
3) Background agent detects assessable events.  
4) Subtle real-time feedback appears.  
5) Background assessment logged.  
6) Dashboard updates with medals, graphs, and progress.

## 4. Example User Interaction
Scenario: Sales Pitch Practice

- [AI]: “Pitch this water bottle to a CEO.”
- [User]: “Uh… okay. You need this bottle… um…”
- [AI]: “Good start! Focus on value rather than just function. How does it solve a problem?”
- [Assessment Agent]: Logs clarity, persuasiveness, filler words; calculates XP.
- [UI]: “Assessment logged! +25 XP. Click for details.”
- [AI]: Uses assessment for context-aware guidance: “Try emphasizing impact — how will this make the CEO’s day better?”
- [Gamification Layer]: Tracks medals, XP, and skill progression.

## 5. Functional Requirements
- Authentication: Email, social login
- Chat system (voice + text input; text-based analysis, STT, TTS)
- Assessment Engine: Multi-turn, criteria-driven scoring
- Scoring & Gamification System
- Progress Dashboard
- Scenario Engine: Default & user-generated
- STT ingestion pipeline for voice input

## 6. Non-Functional Requirements
- Performance: p95 time-to-first-token < 1.2s; p95 full-turn < 2.5s
- STT: p95 transcript availability < 600ms for <5s utterances; < 1.2s for <10s utterances
- TTS: p95 audio start < 1.8s
- Accuracy: Works across accents
- Cost Management: Daily LLM usage quota
- Compliance: GDPR/CCPA
- Privacy & Data Retention: Ephemeral raw audio (for STT), encryption at rest/in transit; transcripts retained per policy
- Reliability: 99.5% uptime

## 7. UX/UI Requirements
- Minimal, chat-first interface
- Subtle inline feedback
- Transparent progress tracking
- Gamified achievements (medals, XP)
- Visual trend graphs (weekly/monthly)

## 8. Technical Requirements
- Platform: Web-first; React Native wrapper for iOS/Android
- Frontend: Next.js (App Router), shadcn/ui, Tailwind CSS, Convex DB
- Backend: Next.js API Routes & Server Actions, Convex DB
- Auth & Payments: Clerk
- AI/ML Layer: Python FastAPI microservice
- Infrastructure & Hosting: Vercel, Convex Cloud, containerized service (Fly.io/Render)
- 3rd-Party APIs: STT (Whisper, Deepgram), TTS (OpenAI, ElevenLabs)
- Reliability: < 1.5s response; failover fallback

## 9. Success Metrics (KPIs)
- Engagement: > 500 DAU, > 7 min avg session
- Efficacy: 15% reduction in tracked errors over 30 days
- Retention: Day 7 > 35%, Day 30 > 20%
- Conversion: > 8% to premium

## 10. Timeline & Milestones
- Weeks 0–2: Prototype chat, STT, feedback
- Weeks 3–4: Assessment Engine v1, Dashboard
- Weeks 5–6: Gamification (points, medals, levels)
- Weeks 7–8: Scenarios & daily challenges

- Beta Launch: 2 months  
- Public Launch: 3 months

## 11. Risks & Assumptions
- Risk: High LLM cost → Mitigation: assessment quota
- Risk: Accent bias in STT → Mitigation: fallback transcription
- Assumption: Users want continuous coaching, not static summaries

## 12. Market & Competition
- Competitors: Orai, Yoodli, Ummo
- Strengths: Clean UI, filler/pacing detection, enterprise analytics
- Weaknesses: Shallow assessments, no real-time coaching, weak gamification, limited advanced language focus

Opportunities:
- Stutter/Disfluency Coaching: Flagship differentiator
- Prosody & Intonation: Improve engagement and dynamic delivery
- Advanced Language Skills: Sophistication, clarity, persuasion
- Continuous Gamified Progress: Points, medals, levels

## 13. Monetization & Pricing
- Free Tier: 1 skill, limited daily assessments
- Basic (£8.99/mo): 3–4 skills, higher quota
- Premium (£14.99/mo): 6+ skills, advanced dashboards, unlimited scenarios
- Add-on: Scenario marketplace with commission

## 14. Future Opportunities
- Peer-to-peer coaching
- AI speech style transfer (imitate public figures)
- Corporate onboarding version
- AR/VR immersive coaching

## 15. CoachUp: Accelerated Timeline & Cost Overview (Condensed)

### Phase Plan
- Phase 0 – Preparation (Week 0)  
  Finalize MVP design and PRD; set up infrastructure (Next.js, Convex, Clerk, Vercel).  
  Select pretrained STT models (Whisper/Deepgram) for prototyping.  
  Cost: ~£0

- Phase 1 – Text-Based MVP (Weeks 1–2)  
  Validate core coaching experience via text-based analysis with voice input via STT.  
  Implement chat interface, background assessment, skill tracking, gamification, and dashboard.  
  Deliverable: Functional MVP with voice interaction (STT) and text-based analysis only  
  Cost: £100–£200

- Phase 2 – Basic Audio Signal Analysis (Weeks 3–6)  
  Add lightweight audio signal analysis: detect filler words, pacing, repeated phrases from audio features (STT remains for transcription).  
  Provide real-time textual feedback overlay.  
  Cost: £500–£1,000

- Phase 3 – Prosody + Pronunciation Pilot (Weeks 7–10)  
  Introduce pitch, rhythm, and pause analysis.  
  Provide simplified prosody feedback; collect opt-in audio for future fine-tuning.  
  Cost: £1,000–£2,000

- Phase 4 – Data Collection & Fine-Tuning (Weeks 11–20)  
  Aggregate anonymized user audio.  
  Fine-tune Whisper/wav2vec2 + LLMs for disfluency, clarity, style.  
  Small-scale GPU training (1–4 mid-tier GPUs).  
  Cost: £5,000–£10,000

- Phase 5 – Full Speech Coaching Rollout (Months 6–12)  
  Train proprietary models (8–16+ GPUs).  
  Real-time feedback on fluency, prosody, pronunciation, style, and advanced language skills.  
  Accent/dialect adaptation and expanded skill library.  
  Cost: £10,000–£20,000

### Cost Breakdown by Phase & User Volume

| Phase  | Timeline     | Feature Focus                  | Cost/User/Hour (GBP) | Monthly (100) | Monthly (1,000) | Monthly (10,000) | Key Deliverables                                                                                   |
|:------:|--------------|--------------------------------|----------------------:|--------------:|----------------:|-----------------:|-----------------------------------------------------------------------------------------------------|
| 0      | Week 0       | MVP prep & infra setup         | £0.00                 | £0.00         | £0.00           | £0.00            | Frontend (Next.js), DB (Convex), Auth (Clerk), Hosting (Vercel) ready                              |
| 1      | Weeks 1–2    | Voice interaction + text-based analysis MVP | £0.02–£0.05           | £20–£50       | £200–£500       | £2,000–£5,000    | Chat interface, voice input via STT, text feedback, skill scoring, gamification dashboard           |
| 2      | Weeks 3–6    | Basic Audio Signal Analysis    | £0.05–£0.10           | £50–£100      | £500–£1,000     | £5,000–£10,000   | Detect fillers/repetition/pacing from audio features; textual feedback overlay                      |
| 3      | Weeks 7–10   | Prosody & Pronunciation Pilot  | £0.08–£0.15           | £80–£150      | £800–£1,500     | £8,000–£15,000   | Pitch, rhythm, pauses scoring; batch scoring for cost efficiency; early audio coaching              |
| 4      | Weeks 11–20  | Data Collection & Fine-Tuning  | £0.10–£0.25           | £100–£250     | £1,000–£2,500   | £10,000–£25,000  | Fine-tuned models for domain-specific audio assessment; improved scoring                            |
| 5      | Months 6–12  | Full Speech Coaching Rollout   | £0.20–£0.50           | £200–£500     | £2,000–£5,000   | £20,000–£50,000  | High-fidelity real-time coaching; accent/dialect adaptation; advanced gamification                  |

Assumptions & Notes:
- STT Model Costs:
  - Deepgram Nova-2: $0.0043 per minute of audio
  - Whisper (OpenAI): $0.006 per minute of audio
- GPU Instance Costs:
  - AWS EC2 g4dn.xlarge: $0.526 per hour
  - AWS EC2 p4d.24xlarge: $21.96 per hour
- Usage Assumptions:
  - Average session: 10 minutes of audio per user per hour.
  - GPU usage primarily during audio processing inference.
- Scaling Considerations:
  - Costs scale linearly with active users.
  - Optimizations like batching and caching reduce costs as volume increases.

## 16. Related Documents

- Technical Overview: [technical-overview.md](./technical-overview.md)
- Monitoring & Alerts: [monitoring.md](../ops/monitoring.md)
- API Docs (scaffolding): [docs/api/README.md](../api/README.md)