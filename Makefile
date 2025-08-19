SPECTRAL = npx -y @stoplight/spectral-cli
REDOCLY = npx -y @redocly/cli

OPENAPI_FILES := $(shell find docs/api -name openapi.json 2>/dev/null)

.PHONY: help openapi-lint redoc-build openapi-generate-core openapi-snapshot-ai

help:
	@echo "Targets:"
	@echo "  openapi-lint        Lint all OpenAPI specs under docs/api with Spectral"
	@echo "  redoc-build         Build static HTML references from OpenAPI (core & ai)"
	@echo "  openapi-generate-core  Placeholder: generate core OpenAPI from Zod"
	@echo "  openapi-snapshot-ai Placeholder: run in AI repo to snapshot FastAPI spec"

openapi-lint:
	$(SPECTRAL) lint --ruleset docs/api/.spectral.yaml $(OPENAPI_FILES)

redoc-build:
	$(REDOCLY) build-docs docs/api/core/openapi.json -o docs/api/core/reference.html || true
	$(REDOCLY) build-docs docs/api/ai/openapi.json -o docs/api/ai/reference.html || true

openapi-generate-core:
	@echo "TODO: wire zod-to-openapi generator for Next.js API routes; output docs/api/core/openapi.json"

openapi-snapshot-ai:
	@echo "AI spec lives in AI service repo; run 'make openapi-snapshot' there."
