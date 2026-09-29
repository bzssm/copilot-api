/* eslint-disable @typescript-eslint/no-unnecessary-condition, max-lines-per-function -- pre-existing, tracked as tech debt */
import type { Context } from "hono"

import consola from "consola"
import { streamSSE } from "hono/streaming"

import type {
  AnthropicResponse,
  AnthropicTextBlock,
  AnthropicThinkingBlock,
} from "~/routes/messages/anthropic-types"

import { selectEndpoint } from "~/lib/endpoint-selector"
import { checkRateLimit } from "~/lib/rate-limit"
import { state } from "~/lib/state"
import {
  createRequestUsageTracker,
  getChatCompletionUsage,
  getResponsesUsage,
  trackUsage,
  type UsageData,
} from "~/lib/usage-tracker"
import { isGpt5OrAbove, resolveModelName } from "~/lib/utils"
import {
  translateResponsesPayloadToChatCompletions,
  translateChatCompletionResponseToResponses,
} from "~/routes/chat-completions/responses-translation"
import { translateResponsesPayloadToAnthropic } from "~/routes/messages/responses-translation"
import {
  createChatCompletions,
  type ChatCompletionChunk,
  type ChatCompletionResponse,
} from "~/services/copilot/create-chat-completions"
import { createMessages } from "~/services/copilot/create-messages"
import {
  createResponses,
  type ResponsesOutputItem,
  type ResponsesPayload,
  type ResponsesResponse,
} from "~/services/copilot/create-responses"

export async function handleCompletion(c: Context) {
  await checkRateLimit(state)

  const payload = await c.req.json<ResponsesPayload>()
  payload.model = resolveModelName(payload.model)

  const selectedModel = state.models?.data.find(
    (model) => model.id === payload.model,
  )

  const endpoint =
    selectedModel ?
      selectEndpoint("responses", selectedModel)
    : "/chat/completions"

  consola.info(
    `Request model: ${payload.model}, request format: responses, using endpoint: ${endpoint}`,
  )

  if (endpoint === "/responses") {
    return handleDirect(c, payload)
  }

  if (endpoint === "/chat/completions") {
    return handleViaChatCompletions(c, payload)
  }

  return handleViaMessages(c, payload)
}

function stripUnsupportedParams(payload: ResponsesPayload): ResponsesPayload {
  if (!isGpt5OrAbove(payload.model)) return payload
  const { temperature: _t, top_p: _tp, ...rest } = payload
  return rest as ResponsesPayload
}

async function handleDirect(c: Context, payload: ResponsesPayload) {
  const cleanPayload = stripUnsupportedParams(payload)
  const response = await createResponses(cleanPayload)

  if (isResponsesResponse(response)) {
    trackUsage(cleanPayload.model, getResponsesUsage(response.usage))
    return c.json(response)
  }

  return streamSSE(c, async (stream) => {
    const requestUsage = createRequestUsageTracker(cleanPayload.model)
    try {
      for await (const rawEvent of response) {
        if (!rawEvent.data || rawEvent.data === "[DONE]") continue
        const parsed = JSON.parse(rawEvent.data) as {
          response?: ResponsesResponse
        }
        if (parsed.response?.usage) {
          requestUsage.update(getResponsesUsage(parsed.response.usage))
        }
        await stream.writeSSE({
          event: rawEvent.event ?? undefined,
          data: rawEvent.data,
        })
      }
    } finally {
      requestUsage.flush()
    }
  })
}

