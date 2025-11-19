#!/bin/bash
# Complete dev startup with full logging and STT configuration

# SERVER runtime (Next API routes)
export LOG_LEVEL=debug
export LOG_INCLUDE="api:*,ui:*"
export LOG_FORMAT=pretty
export FORCE_DEV_LOGS=1

# CLIENT runtime (browser)
export NEXT_PUBLIC_LOG_LEVEL=debug
export NEXT_PUBLIC_LOG_INCLUDE="ui:engine/*,ui:context/*,ui:api/*"
export NEXT_PUBLIC_LOG_EXCLUDE=""

# Voice/STT — force data-url path, no S3 501s; configure provider + key
export STT_MULTIPART_DATAURL_ENABLED=1
export STT_PROVIDER=deepgram
export DEEPGRAM_API_KEY="${DEEPGRAM_API_KEY:-08653fc74628383e17a45cf448581d7d3a47898b}"
export GOOGLE_API_KEY="${GOOGLE_API_KEY}"

# AI routing
export AI_CHAT_ENABLED=1
export AI_PROVIDER=google
export AI_PROVIDER_CHAT=google
export AI_PROVIDER_CLASSIFIER=google
export AI_PROVIDER_ASSESS=google
export AI_PROVIDER_TRIAGE=google
export AI_PROVIDER_SUMMARY=google
export NEXT_PUBLIC_AI_API_BASE_URL=http://127.0.0.1:8000

echo "===== Starting UI Dev Server with Full Logging ====="
echo "Server logs: ${LOG_INCLUDE}"
echo "Client logs: ${NEXT_PUBLIC_LOG_INCLUDE}"
echo "STT: data-url mode with ${STT_PROVIDER} provider"
echo "========================================"

npm run dev -- --turbopack
