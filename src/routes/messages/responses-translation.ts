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

import type {
  AnthropicAssistantMessage,
  AnthropicImageBlock,
  AnthropicMessage,
  AnthropicMessagesPayload,
  AnthropicResponse,
  AnthropicTextBlock,
  AnthropicThinkingBlock,
  AnthropicToolResultBlock,
  AnthropicToolUseBlock,
} from "./anthropic-types"

// --- Request translation: Anthropic → Responses ---

export function translateAnthropicToResponses(
  payload: AnthropicMessagesPayload,
): ResponsesPayload {
  const input = translateAnthropicMessagesToResponsesInput(
    payload.messages,
    payload.system,
  )

  return {
    model: payload.model,
    input,
    max_output_tokens: payload.max_tokens,
    temperature: isGpt5OrAbove(payload.model) ? undefined : payload.temperature,
    top_p: isGpt5OrAbove(payload.model) ? undefined : payload.top_p,
    stream: payload.stream,
    tools: translateAnthropicToolsToResponses(payload.tools),
    tool_choice: translateAnthropicToolChoiceToResponses(payload.tool_choice),
  }
}

function translateAnthropicMessagesToResponsesInput(
  messages: Array<AnthropicMessage>,
  system: string | Array<AnthropicTextBlock> | undefined,
): Array<ResponsesInputItem> {
  const items: Array<ResponsesInputItem> = []

  if (system) {
    const systemText =
      typeof system === "string" ? system : (
        system.map((block) => block.text).join("\n\n")
      )
    items.push({
      role: "developer",
      content: systemText,
    } as ResponsesInputMessage)
  }

  for (const message of messages) {
    if (message.role === "user") {
      items.push(...translateUserMessageToResponses(message))
    } else {
      items.push(...translateAssistantMessageToResponses(message))
    }
  }

  return items
}

function translateUserMessageToResponses(
  message: AnthropicMessage & { role: "user" },
): Array<ResponsesInputItem> {
  const items: Array<ResponsesInputItem> = []

  if (typeof message.content === "string") {
    items.push({
      role: "user",
      content: message.content,
    } as ResponsesInputMessage)
    return items
  }

  const toolResultBlocks = message.content.filter(
    (block): block is AnthropicToolResultBlock => block.type === "tool_result",
  )
  const otherBlocks = message.content.filter(
    (block) => block.type !== "tool_result",
  )

  for (const block of toolResultBlocks) {
    items.push({
      type: "function_call_output",
      call_id: block.tool_use_id,
      output:
        typeof block.content === "string" ?
          block.content
        : JSON.stringify(block.content),
    } as ResponsesFunctionCallOutput)
  }

  if (otherBlocks.length > 0) {
    const contentParts = otherBlocks.map((block) =>
      translateAnthropicContentBlockToResponsesPart(block),
    )
    items.push({
      role: "user",
      content: contentParts,
    } as ResponsesInputMessage)
  }

  return items
}

function translateAssistantMessageToResponses(
  message: AnthropicAssistantMessage,
): Array<ResponsesInputItem> {
  const items: Array<ResponsesInputItem> = []

  if (typeof message.content === "string") {
    items.push({
      type: "message",
      role: "assistant",
      content: [{ type: "output_text", text: message.content }],
    } as ResponsesOutputMessage)
    return items
  }

  const toolUseBlocks = message.content.filter(
    (block): block is AnthropicToolUseBlock => block.type === "tool_use",
  )
  const textBlocks = message.content.filter(
    (block): block is AnthropicTextBlock | AnthropicThinkingBlock =>
      block.type === "text" || block.type === "thinking",
  )

  if (textBlocks.length > 0) {
    const text = textBlocks
      .map((b) => (b.type === "text" ? b.text : b.thinking))
      .join("\n\n")
    items.push({
      type: "message",
      role: "assistant",
      content: [{ type: "output_text", text }],
    } as ResponsesOutputMessage)
  }

  for (const toolUse of toolUseBlocks) {
    items.push({
      type: "function_call",
      call_id: toolUse.id,
      name: toolUse.name,
      arguments: JSON.stringify(toolUse.input),
    } as ResponsesFunctionCall)
  }

  return items
}

function translateAnthropicContentBlockToResponsesPart(
  block: AnthropicTextBlock | AnthropicImageBlock | AnthropicToolResultBlock,
): ResponsesContentPart {
  switch (block.type) {
    case "text": {
      return { type: "input_text", text: block.text }
    }
    case "image": {
      return {
        type: "input_image",
        image_url: `data:${block.source.media_type};base64,${block.source.data}`,
      }
    }
    default: {
      return { type: "input_text", text: "" }
    }
  }
}

function translateAnthropicToolsToResponses(
  tools: AnthropicMessagesPayload["tools"],
): Array<ResponsesTool> | undefined {
  if (!tools) return undefined
  return tools.map((tool) => ({
    type: "function",
    name: tool.name,
    description: tool.description,
    parameters: tool.input_schema,
  }))
}

function translateAnthropicToolChoiceToResponses(
  toolChoice: AnthropicMessagesPayload["tool_choice"],
): ResponsesPayload["tool_choice"] {
  if (!toolChoice) return undefined
  switch (toolChoice.type) {
    case "auto": {
      return "auto"
    }
    case "any": {
      return "required"
    }
    case "tool": {
      if (toolChoice.name) {
        return { type: "function", name: toolChoice.name }
      }
      return undefined
    }
    case "none": {
      return "none"
    }
    default: {
      return undefined
    }
  }
}

