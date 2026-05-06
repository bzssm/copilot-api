import type {
  ChatCompletionResponse,
  ChatCompletionsPayload,
  Message,
  Tool,
} from "~/services/copilot/create-chat-completions"
import type {
  ResponsesContentPart,
  ResponsesFunctionCall,
  ResponsesFunctionCallOutput,
  ResponsesInputItem,
  ResponsesInputMessage,
  ResponsesOutputItem,
  ResponsesOutputMessage,
  ResponsesPayload,
  ResponsesResponse,
  ResponsesTool,
} from "~/services/copilot/create-responses"

import { isGpt5OrAbove } from "~/lib/utils"

// --- Request translation: Chat Completions → Responses ---

export function translateChatCompletionsToResponses(
  payload: ChatCompletionsPayload,
): ResponsesPayload {
  const input = translateMessagesToResponsesInput(payload.messages)

  return {
    model: payload.model,
    input,
    max_output_tokens:
      payload.max_tokens ?? payload.max_completion_tokens ?? undefined,
    temperature:
      isGpt5OrAbove(payload.model) ? undefined : (
        (payload.temperature ?? undefined)
      ),
    top_p:
      isGpt5OrAbove(payload.model) ? undefined : (payload.top_p ?? undefined),
    stream: payload.stream ?? undefined,
    tools: translateToolsToResponses(payload.tools),
    tool_choice: translateToolChoiceToResponses(payload.tool_choice),
  }
}

function translateMessagesToResponsesInput(
  messages: Array<Message>,
): Array<ResponsesInputItem> {
  const items: Array<ResponsesInputItem> = []

  for (const message of messages) {
    switch (message.role) {
      case "system":
      case "developer": {
        items.push({
          role: "developer",
          content: typeof message.content === "string" ? message.content : "",
        } as ResponsesInputMessage)
        break
      }
      case "user": {
        if (typeof message.content === "string") {
          items.push({
            role: "user",
            content: message.content,
          } as ResponsesInputMessage)
        } else if (Array.isArray(message.content)) {
          const parts: Array<ResponsesContentPart> = message.content.map(
            (part) => {
              if (part.type === "text") {
                return { type: "input_text" as const, text: part.text }
              }
              return {
                type: "input_image" as const,
                image_url: part.image_url.url,
                detail: part.image_url.detail,
              }
            },
          )
          items.push({
            role: "user",
            content: parts,
          } as ResponsesInputMessage)
        }
        break
      }
      case "assistant": {
        if (message.tool_calls && message.tool_calls.length > 0) {
          if (message.content) {
            items.push({
              type: "message",
              role: "assistant",
              content: [
                {
                  type: "output_text",
                  text:
                    typeof message.content === "string" ? message.content : "",
                },
              ],
            } as ResponsesOutputMessage)
          }
          for (const toolCall of message.tool_calls) {
            items.push({
              type: "function_call",
              call_id: toolCall.id,
              name: toolCall.function.name,
              arguments: toolCall.function.arguments,
            } as ResponsesFunctionCall)
          }
        } else {
          items.push({
            type: "message",
            role: "assistant",
            content: [
              {
                type: "output_text",
                text:
                  typeof message.content === "string" ? message.content : "",
              },
            ],
          } as ResponsesOutputMessage)
        }
        break
      }
      case "tool": {
        items.push({
          type: "function_call_output",
          call_id: message.tool_call_id ?? "",
          output:
            typeof message.content === "string" ?
              message.content
            : JSON.stringify(message.content),
        } as ResponsesFunctionCallOutput)
        break
      }
    }
  }

  return items
}

function translateToolsToResponses(
  tools: Array<Tool> | null | undefined,
): Array<ResponsesTool> | undefined {
  if (!tools) return undefined
  return tools.map((tool) => ({
    type: "function",
    name: tool.function.name,
    description: tool.function.description,
    parameters: tool.function.parameters,
  }))
}

function translateToolChoiceToResponses(
  toolChoice: ChatCompletionsPayload["tool_choice"],
): ResponsesPayload["tool_choice"] {
  if (!toolChoice) return undefined
  if (typeof toolChoice === "string") {
    if (
      toolChoice === "none"
      || toolChoice === "auto"
      || toolChoice === "required"
    ) {
      return toolChoice
    }
    return undefined
  }
  return { type: "function", name: toolChoice.function.name }
}

// --- Response translation: Chat Completions → Responses ---

export function translateChatCompletionResponseToResponses(
  response: ChatCompletionResponse,
): ResponsesResponse {
  const choice = response.choices[0]
  const output: Array<ResponsesOutputItem> = []

  if (choice?.message.content) {
    output.push({
      type: "message",
      role: "assistant",
      content: [{ type: "output_text", text: choice.message.content }],
    } as ResponsesOutputMessage)
  }

  if (choice?.message.tool_calls) {
    for (const tc of choice.message.tool_calls) {
      output.push({
        type: "function_call",
        call_id: tc.id,
        name: tc.function.name,
        arguments: tc.function.arguments,
      } as ResponsesFunctionCall)
    }
  }

  return {
    id: response.id,
    object: "response",
    created_at: response.created,
    status: choice?.finish_reason === "length" ? "incomplete" : "completed",
    model: response.model,
    output,
    usage: {
      input_tokens: response.usage?.prompt_tokens ?? 0,
      output_tokens: response.usage?.completion_tokens ?? 0,
      total_tokens: response.usage?.total_tokens ?? 0,
    },
  }
}

// --- Response translation: Responses → Chat Completions ---

