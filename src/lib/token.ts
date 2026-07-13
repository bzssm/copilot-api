import consola from "consola"
import fs from "node:fs/promises"

import { PATHS } from "~/lib/paths"
import { getCopilotToken } from "~/services/github/get-copilot-token"
import { getDeviceCode } from "~/services/github/get-device-code"
import { getGitHubUser } from "~/services/github/get-user"
import { pollAccessToken } from "~/services/github/poll-access-token"

import type { HmacCredential } from "./hmac"

import { HTTPError } from "./error"
import {
  parseHmacCredential,
  readHmacCredential,
  writeHmacCredential,
} from "./hmac"
import { state } from "./state"

const readGithubToken = () => fs.readFile(PATHS.GITHUB_TOKEN_PATH, "utf8")

const writeGithubToken = (token: string) =>
  fs.writeFile(PATHS.GITHUB_TOKEN_PATH, token)

export const setupCopilotToken = async () => {
  const { token, refresh_in } = await getCopilotToken()
  state.copilotToken = token

  // Display the Copilot token to the screen
  consola.debug("GitHub Copilot Token fetched successfully!")
  if (state.showToken) {
    consola.info("Copilot token:", token)
  }

  const refreshInterval = (refresh_in - 60) * 1000
  setInterval(async () => {
    consola.debug("Refreshing Copilot token")
    try {
      const { token } = await getCopilotToken()
      state.copilotToken = token
      consola.debug("Copilot token refreshed")
      if (state.showToken) {
        consola.info("Refreshed Copilot token:", token)
      }
    } catch (error) {
      consola.error("Failed to refresh Copilot token:", error)
      throw error
    }
  }, refreshInterval)
}

interface SetupGitHubTokenOptions {
  force?: boolean
}

export async function setupGitHubToken(
  options?: SetupGitHubTokenOptions,
): Promise<void> {
  try {
    const githubToken = await readGithubToken()

    if (githubToken && !options?.force) {
      state.githubToken = githubToken
      if (state.showToken) {
        consola.info("GitHub token:", githubToken)
      }
      await logUser()

      return
    }

    consola.info("Not logged in, getting new access token")
    const response = await getDeviceCode()
    consola.debug("Device code response:", response)

    consola.info(
      `Please enter the code "${response.user_code}" in ${response.verification_uri}`,
    )

    const token = await pollAccessToken(response)
    await writeGithubToken(token)
    state.githubToken = token

    if (state.showToken) {
      consola.info("GitHub token:", token)
    }
    await logUser()
  } catch (error) {
    if (error instanceof HTTPError) {
      consola.error("Failed to get GitHub token:", await error.response.json())
      throw error
    }

    consola.error("Failed to get GitHub token:", error)
    throw error
  }
}

async function logUser() {
  const user = await getGitHubUser()
  consola.info(`Logged in as ${user.login}`)
}

interface SetupAuthOptions {
  githubToken?: string
  hmac?: string
}

export async function setupAuth(options: SetupAuthOptions): Promise<void> {
  if (options.githubToken && options.hmac) {
    throw new Error("Provide either --github-token or --hmac, not both")
  }

  // A credential passed on the command line is used directly, never persisted
  if (options.hmac) {
    applyHmac(parseHmacCredential(options.hmac))
    return
  }

  if (options.githubToken) {
    state.githubToken = options.githubToken
    consola.info("Using provided GitHub token")
    await useGithubAuth()
    return
  }

  // Nothing provided, let the user pick a method
  const mode = await promptAuthMode()

  if (mode === "hmac") {
    const credential =
      (await readHmacCredential()) ?? (await createHmacCredential())
    applyHmac(credential)
    return
  }

  await useGithubAuth()
}

async function useGithubAuth(): Promise<void> {
  state.authMode = "github"
  if (!state.githubToken) {
    await setupGitHubToken()
  }
  await setupCopilotToken()
}

function applyHmac(credential: HmacCredential): void {
  state.authMode = "hmac"
  state.hmacIntegrationId = credential.integrationId
  state.hmacKey = credential.key
  consola.info(`Using HMAC authentication: ${credential.integrationId}`)
}

async function createHmacCredential(): Promise<HmacCredential> {
  const credential = await promptHmacCredential()
  await writeHmacCredential(credential)
  return credential
}

async function promptAuthMode(): Promise<"github" | "hmac"> {
  const mode = await consola.prompt("Select the authentication method to use", {
    type: "select",
    options: [
      { label: "GitHub token", value: "github" },
      { label: "HMAC", value: "hmac" },
    ],
  })
  return mode as unknown as "github" | "hmac"
}

async function promptHmacCredential(): Promise<HmacCredential> {
  const integrationId = (
    await consola.prompt("Enter the integration id", { type: "text" })
  ).trim()
  const key = (
    await consola.prompt("Enter the HMAC key", { type: "text" })
  ).trim()

  if (!integrationId || !key) {
    throw new Error("Both integration-id and HMAC key are required")
  }

  return { integrationId, key }
}
