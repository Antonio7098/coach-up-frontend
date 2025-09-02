# Coach-Min Page Deployment Guide

This document provides a comprehensive guide for deploying the coach-min page to Vercel for beta testing with friends and family.

## Overview

The coach-min page is a voice-enabled AI coaching interface that requires several external services and careful configuration for production deployment. This guide covers all necessary steps from pre-deployment setup to post-deployment monitoring.

## Architecture Dependencies

The coach-min page is **not a standalone application**. It requires:

- **AI API Backend** (FastAPI server) - Handles chat functionality and LLM interactions
- **Convex Database** - Manages data persistence, user profiles, goals, and session data
- **Clerk Authentication** - Provides user authentication and session management
- **Speech Services** (STT/TTS) - Enables voice input/output functionality
- **AWS S3** - Stores audio files and provides CDN for audio content

## Pre-Deployment Checklist

### 1. External Service Setup

#### Convex Database
```bash
cd coach-up-frontend
npx convex deploy --prod
```
- Create production deployment
- Note the production URL (e.g., `https://your-project.convex.cloud`)
- Ensure all schema migrations are applied

#### AI API Backend
- Deploy FastAPI backend to cloud service (Railway, Render, Heroku, etc.)
- Ensure HTTPS endpoint is accessible
- Configure CORS for your Vercel domain
- Test all API endpoints are responding

#### Clerk Authentication
- Create production Clerk application (not test)
- Configure allowed domains in Clerk dashboard
- Get production keys:
  - `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` (starts with `pk_live_`)
  - `CLERK_SECRET_KEY` (starts with `sk_live_`)

#### Speech Services
Choose one provider:

**Google Cloud (Recommended)**
- Create Google Cloud project
- Enable Speech-to-Text and Text-to-Speech APIs
- Create service account with appropriate permissions
- Download JSON credentials

**AWS (Alternative)**
- Set up IAM user with Transcribe and Polly permissions
- Configure AWS credentials
- Set up S3 bucket for audio storage

#### S3 Storage
- Create S3 bucket for audio files
- Configure CORS policy:
```json
{
  "CORSRules": [
    {
      "AllowedHeaders": ["*"],
      "AllowedMethods": ["GET", "PUT", "POST"],
      "AllowedOrigins": ["https://your-domain.vercel.app"],
      "MaxAgeSeconds": 3000
    }
  ]
}
```

### 2. Environment Variables

Create `.env.local` in `coach-up-frontend/ui/`:

```bash
# === REQUIRED FOR PRODUCTION ===

# Clerk Authentication
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_live_...
CLERK_SECRET_KEY=sk_live_...

# Convex Database
CONVEX_URL=https://your-production.convex.cloud
NEXT_PUBLIC_CONVEX_URL=https://your-production.convex.cloud

# AI API Backend
AI_API_BASE_URL=https://your-ai-api-domain.com
NEXT_PUBLIC_AI_API_BASE_URL=https://your-ai-api-domain.com

# Speech Services
STT_PROVIDER=google  # or aws, mock
TTS_PROVIDER=google  # or aws, mock

# Google Cloud Speech (if using Google)
GOOGLE_APPLICATION_CREDENTIALS_JSON={"type":"service_account",...}

# AWS Services (if using AWS)
AWS_ACCESS_KEY_ID=your-access-key
AWS_SECRET_ACCESS_KEY=your-secret-key
AWS_REGION=us-east-1

# S3 Storage
S3_BUCKET_AUDIO=your-audio-bucket
S3_REGION=us-east-1

# === PRODUCTION CONFIGURATION ===

# Route Protection
CLERK_PROTECT_ALL=1  # Enable for production

# Mock Mode (disable for production)
MOCK_CONVEX=0

# Summary Configuration
NEXT_PUBLIC_SUMMARY_REFRESH_TURNS=8

# Audio Configuration
STT_MAX_AUDIO_BYTES=26214400  # 25MB
TTS_FORMAT=audio/mpeg

# Provider Override (disable for production)
ALLOW_PROVIDER_OVERRIDE=0

# === OPTIONAL CONFIGURATION ===

# Debug Settings
PROMPT_DEBUG=0
CSS_TRANSFORMER_WASM=1

# Rate Limiting
RATE_LIMIT_REQUESTS_PER_MINUTE=60
RATE_LIMIT_BURST=10
```

