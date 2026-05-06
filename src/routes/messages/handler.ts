import type { Context } from "hono"

import consola from "consola"
import { streamSSE } from "hono/streaming"

import { awaitApproval } from "~/lib/approval"
import { selectEndpoint } from "~/lib/endpoint-selector"
import { checkRateLimit } from "~/lib/rate-limit"
import { addRecord } from "~/lib/session-store"
import { state } from "~/lib/state"
import { trackUsage } from "~/lib/usage-tracker"
import { isGpt5OrAbove } from "~/lib/utils"
import {
  createChatCompletions,
  type ChatCompletionChunk,
  type ChatCompletionResponse,
} from "~/services/copilot/create-chat-completions"
import { createMessages } from "~/services/copilot/create-messages"
import {
  createResponses,
  type ResponsesOutputItem,
  type ResponsesResponse,
} from "~/services/copilot/create-responses"

import {
  type AnthropicMessagesPayload,
  type AnthropicResponse,
  type AnthropicStreamState,
} from "./anthropic-types"
import {
  translateToAnthropic,
  translateToOpenAI,
} from "./non-stream-translation"
import {
  translateAnthropicToResponses,
  translateResponsesResponseToAnthropic,
} from "./responses-translation"
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

  if (state.manualApprove) {
    await awaitApproval()
  }

  const selectedModel = state.models?.data.find(
    (model) => model.id === anthropicPayload.model,
  )

  const endpoint =
    selectedModel ?
      selectEndpoint("messages", selectedModel)
    : "/chat/completions"

  consola.info(
    `Request model: ${anthropicPayload.model}, request format: messages, using endpoint: ${endpoint}`,
  )

  if (endpoint === "/v1/messages") {
    return handleNativeMessages(c, anthropicPayload, sessionId)
  }

  if (endpoint === "/responses") {
    return handleViaResponses(c, anthropicPayload, sessionId)
  }

  return handleViaTranslation(c, anthropicPayload, sessionId)
}

async function handleNativeMessages(
  c: Context,
  anthropicPayload: AnthropicMessagesPayload,
  sessionId: string | undefined,
) {
  let payload: AnthropicMessagesPayload = {
    model: anthropicPayload.model,
    messages: anthropicPayload.messages,
    max_tokens: anthropicPayload.max_tokens,
    ...(anthropicPayload.system != null && { system: anthropicPayload.system }),
    ...(anthropicPayload.metadata != null && {
      metadata: anthropicPayload.metadata,
    }),
    ...(anthropicPayload.stop_sequences != null && {
      stop_sequences: anthropicPayload.stop_sequences,
    }),
    ...(anthropicPayload.stream != null && { stream: anthropicPayload.stream }),
    ...(anthropicPayload.temperature != null && {
      temperature: anthropicPayload.temperature,
    }),
    ...(anthropicPayload.top_p != null && { top_p: anthropicPayload.top_p }),
    ...(anthropicPayload.top_k != null && { top_k: anthropicPayload.top_k }),
    ...(anthropicPayload.tools != null && { tools: anthropicPayload.tools }),
    ...(anthropicPayload.tool_choice != null && {
      tool_choice: anthropicPayload.tool_choice,
    }),
    ...(anthropicPayload.thinking != null && {
      thinking: anthropicPayload.thinking,
    }),
    ...(anthropicPayload.service_tier != null && {
      service_tier: anthropicPayload.service_tier,
    }),
  }
  const selectedModel = state.models?.data.find((m) => m.id === payload.model)
  if (payload.thinking) {
    if (selectedModel?.capabilities?.supports?.adaptive_thinking) {
      payload = { ...payload, thinking: { type: "adaptive" } }
    } else {
      const { thinking: _, ...rest } = payload
      payload = rest as AnthropicMessagesPayload
    }
  }
  if (isGpt5OrAbove(payload.model)) {
    const { temperature: _t, top_p: _tp, stop_sequences: _s, ...rest } = payload
    payload = rest as AnthropicMessagesPayload
  }

  const response = await createMessages(payload)

  if (isAnthropicResponse(response)) {
    consola.debug("Non-streaming native messages response")

    trackUsage(anthropicPayload.model, {
      input_tokens: response.usage.input_tokens,
      output_tokens: response.usage.output_tokens,
      cache_read_input_tokens: response.usage.cache_read_input_tokens ?? 0,
    })

    if (state.sessionLog && sessionId) {
      await addRecord(
        sessionId,
        anthropicPayload.model,
        anthropicPayload,
        response,
      )
    }

    return c.json(response)
  }

  consola.debug("Streaming native messages response")
  return streamSSE(c, async (stream) => {
    const collectedEvents: Array<unknown> = []

    for await (const rawEvent of response) {
      if (!rawEvent.data || rawEvent.data === "[DONE]") continue

      const event = JSON.parse(rawEvent.data) as {
        type: string
        usage?: {
          input_tokens?: number
          output_tokens?: number
          cache_read_input_tokens?: number
        }
      }

      if (state.sessionLog && sessionId) {
        collectedEvents.push(event)
      }

      if (event.type === "message_delta" && event.usage) {
        trackUsage(anthropicPayload.model, {
          input_tokens: event.usage.input_tokens ?? 0,
          output_tokens: event.usage.output_tokens ?? 0,
          cache_read_input_tokens: event.usage.cache_read_input_tokens ?? 0,
        })
      }

      await stream.writeSSE({
        event: event.type,
        data: JSON.stringify(event),
      })
    }

    if (state.sessionLog && sessionId) {
      await addRecord(
        sessionId,
        anthropicPayload.model,
        anthropicPayload,
        collectedEvents,
      )
    }
  })
}

