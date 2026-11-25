/* eslint-disable regexp/no-unused-capturing-group -- pre-existing, tracked as tech debt */
import consola from "consola"

import { getModels } from "~/services/copilot/get-models"
import { getVSCodeVersion } from "~/services/get-vscode-version"

import { HTTPError } from "./error"
import { state } from "./state"

export const sleep = (ms: number) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms)
  })

export const isNullish = (value: unknown): value is null | undefined =>
  value === null || value === undefined

export const isGpt5OrAbove = (model: string): boolean =>
  /^gpt-([5-9]|\d{2,})/.test(model)

function levenshtein(a: string, b: string): number {
  const m = a.length
  const n = b.length
  const dp = Array.from({ length: m + 1 }, () =>
    Array.from<number>({ length: n + 1 }).fill(0),
  )
  for (let i = 0; i <= m; i++) {
    dp[i][0] = i
  }
  for (let j = 0; j <= n; j++) {
    dp[0][j] = j
  }
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] =
        a[i - 1] === b[j - 1] ?
          dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1])
    }
  }
  return dp[m][n]
}

const FUZZY_MODEL_THRESHOLD = 0.2
const ONE_MILLION_CONTEXT_SUFFIX = "[1m]"

const modelAliasKey = (name: string) => name.toLowerCase().replaceAll(".", "-")

/**
 * Strict mode requires the original model ID. Otherwise, normalize the context
 * suffix and check exact IDs and aliases before using edit distance.
 */
export function resolveModelName(input: string): string {
  const available = state.models?.data.map((model) => model.id) ?? []
  if (state.strictModelName) {
    if (available.includes(input)) return input

    const message = `Model "${input}" does not exactly match an available model ID`
    throw new HTTPError(message, new Response(message, { status: 400 }))
  }

  const normalizedInput =
    input.endsWith(ONE_MILLION_CONTEXT_SUFFIX) ?
      input.slice(0, -ONE_MILLION_CONTEXT_SUFFIX.length)
    : input
  if (available.length === 0) return normalizedInput

  // 1. Exact match
  if (available.includes(normalizedInput)) return normalizedInput

  const aliasKey = modelAliasKey(normalizedInput)
  const aliasMatch = available.find(
    (model) => modelAliasKey(model) === aliasKey,
  )
  if (aliasMatch) {
    consola.info(
      `Resolved model "${input}" -> "${aliasMatch}" (normalized alias)`,
    )
    return aliasMatch
  }

  const lowerInput = normalizedInput.toLowerCase()
  let bestMatch = normalizedInput
  let bestDistance = Infinity
  for (const model of available) {
    const distance = levenshtein(lowerInput, model.toLowerCase())
    if (distance < bestDistance) {
      bestDistance = distance
      bestMatch = model
    }
  }

  const maxLen = Math.max(normalizedInput.length, bestMatch.length)
  const ratio = maxLen > 0 ? bestDistance / maxLen : Infinity
  if (ratio < FUZZY_MODEL_THRESHOLD) {
    consola.info(
      `Resolved model "${input}" -> "${bestMatch}" (fuzzy, distance=${bestDistance}, ratio=${ratio.toFixed(2)}, threshold=${FUZZY_MODEL_THRESHOLD})`,
    )
    return bestMatch
  }

  consola.warn(
    `No close model match for "${input}", passing through "${normalizedInput}"`,
  )
  return normalizedInput
}

export async function cacheModels(): Promise<void> {
  const models = await getModels()
  state.models = models
}

export const cacheVSCodeVersion = async () => {
  const response = await getVSCodeVersion()
  state.vsCodeVersion = response

  consola.info(`Using VSCode version: ${response}`)
}
