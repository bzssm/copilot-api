import { createHmac } from "node:crypto"
import fs from "node:fs/promises"

import type { State } from "./state"

import { PATHS } from "./paths"

export interface HmacCredential {
  integrationId: string
  key: string
}

export const parseHmacCredential = (raw: string): HmacCredential => {
  const separatorIndex = raw.indexOf(":")
  if (separatorIndex === -1) {
    throw new Error(
      "Invalid hmac credential, expected format {integration-id}:{hmac-key}",
    )
  }

  const integrationId = raw.slice(0, separatorIndex).trim()
  const key = raw.slice(separatorIndex + 1).trim()

  if (!integrationId || !key) {
    throw new Error(
      "Invalid hmac credential, both integration-id and hmac-key are required",
    )
  }

  return { integrationId, key }
}

export const serializeHmacCredential = (credential: HmacCredential): string =>
  `${credential.integrationId}:${credential.key}`

export const readHmacCredential = async (): Promise<
  HmacCredential | undefined
> => {
  try {
    const raw = (await fs.readFile(PATHS.HMAC_TOKEN_PATH, "utf8")).trim()
    if (!raw) return undefined
    return parseHmacCredential(raw)
  } catch {
    return undefined
  }
}

export const writeHmacCredential = async (
  credential: HmacCredential,
): Promise<void> => {
  await fs.writeFile(PATHS.HMAC_TOKEN_PATH, serializeHmacCredential(credential))
  await fs.chmod(PATHS.HMAC_TOKEN_PATH, 0o600)
}

export const generateRequestHmac = (secret: string): string => {
  const timestamp = Math.floor(Date.now() / 1000).toString()
  const hex = createHmac("sha256", secret).update(timestamp).digest("hex")
  return `${timestamp}.${hex}`
}

export const hasValidAuth = (state: State): boolean =>
  Boolean(state.copilotToken)
  || Boolean(state.hmacKey && state.hmacIntegrationId)
