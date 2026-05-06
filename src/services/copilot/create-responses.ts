import consola from "consola"
import { events } from "fetch-event-stream"

import { copilotBaseUrl, copilotHeaders } from "~/lib/api-config"
import { HTTPError } from "~/lib/error"
import { state } from "~/lib/state"

export const createResponses = async (payload: ResponsesPayload) => {
  if (!state.copilotToken) throw new Error("Copilot token not found")

  const headers: Record<string, string> = {
    ...copilotHeaders(state),
  }

  const response = await fetch(`${copilotBaseUrl(state)}/responses`, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  })

  if (!response.ok) {
    consola.error("Failed to create responses", response)
    throw new HTTPError("Failed to create responses", response)
  }

  if (payload.stream) {
    return events(response)
  }

  return (await response.json()) as ResponsesResponse
}

// --- Request types ---

export interface ResponsesPayload {
  model: string
  input: string | Array<ResponsesInputItem>
  instructions?: string
  max_output_tokens?: number
  temperature?: number
  top_p?: number
  stream?: boolean
  tools?: Array<ResponsesTool>
  tool_choice?:
    | "auto"
    | "none"
    | "required"
    | { type: "function"; name: string }
  reasoning?: { effort?: "low" | "medium" | "high" }
  text?: {
    format:
      | { type: "text" }
      | { type: "json_schema"; json_schema: Record<string, unknown> }
  }
  store?: boolean
  metadata?: Record<string, string>
}

export type ResponsesInputItem =
  | ResponsesInputMessage
  | ResponsesOutputMessage
  | ResponsesFunctionCall
  | ResponsesFunctionCallOutput

export interface ResponsesInputMessage {
  type?: "message"
  role: "user" | "system" | "developer"
  content: string | Array<ResponsesContentPart>
  status?: "in_progress" | "completed" | "incomplete"
}

export interface ResponsesOutputMessage {
  type: "message"
  id?: string
  role: "assistant"
  content: Array<ResponsesOutputContentPart>
  status?: "in_progress" | "completed" | "incomplete"
}

export interface ResponsesFunctionCall {
  type: "function_call"
  id?: string
  call_id: string
  name: string
  arguments: string
  status?: "in_progress" | "completed" | "incomplete"
}

export interface ResponsesFunctionCallOutput {
  type: "function_call_output"
  call_id: string
  output: string
}

export type ResponsesContentPart =
  | { type: "input_text"; text: string }
  | {
      type: "input_image"
      image_url?: string
      file_id?: string
      detail?: "low" | "high" | "auto"
    }

export type ResponsesOutputContentPart =
  | { type: "output_text"; text: string; annotations?: Array<unknown> }
  | { type: "refusal"; refusal: string }

export interface ResponsesTool {
  type: "function"
  name: string
  description?: string
  parameters?: Record<string, unknown>
}

// --- Response types ---

export interface ResponsesResponse {
  id: string
  object: "response"
  created_at: number
  status: "completed" | "incomplete" | "failed" | "in_progress"
  model: string
  output: Array<ResponsesOutputItem>
  usage: {
    input_tokens: number
    input_tokens_details?: { cached_tokens: number }
    output_tokens: number
    output_tokens_details?: { reasoning_tokens: number }
    total_tokens: number
  }
  error?: { code: string; message: string } | null
}

export type ResponsesOutputItem = ResponsesOutputMessage | ResponsesFunctionCall
