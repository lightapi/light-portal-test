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
ALLOW_BILLABLE_TESTS ?= false
TOKEN_PROFILE ?=
LLM_PUBLIC_ALIAS ?=

export TOKEN_PROFILE
export LLM_PUBLIC_ALIAS

.PHONY: validate smoke llm functional repeat perf-smoke perf-live batch all

validate:
	./scripts/validate.sh

smoke:
	./scripts/run-functional.sh tests/smoke

llm:
	./scripts/run-functional.sh tests/llm

functional:
	./scripts/run-functional.sh tests/smoke tests/llm

repeat:
	COUNT=$(COUNT) INTERVAL=$(INTERVAL) STOP_ON_FAILURE=$(STOP_ON_FAILURE) \
		REPEAT_WARN_P95_MS=$(REPEAT_WARN_P95_MS) REPEAT_FAIL_P95_MS=$(REPEAT_FAIL_P95_MS) \
		./scripts/run-repeated.sh

perf-smoke:
	VUS=$(VUS) DURATION=$(DURATION) ./scripts/run-performance.sh models-smoke

perf-live:
	ALLOW_BILLABLE_TESTS=$(ALLOW_BILLABLE_TESTS) VUS=$(VUS) DURATION=$(DURATION) \
		./scripts/run-performance.sh llm-buffered

batch:
	BATCH_REPEAT_COUNT=$(BATCH_REPEAT_COUNT) BATCH_REPEAT_INTERVAL=$(BATCH_REPEAT_INTERVAL) \
		REPEAT_WARN_P95_MS=$(REPEAT_WARN_P95_MS) REPEAT_FAIL_P95_MS=$(REPEAT_FAIL_P95_MS) \
		ALLOW_BILLABLE_TESTS=$(ALLOW_BILLABLE_TESTS) VUS=$(VUS) DURATION=$(DURATION) \
		./scripts/run-all.sh

all: batch
