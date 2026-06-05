/**
 * Wraps an upstream async iterable so that, whenever the upstream stays idle
 * for longer than `intervalMs`, a keepalive sentinel is yielded instead.
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
  source: AsyncIterable<T>,
  intervalMs = 15_000,
): AsyncGenerator<WithKeepalive<T>> {
  const iterator = source[Symbol.asyncIterator]()

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
        // Upstream idle past the interval: emit a heartbeat and keep waiting on
        // the same pending upstream promise.
        yield KEEPALIVE_PING
        continue
      }

      const result = winner as IteratorResult<T>
      if (result.done) {
        return
      }

      yield result.value
      nextPromise = iterator.next()
    }
  } finally {
    await iterator.return?.()
  }
}
