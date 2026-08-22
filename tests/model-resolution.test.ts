import { afterEach, describe, expect, test } from "bun:test"

import { state } from "~/lib/state"
import { resolveModelName } from "~/lib/utils"

const originalModels = state.models

afterEach(() => {
  state.models = originalModels
})

describe("resolveModelName", () => {
  test("strips the 1m context suffix before exact matching", () => {
    state.models = {
      object: "list",
      data: [
        {
          id: "claude-sonnet-4",
          name: "Claude Sonnet 4",
          object: "model",
          version: "4",
          vendor: "Anthropic",
          preview: false,
          model_picker_enabled: true,
          capabilities: {
            family: "claude-sonnet",
            limits: {},
            object: "model_capabilities",
            supports: {},
            tokenizer: "o200k_base",
            type: "chat",
          },
        },
      ],
    }

    expect(resolveModelName("claude-sonnet-4[1m]")).toBe("claude-sonnet-4")
  })

  test("strips the suffix when the model cache is unavailable", () => {
    state.models = undefined

    expect(resolveModelName("claude-sonnet-4[1m]")).toBe("claude-sonnet-4")
  })
})
