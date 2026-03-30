import type { Context } from "hono"

import consola from "consola"
import { streamSSE } from "hono/streaming"

import { awaitApproval } from "~/lib/approval"
import { checkRateLimit } from "~/lib/rate-limit"
import { addRecord } from "~/lib/session-store"
import { state } from "~/lib/state"
import { trackUsage } from "~/lib/usage-tracker"
import {
  createChatCompletions,
  type ChatCompletionChunk,
  type ChatCompletionResponse,
} from "~/services/copilot/create-chat-completions"

import {
  type AnthropicMessagesPayload,
  type AnthropicStreamState,
} from "./anthropic-types"
import {
  translateToAnthropic,
  translateToOpenAI,
} from "./non-stream-translation"
import { translateChunkToAnthropicEvents } from "./stream-translation"

export async function handleCompletion(c: Context) {
  await checkRateLimit(state)

  const anthropicPayload = await c.req.json<AnthropicMessagesPayload>()

  // 从 metadata.user_id 中解析 session_id
  let sessionId: string | undefined
  try {
    const metadata = anthropicPayload.metadata as
      | Record<string, unknown>
      | undefined
    if (metadata?.user_id && typeof metadata.user_id === "string") {
      const userIdData = JSON.parse(metadata.user_id) as Record<string, unknown>
      sessionId = userIdData.session_id as string | undefined
    }
  } catch {
    // user_id 不是有效 JSON，忽略
  }

  const openAIPayload = translateToOpenAI(anthropicPayload)
  consola.debug(
    "Translated OpenAI request payload:",
    JSON.stringify(openAIPayload),
  )

  if (state.manualApprove) {
    await awaitApproval()
  }

  const response = await createChatCompletions(openAIPayload)

  if (isNonStreaming(response)) {
    consola.debug(
      "Non-streaming response from Copilot:",
      JSON.stringify(response).slice(-400),
    )
    const anthropicResponse = translateToAnthropic(response)
    consola.debug(
      "Translated Anthropic response:",
      JSON.stringify(anthropicResponse),
    )

    // 记录 usage
    trackUsage(anthropicPayload.model, {
      input_tokens: anthropicResponse.usage.input_tokens,
      output_tokens: anthropicResponse.usage.output_tokens,
      cache_read_input_tokens: anthropicResponse.usage.cache_read_input_tokens ?? 0,
    })

    if (state.sessionLog && sessionId) {
      await addRecord(sessionId, anthropicPayload.model, anthropicPayload, anthropicResponse)
    }

    return c.json(anthropicResponse)
  }

  consola.debug("Streaming response from Copilot")
  return streamSSE(c, async (stream) => {
    const streamState: AnthropicStreamState = {
      messageStartSent: false,
      contentBlockIndex: 0,
      contentBlockOpen: false,
      toolCalls: {},
    }

    // 收集流式响应的所有事件，用于 session 记录
    const collectedEvents: unknown[] = []

    for await (const rawEvent of response) {
      consola.debug("Copilot raw stream event:", JSON.stringify(rawEvent))
      if (rawEvent.data === "[DONE]") {
        break
      }

      if (!rawEvent.data) {
        continue
      }

      const chunk = JSON.parse(rawEvent.data) as ChatCompletionChunk
      const events = translateChunkToAnthropicEvents(chunk, streamState)

      for (const event of events) {
        consola.debug("Translated Anthropic event:", JSON.stringify(event))
        if (state.sessionLog && sessionId) {
          collectedEvents.push(event)
        }

        // 从 message_delta 事件提取 usage 并记录
        if (event.type === "message_delta") {
          const msgDelta = event as { usage?: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number } }
          if (msgDelta.usage) {
            trackUsage(anthropicPayload.model, {
              input_tokens: msgDelta.usage.input_tokens ?? 0,
              output_tokens: msgDelta.usage.output_tokens ?? 0,
              cache_read_input_tokens: msgDelta.usage.cache_read_input_tokens ?? 0,
            })
          }
        }

        await stream.writeSSE({
          event: event.type,
          data: JSON.stringify(event),
        })
      }
    }

    if (state.sessionLog && sessionId) {
      await addRecord(sessionId, anthropicPayload.model, anthropicPayload, collectedEvents)
    }
  })
}

const isNonStreaming = (
  response: Awaited<ReturnType<typeof createChatCompletions>>,
): response is ChatCompletionResponse => Object.hasOwn(response, "choices")
