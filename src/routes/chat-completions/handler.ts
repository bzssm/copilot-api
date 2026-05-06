import type { Context } from "hono"

import consola from "consola"
import { streamSSE, type SSEMessage } from "hono/streaming"

import { awaitApproval } from "~/lib/approval"
import { selectEndpoint } from "~/lib/endpoint-selector"
import { checkRateLimit } from "~/lib/rate-limit"
import { state } from "~/lib/state"
import { getTokenCount } from "~/lib/tokenizer"
import { trackUsage } from "~/lib/usage-tracker"
import { isGpt5OrAbove, isNullish } from "~/lib/utils"
import {
  createChatCompletions,
  type ChatCompletionResponse,
  type ChatCompletionsPayload,
} from "~/services/copilot/create-chat-completions"
import {
  createResponses,
  type ResponsesResponse,
} from "~/services/copilot/create-responses"

import {
  translateChatCompletionsToResponses,
  translateResponsesResponseToChatCompletions,
} from "./responses-translation"

export async function handleCompletion(c: Context) {
  await checkRateLimit(state)

  let payload = await c.req.json<ChatCompletionsPayload>()
  // Find the selected model
  const selectedModel = state.models?.data.find(
    (model) => model.id === payload.model,
  )

  // Calculate and display token count
  try {
    if (selectedModel) {
      const tokenCount = await getTokenCount(payload, selectedModel)
      consola.info("Current token count:", tokenCount)
    } else {
      consola.warn("No model selected, skipping token count calculation")
    }
  } catch (error) {
    consola.warn("Failed to calculate token count:", error)
  }

  if (state.manualApprove) await awaitApproval()

  if (
    isNullish(payload.max_tokens)
    && isNullish(payload.max_completion_tokens)
  ) {
    const maxOutputTokens = selectedModel?.capabilities.limits.max_output_tokens

    if (isGpt5OrAbove(payload.model)) {
      payload = { ...payload, max_completion_tokens: maxOutputTokens }
      consola.debug("Set max_completion_tokens to:", maxOutputTokens)
    } else {
      payload = { ...payload, max_tokens: maxOutputTokens }
      consola.debug("Set max_tokens to:", maxOutputTokens)
    }
  }

  if (isGpt5OrAbove(payload.model) && !isNullish(payload.max_tokens)) {
    payload = {
      ...payload,
      max_completion_tokens:
        payload.max_completion_tokens ?? payload.max_tokens,
      max_tokens: undefined,
    }
  }

  if (isGpt5OrAbove(payload.model)) {
    const {
      temperature: _t,
      top_p: _tp,
      stop: _s,
      frequency_penalty: _fp,
      presence_penalty: _pp,
      ...rest
    } = payload
    payload = rest as ChatCompletionsPayload
  }

  const endpoint =
    selectedModel ?
      selectEndpoint("chat-completions", selectedModel)
    : "/chat/completions"

  consola.info(
    `Request model: ${payload.model}, request format: chat-completions, using endpoint: ${endpoint}`,
  )

  if (endpoint === "/responses") {
    return handleViaResponses(c, payload)
  }

  return handleDirect(c, payload)
}

async function handleDirect(c: Context, payload: ChatCompletionsPayload) {
  if (isGpt5OrAbove(payload.model)) {
    const { temperature: _t, top_p: _tp, ...rest } = payload
    payload = rest as ChatCompletionsPayload
  }

  const response = await createChatCompletions(payload)

  if (isNonStreaming(response)) {
    consola.debug("Non-streaming response:", JSON.stringify(response))
    trackUsage(payload.model, {
      input_tokens: response.usage?.prompt_tokens ?? 0,
      output_tokens: response.usage?.completion_tokens ?? 0,
      cache_read_input_tokens: 0,
    })
    return c.json(response)
  }

  consola.debug("Streaming response")
  return streamSSE(c, async (stream) => {
    for await (const chunk of response) {
      consola.debug("Streaming chunk:", JSON.stringify(chunk))
      await stream.writeSSE(chunk as SSEMessage)

      if (chunk.data && chunk.data !== "[DONE]") {
        const parsed = JSON.parse(chunk.data) as {
          usage?: { prompt_tokens?: number; completion_tokens?: number }
        }
        if (parsed.usage) {
          trackUsage(payload.model, {
            input_tokens: parsed.usage.prompt_tokens ?? 0,
            output_tokens: parsed.usage.completion_tokens ?? 0,
            cache_read_input_tokens: 0,
          })
        }
      }
    }
  })
}

