.PHONY: dev build test tidy clean install-deps frontend frontend-dev help

BIN       := ./tmp/staxv-hypervisor
MAIN      := ./cmd/staxv-hypervisor
VERSION   := $(shell git describe --tags --dirty --always 2>/dev/null || echo dev)
LDFLAGS   := -X main.version=$(VERSION)

## dev         — backend live-reload (air). If you're editing the frontend, also run `make frontend-dev` in another terminal.
dev:
	@command -v air >/dev/null 2>&1 || { echo "air not found — run 'make install-deps' first"; exit 1; }
	air

## frontend    — one-shot build of the React app; result copied into internal/webui/dist for embed.FS.
frontend:
	cd frontend && npm install && npm run build
	rm -rf internal/webui/dist
	mkdir -p internal/webui/dist
	cp -R frontend/dist/. internal/webui/dist/
	@touch internal/webui/dist/.gitkeep

## frontend-dev — Vite dev server on :5173, proxies /api to the backend on :5001. Run alongside `make dev`.
frontend-dev:
	cd frontend && npm install && npm run dev

## build       — produce a release binary in ./tmp/ (runs frontend build first).
build: frontend
	go build -ldflags "$(LDFLAGS)" -o $(BIN) $(MAIN)

## build-backend — build the Go binary only (skip the frontend step; serves the last-built UI in internal/webui/dist/).
build-backend:
	go build -ldflags "$(LDFLAGS)" -o $(BIN) $(MAIN)

## test        — run unit tests
test:
	go test -race -count=1 ./...

## tidy        — sync go.mod / go.sum
tidy:
	go mod tidy

## clean       — remove build artifacts (Go binary, frontend dist)
clean:
	rm -rf ./tmp frontend/dist internal/webui/dist
	mkdir -p internal/webui/dist
	@touch internal/webui/dist/.gitkeep

## install-deps — install dev dependencies (air for Go live-reload). Run once per machine.
install-deps:
	go install github.com/air-verse/air@latest

## help        — this message
help:
	@awk '/^## /{sub(/^## /, ""); printf "  %s\n", $$0}' $(MAKEFILE_LIST)
