import type { Model } from "~/services/copilot/get-models"

export type CopilotEndpoint =
  | "/v1/messages"
  | "/chat/completions"
  | "/responses"

type RequestFormat = "messages" | "chat-completions" | "responses"

const ENDPOINT_PRIORITY: Array<CopilotEndpoint> = [
  "/responses",
  "/v1/messages",
  "/chat/completions",
]

const REQUEST_FORMAT_TO_ENDPOINT: Record<RequestFormat, CopilotEndpoint> = {
  messages: "/v1/messages",
  "chat-completions": "/chat/completions",
  responses: "/responses",
}

export function selectEndpoint(
  requestFormat: RequestFormat,
  model: Model,
): CopilotEndpoint {
  const supported = model.supported_endpoints

  if (!supported || supported.length === 0) {
    return "/chat/completions"
  }

  const nativeEndpoint = REQUEST_FORMAT_TO_ENDPOINT[requestFormat]
  if (supported.includes(nativeEndpoint)) {
    return nativeEndpoint
  }

  for (const endpoint of ENDPOINT_PRIORITY) {
    if (supported.includes(endpoint)) {
      return endpoint
    }
  }

  return "/chat/completions"
}
