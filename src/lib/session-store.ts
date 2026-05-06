import consola from "consola"
import fs from "node:fs/promises"
import path from "node:path"

const __dirname = import.meta.dirname
const SESSIONS_DIR = path.resolve(__dirname, "..", "..", "sessions")

export interface SessionRecord {
  timestamp: string
  model: string
  request: unknown
  response: unknown
}

interface SessionFile {
  sessionId: string
  records: Array<SessionRecord>
}

async function ensureSessionsDir(): Promise<void> {
  await fs.mkdir(SESSIONS_DIR, { recursive: true })
}

export async function addRecord(
  sessionId: string,
  model: string,
  request: unknown,
  response: unknown,
): Promise<void> {
  try {
    await ensureSessionsDir()

    const filePath = path.join(SESSIONS_DIR, `${sessionId}.json`)

    let sessionFile: SessionFile
    try {
      const content = await fs.readFile(filePath)
      sessionFile = JSON.parse(content) as SessionFile
    } catch {
      sessionFile = { sessionId, records: [] }
    }

    sessionFile.records.push({
      timestamp: new Date().toISOString(),
      model,
      request,
      response,
    })

    await fs.writeFile(filePath, JSON.stringify(sessionFile, null, 2))
  } catch (error) {
    consola.warn("[Session Log] Failed to save record:", error)
  }
}

export async function getSessions(): Promise<
  Array<{ sessionId: string; recordCount: number; updatedAt: string }>
> {
  try {
    await ensureSessionsDir()
    const files = await fs.readdir(SESSIONS_DIR)
    const sessions = await Promise.all(
      files
        .filter((f) => f.endsWith(".json"))
        .map(async (f) => {
          const filePath = path.join(SESSIONS_DIR, f)
          const content = await fs.readFile(filePath)
          const data = JSON.parse(content) as SessionFile
          const stat = await fs.stat(filePath)
          return {
            sessionId: data.sessionId,
            recordCount: data.records.length,
            updatedAt: stat.mtime.toISOString(),
          }
        }),
    )
    return sessions.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  } catch {
    return []
  }
}

export async function getSession(
  sessionId: string,
): Promise<SessionFile | null> {
  try {
    const filePath = path.join(SESSIONS_DIR, `${sessionId}.json`)
    const content = await fs.readFile(filePath)
    return JSON.parse(content) as SessionFile
  } catch {
    return null
  }
}
