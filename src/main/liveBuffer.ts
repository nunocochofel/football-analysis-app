import { mkdir, rm, writeFile, readFile } from 'fs/promises'
import { join } from 'path'

// Fase LIVE 2 — the actual "buffer temporal" the phase is named after. Owns a small directory of
// fragment files on disk (see the module-level comment in liveIngest.ts for why disk rather than
// RAM) plus an in-memory index of what's currently in the window. One instance per LIVE session
// (created fresh in LiveSession.start(), disposed in stop()/fail()) — never shared across sessions,
// never grows across reconnects.

export interface SegmentMeta {
  id: number
  startMs: number
  endMs: number
  filePath: string
  byteLength: number
}

// 5 minutes: generous enough to meaningfully answer "what just happened", small enough that even a
// modest bitrate (a few Mbps, typical for 720p60 H.264 broadcast) keeps total disk usage in the low
// hundreds of MB — trivial for any SSD — and keeps the in-memory index (one small object per
// fragment, not per byte) at a few hundred entries at most, never growing further once the window
// is full. Not a hard technical ceiling — see liveIngest.ts for how a caller could override it —
// just the POC value the task asked to justify.
export const DEFAULT_BUFFER_DURATION_MS = 5 * 60 * 1000

export class LiveBuffer {
  private readonly segments: SegmentMeta[] = []
  private nextId = 1
  private initBytes: Buffer | null = null
  private initFilePath: string | null = null
  private disposed = false

  constructor(
    private readonly sessionDir: string,
    private readonly bufferDurationMs: number = DEFAULT_BUFFER_DURATION_MS
  ) {}

  async init(): Promise<void> {
    await mkdir(this.sessionDir, { recursive: true })
  }

  async setInitSegment(bytes: Buffer): Promise<void> {
    if (this.disposed) return
    this.initBytes = bytes
    this.initFilePath = join(this.sessionDir, 'init.mp4')
    await writeFile(this.initFilePath, bytes)
  }

  getInitSegment(): Buffer | null {
    return this.initBytes
  }

  // nowMs is passed in (rather than read via Date.now() here) purely so tests can control time
  // deterministically — see the module-level comment in liveIngest.ts about wall-clock receipt
  // time being the timeline basis for this phase (not PTS parsed out of the fragment itself).
  async addFragment(bytes: Buffer, nowMs: number): Promise<SegmentMeta> {
    if (this.disposed) throw new Error('LiveBuffer já foi terminado.')
    const id = this.nextId++
    const startMs = this.segments.length ? this.segments[this.segments.length - 1].endMs : nowMs
    const filePath = join(this.sessionDir, `${id}.m4s`)
    await writeFile(filePath, bytes)
    const meta: SegmentMeta = { id, startMs, endMs: nowMs, filePath, byteLength: bytes.length }
    this.segments.push(meta)
    await this.trim()
    return meta
  }

  // Sliding window: drop whole fragments off the OLDEST end while the window exceeds
  // bufferDurationMs — never partial-trims a fragment (each one is the smallest unit both the disk
  // index and the renderer's SourceBuffer.remove() calls operate on), so both sides of the buffer
  // stay in exact agreement about what "the oldest available segment" is.
  private async trim(): Promise<void> {
    while (this.segments.length > 1) {
      const newest = this.segments[this.segments.length - 1]
      const oldest = this.segments[0]
      if (newest.endMs - oldest.startMs <= this.bufferDurationMs) break
      this.segments.shift()
      try {
        await rm(oldest.filePath, { force: true })
      } catch {
        /* already gone — not fatal, disk usage just doesn't shrink by this one file */
      }
    }
  }

  async getSegment(id: number): Promise<Buffer | null> {
    const meta = this.segments.find((s) => s.id === id)
    if (!meta) return null
    try {
      return await readFile(meta.filePath)
    } catch {
      return null // trimmed between the caller learning the id and fetching it — a normal race, not an error
    }
  }

  // Diagnostics/tests only — the renderer learns about new segments via the 'segment' LiveEvent
  // (see liveIngest.ts), not by polling this.
  getIndexSnapshot(): SegmentMeta[] {
    return this.segments.map((s) => ({ ...s }))
  }

  get liveEdgeMs(): number | null {
    return this.segments.length ? this.segments[this.segments.length - 1].endMs : null
  }

  get oldestMs(): number | null {
    return this.segments.length ? this.segments[0].startMs : null
  }

  get segmentCount(): number {
    return this.segments.length
  }

  // C2.1 — lets LiveSession.start() know whether a buffer it's holding onto from a previous
  // attempt is still a legitimate thing to reuse (a reconnect within the SAME logical session)
  // versus something orphaned from an earlier session that needs disposing before a genuinely
  // fresh one starts.
  get isDisposed(): boolean {
    return this.disposed
  }

  // Deletes every fragment file plus the init segment and the session directory itself — called on
  // stop()/fail() so a LIVE session never leaves temp files behind (Teste 10 in the task's own list
  // checks exactly this).
  async dispose(): Promise<void> {
    if (this.disposed) return
    this.disposed = true
    try {
      // maxRetries/retryDelay: Windows can transiently hold a just-closed file handle a few ms
      // longer than the write/read promise that used it — a bare rm() can lose that race and
      // leave the directory behind (confirmed by real testing, not assumed). These options are
      // Node's own built-in answer to exactly this class of EBUSY/ENOTEMPTY/EPERM race, not a
      // custom retry loop reinvented here.
      await rm(this.sessionDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 150 })
    } catch {
      /* best-effort — an orphaned temp dir is not a leak the running process can grow unbounded from */
    }
    this.segments.length = 0
    this.initBytes = null
  }
}
