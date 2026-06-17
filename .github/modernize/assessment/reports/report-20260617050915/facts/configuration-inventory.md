# Configuration & Externalized Settings Inventory

The application configuration is centered on CLI flags, environment variables, and a small set of repository-level config files. Runtime secrets are externally supplied via local token storage and optional environment variables.

## Configuration Sources

| Source | Type | Path/Location | Notes |
|---|---|---|---|
| `package.json` | Build and script config | repository root | Defines build, lint, typecheck, and start scripts |
| `tsconfig.json` | TypeScript compiler config | repository root | Strict TypeScript options and path aliases |
| `eslint.config.js` | Lint config | repository root | ESLint setup via shared config package |
| `opencode.json` | Tool integration config | repository root | Editor/agent integration metadata |
| `Dockerfile` | Container runtime config | repository root | Bun-based multi-stage build and healthcheck |
| `entrypoint.sh` | Container startup config | repository root | Accepts `GH_TOKEN` and starts CLI |
| CLI args (`src/start.ts`) | Runtime options | command line | Port, account type, rate limit, token display, etc. |
| Environment variables | Runtime externalized config | shell/container | `GH_TOKEN`, proxy environment variables |
| Local token file | Secret storage | `~/.local/share/copilot-api/github_token` | Created and read by token module |

## Build Profiles

| Profile | Activation | Purpose | Key Dependencies/Plugins |
|---|---|---|---|
| default build | `npm run build` or `bun run build` | Bundle server entrypoint | `tsdown`, `typescript` |
| dev watch | `bun run dev` | Local development with watch mode | Bun runtime |
| production start | `bun run start` | Start production server process | Bun runtime |
| docker builder stage | Docker build stage | Build distributable artifacts | `oven/bun:1.2.19-alpine` |
| docker runner stage | Docker build stage | Runtime image with prod deps | `oven/bun:1.2.19-alpine` |

## Runtime Profiles

| Profile | Activation Method | Config Files | Key Overrides |
|---|---|---|---|
| default local | CLI without extra env | `src/start.ts` defaults | Port `4141`, account type `individual` |
| docker runtime | Container entrypoint | `Dockerfile`, `entrypoint.sh` | Reads `GH_TOKEN`, exposes port `4141` |
| proxy-enabled runtime | `--proxy-env` flag | environment variables | Initializes proxy settings from process env |

## Properties Inventory

| Property Key | Default | Profiles | Source |
|---|---|---|---|
| `port` | `4141` | all | CLI arg in `src/start.ts` |
| `verbose` | `false` | all | CLI arg in `src/start.ts` |
| `account-type` | `individual` | all | CLI arg in `src/start.ts` |
| `manual` | `false` | all | CLI arg in `src/start.ts` |
| `rate-limit` | unset | optional | CLI arg in `src/start.ts` |
| `wait` | `false` | optional | CLI arg in `src/start.ts` |
| `github-token` | unset | optional | CLI arg in `src/start.ts` |
| `claude-code` | `false` | optional | CLI arg in `src/start.ts` |
| `show-token` | `false` | optional | CLI arg in `src/start.ts` |
| `proxy-env` | `false` | optional | CLI arg in `src/start.ts` |
| `session-log` | `false` | optional | CLI arg in `src/start.ts` |
| `fuzzy-model` | `false` | optional | CLI arg in `src/start.ts` |
| `GH_TOKEN` | unset | docker or env-driven | environment variable |

## Startup Parameters & Resource Requirements

| Service | JVM/Runtime Options | Memory | Instance Count |
|---|---|---|---|
| copilot-api | Bun runtime, CLI options, optional proxy env initialization | Not explicitly pinned in repo | Single process by default |
| docker copilot-api | Bun runtime in alpine image; healthcheck enabled | Not explicitly pinned in Dockerfile | Single container by default |

## Startup Dependency Chain

1. `start` command initializes path/proxy configuration.
2. GitHub token is loaded or device-flow authentication is run.
3. Copilot token is fetched and scheduled for refresh.
4. Model metadata is cached.
5. HTTP server is started and begins handling requests.

## Secrets & Sensitive Configuration

| Secret Reference | Type | Storage (masked) |
|---|---|---|
| `GH_TOKEN` | GitHub access token input | Environment variable `[MASKED]` |
| `~/.local/share/copilot-api/github_token` | persisted token file | Local file `[MASKED]` |
| in-memory copilot token | short-lived service token | process memory `[MASKED]` |

### Secrets Provisioning Workflow

Secrets are either provided directly through environment variables (for container/automation usage) or created via interactive GitHub device flow and then stored locally. The application reads these secrets at startup, exchanges for a Copilot token, and refreshes the Copilot token during runtime. The same token set is shared across all route handlers inside the single service process.

## Feature Flags

| Flag Name | Default | Controlled By |
|---|---|---|
| `manual` | `false` | CLI arg `--manual` |
| `wait` | `false` | CLI arg `--wait` |
| `show-token` | `false` | CLI arg `--show-token` |
| `proxy-env` | `false` | CLI arg `--proxy-env` |
| `session-log` | `false` | CLI arg `--session-log` |
| `fuzzy-model` | `false` | CLI arg `--fuzzy-model` |

## Framework & Runtime Versions

| Component | Version | Source |
|---|---|---|
| Bun runtime | `>=1.2.x` | README prerequisites and Docker base image |
| Hono | `^4.9.9` | `package.json` |
| TypeScript | `^5.9.3` | `package.json` |
| ESLint | `^9.37.0` | `package.json` |
| Node HTTP client (`undici`) | `^7.16.0` | `package.json` |
| Docker base image | `oven/bun:1.2.19-alpine` | `Dockerfile` |
