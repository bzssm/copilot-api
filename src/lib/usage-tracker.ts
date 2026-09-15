// 全局 token 用量统计，分模型记录，持久化到本地文件，不依赖 --session-log

import consola from "consola"
import fs from "node:fs"
import path from "node:path"

import type { ChatCompletionResponse } from "~/services/copilot/create-chat-completions"
import type { ResponsesResponse } from "~/services/copilot/create-responses"

const __dirname = import.meta.dirname
const USAGE_FILE = path.resolve(__dirname, "..", "..", "token-usage.json")

interface ModelUsage {
  input_tokens: number
  output_tokens: number
  cache_creation_input_tokens: number
  cache_read_input_tokens: number
  request_count: number
}

export interface UsageData {
  input_tokens: number
  output_tokens: number
  cache_creation_input_tokens?: number
  cache_read_input_tokens: number
}

export function createUsageTracker(usageFile: string) {
  const usageByModel = new Map<string, ModelUsage>()

  // 启动时从文件加载
  try {
    const content = fs.readFileSync(usageFile)
    const data = JSON.parse(content.toString()) as Record<
      string,
      UsageData & { request_count: number }
    >
    for (const [model, usage] of Object.entries(data)) {
      usageByModel.set(model, {
        ...usage,
        cache_creation_input_tokens: usage.cache_creation_input_tokens ?? 0,
      })
    }
    consola.info(`[Usage Tracker] Loaded usage data from ${usageFile}`)
  } catch {
    // 文件不存在或无效，从空开始
  }

  function saveToFile(): void {
    try {
      const data: Record<string, ModelUsage> = {}
      for (const [model, usage] of usageByModel) {
        data[model] = { ...usage }
      }
      fs.writeFileSync(usageFile, JSON.stringify(data, null, 2))
    } catch (error) {
      consola.warn("[Usage Tracker] Failed to save:", error)
    }
  }

  function trackUsage(model: string, usage: UsageData): void {
    const existing = usageByModel.get(model) ?? {
      input_tokens: 0,
      output_tokens: 0,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
      request_count: 0,
    }

    existing.input_tokens += usage.input_tokens
    existing.output_tokens += usage.output_tokens
    existing.cache_creation_input_tokens +=
      usage.cache_creation_input_tokens ?? 0
    existing.cache_read_input_tokens += usage.cache_read_input_tokens
    existing.request_count += 1

    usageByModel.set(model, existing)
    saveToFile()
  }

  function getUsageStats(): Record<string, ModelUsage> {
    const result: Record<string, ModelUsage> = {}
    for (const [model, usage] of usageByModel) {
      result[model] = { ...usage }
    }
    return result
  }

  return { trackUsage, getUsageStats }
}

export const { trackUsage, getUsageStats } = createUsageTracker(USAGE_FILE)

export function getChatCompletionUsage(
  usage: ChatCompletionResponse["usage"],
): UsageData {
  const cachedTokens = usage?.prompt_tokens_details?.cached_tokens ?? 0
  return {
    input_tokens: (usage?.prompt_tokens ?? 0) - cachedTokens,
    output_tokens: usage?.completion_tokens ?? 0,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: cachedTokens,
  }
}

export function getResponsesUsage(
  usage: ResponsesResponse["usage"] | undefined,
): UsageData {
  const cachedTokens = usage?.input_tokens_details?.cached_tokens ?? 0
  return {
    input_tokens: (usage?.input_tokens ?? 0) - cachedTokens,
    output_tokens: usage?.output_tokens ?? 0,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: cachedTokens,
  }
}

export function createRequestUsageTracker(
  model: string,
  recordUsage: typeof trackUsage = trackUsage,
) {
  const usage: Required<UsageData> = {
    input_tokens: 0,
    output_tokens: 0,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
  }
  let hasUsage = false
  let recorded = false

  function update(snapshot: Partial<UsageData> | undefined): void {
    if (!snapshot || recorded) return
    for (const field of Object.keys(usage) as Array<keyof UsageData>) {
      const value = snapshot[field]
      if (value !== undefined) {
        usage[field] = value
        hasUsage = true
      }
    }
  }

  function flush(): void {
    if (!hasUsage || recorded) return
    recorded = true
    recordUsage(model, { ...usage })
  }

  return { update, flush }
}