async function handleViaChatCompletions(c: Context, payload: ResponsesPayload) {
  const chatPayload = translateResponsesPayloadToChatCompletions(payload)
  consola.debug("Translated to chat completions payload")

  const response = await createChatCompletions(chatPayload)

  if (isNonStreamingChatCompletion(response)) {
    const responsesResponse =
      translateChatCompletionResponseToResponses(response)
    trackUsage(payload.model, getChatCompletionUsage(response.usage))
    return c.json(responsesResponse)
  }

  // Streaming: translate chat completion chunks to Responses SSE events
  return streamSSE(c, async (stream) => {
    const responseId = `resp_${Date.now()}`
    let outputText = ""
    const requestUsage = createRequestUsageTracker(payload.model)

    // Send response.created
    await stream.writeSSE({
      event: "response.created",
      data: JSON.stringify({
        type: "response.created",
        response: {
          id: responseId,
          status: "in_progress",
          model: payload.model,
          output: [],
        },
      }),
    })

    await stream.writeSSE({
      event: "response.output_item.added",
      data: JSON.stringify({
        type: "response.output_item.added",
        output_index: 0,
        item: { type: "message", role: "assistant", content: [] },
      }),
    })

    await stream.writeSSE({
      event: "response.content_part.added",
      data: JSON.stringify({
        type: "response.content_part.added",
        output_index: 0,
        content_index: 0,
        part: { type: "output_text", text: "" },
      }),
    })

    try {
      for await (const rawEvent of response) {
        if (rawEvent.data === "[DONE]") break
        if (!rawEvent.data) continue

        const chunk = JSON.parse(rawEvent.data) as ChatCompletionChunk
        if (chunk.usage) {
          requestUsage.update(getChatCompletionUsage(chunk.usage))
        }
        const delta = chunk.choices?.[0]?.delta
        const finishReason = chunk.choices?.[0]?.finish_reason

        if (delta?.content) {
          outputText += delta.content
          await stream.writeSSE({
            event: "response.output_text.delta",
            data: JSON.stringify({
              type: "response.output_text.delta",
              output_index: 0,
              content_index: 0,
              delta: delta.content,
            }),
          })
        }

        if (finishReason) {
          await stream.writeSSE({
            event: "response.content_part.done",
            data: JSON.stringify({
              type: "response.content_part.done",
              output_index: 0,
              content_index: 0,
              part: { type: "output_text", text: outputText },
            }),
          })

          await stream.writeSSE({
            event: "response.output_item.done",
            data: JSON.stringify({
              type: "response.output_item.done",
              output_index: 0,
              item: {
                type: "message",
                role: "assistant",
                content: [{ type: "output_text", text: outputText }],
              },
            }),
          })

          await stream.writeSSE({
            event: "response.completed",
            data: JSON.stringify({
              type: "response.completed",
              response: {
                id: responseId,
                status: "completed",
                model: payload.model,
                output: [
                  {
                    type: "message",
                    role: "assistant",
                    content: [{ type: "output_text", text: outputText }],
                  },
                ],
                usage:
                  chunk.usage ?
                    {
                      input_tokens: chunk.usage.prompt_tokens,
                      output_tokens: chunk.usage.completion_tokens,
                      total_tokens: chunk.usage.total_tokens,
                    }
                  : undefined,
              },
            }),
          })
        }
      }
    } finally {
      requestUsage.flush()
    }
  })
}

async function handleViaMessages(c: Context, payload: ResponsesPayload) {
  const anthropicPayload = translateResponsesPayloadToAnthropic(payload)
  consola.debug("Translated to anthropic payload")

  const response = await createMessages(anthropicPayload)

  if (isAnthropicResponse(response)) {
    const responsesResponse = translateAnthropicResponseToResponses(
      response,
      payload.model,
    )
    trackUsage(payload.model, {
      input_tokens: response.usage.input_tokens ?? 0,
      output_tokens: response.usage.output_tokens ?? 0,
      cache_creation_input_tokens:
        response.usage.cache_creation_input_tokens ?? 0,
      cache_read_input_tokens: response.usage.cache_read_input_tokens ?? 0,
    })
    return c.json(responsesResponse)
  }

  // Streaming: translate Anthropic SSE events to Responses SSE events
  return streamSSE(c, async (stream) => {
    const streamState = createMessagesStreamState(payload.model)
    const requestUsage = createRequestUsageTracker(payload.model)

    try {
      for await (const rawEvent of response) {
        if (!rawEvent.data || rawEvent.data === "[DONE]") continue
        const event = JSON.parse(rawEvent.data) as AnthropicStreamEvent

        if (event.type === "message_start") {
          requestUsage.update(event.message?.usage)
        } else if (event.type === "message_delta") {
          requestUsage.update(event.usage)
        }

        for (const out of translateAnthropicStreamEventToResponses(
          event,
          streamState,
        )) {
          await stream.writeSSE({ event: out.type, data: JSON.stringify(out) })
        }
      }
    } finally {
      requestUsage.flush()
    }
  })
}

