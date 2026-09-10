SHELL := /usr/bin/env bash

COUNT ?= 10
INTERVAL ?= 10
STOP_ON_FAILURE ?= true
REPEAT_WARN_P95_MS ?= 10000
REPEAT_FAIL_P95_MS ?= 30000
BATCH_REPEAT_COUNT ?= 3
BATCH_REPEAT_INTERVAL ?= 5
VUS ?= 1
DURATION ?= 30s
LLM_ITERATIONS ?= 10
ALLOW_BILLABLE_TESTS ?= false
TOKEN_PROFILE ?=
LLM_PUBLIC_ALIAS ?=
EMBEDDING_QUERY_ALIAS ?= kb-query
EMBEDDING_INDEX_ALIAS ?= kb-index
EMBEDDING_SPACE_ID ?= nvidia-nemotron-3-embed-1b-float-v1
EMBEDDING_SPACE_REVISION ?= 1
EMBEDDING_DIMENSION ?= 2048

ifneq ($(filter command line environment environment override,$(origin ALLOW_BILLABLE_TESTS)),)
ALL_ALLOW_BILLABLE_TESTS := $(ALLOW_BILLABLE_TESTS)
else
ALL_ALLOW_BILLABLE_TESTS := true
endif

export TOKEN_PROFILE
export LLM_PUBLIC_ALIAS
export EMBEDDING_QUERY_ALIAS
export EMBEDDING_INDEX_ALIAS
export EMBEDDING_SPACE_ID
export EMBEDDING_SPACE_REVISION
export EMBEDDING_DIMENSION

.PHONY: validate smoke llm mcp mcp-source workflow-mcp embeddings promotion-api promotion-ui genai-chat-ui promotion-hourly functional repeat perf-smoke perf-live batch all runner

validate:
	./scripts/validate.sh

smoke:
	./scripts/run-functional.sh tests/smoke

llm:
	./scripts/run-functional.sh tests/llm

mcp:
	./scripts/run-mcp.sh

mcp-source:
	./scripts/run-mcp-source.sh

workflow-mcp:
	./scripts/run-functional.sh tests/workflow-mcp

embeddings:
	ALLOW_BILLABLE_TESTS=$(ALLOW_BILLABLE_TESTS) ./scripts/run-embeddings.sh

promotion-api:
	./scripts/run-promotion-api.sh

promotion-ui:
	./scripts/run-promotion-ui.sh

genai-chat-ui:
	./scripts/run-genai-chat-ui.sh

promotion-hourly:
	./scripts/run-promotion-hourly.sh

runner:
	node runner/server.mjs

functional:
	./scripts/run-functional.sh tests/smoke tests/llm tests/workflow-mcp

repeat:
	COUNT=$(COUNT) INTERVAL=$(INTERVAL) STOP_ON_FAILURE=$(STOP_ON_FAILURE) \
		REPEAT_WARN_P95_MS=$(REPEAT_WARN_P95_MS) REPEAT_FAIL_P95_MS=$(REPEAT_FAIL_P95_MS) \
		./scripts/run-repeated.sh

perf-smoke:
	VUS=$(VUS) DURATION=$(DURATION) ./scripts/run-performance.sh models-smoke

perf-live:
	ALLOW_BILLABLE_TESTS=$(ALLOW_BILLABLE_TESTS) VUS=$(VUS) LLM_ITERATIONS=$(LLM_ITERATIONS) \
		./scripts/run-performance.sh llm-buffered

batch:
	BATCH_REPEAT_COUNT=$(BATCH_REPEAT_COUNT) BATCH_REPEAT_INTERVAL=$(BATCH_REPEAT_INTERVAL) \
		REPEAT_WARN_P95_MS=$(REPEAT_WARN_P95_MS) REPEAT_FAIL_P95_MS=$(REPEAT_FAIL_P95_MS) \
		ALLOW_BILLABLE_TESTS=$(ALLOW_BILLABLE_TESTS) VUS=$(VUS) DURATION=$(DURATION) \
		LLM_ITERATIONS=$(LLM_ITERATIONS) \
		./scripts/run-all.sh

all:
	$(MAKE) batch ALLOW_BILLABLE_TESTS=$(ALL_ALLOW_BILLABLE_TESTS)
ifeq ($(ALL_ALLOW_BILLABLE_TESTS),true)
	$(MAKE) embeddings ALLOW_BILLABLE_TESTS=true
	$(MAKE) genai-chat-ui
else
	@echo "Skipping billable embedding and GenAI Chat UI tests because ALLOW_BILLABLE_TESTS=$(ALL_ALLOW_BILLABLE_TESTS)."
endif
