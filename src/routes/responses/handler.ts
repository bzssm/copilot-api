/* eslint-disable @typescript-eslint/no-unnecessary-condition, max-lines-per-function -- pre-existing, tracked as tech debt */
import type { Context } from "hono"

import consola from "consola"
import { streamSSE } from "hono/streaming"

import type { AnthropicResponse } from "~/routes/messages/anthropic-types"

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
    const responseId = `resp_${Date.now()}`
    let outputText = ""
    let createdSent = false
    const requestUsage = createRequestUsageTracker(payload.model)

    try {
      for await (const rawEvent of response) {
        if (!rawEvent.data || rawEvent.data === "[DONE]") continue
        const event = JSON.parse(rawEvent.data) as {
          type: string
          delta?: { type?: string; text?: string; stop_reason?: string }
          message?: { usage?: Partial<UsageData> }
          usage?: Partial<UsageData>
        }

        if (event.type === "message_start") {
          requestUsage.update(event.message?.usage)
        } else if (event.type === "message_delta") {
          requestUsage.update(event.usage)
        }

        if (!createdSent) {
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
          createdSent = true
        }

        if (
          event.type === "content_block_delta"
          && event.delta?.type === "text_delta"
          && event.delta.text
        ) {
          outputText += event.delta.text
          await stream.writeSSE({
            event: "response.output_text.delta",
            data: JSON.stringify({
              type: "response.output_text.delta",
              output_index: 0,
              content_index: 0,
              delta: event.delta.text,
            }),
          })
        }

        if (event.type === "message_stop") {
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

function translateAnthropicResponseToResponses(
  response: AnthropicResponse,
  model: string,
): ResponsesResponse {
  const textContent = response.content
    .filter((b) => b.type === "text")
    .map((b) => (b as { text: string }).text)
    .join("")

  return {
    id: response.id,
    object: "response",
    created_at: Math.floor(Date.now() / 1000),
    status: "completed",
    model,
    output: [
      {
        type: "message",
        role: "assistant",
        content: [{ type: "output_text", text: textContent }],
      },
    ],
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
