/* eslint-disable regexp/no-unused-capturing-group -- pre-existing, tracked as tech debt */
import consola from "consola"

import { getModels } from "~/services/copilot/get-models"
import { getVSCodeVersion } from "~/services/get-vscode-version"

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

/**
 * Resolves a requested model name to an available model id.
 *
 * Order: exact match -> case-insensitive exact match -> (opt-in) Levenshtein
 * fuzzy match. Fuzzy matching only runs when `state.fuzzyModelMatch` is enabled
 * and the closest candidate is within `FUZZY_MODEL_THRESHOLD` relative distance.
 * When nothing matches confidently the original input is returned unchanged so
 * the upstream API decides how to handle it.
 */
export function resolveModelName(input: string): string {
  const available = state.models?.data.map((model) => model.id) ?? []
  if (available.length === 0) return input

  // 1. Exact match
  if (available.includes(input)) return input

  const lowerInput = input.toLowerCase()

  // 2. Case-insensitive exact match
  const caseMatch = available.find(
    (model) => model.toLowerCase() === lowerInput,
  )
  if (caseMatch) {
    consola.info(
      `Resolved model "${input}" -> "${caseMatch}" (case-insensitive)`,
    )
    return caseMatch
  }

  // 3. Levenshtein fuzzy match (opt-in via --fuzzy-model)
  if (!state.fuzzyModelMatch) return input

  let bestMatch = input
  let bestDistance = Infinity
  for (const model of available) {
    const distance = levenshtein(lowerInput, model.toLowerCase())
    if (distance < bestDistance) {
      bestDistance = distance
      bestMatch = model
    }
  }

  const maxLen = Math.max(input.length, bestMatch.length)
  const ratio = maxLen > 0 ? bestDistance / maxLen : Infinity
  if (ratio < FUZZY_MODEL_THRESHOLD) {
    consola.info(
      `Resolved model "${input}" -> "${bestMatch}" (fuzzy, distance=${bestDistance}, ratio=${ratio.toFixed(2)}, threshold=${FUZZY_MODEL_THRESHOLD})`,
    )
    return bestMatch
  }

  consola.warn(`No close model match for "${input}", passing through unchanged`)
  return input
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