export function translateResponsesResponseToChatCompletions(
  response: ResponsesResponse,
): ChatCompletionResponse {
  const messageContent = extractTextFromResponsesOutput(response.output)
  const toolCalls = extractToolCallsFromResponsesOutput(response.output)
  const finishReason = translateResponsesStatusToFinishReason(
    response.status,
    toolCalls.length > 0,
  )

  return {
    id: response.id,
    object: "chat.completion",
    created: response.created_at,
    model: response.model,
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content: messageContent,
          ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
        },
        logprobs: null,
        finish_reason: finishReason,
      },
    ],
    usage: {
      prompt_tokens: response.usage.input_tokens,
      completion_tokens: response.usage.output_tokens,
      total_tokens: response.usage.total_tokens,
      ...(response.usage.input_tokens_details ?
        {
          prompt_tokens_details: {
            cached_tokens: response.usage.input_tokens_details.cached_tokens,
          },
        }
      : {}),
    },
  }
}

function extractTextFromResponsesOutput(
  output: ResponsesResponse["output"],
): string | null {
  const texts: Array<string> = []
  for (const item of output) {
    if (item.type === "message" && item.role === "assistant") {
      for (const part of item.content) {
        if (part.type === "output_text") {
          texts.push(part.text)
        }
      }
    }
  }
  return texts.length > 0 ? texts.join("") : null
}

function extractToolCallsFromResponsesOutput(
  output: ResponsesResponse["output"],
): Array<{
  id: string
  type: "function"
  function: { name: string; arguments: string }
}> {
  const toolCalls: Array<{
    id: string
    type: "function"
    function: { name: string; arguments: string }
  }> = []
  for (const item of output) {
    if (item.type === "function_call") {
      toolCalls.push({
        id: item.call_id,
        type: "function",
        function: {
          name: item.name,
          arguments: item.arguments,
        },
      })
    }
  }
  return toolCalls
}

function translateResponsesStatusToFinishReason(
  status: ResponsesResponse["status"],
  hasToolCalls: boolean,
): "stop" | "length" | "tool_calls" | "content_filter" {
  if (hasToolCalls) return "tool_calls"
  switch (status) {
    case "completed": {
      return "stop"
    }
    case "incomplete": {
      return "length"
    }
    default: {
      return "stop"
    }
  }
}

// --- Request translation: Responses → Chat Completions ---

export function translateResponsesPayloadToChatCompletions(
  payload: ResponsesPayload,
): ChatCompletionsPayload {
  const messages = translateResponsesInputToMessages(payload)

  return {
    model: payload.model,
    messages,
    max_tokens: payload.max_output_tokens,
    temperature: isGpt5OrAbove(payload.model) ? undefined : payload.temperature,
    top_p: isGpt5OrAbove(payload.model) ? undefined : payload.top_p,
    stream: payload.stream,
    tools: translateResponsesToolsToChatCompletions(payload.tools),
    tool_choice: translateResponsesToolChoiceToChatCompletions(
      payload.tool_choice,
    ),
  }
}

function translateResponsesInputToMessages(
  payload: ResponsesPayload,
): Array<Message> {
  const messages: Array<Message> = []

  if (payload.instructions) {
    messages.push({ role: "system", content: payload.instructions })
  }

  if (typeof payload.input === "string") {
    messages.push({ role: "user", content: payload.input })
    return messages
  }

  for (const item of payload.input) {
    if ("role" in item && item.role !== "assistant") {
      const role = item.role === "developer" ? "system" : item.role
      if (typeof item.content === "string") {
        messages.push({ role, content: item.content })
      } else if (Array.isArray(item.content)) {
        const parts = item.content.map((part) => {
          if (part.type === "input_text") {
            return { type: "text" as const, text: part.text }
          }
          return {
            type: "image_url" as const,
            image_url: {
              url: (part as { image_url?: string }).image_url ?? "",
            },
          }
        })
        messages.push({ role, content: parts })
      }
    } else if (
      "type" in item
      && item.type === "message"
      && "role" in item
      && item.role === "assistant"
    ) {
      const outputMsg = item
      const text = outputMsg.content
        .filter((p) => p.type === "output_text")
        .map((p) => (p as { text: string }).text)
        .join("")
      messages.push({ role: "assistant", content: text || null })
    } else if ("type" in item && item.type === "function_call") {
      const fc = item
      messages.push({
        role: "assistant",
        content: null,
        tool_calls: [
          {
            id: fc.call_id,
            type: "function",
            function: { name: fc.name, arguments: fc.arguments },
          },
        ],
      })
    } else if ("type" in item && item.type === "function_call_output") {
      const fco = item
      messages.push({
        role: "tool",
        tool_call_id: fco.call_id,
        content: fco.output,
      })
    }
  }

  return messages
}

function translateResponsesToolsToChatCompletions(
  tools: ResponsesPayload["tools"],
): Array<Tool> | undefined {
  if (!tools) return undefined
  return tools.map((tool) => ({
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters ?? {},
    },
  }))
}

function translateResponsesToolChoiceToChatCompletions(
  toolChoice: ResponsesPayload["tool_choice"],
): ChatCompletionsPayload["tool_choice"] {
  if (!toolChoice) return undefined
  if (typeof toolChoice === "string") {
    if (
      toolChoice === "auto"
      || toolChoice === "none"
      || toolChoice === "required"
    ) {
      return toolChoice
    }
    return undefined
  }
  return { type: "function", function: { name: toolChoice.name } }
}
