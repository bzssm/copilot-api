/* eslint-disable @typescript-eslint/no-unnecessary-condition, eqeqeq, complexity, no-nested-ternary -- pre-existing, tracked as tech debt */
import { Hono } from "hono"

import { forwardError } from "~/lib/error"
import { state } from "~/lib/state"
import { cacheModels } from "~/lib/utils"

export const modelRoutes = new Hono()

modelRoutes.get("/", async (c) => {
  try {
    if (!state.models) {
      // This should be handled by startup logic, but as a fallback.
      await cacheModels()
    }

    const models = state.models?.data.map((model) => {
      const effortLevels = model.capabilities?.supports?.reasoning_effort
      const effort =
        effortLevels ?
          {
            supported: true,
            ...Object.fromEntries(
              effortLevels.map((level) => [level, { supported: true }]),
            ),
          }
        : { supported: false }

      const contextWindow =
        model.capabilities?.limits?.max_context_window_tokens
      const idSuffix =
        (contextWindow ?? 0) > 950000 && (contextWindow ?? 0) < 1200000 ?
          "[1m]"
        : ""

      const supports = model.capabilities?.supports
      const thinking =
        supports?.adaptive_thinking === true ?
          {
            supported: true,
            types: {
              adaptive: { supported: true },
              enabled: { supported: false },
            },
          }
        : (
          supports?.max_thinking_budget != null
          && supports?.min_thinking_budget != null
        ) ?
          {
            supported: true,
            types: {
              adaptive: { supported: false },
              enabled: { supported: true },
            },
          }
        : { supported: false }

      return {
        id: `${model.id}${idSuffix}`,
        object: "model",
        type: "model",
        created: 0,
        created_at: new Date(0).toISOString(),
        owned_by: model.vendor,
        display_name: model.name,
        max_input_tokens: model.capabilities?.limits?.max_prompt_tokens ?? 0,
        max_tokens: model.capabilities?.limits?.max_output_tokens ?? 0,
        capabilities: {
          effort,
          structured_outputs: {
            supported:
              model.capabilities?.supports?.structured_outputs === true,
          },
          thinking,
        },
      }
    })

    return c.json({
      object: "list",
      data: models,
      has_more: false,
    })
  } catch (error) {
    return await forwardError(c, error)
  }
})