async function handleViaResponses(c: Context, payload: ChatCompletionsPayload) {
  const responsesPayload = translateChatCompletionsToResponses(payload)
  consola.debug(
    "Translated Responses request payload:",
    JSON.stringify(responsesPayload),
  )

  const response = await createResponses(responsesPayload)

  if (isResponsesResponse(response)) {
    consola.debug("Non-streaming responses response")
    const chatResponse = translateResponsesResponseToChatCompletions(response)
    trackUsage(payload.model, {
      input_tokens: response.usage?.input_tokens ?? 0,
      output_tokens: response.usage?.output_tokens ?? 0,
      cache_read_input_tokens: 0,
    })
    return c.json(chatResponse)
  }

  // Streaming: translate Responses SSE events to Chat Completions SSE chunks
  consola.debug("Streaming responses response")
  return streamSSE(c, async (stream) => {
    const responseId = `chatcmpl-${Date.now()}`
    let sentRole = false

    for await (const rawEvent of response) {
      if (!rawEvent.data) continue

      const event = JSON.parse(rawEvent.data) as Record<string, unknown>
      const chunks = translateResponsesStreamToChatCompletionsChunks(
        event,
        responseId,
        payload.model,
        sentRole,
      )

      for (const chunk of chunks.data) {
        await stream.writeSSE({
          data: JSON.stringify(chunk),
        })
      }

      if (chunks.sentRole) sentRole = true

      if (event.type === "response.completed") {
        const resp = event.response as ResponsesResponse | undefined
        if (resp?.usage) {
          trackUsage(payload.model, {
            input_tokens: resp.usage.input_tokens ?? 0,
            output_tokens: resp.usage.output_tokens ?? 0,
            cache_read_input_tokens: 0,
          })
        }
      }
    }

    await stream.writeSSE({ data: "[DONE]" })
  })
}

const isNonStreaming = (
  response: Awaited<ReturnType<typeof createChatCompletions>>,
): response is ChatCompletionResponse => Object.hasOwn(response, "choices")

const isResponsesResponse = (
  response: Awaited<ReturnType<typeof createResponses>>,
): response is ResponsesResponse => Object.hasOwn(response, "output")

function translateResponsesStreamToChatCompletionsChunks(
  event: Record<string, unknown>,
  responseId: string,
  model: string,
  sentRole: boolean,
): { data: Array<Record<string, unknown>>; sentRole: boolean } {
  const chunks: Array<Record<string, unknown>> = []
  let newSentRole = sentRole

  const makeChunk = (
    delta: Record<string, unknown>,
    finishReason: string | null = null,
  ) => ({
    id: responseId,
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{ index: 0, delta, finish_reason: finishReason }],
  })

  switch (event.type) {
    case "response.output_text.delta": {
      if (!sentRole) {
        chunks.push(makeChunk({ role: "assistant" }))
        newSentRole = true
      }
      chunks.push(makeChunk({ content: event.delta as string }))
      break
    }
    case "response.output_item.added": {
      const item = event.item as
        | { type: string; name?: string; call_id?: string }
        | undefined
      if (item?.type === "function_call" && item.name && item.call_id) {
        if (!sentRole) {
          chunks.push(makeChunk({ role: "assistant" }))
          newSentRole = true
        }
        chunks.push(
          makeChunk({
            tool_calls: [
              {
                index: (event.output_index as number) ?? 0,
                id: item.call_id,
                type: "function",
                function: { name: item.name, arguments: "" },
              },
            ],
          }),
        )
      }
      break
    }
    case "response.function_call_arguments.delta": {
      chunks.push(
        makeChunk({
          tool_calls: [
            {
              index: (event.output_index as number) ?? 0,
              function: { arguments: event.delta as string },
            },
          ],
        }),
      )
      break
    }
    case "response.completed": {
      const resp = event.response as ResponsesResponse | undefined
      const hasToolCalls = resp?.output?.some((o) => o.type === "function_call")
      chunks.push(makeChunk({}, hasToolCalls ? "tool_calls" : "stop"))
      if (resp?.usage) {
        chunks.push({
          ...makeChunk({}),
          usage: {
            prompt_tokens: resp.usage.input_tokens,
            completion_tokens: resp.usage.output_tokens,
            total_tokens: resp.usage.total_tokens,
          },
        })
      }
      break
    }
  }

  return { data: chunks, sentRole: newSentRole }
}
