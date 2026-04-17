.PHONY: dev build test tidy clean install-deps

BIN       := ./tmp/staxv-hypervisor
MAIN      := ./cmd/staxv-hypervisor
VERSION   := $(shell git describe --tags --dirty --always 2>/dev/null || echo dev)
LDFLAGS   := -X main.version=$(VERSION)

## dev         — run with live-reload (air); save files, app auto-rebuilds in ~2s
dev:
	@command -v air >/dev/null 2>&1 || { echo "air not found — run 'make install-deps' first"; exit 1; }
	air

## build       — produce a release binary in ./tmp/
build:
	go build -ldflags "$(LDFLAGS)" -o $(BIN) $(MAIN)

## test        — run unit tests
test:
	go test -race -count=1 ./...

## tidy        — sync go.mod / go.sum
tidy:
	go mod tidy

## clean       — remove build artifacts
clean:
	rm -rf ./tmp

## install-deps — install dev dependencies (air). Run once per machine.
install-deps:
	go install github.com/air-verse/air@latest

## help        — this message
help:
	@awk '/^## /{sub(/^## /, ""); printf "  %s\n", $$0}' $(MAKEFILE_LIST)
