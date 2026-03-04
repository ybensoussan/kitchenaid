# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Run (development)
export PATH=$PATH:/usr/local/go/bin
go run ./main.go          # → http://localhost:8080

# Build
go build ./...

# Vet
go vet ./...

# Docker
docker compose up         # → http://localhost:8888
```

There are no tests in this codebase.

## Architecture

Single Go binary (`main.go`) wiring together three internal packages, serving a vanilla-JS SPA.

```
main.go                  – route registration, server startup
internal/
  config/                – env-var config (PORT, DB_PATH, UPLOADS_DIR)
  models/                – shared structs (Recipe, Ingredient, Step, PantryItem, Settings, …)
  db/                    – all SQL; Store wraps *sql.DB
  handlers/              – one file per feature area, all methods on *Handler
  scraper/               – recipe extraction (URL, JSON-LD, heuristic, text, image)
static/                  – served as-is; index/recipe/add/pantry/settings HTML + JS + CSS
uploads/                 – uploaded images at runtime (not committed)
```

### Request flow

`main.go` registers routes → `handlers.Handler` (holds `*db.Store`) → `db.Store` executes SQL → returns `models.*` structs → `Handler.writeJSON` wraps in `{"data":…,"error":null}`.

All error responses use `Handler.writeError` which produces `{"data":null,"error":"…"}`.

### Database

SQLite with WAL mode, foreign keys on, `MaxOpenConns(1)`. Schema is applied idempotently in `db.migrate()`. Additive column migrations are run with swallowed errors (SQLite has no `ADD COLUMN IF NOT EXISTS`). Amounts are stored in metric; the frontend converts for display.

### AI features

AI calls (alternatives, tag suggestion, smart-match) are made directly via `net/http` to either the Anthropic or Gemini REST API — no SDK. Provider and model are stored in the `settings` table and read per-request. API keys come from the DB settings or fall back to `ANTHROPIC_API_KEY` / `GEMINI_API_KEY` env vars. Default models: `claude-haiku-4-5-20251001` (Anthropic), `gemini-2.5-flash` (Gemini).

### Import pipeline

`POST /api/import/url` → `scraper.ScrapeURL` (uses `go-recipe` + JSON-LD fallback) → returns a `CreateRecipeRequest` JSON to the frontend (not saved). The frontend stores this in `sessionStorage`, redirects to `/add.html?source=import`, and the user confirms before saving.

`POST /api/import/image` and `POST /api/import/text` call the AI provider to extract structured recipe data and return the same `CreateRecipeRequest` shape.

### Pantry

Pantry items can be linked to recipe ingredients via `pantry_item_id` FK on `ingredients`. The smart-match feature (`POST /api/ai/smart-match`) sends unlinked ingredients + pantry items to the AI and gets back match suggestions and duplicate candidates to merge.

### Static frontend

No build step. Pages are plain HTML files in `static/`; JS lives in `static/js/`. The server serves `./static` at `/` and `./uploads` at `/uploads/`.
