# Configuration & Externalized Settings Inventory

`copilot-api` is configured primarily through CLI arguments at startup; there are no `.env` files or profile-specific configuration files. The sole externalized secret is the GitHub OAuth token, provided either through a single environment variable (`GH_TOKEN`) or obtained interactively via the GitHub Device Flow.

## Configuration Sources

| Source | Type | Path / Location | Notes |
|---|---|---|---|
| CLI arguments | Runtime flags | Parsed by `citty` in `src/start.ts` | Primary configuration mechanism; all options passed at startup |
| `GH_TOKEN` environment variable | Environment variable | Docker entrypoint / shell | Used to pass the GitHub OAuth token non-interactively (Docker only) |
| `HTTP_PROXY` / `HTTPS_PROXY` / `NO_PROXY` | Environment variables | OS environment | Optional; used when `--proxy-env` flag is set |
| `~/.local/share/copilot-api/github_token` | Plaintext file | `$HOME/.local/share/copilot-api/github_token` | Persisted GitHub OAuth token; read/written by the `auth` and `start` subcommands |
| `token-usage.json` | JSON file | `<project-root>/token-usage.json` | Persisted per-model token usage counters; loaded at startup and updated on every request |
| `tsdown.config.ts` | Build configuration | `/tsdown.config.ts` | Injects `NODE_ENV=production` at build time via `env` option |
| `tsconfig.json` | TypeScript configuration | `/tsconfig.json` | Path alias `~/*` → `src/*`; strict mode settings |
| `Dockerfile` | Container configuration | `/Dockerfile` | Two-stage build (builder + runner); exposes port 4141 |
| No `.env` files | — | — | No `.env`, `.env.local`, or `.env.production` files exist in this project |

## Build Profiles

| Profile / Script | Activation | Purpose | Key Settings |
|---|---|---|---|
| `bun run build` (`tsdown`) | Manual — CI or pre-publish | Bundles `src/main.ts` to `dist/main.js` as ESM; sets `NODE_ENV=production` | Entry: `src/main.ts`; format: ESM; target: `es2022`; platform: `node`; sourcemaps enabled; clean output |
| Docker multi-stage builder | Manual — `docker build` | Installs all deps, runs build, produces `dist/` | `FROM oven/bun:1.2.19-alpine`; `bun install --frozen-lockfile`; `bun run build` |
| Docker production runner | Part of `docker build` | Installs only production deps, copies `dist/` | `bun install --frozen-lockfile --production --ignore-scripts --no-cache` |
| `bun run dev` | Manual — local development | Runs source directly with watch mode via `--watch` flag | No bundling; uses Bun's native TypeScript execution |

## Runtime Profiles

This project has no Spring-style or `.env`-based runtime profile system. Configuration is controlled entirely through CLI arguments. Relevant runtime behaviours are activated by flags:

| Effective Profile / Mode | Activation | Key Behaviour |
|---|---|---|
| Development (default) | `bun run dev` or `bun run ./src/main.ts` | Source execution with hot-reload; verbose logging available via `--verbose` |
| Production (Docker) | `docker run` with `GH_TOKEN=<token>` | Uses `dist/main.js`; token passed via env var; non-interactive |
| Manual approval mode | `--manual` CLI flag | Each incoming request requires interactive console confirmation |
| Rate-limited mode | `--rate-limit N` CLI flag | Enforces N-second gap between requests |
| Session logging mode | `--session-log` CLI flag | Writes full request/response pairs to `sessions/` directory |
| Proxy mode | `--proxy-env` CLI flag | Routes outbound HTTP through proxy read from environment variables |
| Verbose / debug mode | `--verbose` CLI flag | Sets `consola.level = 5` |

## Properties Inventory

All configuration is passed as CLI arguments; there are no property files. The following table documents all supported CLI options for the `start` subcommand:

| Property / CLI Flag | Default | Type | Source |
|---|---|---|---|
| `--port` / `-p` | `4141` | string (parsed to int) | CLI argument |
| `--verbose` / `-v` | `false` | boolean | CLI argument |
| `--account-type` / `-a` | `individual` | string (`individual` \| `business` \| `enterprise`) | CLI argument |
| `--manual` | `false` | boolean | CLI argument |
| `--rate-limit` / `-r` | `undefined` (no limit) | string (parsed to int seconds) | CLI argument |
| `--wait` / `-w` | `false` | boolean | CLI argument |
| `--github-token` / `-g` | `undefined` | string | CLI argument or `$GH_TOKEN` (via entrypoint.sh) |
| `--claude-code` / `-c` | `false` | boolean | CLI argument |
| `--show-token` | `false` | boolean | CLI argument |
| `--proxy-env` | `false` | boolean | CLI argument |
| `--session-log` | `false` | boolean | CLI argument |
| `--fuzzy-model` | `false` | boolean | CLI argument |
| `GH_TOKEN` | — | Environment variable | Set in Docker environment |
| `HTTP_PROXY` | — | Environment variable | OS environment (used when `--proxy-env` is set) |
| `HTTPS_PROXY` | — | Environment variable | OS environment (used when `--proxy-env` is set) |
| `NO_PROXY` | — | Environment variable | OS environment (used when `--proxy-env` is set) |

Hardcoded internal constants (not externalized):

| Constant | Value | Location |
|---|---|---|
| Copilot plugin version | `0.45.1` | `src/lib/api-config.ts` |
| GitHub API version header | `2025-04-01` | `src/lib/api-config.ts` |
| GitHub OAuth Client ID | `Iv1.b507a08c87ecfe98` | `src/lib/api-config.ts` |
| VSCode version fallback | `1.104.3` | `src/services/get-vscode-version.ts` |
| Default server port | `4141` | `src/start.ts` |

