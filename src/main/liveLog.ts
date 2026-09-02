import { app } from 'electron'
import { appendFileSync, mkdirSync } from 'fs'
import { join } from 'path'

// Session-level diagnostics for LIVE (RTMP/YouTube) — previously only console.log/console.error,
// invisible in a packaged app (no DevTools attached to the main process for a normal user).
// Appended (never truncated) to the SAME directory index.ts's own startup-errors.log already uses
// (app.getPath('logs') — on Windows this is <userData>/logs, e.g.
// %APPDATA%\LINHA\logs\live-session.log). One rolling file, not one per session, so a multi-hour
// test's whole timeline — connect, every reconnect, every error — stays in one place to scroll
// through instead of hunting across files.
const LOG_FILE = 'live-session.log'

// Query strings on a resolved YouTube stream URL carry short-lived auth-style tokens
// (expire=/signature-shaped params) — stripped before writing to a persistent file on disk, same
// spirit as never logging a password even locally. RTMP URLs are left as-is, matching how they
// were already being written to the (volatile, DevTools-only) console before this file existed.
function sanitizeForLog(text: string): string {
  return text.replace(/(https?:\/\/[^\s?]+)\?[^\s]*/g, '$1?(query omitida)')
}

export function logLive(line: string): void {
  try {
    const dir = app.getPath('logs')
    mkdirSync(dir, { recursive: true })
    const stamp = new Date().toISOString()
    appendFileSync(join(dir, LOG_FILE), `[${stamp}] ${sanitizeForLog(line)}\n`)
  } catch {
    // Best-effort — a logging failure must never take down the LIVE session itself.
  }
}
