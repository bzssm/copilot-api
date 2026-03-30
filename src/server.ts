import fs from "node:fs/promises"
import path from "node:path"
import url from "node:url"

import { Hono } from "hono"
import { cors } from "hono/cors"
import { logger } from "hono/logger"

import { completionRoutes } from "./routes/chat-completions/route"
import { embeddingRoutes } from "./routes/embeddings/route"
import { getSession, getSessions } from "./lib/session-store"
import { getUsageStats } from "./lib/usage-tracker"
import { messageRoutes } from "./routes/messages/route"
import { modelRoutes } from "./routes/models/route"
import { tokenRoute } from "./routes/token/route"
import { usageRoute } from "./routes/usage/route"

const __dirname = path.dirname(url.fileURLToPath(import.meta.url))

export const server = new Hono()

server.use(logger())
server.use(cors())

server.get("/", (c) => c.text("Server running"))

server.get("/dashboard", async (c) => {
  const htmlPath = path.resolve(__dirname, "..", "pages", "index.html")
  const html = await fs.readFile(htmlPath, "utf-8")
  return c.html(html)
})

server.get("/sessions", async (c) => {
  const sessions = await getSessions()
  return c.json(sessions)
})

server.get("/sessions/:id", async (c) => {
  const session = await getSession(c.req.param("id"))
  if (!session) {
    return c.json({ error: "Session not found" }, 404)
  }
  return c.json(session)
})

server.get("/token-usage", (c) => {
  return c.json(getUsageStats())
})

server.route("/chat/completions", completionRoutes)
server.route("/models", modelRoutes)
server.route("/embeddings", embeddingRoutes)
server.route("/usage", usageRoute)
server.route("/token", tokenRoute)

// Compatibility with tools that expect v1/ prefix
server.route("/v1/chat/completions", completionRoutes)
server.route("/v1/models", modelRoutes)
server.route("/v1/embeddings", embeddingRoutes)

// Anthropic compatible endpoints
server.route("/v1/messages", messageRoutes)
