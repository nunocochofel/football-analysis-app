import { app } from 'electron'
import { appendFileSync, mkdirSync } from 'fs'
import { join } from 'path'

// Diagnostic instrumentation for "a exportação fica bloqueada nos 50%" — same pattern as
// liveLog.ts's logLive(): a rolling, append-only file under app.getPath('logs') so a packaged
// build (no attached DevTools for a normal user) still has a persistent, shareable timeline of
// exactly where an export got to. Covers BOTH processes: the renderer's own capture/draw loop
// calls this via the 'log:export' IPC channel (see ipc.ts), and ffmpeg.ts calls it directly here
// in the main process — one file, one interleaved timeline, so "the last line before it stopped"
// is unambiguous regardless of which process was doing the stuck work.
const LOG_FILE = 'export.log'

export function logExport(line: string): void {
  try {
    const dir = app.getPath('logs')
    mkdirSync(dir, { recursive: true })
    const stamp = new Date().toISOString()
    appendFileSync(join(dir, LOG_FILE), `[${stamp}] ${line}\n`)
  } catch {
    // Best-effort — a logging failure must never take down the export itself.
  }
}
