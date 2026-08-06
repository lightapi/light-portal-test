SHELL := /usr/bin/env bash

COUNT ?= 10
INTERVAL ?= 10
VUS ?= 1
DURATION ?= 30s
ALLOW_BILLABLE_TESTS ?= false
TOKEN_PROFILE ?=
LLM_PUBLIC_ALIAS ?=

export TOKEN_PROFILE
export LLM_PUBLIC_ALIAS

.PHONY: validate smoke llm functional repeat perf-smoke perf-live

validate:
	./scripts/validate.sh

smoke:
	./scripts/run-functional.sh tests/smoke

llm:
	./scripts/run-functional.sh tests/llm

functional:
	./scripts/run-functional.sh tests/smoke tests/llm

repeat:
	COUNT=$(COUNT) INTERVAL=$(INTERVAL) ./scripts/run-repeated.sh

perf-smoke:
	VUS=$(VUS) DURATION=$(DURATION) ./scripts/run-performance.sh models-smoke

perf-live:
	ALLOW_BILLABLE_TESTS=$(ALLOW_BILLABLE_TESTS) VUS=$(VUS) DURATION=$(DURATION) \
		./scripts/run-performance.sh llm-buffered