## Startup Parameters & Resource Requirements

| Service | Runtime Options | Memory | CPU | Notes |
|---|---|---|---|---|
| copilot-api (direct) | Bun runtime defaults; no JVM | OS default | OS default | No explicit memory or CPU limits configured |
| copilot-api (Docker) | Bun 1.2.19 on Alpine; `EXPOSE 4141` | Not configured (no `mem_limit`) | Not configured | Health check: `wget --spider -q http://localhost:4141/` every 30s, timeout 5s, start-period 10s, 3 retries |

No JVM heap settings, no Kubernetes resource requests/limits, and no container resource constraints are configured.

## Startup Dependency Chain

```
1. [copilot-api process starts]
      │
      ▼
2. initProxyFromEnv()           ← if --proxy-env; configures undici global dispatcher
      │
      ▼
3. ensurePaths()                ← creates ~/.local/share/copilot-api/ and github_token file
      │
      ▼
4. cacheVSCodeVersion()         ← fetches VSCode version from AUR (5 s timeout; falls back to 1.104.3)
      │
      ▼
5. setupGitHubToken()           ← reads token from disk OR runs GitHub Device Flow interactively
      │
      ▼
6. setupCopilotToken()          ← exchanges GitHub token for short-lived Copilot bearer token;
      │                            starts auto-refresh setInterval
      ▼
7. cacheModels()                ← fetches available model list from api.githubcopilot.com
      │
      ▼
8. serve() [srvx]               ← binds HTTP server to port (default 4141); begins accepting requests
```

No Docker Compose `depends_on`, Kubernetes readiness probes (beyond the container `HEALTHCHECK`), or external service-discovery wait mechanisms are configured. The startup is single-process and linear.

## Secrets & Sensitive Configuration

| Secret | Type | Storage | Notes |
|---|---|---|---|
| GitHub OAuth token | Long-lived credential | `~/.local/share/copilot-api/github_token` (chmod 600) or `$GH_TOKEN` env var | Obtained via Device Flow; persisted in plaintext |
| Copilot bearer token | Short-lived credential | In-memory (`state.copilotToken`) | Exchanged from GitHub token; auto-refreshed; exposed via `/token` endpoint |
| GitHub Client ID | OAuth Client ID | Hardcoded in `src/lib/api-config.ts` | Public value; not secret |

### Secrets Provisioning Workflow

**Interactive (default, local use):**
1. First run: `copilot-api auth` → initiates GitHub OAuth Device Flow → user enters `user_code` at `github.com/login/device` → access token returned and written to `~/.local/share/copilot-api/github_token` with `chmod 600`.
2. Subsequent runs: `copilot-api start` → reads the persisted token from disk → exchanges it for a short-lived Copilot token via `GET /copilot_internal/v2/token` on `api.github.com`.

**Non-interactive (Docker):**
1. `docker run -e GH_TOKEN=<token> ...` → `entrypoint.sh` passes the token as `--github-token $GH_TOKEN` to `bun run dist/main.js start` → token is placed directly into `state.githubToken` without being written to disk.

No external secret store (HashiCorp Vault, Azure Key Vault, AWS Secrets Manager) is used. There is no encryption, RBAC, or managed identity in the secrets workflow.

## Feature Flags

All feature flags are CLI boolean arguments set at startup. There is no remote feature-flag service or dynamic toggle mechanism.

| Flag | CLI Argument | Default | Controlled By | Effect |
|---|---|---|---|---|
| Manual approval | `--manual` | `false` | CLI | Pause each request for interactive confirmation |
| Rate limiting | `--rate-limit N` | disabled | CLI | Enforce N-second gap between requests |
| Rate limit wait | `--wait` | `false` | CLI | Wait instead of 429 when rate limit is hit |
| Verbose logging | `--verbose` | `false` | CLI | Set `consola.level = 5` (all log levels) |
| Show token | `--show-token` | `false` | CLI | Log GitHub and Copilot tokens to console |
| Proxy from env | `--proxy-env` | `false` | CLI | Route outbound HTTP through `HTTP_PROXY` / `HTTPS_PROXY` |
| Session logging | `--session-log` | `false` | CLI | Persist full request/response pairs to `sessions/` |
| Claude Code mode | `--claude-code` | `false` | CLI | Interactive model selection; copies env command to clipboard |
| Fuzzy model match | `--fuzzy-model` | `false` | CLI | Match requested model names approximately to available models |

## Framework & Runtime Versions

| Component | Version | Source |
|---|---|---|
| Runtime — Bun | 1.x (1.2.19 in Docker) | `Dockerfile`; `@types/bun ^1.2.23` |
| Runtime — Node.js (fallback) | 22.x (CI/dev) | `.node-version` / environment |
| Language — TypeScript | ^5.9.3 | `package.json` devDependencies |
| Web Framework — Hono | ^4.9.9 | `package.json` dependencies |
| HTTP Server — srvx | ^0.8.9 | `package.json` dependencies |
| HTTP Client — undici | ^7.16.0 | `package.json` dependencies |
| CLI Framework — citty | ^0.1.6 | `package.json` dependencies |
| Schema Validation — Zod | ^4.1.11 | `package.json` dependencies |
| Logging — consola | ^3.4.2 | `package.json` dependencies |
| Build Tool — tsdown | ^0.15.6 | `package.json` devDependencies |
| Linter — ESLint | ^9.37.0 | `package.json` devDependencies |
| Container base image | `oven/bun:1.2.19-alpine` | `Dockerfile` |
| Package manager — npm / bun | npm 10.x / Bun 1.x | Local environment |
| Target ECMAScript | ES2022 | `tsdown.config.ts` |
| TypeScript target | ESNext | `tsconfig.json` |
