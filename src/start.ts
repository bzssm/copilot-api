#!/usr/bin/env node

import { readFile } from "node:fs/promises"

import { defineCommand } from "citty"
import clipboard from "clipboardy"
import consola from "consola"
import { serve, type ServerHandler } from "srvx"
import invariant from "tiny-invariant"

import { ensurePaths } from "./lib/paths"
import { initProxyFromEnv } from "./lib/proxy"
import { generateEnvScript } from "./lib/shell"
import { state } from "./lib/state"
import { setupCopilotToken, setupGitHubToken } from "./lib/token"
import { cacheModels, cacheVSCodeVersion } from "./lib/utils"
import { server } from "./server"

interface RunServerOptions {
  port: number
  verbose: boolean
  accountType: string
  manual: boolean
  rateLimit?: number
  rateLimitWait: boolean
  githubToken?: string
  claudeCode: boolean
  showToken: boolean
  proxyEnv: boolean
  sessionLog: boolean
  fuzzyModelMatch: boolean
  overrideContextWindowPath?: string
}

// Applied when --override-context-window is passed as a bare flag (no path).
// Fill in model id -> context window token count entries as needed.
const DEFAULT_CONTEXT_WINDOW_OVERRIDES: Record<string, number> = {
  "claude-fable-5": 1_000_000,
  "claude-opus-4.6": 1_000_000,
  "claude-opus-4.7": 1_000_000,
  "claude-opus-4.8": 1_000_000,
  "claude-sonnet-4.6": 1_000_000,
  "claude-sonnet-5": 1_000_000,
  "gemini-3.1-pro-preview": 1_000_000,
  "gemini-3.5-flash": 1_000_000,
  "gpt-5.5": 1_000_000,
}

async function loadContextWindowOverrides(
  path: string,
): Promise<Record<string, number>> {
  let raw: string
  try {
    raw = await readFile(path, "utf8")
  } catch (error) {
    throw new Error(
      `Failed to read context window override file at "${path}": ${error instanceof Error ? error.message : String(error)}`,
    )
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    throw new Error(
      `Failed to parse context window override file at "${path}" as JSON: ${error instanceof Error ? error.message : String(error)}`,
    )
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(
      `Context window override file at "${path}" must be a JSON object mapping model id to a token count`,
    )
  }

  const overrides: Record<string, number> = {}
  for (const [modelId, value] of Object.entries(parsed)) {
    if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
      throw new Error(
        `Context window override for "${modelId}" must be a positive integer, received: ${JSON.stringify(value)}`,
      )
    }
    overrides[modelId] = value
  }

  return overrides
}

export async function runServer(options: RunServerOptions): Promise<void> {
  if (options.proxyEnv) {
    initProxyFromEnv()
  }

  if (options.verbose) {
    consola.level = 5
    consola.info("Verbose logging enabled")
  }

  state.accountType = options.accountType
  if (options.accountType !== "individual") {
    consola.info(`Using ${options.accountType} plan GitHub account`)
  }

  state.manualApprove = options.manual
  state.rateLimitSeconds = options.rateLimit
  state.rateLimitWait = options.rateLimitWait
  state.showToken = options.showToken
  state.sessionLog = options.sessionLog
  state.fuzzyModelMatch = options.fuzzyModelMatch

  if (options.overrideContextWindowPath !== undefined) {
    state.contextWindowOverrides =
      options.overrideContextWindowPath === "" ?
        DEFAULT_CONTEXT_WINDOW_OVERRIDES
        : await loadContextWindowOverrides(options.overrideContextWindowPath)
    consola.info(
      `Loaded ${Object.keys(state.contextWindowOverrides).length} context window override(s)`,
    )
  }

  await ensurePaths()
  await cacheVSCodeVersion()

  if (options.githubToken) {
    state.githubToken = options.githubToken
    consola.info("Using provided GitHub token")
  } else {
    await setupGitHubToken()
  }

  await setupCopilotToken()
  await cacheModels()

  consola.info(
    `Available models: \n${state.models?.data.map((model) => `- ${model.id}`).join("\n")}`,
  )
  consola.debug("Full models response:", JSON.stringify(state.models, null, 2))

  const serverUrl = `http://localhost:${options.port}`

  if (options.claudeCode) {
    invariant(state.models, "Models should be loaded by now")

    const selectedModel = await consola.prompt(
      "Select a model to use with Claude Code",
      {
        type: "select",
        options: state.models.data.map((model) => model.id),
      },
    )

    const selectedSmallModel = await consola.prompt(
      "Select a small model to use with Claude Code",
      {
        type: "select",
        options: state.models.data.map((model) => model.id),
      },
    )

    const command = generateEnvScript(
      {
        ANTHROPIC_BASE_URL: serverUrl,
        ANTHROPIC_AUTH_TOKEN: "dummy",
        ANTHROPIC_MODEL: selectedModel,
        ANTHROPIC_DEFAULT_SONNET_MODEL: selectedModel,
        ANTHROPIC_SMALL_FAST_MODEL: selectedSmallModel,
        ANTHROPIC_DEFAULT_HAIKU_MODEL: selectedSmallModel,
        DISABLE_NON_ESSENTIAL_MODEL_CALLS: "1",
        CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
      },
      "claude",
    )

    try {
      clipboard.writeSync(command)
      consola.success("Copied Claude Code command to clipboard!")
    } catch {
      consola.warn(
        "Failed to copy to clipboard. Here is the Claude Code command:",
      )
      consola.log(command)
    }
  }

  consola.box(`🌐 Dashboard: ${serverUrl}/dashboard`)

  serve({
    fetch: server.fetch as ServerHandler,
    port: options.port,
  })
}