### 3. Vercel Configuration

Create `vercel.json` in `coach-up-frontend/ui/`:

```json
{
  "buildCommand": "npm run build",
  "outputDirectory": ".next",
  "framework": "nextjs",
  "functions": {
    "src/app/api/**/*.ts": {
      "runtime": "nodejs18.x"
    }
  },
  "env": {
    "NODE_ENV": "production"
  },
  "headers": [
    {
      "source": "/api/(.*)",
      "headers": [
        {
          "key": "Access-Control-Allow-Origin",
          "value": "*"
        },
        {
          "key": "Access-Control-Allow-Methods",
          "value": "GET, POST, PUT, DELETE, OPTIONS"
        },
        {
          "key": "Access-Control-Allow-Headers",
          "value": "Content-Type, Authorization, X-Request-Id, X-Tracked-Skill-Id"
        }
      ]
    }
  ],
  "rewrites": [
    {
      "source": "/coach-min",
      "destination": "/coach-min"
    }
  ]
}
```

## Deployment Steps

### Step 1: Local Testing

```bash
cd coach-up-frontend/ui

# Install dependencies
npm install

# Test build
npm run build

# Test locally with production config
npm run start
```

Verify:
- Build completes without errors
- All environment variables are loaded
- API routes respond correctly
- Authentication flow works

### Step 2: Deploy to Vercel

```bash
# Install Vercel CLI
npm i -g vercel

# Deploy to production
cd coach-up-frontend/ui
vercel --prod
```

### Step 3: Configure Vercel Environment Variables

In Vercel Dashboard:
1. Go to Project Settings → Environment Variables
2. Add all variables from your `.env.local`
3. **Critical**: Use production values, not test/development values
4. Set environment to "Production" for all variables

### Step 4: Configure Build Settings

In Vercel Dashboard:
- Root Directory: `coach-up-frontend/ui`
- Build Command: `npm run build`
- Output Directory: `.next`
- Install Command: `npm install`

## Post-Deployment Verification

### 1. Core Functionality Tests

```bash
# Test authentication
curl -I https://your-domain.vercel.app/coach-min

# Test API endpoints
curl -X POST https://your-domain.vercel.app/api/v1/stt \
  -H "Content-Type: application/json" \
  -d '{"audioUrl": "test"}'

curl -X POST https://your-domain.vercel.app/api/v1/tts \
  -H "Content-Type: application/json" \
  -d '{"text": "Hello world"}'
```

### 2. User Flow Testing

1. **Authentication Flow**
   - Visit `/coach-min`
   - Sign in with Clerk
   - Verify user session is created

2. **Voice Functionality**
   - Grant microphone permissions
   - Test voice recording
   - Verify STT transcription
   - Test TTS playback

3. **Chat Functionality**
   - Send voice message
   - Verify AI response
   - Check conversation persistence

4. **Profile Management**
   - Open dashboard
   - Create/edit profile
   - Add/edit goals
   - Verify data persistence

### 3. Error Handling Verification

Test graceful degradation:
- Disable external services temporarily
- Verify app still loads
- Check error messages are user-friendly
- Ensure no crashes occur

## Monitoring & Observability

### Key Metrics to Monitor

1. **API Performance**
   - Response times for `/api/chat`
   - STT/TTS latency
   - Error rates by endpoint

2. **External Service Health**
   - Convex query performance
   - AI API response times
   - Speech service availability

3. **User Experience**
   - Page load times
   - Voice interaction success rates
   - Authentication flow completion

4. **Cost Monitoring**
   - External API usage
   - Storage costs
   - Compute costs

### Logging Configuration

The app includes comprehensive logging:
- Request/response logging with request IDs
- Error tracking with stack traces
- Performance metrics
- User interaction events

Monitor logs in:
- Vercel Function Logs
- External service dashboards
- Browser console (for client-side errors)

## Security Considerations

### Production Security Checklist