// --- Response translation: Responses → Anthropic ---

export function translateResponsesResponseToAnthropic(
  response: ResponsesResponse,
): AnthropicResponse {
  const content = translateResponsesOutputToAnthropicContent(response.output)
  const stopReason = translateResponsesStatusToAnthropicStopReason(
    response.status,
    response.output,
  )

  return {
    id: response.id,
    type: "message",
    role: "assistant",
    model: response.model,
    content,
    stop_reason: stopReason,
    stop_sequence: null,
    usage: {
      input_tokens: response.usage.input_tokens,
      output_tokens: response.usage.output_tokens,
    },
  }
}

function translateResponsesOutputToAnthropicContent(
  output: Array<ResponsesOutputItem>,
): AnthropicResponse["content"] {
  const content: AnthropicResponse["content"] = []

  for (const item of output) {
    if (item.type === "message" && item.role === "assistant") {
      for (const part of item.content) {
        if (part.type === "output_text") {
          content.push({ type: "text", text: part.text })
        }
      }
    } else if (item.type === "function_call") {
      content.push({
        type: "tool_use",
        id: item.call_id,
        name: item.name,
        input: JSON.parse(item.arguments) as Record<string, unknown>,
      })
    }
  }

  return content
}

function translateResponsesStatusToAnthropicStopReason(
  status: ResponsesResponse["status"],
  output: Array<ResponsesOutputItem>,
): AnthropicResponse["stop_reason"] {
  const hasFunctionCall = output.some((item) => item.type === "function_call")
  if (hasFunctionCall) return "tool_use"

  switch (status) {
    case "completed": {
      return "end_turn"
    }
    case "incomplete": {
      return "max_tokens"
    }
    case "failed": {
      return "end_turn"
    }
    default: {
      return "end_turn"
    }
  }
}

// --- Request translation: Responses → Anthropic ---

export function translateResponsesPayloadToAnthropic(
  payload: ResponsesPayload,
): AnthropicMessagesPayload {
  const { system, messages } =
    translateResponsesInputToAnthropicMessages(payload)

  return {
    model: payload.model,
    max_tokens: payload.max_output_tokens ?? 4096,
    system,
    messages,
    stream: payload.stream,
    temperature: isGpt5OrAbove(payload.model) ? undefined : payload.temperature,
    top_p: isGpt5OrAbove(payload.model) ? undefined : payload.top_p,
    tools: translateResponsesToolsToAnthropic(payload.tools),
    tool_choice: translateResponsesToolChoiceToAnthropic(payload.tool_choice),
  }
}

function translateResponsesInputToAnthropicMessages(
  payload: ResponsesPayload,
): { system?: string; messages: Array<AnthropicMessage> } {
  let system: string | undefined
  const messages: Array<AnthropicMessage> = []

  if (payload.instructions) {
    system = payload.instructions
  }

  if (typeof payload.input === "string") {
    messages.push({ role: "user", content: payload.input })
    return { system, messages }
  }

  for (const item of payload.input) {
    if (
      "role" in item
      && (item.role === "system" || item.role === "developer")
    ) {
      const text = typeof item.content === "string" ? item.content : ""
      system = system ? `${system}\n\n${text}` : text
    } else if ("role" in item && item.role === "user") {
      if (typeof item.content === "string") {
        messages.push({ role: "user", content: item.content })
      } else if (Array.isArray(item.content)) {
        const blocks = item.content.map((part) => {
          if (part.type === "input_text") {
            return { type: "text" as const, text: part.text }
          }
          return {
            type: "image" as const,
            source: {
              type: "base64" as const,
              media_type: "image/png" as const,
              data: (part as { image_url?: string }).image_url ?? "",
            },
          }
        })
        messages.push({ role: "user", content: blocks })
      }
    } else if (
      "type" in item
      && item.type === "message"
      && "role" in item
      && item.role === "assistant"
    ) {
      const outputMsg = item
      const content = outputMsg.content
        .filter((p) => p.type === "output_text")
        .map((p) => ({
          type: "text" as const,
          text: (p as { text: string }).text,
        }))
      messages.push({ role: "assistant", content })
    } else if ("type" in item && item.type === "function_call") {
      const fc = item
      messages.push({
        role: "assistant",
        content: [
          {
            type: "tool_use",
            id: fc.call_id,
            name: fc.name,
            input: JSON.parse(fc.arguments) as Record<string, unknown>,
          },
        ],
      })
    } else if ("type" in item && item.type === "function_call_output") {
      const fco = item
      messages.push({
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: fco.call_id,
            content: fco.output,
          },
        ],
      })
    }
  }

  return { system, messages }
}

function translateResponsesToolsToAnthropic(
  tools: ResponsesPayload["tools"],
): AnthropicMessagesPayload["tools"] {
  if (!tools) return undefined
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: tool.parameters ?? {},
  }))
}

function translateResponsesToolChoiceToAnthropic(
  toolChoice: ResponsesPayload["tool_choice"],
): AnthropicMessagesPayload["tool_choice"] {
  if (!toolChoice) return undefined
  if (typeof toolChoice === "string") {
    switch (toolChoice) {
      case "auto": {
        return { type: "auto" }
      }
      case "required": {
        return { type: "any" }
      }
      case "none": {
        return { type: "none" }
      }
      default: {
        return undefined
      }
    }
  }
  return { type: "tool", name: toolChoice.name }
}
