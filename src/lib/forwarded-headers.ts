import { AsyncLocalStorage } from "node:async_hooks"

// Client SDK metadata headers that are passed through to the Copilot backend.
const FORWARDED_HEADER_NAMES = new Set([
  "x-stainless-arch",
  "x-stainless-lang",
  "x-stainless-os",
  "x-stainless-package-version",
  "x-stainless-runtime",
  "x-stainless-runtime-version",
  "x-stainless-timeout",
])

const storage = new AsyncLocalStorage<Record<string, string>>()

export function pickForwardedHeaders(
  headers: Record<string, string>,
): Record<string, string> {
  const picked: Record<string, string> = {}
  for (const [name, value] of Object.entries(headers)) {
    const lowerName = name.toLowerCase()
    if (FORWARDED_HEADER_NAMES.has(lowerName)) picked[lowerName] = value
  }
  return picked
}

export function runWithForwardedHeaders<T>(
  headers: Record<string, string>,
  fn: () => T,
): T {
  return storage.run(headers, fn)
}

// Empty outside a request context (e.g. model caching at startup).
export function getForwardedHeaders(): Record<string, string> {
  return storage.getStore() ?? {}
}
