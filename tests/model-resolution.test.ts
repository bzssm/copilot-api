import { afterEach, describe, expect, test } from "bun:test"

import { HTTPError } from "~/lib/error"
import { state } from "~/lib/state"
import { resolveModelName } from "~/lib/utils"

const originalModels = state.models
const originalStrictModelName = state.strictModelName

afterEach(() => {
  state.models = originalModels
  state.strictModelName = originalStrictModelName
})

function setAvailableModels(...ids: Array<string>) {
  state.models = {
    object: "list",
    data: ids.map((id) => ({
      id,
      name: id,
      object: "model",
      version: "1",
      vendor: "Anthropic",
      preview: false,
      model_picker_enabled: true,
      capabilities: {
        family: "claude",
        limits: {},
        object: "model_capabilities",
        supports: {},
        tokenizer: "o200k_base",
        type: "chat",
      },
    })),
  }
}

describe("resolveModelName", () => {
  test("strips the 1m context suffix before exact matching", () => {
    setAvailableModels("claude-sonnet-4")

    expect(resolveModelName("claude-sonnet-4[1m]")).toBe("claude-sonnet-4")
  })

  test("strips the suffix when the model cache is unavailable", () => {
    state.models = undefined

    expect(resolveModelName("claude-sonnet-4[1m]")).toBe("claude-sonnet-4")
  })

  test("prefers a separator alias over an equally close fuzzy match", () => {
    setAvailableModels("claude-opus-5-6", "claude-opus-5.5")

    expect(resolveModelName("claude-opus-5-5")).toBe("claude-opus-5.5")
    expect(resolveModelName("claude-opus-5-5[1m]")).toBe("claude-opus-5.5")
  })

  test("prefers exact IDs over separator aliases", () => {
    setAvailableModels("claude-opus-5.5", "claude-opus-5-5")

    expect(resolveModelName("claude-opus-5-5[1m]")).toBe("claude-opus-5-5")
  })

  test("allows mixed separators throughout the model name", () => {
    setAvailableModels("claude.opus.5-6", "claude-opus-5.5")

    expect(resolveModelName("claude.opus.5-5")).toBe("claude-opus-5.5")
    expect(resolveModelName("claude.opus.5-5[1m]")).toBe("claude-opus-5.5")
  })

  test("combines case and separator aliases without preferring either", () => {
    setAvailableModels("claude-opus-5.5")
    expect(resolveModelName("Claude.Opus-5.5")).toBe("claude-opus-5.5")

    setAvailableModels("claude-opus-5.5", "claude.opus-5.5")
    expect(resolveModelName("Claude.Opus-5.5")).toBe("claude-opus-5.5")
    expect(resolveModelName("claude.opus-5.5")).toBe("claude.opus-5.5")
  })

  test("uses fuzzy matching by default only below the distance threshold", () => {
    setAvailableModels("claude-opus-5.5", "abcde")

    expect(resolveModelName("claude-ops-5.5")).toBe("claude-opus-5.5")
    expect(resolveModelName("abcdx[1m]")).toBe("abcdx")
  })

  test("strict mode accepts only the case-sensitive, unmodified model ID", () => {
    state.strictModelName = true
    setAvailableModels("claude-opus-5.5")

    expect(resolveModelName("claude-opus-5.5")).toBe("claude-opus-5.5")
    for (const input of [
      "CLAUDE-OPUS-5.5",
      "claude-opus-5.5[1m]",
      "claude-opus-5-5",
      "claude-opus-5-5[1m]",
      "claude.opus.5-5",
      "claude-ops-5.5",
    ]) {
      expect(() => resolveModelName(input)).toThrow(HTTPError)
    }
  })

  test("strict mode rejects requests if no available ID can be verified", () => {
    state.strictModelName = true
    state.models = undefined

    expect(() => resolveModelName("claude-opus-5.5")).toThrow(HTTPError)
  })
})
