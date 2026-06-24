import consola from "consola"

/**
 * Wraps an upstream SSE source so that, whenever the upstream stays idle for
 * longer than `intervalMs`, a keepalive sentinel is yielded instead.
 *
 * The `source` may be either an already-ready async iterable, or a Promise that
 * resolves to one (e.g. the still-pending `fetch` to the upstream provider).
 * When a Promise is given, keepalive pings are emitted while awaiting it, so the
 * heartbeat also covers the "waiting for response headers" window before any
 * data starts flowing.
 *
 * This lets the SSE handler emit `event: ping` heartbeats to the client during
 * long "thinking" gaps where the upstream produces no data, preventing idle
 * socket timeouts (e.g. "The socket connection was closed unexpectedly").
 *
 * All yielding happens on the single consuming loop, so downstream writes stay
 * sequential and never interleave.
 */

export const KEEPALIVE_PING = Symbol("keepalive-ping")

export type WithKeepalive<T> = T | typeof KEEPALIVE_PING

export async function* withKeepalive<T>(
  source: AsyncIterable<T> | Promise<AsyncIterable<T>>,
  intervalMs = 5_000,
): AsyncGenerator<WithKeepalive<T>> {
  let pingCount = 0

  // Phase 1: if the upstream is still a pending promise (e.g. awaiting response
  // headers), emit keepalive pings until it resolves.
  let iterable: AsyncIterable<T>
  if (source instanceof Promise) {
    let resolved = false
    const sourcePromise = source.then((value) => {
      resolved = true
      return value
    })

    while (!resolved) {
      let timer: ReturnType<typeof setTimeout> | undefined
      const timeoutPromise = new Promise<typeof KEEPALIVE_PING>((resolve) => {
        timer = setTimeout(() => resolve(KEEPALIVE_PING), intervalMs)
      })

      const winner = await Promise.race([sourcePromise, timeoutPromise])

      if (timer) clearTimeout(timer)

      if (winner === KEEPALIVE_PING && !resolved) {
        pingCount += 1
        consola.info(
          `[Keepalive] awaiting upstream headers, ping sent * ${pingCount}`,
        )
        yield KEEPALIVE_PING
      }
    }

    iterable = await sourcePromise
  } else {
    iterable = source
  }

  // Phase 2: iterate the upstream, emitting a ping whenever it idles past the
  // interval between events.
  const iterator = iterable[Symbol.asyncIterator]()

  let nextPromise = iterator.next()

  try {
    while (true) {
      let timer: ReturnType<typeof setTimeout> | undefined
      const timeoutPromise = new Promise<typeof KEEPALIVE_PING>((resolve) => {
        timer = setTimeout(() => resolve(KEEPALIVE_PING), intervalMs)
      })

      const winner = await Promise.race([nextPromise, timeoutPromise])

      if (timer) clearTimeout(timer)

      if (winner === KEEPALIVE_PING) {
        pingCount += 1
        consola.info(`[Keepalive] upstream idle, ping sent * ${pingCount}`)
        yield KEEPALIVE_PING
        continue
      }

      const result = winner as IteratorResult<T>
      if (result.done) {
        return
      }

      pingCount = 0
      yield result.value
      nextPromise = iterator.next()
    }
  } finally {
    await iterator.return?.()
  }
}
