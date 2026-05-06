// 全局 token 用量统计，分模型记录，持久化到本地文件，不依赖 --session-log

import consola from "consola"
import fs from "node:fs"
import path from "node:path"

const __dirname = import.meta.dirname
const USAGE_FILE = path.resolve(__dirname, "..", "..", "token-usage.json")

interface ModelUsage {
  input_tokens: number
  output_tokens: number
  cache_read_input_tokens: number
  request_count: number
}

const usageByModel = new Map<string, ModelUsage>()

// 启动时从文件加载
try {
  const content = fs.readFileSync(USAGE_FILE)
  const data = JSON.parse(content) as Record<string, ModelUsage>
  for (const [model, usage] of Object.entries(data)) {
    usageByModel.set(model, usage)
  }
  consola.info(`[Usage Tracker] Loaded usage data from ${USAGE_FILE}`)
} catch {
  // 文件不存在或无效，从空开始
}

function saveToFile(): void {
  try {
    const data: Record<string, ModelUsage> = {}
    for (const [model, usage] of usageByModel) {
      data[model] = { ...usage }
    }
    fs.writeFileSync(USAGE_FILE, JSON.stringify(data, null, 2))
  } catch (error) {
    consola.warn("[Usage Tracker] Failed to save:", error)
  }
}

export interface UsageData {
  input_tokens: number
  output_tokens: number
  cache_read_input_tokens: number
}

export function trackUsage(model: string, usage: UsageData): void {
  const existing = usageByModel.get(model) ?? {
    input_tokens: 0,
    output_tokens: 0,
    cache_read_input_tokens: 0,
    request_count: 0,
  }

  existing.input_tokens += usage.input_tokens
  existing.output_tokens += usage.output_tokens
  existing.cache_read_input_tokens += usage.cache_read_input_tokens
  existing.request_count += 1

  usageByModel.set(model, existing)
  saveToFile()
}

export function getUsageStats(): Record<string, ModelUsage> {
  const result: Record<string, ModelUsage> = {}
  for (const [model, usage] of usageByModel) {
    result[model] = { ...usage }
  }
  return result
}