export const start = defineCommand({
  meta: {
    name: "start",
    description: "Start the Copilot API server",
  },
  args: {
    port: {
      alias: "p",
      type: "string",
      default: "4141",
      description: "Port to listen on",
    },
    verbose: {
      alias: "v",
      type: "boolean",
      default: false,
      description: "Enable verbose logging",
    },
    "account-type": {
      alias: "a",
      type: "string",
      default: "individual",
      description: "Account type to use (individual, business, enterprise)",
    },
    manual: {
      type: "boolean",
      default: false,
      description: "Enable manual request approval",
    },
    "rate-limit": {
      alias: "r",
      type: "string",
      description: "Rate limit in seconds between requests",
    },
    wait: {
      alias: "w",
      type: "boolean",
      default: false,
      description:
        "Wait instead of error when rate limit is hit. Has no effect if rate limit is not set",
    },
    "github-token": {
      alias: "g",
      type: "string",
      description:
        "Provide GitHub token directly (must be generated using the `auth` subcommand)",
    },
    "claude-code": {
      alias: "c",
      type: "boolean",
      default: false,
      description:
        "Generate a command to launch Claude Code with Copilot API config",
    },
    "show-token": {
      type: "boolean",
      default: false,
      description: "Show GitHub and Copilot tokens on fetch and refresh",
    },
    "proxy-env": {
      type: "boolean",
      default: false,
      description: "Initialize proxy from environment variables",
    },
    "session-log": {
      type: "boolean",
      default: false,
      description: "Enable session logging to local files",
    },
    "fuzzy-model": {
      type: "boolean",
      default: false,
      description:
        "Enable fuzzy matching of requested model names to the closest available model",
    },
    "override-context-window": {
      type: "string",
      description:
        "Path to a JSON file mapping model id to a context window token count, used to override each model's max_context_window_tokens when caching models",
    },
  },
  run({ args }) {
    const rateLimitRaw = args["rate-limit"]
    const rateLimit =
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      rateLimitRaw === undefined ? undefined : Number.parseInt(rateLimitRaw, 10)

    return runServer({
      port: Number.parseInt(args.port, 10),
      verbose: args.verbose,
      accountType: args["account-type"],
      manual: args.manual,
      rateLimit,
      rateLimitWait: args.wait,
      githubToken: args["github-token"],
      claudeCode: args["claude-code"],
      showToken: args["show-token"],
      proxyEnv: args["proxy-env"],
      sessionLog: args["session-log"],
      fuzzyModelMatch: args["fuzzy-model"],
      overrideContextWindowPath: args["override-context-window"],
    })
  },
})