interface AnthropicStreamEvent {
  type: string
  index?: number
  content_block?: { type?: string }
  delta?: {
    type?: string
    text?: string
    thinking?: string
    stop_reason?: string
  }
  message?: { usage?: Partial<UsageData> }
  usage?: Partial<UsageData>
}

type ResponsesStreamEvent = { type: string; [key: string]: unknown }

interface MessagesStreamState {
  model: string
  responseId: string
  reasoningId: string
  createdSent: boolean
  nextOutputIndex: number
  reasoningIndex?: number
  reasoningDone: boolean
  messageIndex?: number
  thinkingText: string
  outputText: string
  thinkingBlockIndexes: Set<number>
}

function createMessagesStreamState(model: string): MessagesStreamState {
  return {
    model,
    responseId: `resp_${Date.now()}`,
    reasoningId: `rs_${Date.now()}`,
    createdSent: false,
    nextOutputIndex: 0,
    reasoningDone: false,
    thinkingText: "",
    outputText: "",
    thinkingBlockIndexes: new Set(),
  }
}

const streamReasoningItem = (s: MessagesStreamState) => ({
  type: "reasoning",
  id: s.reasoningId,
  summary: [{ type: "summary_text", text: s.thinkingText }],
})

const streamMessageItem = (s: MessagesStreamState) => ({
  type: "message",
  role: "assistant",
  content: [{ type: "output_text", text: s.outputText }],
})

// Output items are allocated lazily so a reasoning item (if any) comes first
function openReasoningItem(
  s: MessagesStreamState,
  out: Array<ResponsesStreamEvent>,
): void {
  if (s.reasoningIndex !== undefined) return
  s.reasoningIndex = s.nextOutputIndex
  s.nextOutputIndex += 1
  out.push(
    {
      type: "response.output_item.added",
      output_index: s.reasoningIndex,
      item: { type: "reasoning", id: s.reasoningId, summary: [] },
    },
    {
      type: "response.reasoning_summary_part.added",
      output_index: s.reasoningIndex,
      summary_index: 0,
      part: { type: "summary_text", text: "" },
    },
  )
}

function openMessageItem(
  s: MessagesStreamState,
  out: Array<ResponsesStreamEvent>,
): void {
  if (s.messageIndex !== undefined) return
  s.messageIndex = s.nextOutputIndex
  s.nextOutputIndex += 1
  out.push(
    {
      type: "response.output_item.added",
      output_index: s.messageIndex,
      item: { type: "message", role: "assistant", content: [] },
    },
    {
      type: "response.content_part.added",
      output_index: s.messageIndex,
      content_index: 0,
      part: { type: "output_text", text: "" },
    },
  )
}

function onContentBlockStart(
  event: AnthropicStreamEvent,
  s: MessagesStreamState,
  out: Array<ResponsesStreamEvent>,
): void {
  if (event.content_block?.type === "thinking") {
    s.thinkingBlockIndexes.add(event.index ?? 0)
    openReasoningItem(s, out)
  } else if (event.content_block?.type === "text") {
    openMessageItem(s, out)
  }
}

function onContentBlockDelta(
  event: AnthropicStreamEvent,
  s: MessagesStreamState,
  out: Array<ResponsesStreamEvent>,
): void {
  if (event.delta?.type === "thinking_delta" && event.delta.thinking) {
    openReasoningItem(s, out)
    s.thinkingText += event.delta.thinking
    out.push({
      type: "response.reasoning_summary_text.delta",
      output_index: s.reasoningIndex,
      summary_index: 0,
      delta: event.delta.thinking,
    })
  } else if (event.delta?.type === "text_delta" && event.delta.text) {
    openMessageItem(s, out)
    s.outputText += event.delta.text
    out.push({
      type: "response.output_text.delta",
      output_index: s.messageIndex,
      content_index: 0,
      delta: event.delta.text,
    })
  }
}