- [ ] Use production API keys (not test keys)
- [ ] Enable `CLERK_PROTECT_ALL=1`
- [ ] Configure proper CORS policies
- [ ] Set up rate limiting
- [ ] Monitor for unusual usage patterns
- [ ] Regular security updates

### Data Privacy

- Audio files are stored temporarily in S3
- User data is encrypted in Convex
- No PII is logged in plain text
- Session data is properly isolated

## Beta Testing Strategy

### Recommended Approach

1. **Start Small**
   - Begin with 5-10 trusted users
   - Collect detailed feedback
   - Monitor usage patterns

2. **User Onboarding**
   - Provide clear setup instructions
   - Explain microphone permissions
   - Share expected use cases

3. **Feedback Collection**
   - Voice quality feedback
   - Response time expectations
   - Feature requests
   - Bug reports

4. **Usage Limits**
   - Set API rate limits
   - Monitor costs closely
   - Implement usage alerts

### Common Beta Issues

1. **Microphone Permissions**
   - Users need to grant browser permissions
   - HTTPS is required for microphone access
   - Some browsers have stricter policies

2. **Audio Quality**
   - Background noise affects STT accuracy
   - Network latency impacts real-time feel
   - Device compatibility varies

3. **Authentication**
   - Users may need to create accounts
   - Session persistence across devices
   - Password reset flows

## Troubleshooting Guide

### Common Deployment Issues

#### Build Failures
```bash
# Check environment variables
vercel env ls

# Verify build locally
npm run build

# Check Node.js version compatibility
node --version
```

#### API Errors
- Verify external service credentials
- Check API endpoint accessibility
- Review CORS configuration
- Monitor rate limiting

#### Authentication Issues
- Confirm Clerk keys are production keys
- Check allowed domains in Clerk dashboard
- Verify `CLERK_PROTECT_ALL` setting
- Test authentication flow manually

#### Audio Issues
- Check browser microphone permissions
- Verify STT/TTS provider configuration
- Test S3 bucket permissions
- Monitor audio file uploads

### Performance Optimization

1. **API Response Times**
   - Monitor external service latency
   - Implement caching where appropriate
   - Optimize database queries

2. **Audio Processing**
   - Compress audio files
   - Use appropriate audio formats
   - Implement audio streaming

3. **Client-Side Performance**
   - Optimize bundle size
   - Implement lazy loading
   - Use CDN for static assets

## Cost Management

### Expected Costs (Monthly)

- **Vercel**: $20-50 (depending on usage)
- **Convex**: $25-100 (based on data/requests)
- **Clerk**: $25-100 (based on users)
- **Speech Services**: $50-200 (based on usage)
- **S3 Storage**: $5-20 (based on audio files)

### Cost Optimization

1. **Set Usage Limits**
   - Implement rate limiting
   - Monitor API quotas
   - Set up billing alerts

2. **Optimize Usage**
   - Cache frequently used data
   - Compress audio files
   - Use appropriate service tiers

3. **Monitor Closely**
   - Set up cost alerts
   - Review usage weekly
   - Optimize based on patterns

## Maintenance & Updates

### Regular Maintenance Tasks

1. **Weekly**
   - Review error logs
   - Check service health
   - Monitor costs

2. **Monthly**
   - Update dependencies
   - Review security patches
   - Analyze usage patterns

3. **Quarterly**
   - Performance optimization
   - Feature updates
   - Security audit

### Update Process

1. Test changes locally
2. Deploy to staging environment
3. Run full test suite
4. Deploy to production
5. Monitor for issues

## Support & Documentation

### User Support

- Create FAQ document
- Provide setup instructions
- Document known issues
- Set up support channels

### Developer Documentation

- API documentation
- Architecture overview
- Deployment procedures
- Troubleshooting guides

## Conclusion

The coach-min page is well-architected for production deployment with comprehensive error handling and graceful degradation. The main complexity lies in setting up external services, but once configured, it provides a robust voice-enabled AI coaching experience.

Key success factors:
- Proper external service configuration
- Comprehensive testing
- Active monitoring
- User feedback integration
- Cost management

This deployment guide should provide everything needed to successfully deploy and maintain the coach-min page for beta testing.
