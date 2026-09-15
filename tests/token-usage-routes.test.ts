import { describe, expect, test } from "bun:test"
import { fileURLToPath } from "node:url"

import type { UsageData } from "~/lib/usage-tracker"

interface Scenario {
  route: "messages" | "chat-completions" | "responses"
  endpoint: "/v1/messages" | "/chat/completions" | "/responses"
  stream: boolean
  repeatInputUsage?: boolean
}

function runHandler(scenario: Scenario) {
  const script = `
    import { mock } from "bun:test"
    import { Hono } from "hono"
    import consola from "consola"
    import fs from "node:fs"
    consola.level = -999
    fs.writeFileSync = () => { throw new Error("Handler tests must not write files") }

    const configuration = ${JSON.stringify(scenario)}
    const records = []
    const recordUsage = (model, usage) => records.push({ model, usage })
    const { createRequestUsageTracker, getChatCompletionUsage, getResponsesUsage } =
      await import("~/lib/usage-tracker")
    mock.module("~/lib/usage-tracker", () => ({
      trackUsage: recordUsage,
      createRequestUsageTracker: model => createRequestUsageTracker(model, recordUsage),
      getChatCompletionUsage,
      getResponsesUsage,
    }))
    const mockedTracker = await import("~/lib/usage-tracker")
    if (mockedTracker.trackUsage !== recordUsage) throw new Error("Usage recorder was not isolated")
    mock.module("~/lib/rate-limit", () => ({ checkRateLimit: async () => {} }))
    mock.module("~/lib/endpoint-selector", () => ({ selectEndpoint: () => configuration.endpoint }))
    mock.module("~/lib/tokenizer", () => ({ getTokenCount: async () => ({ input: 0, output: 0 }) }))

    const nativeUsage = {
      input_tokens: 2,
      output_tokens: 20,
      cache_creation_input_tokens: 1000,
      cache_read_input_tokens: 800,
    }
    const chatUsage = {
      prompt_tokens: 1802,
      completion_tokens: 20,
      total_tokens: 1822,
      prompt_tokens_details: { cached_tokens: 800 },
    }
    const responsesUsage = {
      input_tokens: 1802,
      output_tokens: 20,
      total_tokens: 1822,
      input_tokens_details: { cached_tokens: 800 },
    }
    const nativeResponse = {
      id: "msg_test", type: "message", role: "assistant", model: "test-model",
      content: [{ type: "text", text: "ok" }], stop_reason: "end_turn",
      stop_sequence: null, usage: nativeUsage,
    }
    const chatResponse = {
      id: "chat_test", object: "chat.completion", created: 0, model: "test-model",
      choices: [{ index: 0, message: { role: "assistant", content: "ok" },
        finish_reason: "stop", logprobs: null }], usage: chatUsage,
    }
    const responsesResponse = {
      id: "resp_test", object: "response", created_at: 0, model: "test-model", status: "completed",
      output: [{ id: "item_test", type: "message", role: "assistant",
        content: [{ type: "output_text", text: "ok" }] }], usage: responsesUsage,
    }
    async function* events(values) {
      for (const value of values) yield { event: value.type, data: JSON.stringify(value) }
    }
    mock.module("~/services/copilot/create-messages", () => ({
      createMessages: async () => configuration.stream ? events([
        { type: "message_start", message: { ...nativeResponse, usage: { ...nativeUsage, output_tokens: 1 } } },
        { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "ok" } },
        { type: "message_delta", delta: {}, usage: { output_tokens: 10 } },
        { type: "message_delta", delta: { stop_reason: "end_turn" },
          usage: configuration.repeatInputUsage ? nativeUsage : { output_tokens: 20 } },
        { type: "message_stop" },
      ]) : nativeResponse,
    }))
    const chatChunk = choices => ({
      id: "chat_test", object: "chat.completion.chunk", created: 0, model: "test-model", choices,
    })
    mock.module("~/services/copilot/create-chat-completions", () => ({
      createChatCompletions: async () => configuration.stream ? events([
        chatChunk([{ index: 0, delta: { role: "assistant", content: "ok" }, finish_reason: null }]),
        chatChunk([{ index: 0, delta: {}, finish_reason: "stop" }]),
        { ...chatChunk([]), usage: chatUsage },
        { ...chatChunk([]), usage: chatUsage },
      ]) : chatResponse,
    }))
    mock.module("~/services/copilot/create-responses", () => ({
      createResponses: async () => configuration.stream ? events([
        { type: "response.output_text.delta", delta: "ok" },
        { type: "response.completed", response: responsesResponse },
      ]) : responsesResponse,
    }))

    const { state } = await import("~/lib/state")
    state.models = { data: [{ id: "test-model", capabilities: { supports: {}, limits: { max_output_tokens: 64 } } }] }
    state.sessionLog = false
    state.manualApprove = false
    const { handleCompletion } = await import("~/routes/" + configuration.route + "/handler")
    const app = new Hono()
    app.post("/", handleCompletion)
    const response = await app.request("/", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "test-model", stream: configuration.stream, max_tokens: 64,
        messages: [{ role: "user", content: "hello" }], input: "hello" }),
    })
    const body = await response.text()
    process.stdout.write(JSON.stringify({ status: response.status, hasBody: body.length > 0, records }))
  `
  const result = Bun.spawnSync({
    cmd: [process.execPath, "--eval", script],
    cwd: fileURLToPath(new URL("..", import.meta.url)),
    stdout: "pipe",
    stderr: "pipe",
  })

  expect(result.stderr.toString()).toBe("")
  expect(result.exitCode).toBe(0)
  return JSON.parse(result.stdout.toString()) as {
    status: number
    hasBody: boolean
    records: Array<{ model: string; usage: UsageData }>
  }
}

const endpoints: Array<Scenario["endpoint"]> = [
  "/v1/messages",
  "/chat/completions",
  "/responses",
]

for (const route of ["messages", "responses", "chat-completions"] as const) {
  describe(`${route} usage recording`, () => {
    for (const endpoint of endpoints) {
      if (route === "chat-completions" && endpoint === "/v1/messages") continue
      for (const stream of [false, true]) {
        test(`${endpoint}, stream=${stream}: records complete usage once`, () => {
          const result = runHandler({ route, endpoint, stream })

          expect(result.status).toBe(200)
          expect(result.hasBody).toBe(true)
          expect(result.records).toEqual([
            {
              model: "test-model",
              usage: {
                input_tokens: endpoint === "/v1/messages" ? 2 : 1002,
                output_tokens: 20,
                cache_creation_input_tokens:
                  endpoint === "/v1/messages" ? 1000 : 0,
                cache_read_input_tokens: 800,
              },
            },
          ])
        })
      }
    }
  })
}

describe("Native cumulative usage", () => {
  test("does not double count input repeated in the final native event", () => {
    const result = runHandler({
      route: "messages",
      endpoint: "/v1/messages",
      stream: true,
      repeatInputUsage: true,
    })

    expect(result.records).toHaveLength(1)
    expect(result.records[0].usage.input_tokens).toBe(2)
    expect(result.records[0].usage.cache_creation_input_tokens).toBe(1000)
  })
})