async function handleViaTranslation(
  c: Context,
  anthropicPayload: AnthropicMessagesPayload,
  sessionId: string | undefined,
) {
  const openAIPayload = translateToOpenAI(anthropicPayload)
  consola.debug(
    "Translated OpenAI request payload:",
    JSON.stringify(openAIPayload),
  )

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

    trackUsage(anthropicPayload.model, {
      input_tokens: anthropicResponse.usage.input_tokens,
      output_tokens: anthropicResponse.usage.output_tokens,
      cache_read_input_tokens:
        anthropicResponse.usage.cache_read_input_tokens ?? 0,
    })

    if (state.sessionLog && sessionId) {
      await addRecord(
        sessionId,
        anthropicPayload.model,
        anthropicPayload,
        anthropicResponse,
      )
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

    const collectedEvents: Array<unknown> = []

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

        if (event.type === "message_delta") {
          const msgDelta = event as {
            usage?: {
              input_tokens?: number
              output_tokens?: number
              cache_read_input_tokens?: number
            }
          }
          if (msgDelta.usage) {
            trackUsage(anthropicPayload.model, {
              input_tokens: msgDelta.usage.input_tokens ?? 0,
              output_tokens: msgDelta.usage.output_tokens ?? 0,
              cache_read_input_tokens:
                msgDelta.usage.cache_read_input_tokens ?? 0,
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
      await addRecord(
        sessionId,
        anthropicPayload.model,
        anthropicPayload,
        collectedEvents,
      )
    }
  })
}

const isAnthropicResponse = (
  response: Awaited<ReturnType<typeof createMessages>>,
): response is AnthropicResponse => Object.hasOwn(response, "type")

const isNonStreaming = (
  response: Awaited<ReturnType<typeof createChatCompletions>>,
): response is ChatCompletionResponse => Object.hasOwn(response, "choices")

const isResponsesResponse = (
  response: Awaited<ReturnType<typeof createResponses>>,
): response is ResponsesResponse => Object.hasOwn(response, "output")

async function handleViaResponses(
  c: Context,
  anthropicPayload: AnthropicMessagesPayload,
  sessionId: string | undefined,
) {
  const responsesPayload = translateAnthropicToResponses(anthropicPayload)
  consola.debug(
    "Translated Responses request payload:",
    JSON.stringify(responsesPayload),
  )

  const response = await createResponses(responsesPayload)

  if (isResponsesResponse(response)) {
    consola.debug("Non-streaming responses response")
    const anthropicResponse = translateResponsesResponseToAnthropic(response)

    trackUsage(anthropicPayload.model, {
      input_tokens: anthropicResponse.usage.input_tokens,
      output_tokens: anthropicResponse.usage.output_tokens,
      cache_read_input_tokens:
        anthropicResponse.usage.cache_read_input_tokens ?? 0,
    })

    if (state.sessionLog && sessionId) {
      await addRecord(
        sessionId,
        anthropicPayload.model,
        anthropicPayload,
        anthropicResponse,
      )
    }

    return c.json(anthropicResponse)
  }

  // Streaming: Responses API events → Anthropic SSE events
  consola.debug("Streaming responses response")
  return streamSSE(c, async (stream) => {
    const collectedEvents: Array<unknown> = []
    let messageStartSent = false

    for await (const rawEvent of response) {
      if (!rawEvent.data || rawEvent.data === "[DONE]") continue

      const event = JSON.parse(rawEvent.data) as {
        type: string
        response?: ResponsesResponse
        delta?: string
        content_index?: number
        output_index?: number
        item?: {
          type: string
          call_id?: string
          name?: string
          arguments?: string
        }
        part?: { type: string; text?: string }
      }

      // Translate Responses streaming events to Anthropic streaming events
      const anthropicEvents = translateResponsesStreamEventToAnthropic(
        event,
        messageStartSent,
        anthropicPayload.model,
      )

      for (const anthropicEvent of anthropicEvents.events) {
        if (state.sessionLog && sessionId) {
          collectedEvents.push(anthropicEvent)
        }

        if (anthropicEvent.type === "message_delta") {
          const msgDelta = anthropicEvent as {
            usage?: {
              input_tokens?: number
              output_tokens?: number
              cache_read_input_tokens?: number
            }
          }
          if (msgDelta.usage) {
            trackUsage(anthropicPayload.model, {
              input_tokens: msgDelta.usage.input_tokens ?? 0,
              output_tokens: msgDelta.usage.output_tokens ?? 0,
              cache_read_input_tokens:
                msgDelta.usage.cache_read_input_tokens ?? 0,
            })
          }
        }

        await stream.writeSSE({
          event: anthropicEvent.type,
          data: JSON.stringify(anthropicEvent),
        })
      }

      if (anthropicEvents.messageStartSent) {
        messageStartSent = true
      }
    }

    if (state.sessionLog && sessionId) {
      await addRecord(
        sessionId,
        anthropicPayload.model,
        anthropicPayload,
        collectedEvents,
      )
    }
  })
}

function translateResponsesStreamEventToAnthropic(
  event: Record<string, unknown>,
  messageStartSent: boolean,
  model: string,
): {
  events: Array<{ type: string; [key: string]: unknown }>
  messageStartSent: boolean
} {
  const anthropicEvents: Array<{ type: string; [key: string]: unknown }> = []
  let newMessageStartSent = messageStartSent

  switch (event.type) {
    case "response.created": {
      if (!messageStartSent) {
        const resp = event.response as ResponsesResponse | undefined
        anthropicEvents.push({
          type: "message_start",
          message: {
            id: resp?.id ?? `msg_${Date.now()}`,
            type: "message",
            role: "assistant",
            content: [],
            model,
            stop_reason: null,
            stop_sequence: null,
            usage: { input_tokens: 0, output_tokens: 0 },
          },
        })
        newMessageStartSent = true
      }
      break
    }
    case "response.output_text.delta": {
      const delta = event.delta as string
      anthropicEvents.push({
        type: "content_block_delta",
        index: (event.content_index as number) ?? 0,
        delta: { type: "text_delta", text: delta },
      })
      break
    }
    case "response.content_part.added": {
      const part = event.part as { type: string } | undefined
      if (part?.type === "output_text") {
        anthropicEvents.push({
          type: "content_block_start",
          index: (event.content_index as number) ?? 0,
          content_block: { type: "text", text: "" },
        })
      }
      break
    }
    case "response.content_part.done": {
      anthropicEvents.push({
        type: "content_block_stop",
        index: (event.content_index as number) ?? 0,
      })
      break
    }
    case "response.function_call_arguments.delta": {
      // Tool call argument streaming — accumulate, emit on done
      break
    }
    case "response.output_item.added": {
      const item = event.item as
        | { type: string; call_id?: string; name?: string }
        | undefined
      if (item?.type === "function_call" && item.name && item.call_id) {
        anthropicEvents.push({
          type: "content_block_start",
          index: (event.output_index as number) ?? 0,
          content_block: {
            type: "tool_use",
            id: item.call_id,
            name: item.name,
            input: {},
          },
        })
      }
      break
    }
    case "response.output_item.done": {
      const item = event.item as
        | { type: string; arguments?: string }
        | undefined
      if (item?.type === "function_call" && item.arguments) {
        anthropicEvents.push({
          type: "content_block_delta",
          index: (event.output_index as number) ?? 0,
          delta: {
            type: "input_json_delta",
            partial_json: item.arguments,
          },
        })
      }
      anthropicEvents.push({
        type: "content_block_stop",
        index: (event.output_index as number) ?? 0,
      })
      break
    }
    case "response.completed": {
      const resp = event.response as ResponsesResponse | undefined
      const hasFunctionCall = resp?.output?.some(
        (o: ResponsesOutputItem) => o.type === "function_call",
      )
      anthropicEvents.push(
        {
          type: "message_delta",
          delta: {
            stop_reason: hasFunctionCall ? "tool_use" : "end_turn",
          },
          usage: {
            input_tokens: resp?.usage?.input_tokens ?? 0,
            output_tokens: resp?.usage?.output_tokens ?? 0,
          },
        },
        { type: "message_stop" },
      )
      break
    }
  }

  return { events: anthropicEvents, messageStartSent: newMessageStartSent }
}
