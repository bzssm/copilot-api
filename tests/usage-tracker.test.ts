import { describe, expect, test } from "bun:test"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  createRequestUsageTracker,
  createUsageTracker,
  getChatCompletionUsage,
  getResponsesUsage,
  type getUsageStats,
  type UsageData,
} from "~/lib/usage-tracker"

interface UsageUpdate {
  model: string
  usage: UsageData
}

interface TrackerResult {
  stats: ReturnType<typeof getUsageStats>
  writes: Array<ReturnType<typeof getUsageStats>>
}

function runTracker(
  initialStats: Record<string, UsageData & { request_count: number }>,
  updates: Array<UsageUpdate>,
): TrackerResult {
  const directory = mkdtempSync(join(tmpdir(), "copilot-api-usage-"))
  const usageFile = join(directory, "token-usage.json")

  try {
    writeFileSync(usageFile, JSON.stringify(initialStats))
    const tracker = createUsageTracker(usageFile)
    const writes: TrackerResult["writes"] = []

    for (const update of updates) {
      tracker.trackUsage(update.model, update.usage)
      writes.push(
        JSON.parse(readFileSync(usageFile, "utf8")) as TrackerResult["stats"],
      )
    }

    return { stats: tracker.getUsageStats(), writes }
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

describe("Token usage tracking", () => {
  test("accumulates and persists cache writes separately from ordinary input", () => {
    const { stats, writes } = runTracker({}, [
      {
        model: "claude-test",
        usage: {
          input_tokens: 2,
          output_tokens: 1625,
          cache_creation_input_tokens: 166827,
          cache_read_input_tokens: 0,
        },
      },
      {
        model: "claude-test",
        usage: {
          input_tokens: 10,
          output_tokens: 100,
          cache_creation_input_tokens: 200,
          cache_read_input_tokens: 166827,
        },
      },
    ])

    expect(stats["claude-test"]).toEqual({
      input_tokens: 12,
      output_tokens: 1725,
      cache_creation_input_tokens: 167027,
      cache_read_input_tokens: 166827,
      request_count: 2,
    })
    expect(writes).toHaveLength(2)
    expect(writes[0]["claude-test"].cache_creation_input_tokens).toBe(166827)
    expect(writes[1]).toEqual(stats)
  })

  test("loads legacy totals without resetting existing usage", () => {
    const { stats, writes } = runTracker(
      {
        "claude-test": {
          input_tokens: 14305,
          output_tokens: 1016247,
          cache_read_input_tokens: 107357592,
          request_count: 689,
        },
      },
      [],
    )

    expect(stats["claude-test"]).toEqual({
      input_tokens: 14305,
      output_tokens: 1016247,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 107357592,
      request_count: 689,
    })
    expect(writes).toHaveLength(0)
  })

  test("retains saved cache writes when a caller omits the optional field", () => {
    const { stats } = runTracker(
      {
        "claude-test": {
          input_tokens: 2,
          output_tokens: 1625,
          cache_creation_input_tokens: 166827,
          cache_read_input_tokens: 0,
          request_count: 1,
        },
      },
      [
        {
          model: "claude-test",
          usage: {
            input_tokens: 5,
            output_tokens: 20,
            cache_read_input_tokens: 166827,
          },
        },
      ],
    )

    expect(stats["claude-test"]).toEqual({
      input_tokens: 7,
      output_tokens: 1645,
      cache_creation_input_tokens: 166827,
      cache_read_input_tokens: 166827,
      request_count: 2,
    })
  })
})

describe("Request usage snapshots", () => {
  test("retains initial input and cache writes when the final event only reports output", () => {
    const records: Array<UsageUpdate> = []
    const tracker = createRequestUsageTracker("claude-test", (model, usage) => {
      records.push({ model, usage })
    })

    tracker.update({
      input_tokens: 2,
      output_tokens: 1,
      cache_creation_input_tokens: 166827,
      cache_read_input_tokens: 0,
    })
    tracker.update({ output_tokens: 1625 })
    tracker.flush()

    expect(records).toEqual([
      {
        model: "claude-test",
        usage: {
          input_tokens: 2,
          output_tokens: 1625,
          cache_creation_input_tokens: 166827,
          cache_read_input_tokens: 0,
        },
      },
    ])
  })

  test("records repeated cumulative usage and repeated flushes only once", () => {
    const records: Array<UsageUpdate> = []
    const tracker = createRequestUsageTracker("claude-test", (model, usage) => {
      records.push({ model, usage })
    })
    const usage = {
      input_tokens: 2,
      output_tokens: 1625,
      cache_creation_input_tokens: 166827,
      cache_read_input_tokens: 0,
    }

    tracker.update(usage)
    tracker.update(usage)
    tracker.flush()
    tracker.flush()
    tracker.update({ output_tokens: 2000 })

    expect(records).toEqual([{ model: "claude-test", usage }])
  })

  test("preserves missing fields but accepts explicit zero values", () => {
    const records: Array<UsageUpdate> = []
    const tracker = createRequestUsageTracker("claude-test", (model, usage) => {
      records.push({ model, usage })
    })

    tracker.update({ input_tokens: 20, cache_creation_input_tokens: 100 })
    tracker.update({ input_tokens: undefined, cache_creation_input_tokens: 0 })
    tracker.flush()

    expect(records[0].usage.input_tokens).toBe(20)
    expect(records[0].usage.cache_creation_input_tokens).toBe(0)
  })

  test("does not count streams without usage", () => {
    const records: Array<UsageUpdate> = []
    const tracker = createRequestUsageTracker("claude-test", (model, usage) => {
      records.push({ model, usage })
    })

    tracker.update(undefined)
    tracker.update({})
    tracker.flush()

    expect(records).toHaveLength(0)
  })
})

describe("OpenAI usage normalization", () => {
  test("separates cached chat prompt tokens without double counting", () => {
    expect(
      getChatCompletionUsage({
        prompt_tokens: 1000,
        completion_tokens: 20,
        total_tokens: 1020,
        prompt_tokens_details: { cached_tokens: 800 },
      }),
    ).toEqual({
      input_tokens: 200,
      output_tokens: 20,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 800,
    })
  })

  test("separates cached Responses input tokens without double counting", () => {
    expect(
      getResponsesUsage({
        input_tokens: 1000,
        output_tokens: 20,
        total_tokens: 1020,
        input_tokens_details: { cached_tokens: 800 },
      }),
    ).toEqual({
      input_tokens: 200,
      output_tokens: 20,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 800,
    })
  })
})