function onContentBlockStop(
  event: AnthropicStreamEvent,
  s: MessagesStreamState,
  out: Array<ResponsesStreamEvent>,
): void {
  if (
    !s.thinkingBlockIndexes.has(event.index ?? 0)
    || s.reasoningIndex === undefined
    || s.reasoningDone
  ) {
    return
  }
  s.reasoningDone = true
  out.push(
    {
      type: "response.reasoning_summary_text.done",
      output_index: s.reasoningIndex,
      summary_index: 0,
      text: s.thinkingText,
    },
    {
      type: "response.reasoning_summary_part.done",
      output_index: s.reasoningIndex,
      summary_index: 0,
      part: { type: "summary_text", text: s.thinkingText },
    },
    {
      type: "response.output_item.done",
      output_index: s.reasoningIndex,
      item: streamReasoningItem(s),
    },
  )
}

function onMessageStop(
  s: MessagesStreamState,
  out: Array<ResponsesStreamEvent>,
): void {
  openMessageItem(s, out)
  out.push(
    {
      type: "response.content_part.done",
      output_index: s.messageIndex,
      content_index: 0,
      part: { type: "output_text", text: s.outputText },
    },
    {
      type: "response.output_item.done",
      output_index: s.messageIndex,
      item: streamMessageItem(s),
    },
    {
      type: "response.completed",
      response: {
        id: s.responseId,
        status: "completed",
        model: s.model,
        output: [
          ...(s.reasoningIndex === undefined ? [] : [streamReasoningItem(s)]),
          streamMessageItem(s),
        ],
      },
    },
  )
}

function translateAnthropicStreamEventToResponses(
  event: AnthropicStreamEvent,
  s: MessagesStreamState,
): Array<ResponsesStreamEvent> {
  const out: Array<ResponsesStreamEvent> = []

  if (!s.createdSent) {
    out.push({
      type: "response.created",
      response: {
        id: s.responseId,
        status: "in_progress",
        model: s.model,
        output: [],
      },
    })
    s.createdSent = true
  }

  switch (event.type) {
    case "content_block_start": {
      onContentBlockStart(event, s, out)
      break
    }
    case "content_block_delta": {
      onContentBlockDelta(event, s, out)
      break
    }
    case "content_block_stop": {
      onContentBlockStop(event, s, out)
      break
    }
    case "message_stop": {
      onMessageStop(s, out)
      break
    }
    default: {
      break
    }
  }

  return out
}

function translateAnthropicResponseToResponses(
  response: AnthropicResponse,
  model: string,
): ResponsesResponse {
  const thinkingText = response.content
    .filter((b): b is AnthropicThinkingBlock => b.type === "thinking")
    .map((b) => b.thinking)
    .join("\n\n")
  const textContent = response.content
    .filter((b): b is AnthropicTextBlock => b.type === "text")
    .map((b) => b.text)
    .join("")

  const output: Array<ResponsesOutputItem> = []
  if (thinkingText) {
    output.push({
      type: "reasoning",
      id: `rs_${Date.now()}`,
      summary: [{ type: "summary_text", text: thinkingText }],
    })
  }
  output.push({
    type: "message",
    role: "assistant",
    content: [{ type: "output_text", text: textContent }],
  })

  return {
    id: response.id,
    object: "response",
    created_at: Math.floor(Date.now() / 1000),
    status: "completed",
    model,
    output,
    usage: {
      input_tokens: response.usage.input_tokens,
      output_tokens: response.usage.output_tokens,
      total_tokens: response.usage.input_tokens + response.usage.output_tokens,
    },
  }
}

const isResponsesResponse = (
  response: Awaited<ReturnType<typeof createResponses>>,
): response is ResponsesResponse => Object.hasOwn(response, "output")

const isNonStreamingChatCompletion = (
  response: Awaited<ReturnType<typeof createChatCompletions>>,
): response is ChatCompletionResponse => Object.hasOwn(response, "choices")

const isAnthropicResponse = (
  response: Awaited<ReturnType<typeof createMessages>>,
): response is AnthropicResponse => Object.hasOwn(response, "type")
