# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Project Does

A local proxy server that wraps GitHub Copilot's backend API and exposes it as OpenAI-compatible and Anthropic-compatible REST endpoints. Users authenticate via GitHub OAuth Device Flow, and the server translates incoming requests to Copilot's API format and back.

## Commands

- `bun run dev` — start dev server with watch mode
- `bun run build` — bundle via tsdown
- `bun run start` — production start
- `bun run lint` — ESLint (cached)
- `bun run typecheck` — TypeScript type check (no emit)
- `bun test` — run all tests
- `bun test tests/<file>.test.ts` — run a single test

## Architecture

**Runtime**: Bun | **Framework**: Hono | **CLI**: citty

Request flow: Client → Hono routes → service layer → `api.githubcopilot.com` → response translation → client

Key layers:
- `src/routes/` — Hono route handlers, one directory per endpoint group
  - `chat-completions/` — OpenAI-compatible `/v1/chat/completions`
  - `messages/` — Anthropic-compatible `/v1/messages` (request/response translation lives here)
  - `embeddings/`, `models/`, `usage/`, `token/`
- `src/services/` — external API calls (copilot backend, GitHub REST API)
- `src/lib/` — shared utilities: token management (`token.ts`), global state (`state.ts`), rate limiting, proxy setup, error handling
- `src/main.ts` — CLI entry point defining subcommands (`start`, `auth`, `check-usage`, `debug`)

Auth flow: `auth` subcommand → GitHub Device Flow → token stored at `~/.local/share/copilot-api/github_token` → short-lived Copilot token obtained and auto-refreshed in `src/lib/token.ts`

## Code Conventions

- Path alias `~/*` maps to `src/*` — use it for all internal imports
- Strict TypeScript: no `any`, no unused locals/parameters
- ESM only, no CommonJS
- ESLint via `@echristian/eslint-config` with Prettier
- Tests go in `tests/` as `*.test.ts` using Bun's test runner
