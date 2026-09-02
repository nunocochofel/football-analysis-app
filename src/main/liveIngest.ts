import { spawn, type ChildProcess } from 'child_process'
import * as http from 'http'
import { tmpdir } from 'os'
import { join } from 'path'
import type { AddressInfo } from 'net'
import ffmpegPathRaw from 'ffmpeg-static'
import { LiveBuffer, DEFAULT_BUFFER_DURATION_MS } from './liveBuffer'
import { Mp4BoxSplitter, extractAvcCodecString, type Mp4Box } from './mp4Boxes'
import type { LiveEvent, LiveState, LiveStreamInfo } from '../shared/types'
import { logLive } from './liveLog'

// Same fix as src/main/ffmpeg.ts (kept duplicated rather than imported from there — see the
// "NÃO refatores componentes existentes" constraint for this phase: importing from ffmpeg.ts
// would create a coupling between the export engine and the live-ingest module for a two-line
// helper, for no real benefit).
function unpackAsarPath(p: string): string {
  return p.replace('app.asar', 'app.asar.unpacked')
}
const DEFAULT_FFMPEG_PATH = unpackAsarPath(ffmpegPathRaw as unknown as string)

// No HTTP client connected within this long after ffmpeg confirms a real stream is arriving ->
// treat the session as failed and tear it down, rather than leaving an ffmpeg process running
// forever with its stdout pipe never drained (the OS pipe buffer would fill and ffmpeg would just
// block writing — not a leak exactly, but a stuck, silently-doing-nothing process).
const CONNECT_TIMEOUT_MS = 15000
// Fase LIVE 2 original design: re-armed on every successful segment fetch, treating "nobody
// fetched ANY segment in 20s" as abandonment. Real-world testing (v0.8.53, a genuine YouTube LIVE
// HLS source, not RTMP) showed this firing 20-40s into perfectly healthy sessions — tagging and
// export both worked, the player never actually stopped. Root cause: ffmpeg reading an HLS
// manifest has a real "catch up to the live edge, then throttle to real-time pacing" phase at
// connect time that a continuously-pushed RTMP/MPEG-TS stream never has — one legitimate pause in
// fragment production early in a session, which 20s was too tight to absorb. This was the actual
// cause, not the segment-serve mechanism itself misfiring — see the git history for the fuller
// diagnosis (no code speculatively "fixed" without first finding the real trigger).
//
// Two changes: (1) the window is now driven primarily by an independent renderer heartbeat (see
// heartbeat() below) — segment-serving success still re-arms it too, but a genuinely present
// renderer re-arms it regardless of whether ffmpeg happens to be between fragments right now,
// which is what "is anyone actually watching" should mean. Closing the app window is ALREADY
// handled deterministically and immediately via 'before-quit' (see index.ts) — this timeout only
// ever has to catch a frozen/crashed renderer that never closes the window, a genuinely rare case
// that deserves a generous window, not a tight one. (2) the timeout itself is minutes, not
// seconds — tied to DEFAULT_BUFFER_DURATION_MS: if NEITHER a heartbeat NOR a served segment has
// happened in as long as the entire ring buffer window, the buffer would have fully cycled with
// zero consumption regardless — a far stronger abandonment signal than a short fixed number ever
// was.
//
// LINHA_LIVE_DISABLE_LIVENESS_WATCHDOG=1 (env var) disables this timeout entirely — an escape
// hatch for a long manual test session while this fix is still being validated in practice, not
// meant to ship as a normal user-facing setting.
const LIVENESS_TIMEOUT_MS = DEFAULT_BUFFER_DURATION_MS
// After SIGTERM, how long to wait before escalating to SIGKILL — ffmpeg normally exits within a
// few hundred ms of SIGTERM, this is just a safety net against a wedged process.
const KILL_ESCALATION_MS = 3000
// Diagnostic ffmpeg stderr lines are ALWAYS logged in full to the main-process console (visible
// via `npm run dev`/DevTools of the main process) — this throttle only limits what additionally
// gets pushed to the renderer as a 'log' event, per the "evita spam contínuo desnecessário"
// requirement.
const RENDERER_LOG_THROTTLE_MS = 2000

const RTMP_URL_PATTERN = /^rtmps?:\/\/\S+$/i
// http(s):// accepted too — start() is also the convergence point for a source that needed a
// resolution step first (YouTube LIVE via yt-dlp, see liveInput.ts/youtubeResolve.ts: yt-dlp
// resolves a youtube.com link into a real HLS manifest URL, which is what actually reaches this
// function). isValidRtmpUrl() itself stays exactly as it was — untouched, still RTMP-only, still
// exported with its original meaning intact for anything that specifically needs an RTMP check —
// this is a second, separate function precisely so nothing about it changes.
const LIVE_INPUT_URL_PATTERN = /^(rtmps?|https?):\/\/\S+$/i

export function isValidRtmpUrl(url: string): boolean {
  if (typeof url !== 'string') return false
  const trimmed = url.trim()
  return RTMP_URL_PATTERN.test(trimmed) && !/\s/.test(trimmed)
}

function isValidLiveInputUrl(url: string): boolean {
  if (typeof url !== 'string') return false
  const trimmed = url.trim()
  return LIVE_INPUT_URL_PATTERN.test(trimmed) && !/\s/.test(trimmed)
}

export interface LiveSessionStartOptions {
  // Test-only: lets tests point at a deliberately-broken "ffmpeg" (e.g. a nonexistent path, or a
  // tiny script that exits immediately) to exercise the "ffmpeg missing/unspawnable" error path
  // without touching the real bundled binary used in production.
  ffmpegBinOverride?: string
  // Test-only: lets tests use a tiny window (e.g. a few seconds) to actually exercise ring-buffer
  // trimming quickly, instead of waiting out the real 5-minute production default.
  bufferDurationMsOverride?: number
  // YouTube LIVE only (see liveInput.ts) — RTMP never sets these, a single RTMP connection always
  // already carries both. audioUrl: a SEPARATE audio-only URL to mux in via a second ffmpeg -i
  // (YouTube LIVE never offers a single pre-muxed format — see youtubeResolve.ts's own comment for
  // how this was confirmed, not assumed). noAudio: the resolved format genuinely has no audio
  // anywhere — ffmpeg gets -an instead of being told to encode a track that doesn't exist, which
  // is what silently produced zero output for two real minutes before this was found.
  audioUrl?: string | null
  noAudio?: boolean
}

// Fase LIVE 2 — RTMP/YouTube ingest via ffmpeg, remuxed into fMP4, split into independently
// storable/servable fragments (see mp4Boxes.ts), held in a disk-backed sliding-window ring buffer
// (see liveBuffer.ts), and served to the renderer's MediaSource/SourceBuffer over a local,
// loopback-only HTTP server — instead of Fase 1's single infinite pipe to one HTTP client, which
// had nothing to rewind into (see the module-level audit that preceded this rewrite). Still one
// session at a time (reconnect-with-continuity across a NEW start() is still out of scope — a
// fresh start() always begins a fresh buffer, same as Fase 1 began a fresh pipe).
export class LiveSession {
  private proc: ChildProcess | null = null
  private server: http.Server | null = null
  private state: LiveState = 'disconnected'
  private connectTimeoutId: ReturnType<typeof setTimeout> | null = null
  private livenessTimeoutId: ReturnType<typeof setTimeout> | null = null
  private streamDetected = false
  private firstSegmentServed = false
  private intentionalStop = false
  private stderrCarry = ''
  private lastRendererLogMs = 0
  private streamInfo: LiveStreamInfo = { width: null, height: null, fps: null, videoCodec: null, audioCodec: null, mseCodecs: null }
  // Bumped on every start()/stop() — lets async work belonging to a PREVIOUS attempt recognize
  // it's been superseded and bail out instead of mutating state for the wrong session. Real bug
  // this fixes (found by this module's own tests, not by inspection): the local HTTP server binds
  // asynchronously (server.listen()'s callback), which takes a moment — if ffmpeg's connection
  // fails FAST (a refused connection can resolve in well under that time), fail() can run and
  // move the session to 'error' BEFORE the server finishes binding. Without this guard, the
  // now-irrelevant server would still get assigned to this.server once its listen() callback
  // eventually fired, leaking an open server no one would ever close — and on a subsequent
  // start(), that stale assignment could clobber the NEW session's own server reference,
  // producing exactly the kind of hard-to-reproduce "reconnect after an error sometimes gets
  // wedged" symptom this was caught chasing down.
  private generation = 0

  // fMP4 box-splitting state — a fresh Mp4BoxSplitter + pending-moof slot per start(), matching a
  // fresh LiveBuffer. writeQueue serializes the (async, disk-writing) box handling so fragments are
  // stored in arrival order even though Node's stdout 'data' events themselves are synchronous —
  // without this, two overlapping addFragment() disk writes could interleave or reorder.
  private boxSplitter: Mp4BoxSplitter | null = null
  private liveBuffer: LiveBuffer | null = null
  private pendingInitBoxes: Mp4Box[] = []
  private pendingMoof: Mp4Box | null = null
  private initReady = false
  private writeQueue: Promise<void> = Promise.resolve()

  constructor(private readonly emit: (event: LiveEvent) => void) {}

  getState(): LiveState {
    return this.state
  }
  // "Active" means genuinely occupied — a fresh start() would step on an in-flight session.
  // 'error' and 'disconnected' are both TERMINAL states a new start() should be free to leave
  // behind without any separate "clear/reset" step first: if a connection attempt just failed,
  // the natural next thing the user does is try again (possibly with a corrected URL), not hunt
  // for a reset button. (A real bug caught by this module's own tests: isActive() originally
  // treated 'error' as active too, which made a fresh start() after any failure throw "já existe
  // uma sessão em curso" — permanently wedging the panel until the app was restarted.)
  isActive(): boolean {
    return this.state === 'connecting' || this.state === 'live' || this.state === 'stopping'
  }

  // Diagnostics/tests only — lets a test (or a future buffer-state UI) inspect what's actually in
  // the ring buffer right now without threading a getter through every call site.
  getBufferSnapshot(): { segmentCount: number; liveEdgeMs: number | null; oldestMs: number | null } {
    return {
      segmentCount: this.liveBuffer?.segmentCount ?? 0,
      liveEdgeMs: this.liveBuffer?.liveEdgeMs ?? null,
      oldestMs: this.liveBuffer?.oldestMs ?? null
    }
  }

  // Fase LIVE 3 — the one new seam clip export needs: read-only access to the CURRENT session's
  // buffer (null outside an active session, e.g. after stop()/fail()). Deliberately just a getter,
  // not a new responsibility on LiveSession itself — see src/main/liveClip.ts, which does the
  // actual segment-gathering/export work against the returned LiveBuffer directly, exactly as the
  // task's own architecture diagram intends (Clip Engine reads from Buffer, not through LiveSession).
  getLiveBuffer(): LiveBuffer | null {
    return this.liveBuffer
  }

  async start(rtmpUrl: string, opts: LiveSessionStartOptions = {}): Promise<void> {
    if (this.isActive()) {
      throw new Error('Já existe uma sessão LIVE em curso — termina-a primeiro.')
    }
    if (!isValidLiveInputUrl(rtmpUrl)) {
      throw new Error('URL de entrada LIVE inválido — tem de ser rtmp://, rtmps://, http:// ou https://, sem espaços.')
    }
    const myGeneration = ++this.generation
    this.streamDetected = false
    this.firstSegmentServed = false
    this.intentionalStop = false
    this.stderrCarry = ''
    this.streamInfo = { width: null, height: null, fps: null, videoCodec: null, audioCodec: null, mseCodecs: null }
    this.boxSplitter = new Mp4BoxSplitter()
    this.pendingInitBoxes = []
    this.pendingMoof = null
    this.initReady = false
    this.writeQueue = Promise.resolve()
    this.setState('connecting')

    const sessionDir = join(tmpdir(), 'linha-live', `${myGeneration}-${Date.now()}`)
    const liveBuffer = new LiveBuffer(sessionDir, opts.bufferDurationMsOverride ?? DEFAULT_BUFFER_DURATION_MS)
    try {
      await liveBuffer.init()
    } catch (err) {
      if (myGeneration === this.generation) {
        this.fail('Não foi possível preparar o buffer temporal: ' + (err instanceof Error ? err.message : String(err)))
      }
      return
    }
    if (myGeneration !== this.generation) return // superseded while the temp dir was being created
    this.liveBuffer = liveBuffer

    const ffmpegBin = opts.ffmpegBinOverride || DEFAULT_FFMPEG_PATH
    // -c:v copy: remux only, no re-encode — lowest latency/CPU, and correct as long as the source
    // is already H.264 (true for Veo Live and virtually every RTMP encoder in practice, and for
    // every YouTube LIVE format observed — see youtubeResolve.ts).
    //
    // -reconnect/-reconnect_streamed/-reconnect_delay_max/-rw_timeout: HTTP(S)-protocol AVOptions
    // (apply when rtmpUrl is actually http(s)://, e.g. a resolved YouTube LIVE HLS manifest — RTMP
    // proper reuses this same start() unmodified and simply ignores options its own protocol
    // handler doesn't recognize, confirmed against a real rtmp:// URL: no warning, no rejection).
    // rw_timeout is in MICROSECONDS (ffmpeg's own unit for this option, not ms) — 15s, matching
    // CONNECT_TIMEOUT_MS's own generosity for a stalled read. reconnect_delay_max caps the gap
    // between automatic reconnect attempts ffmpeg makes internally, at the network layer —
    // separate from and beneath the session-level auto-reconnect in liveInput.ts, which
    // re-resolves a fresh URL entirely once ffmpeg itself gives up and exits.
    //
    // -reconnect_at_eof is DELIBERATELY NOT included, after real testing (v0.8.54) found it's what
    // actually caused a whole real YouTube LIVE session to serve zero segments for two straight
    // minutes — confirmed directly, not guessed: ran ffmpeg by hand against the exact two real HLS
    // URLs (video-only + audio-only) that session resolved, with vs. without this one flag.
    // With it: 0 bytes of output, stderr looping through the SAME manifest lines twice over
    // ("Will reconnect... error=End of file", then the identical #EXT-X-DATERANGE entries again
    // from the start). Without it: real, healthy output within seconds. A polled-playlist live HLS
    // source reaches "EOF" on its currently-known segment list constantly, by design, as a normal
    // part of how live HLS works — ffmpeg's own HLS demuxer already re-polls for new segments on
    // its own; -reconnect_at_eof instead makes the underlying HTTP layer treat that completely
    // normal condition as a dropped connection needing a protocol-level reconnect, which re-fetched
    // stale playlist state instead of ever advancing to genuinely new segments.
    const RECONNECT_FLAGS = ['-reconnect', '1', '-reconnect_streamed', '1', '-reconnect_delay_max', '30', '-rw_timeout', '15000000']
    const args = ['-loglevel', 'info', ...RECONNECT_FLAGS, '-i', rtmpUrl]
    // YouTube LIVE only (opts.audioUrl set — see liveInput.ts/youtubeResolve.ts): a second -i for
    // the separate audio-only stream, with explicit -map so ffmpeg knows to combine them (with a
    // single -i, no -map is needed at all — ffmpeg includes every stream from the one input by
    // default, which is why the RTMP path below stays exactly as it always was).
    if (opts.audioUrl) {
      args.push(...RECONNECT_FLAGS, '-i', opts.audioUrl, '-map', '0:v:0', '-map', '1:a:0')
    } else if (opts.noAudio) {
      args.push('-map', '0:v:0')
    }
    args.push('-c:v', 'copy')
    // -c:a aac: audio re-encoded rather than copied — negligible CPU cost, but safe against the
    // few sources that carry a codec MP4/Chromium can't play, without the video-side latency cost
    // a defensive video re-encode would add. -an (no audio output at all) only when the resolved
    // format genuinely has none — see LiveSessionStartOptions' own comment for the real session
    // this fixes: asking ffmpeg to encode -c:a aac from an input with no audio track at all
    // produced zero output, silently, for a full two-minute test.
    if (opts.noAudio) {
      args.push('-an')
    } else {
      args.push('-c:a', 'aac', '-b:a', '128k')
    }
    // frag_keyframe+empty_moov+default_base_moof: fragmented MP4, one moof+mdat pair per keyframe
    // — exactly the ftyp/moov-once-then-moof/mdat* shape mp4Boxes.ts expects to split into an init
    // segment plus a stream of independently storable fragments (see the box-handling loop below).
    args.push('-f', 'mp4', '-movflags', 'frag_keyframe+empty_moov+default_base_moof', 'pipe:1')
    console.log('[live] a iniciar ffmpeg:', ffmpegBin, args.join(' '))
    logLive(`sessão a iniciar — ffmpeg ${ffmpegBin} ${args.join(' ')}`)

    let proc: ChildProcess
    try {
      // No shell involved (spawn without shell:true never invokes one) — the RTMP URL, however
      // untrusted, is passed as one argv element among many, never concatenated into a command
      // string, so there is no shell-injection surface here regardless of its contents.
      proc = spawn(ffmpegBin, args, { windowsHide: true })
    } catch (err) {
      this.fail('Não foi possível iniciar o ffmpeg: ' + (err instanceof Error ? err.message : String(err)))
      return
    }
    this.proc = proc

    // Unlike Fase 1, stdout is consumed immediately (never paused) — the ring buffer is meant to
    // start filling as soon as real data exists, independent of whether a renderer has connected
    // yet; that independence is the whole point of a buffer.
    proc.stdout?.on('data', (chunk: Buffer) => {
      if (myGeneration !== this.generation || !this.boxSplitter) return
      const boxes = this.boxSplitter.push(chunk)
      if (boxes.length === 0) return
      this.writeQueue = this.writeQueue.then(() => this.handleBoxes(boxes, myGeneration)).catch((err) => {
        console.error('[live] erro a processar fragmentos fMP4:', err)
      })
    })

    proc.on('error', (err) => {
      if (myGeneration !== this.generation) return // superseded by a later start()/stop() — ignore
      // Typically ENOENT (binary not found/not executable) — the one case that can fire instead
      // of (never in addition to) the 'close' handler below.
      this.fail('Falha ao arrancar o ffmpeg: ' + err.message)
    })
    proc.stderr?.on('data', (chunk: Buffer) => {
      if (myGeneration !== this.generation) return
      this.handleStderr(chunk.toString('utf8'), myGeneration)
    })
    proc.on('close', (code, signal) => {
      if (this.proc === proc) this.proc = null
      console.log(`[live] ffmpeg terminou (code=${String(code)} signal=${String(signal)} intentional=${this.intentionalStop})`)
      if (myGeneration !== this.generation) return // superseded — its own start()/stop() already handled the resulting state
      if (this.intentionalStop) {
        // stop() already decided the resulting state and tore down the server — nothing more to do.
        return
      }
      this.fail(
        code
          ? `O ffmpeg terminou inesperadamente (código ${String(code)}). Verifica se o URL RTMP está correto e se o emissor está mesmo a transmitir.`
          : 'A ligação ao RTMP foi perdida.'
      )
    })

    try {
      await this.startServer(myGeneration)
    } catch (err) {
      if (myGeneration === this.generation) {
        this.fail('Não foi possível iniciar o servidor local: ' + (err instanceof Error ? err.message : String(err)))
      }
    }
  }

  // reason distinguishes a deliberate user "Parar" (→ disconnected, no error) from the player
  // going idle/away unexpectedly (→ error, since reconnect-with-continuity is still out of scope
  // — see the class-level comment).
  async stop(reason: 'manual' | 'client-disconnected' = 'manual'): Promise<void> {
    if (this.state === 'disconnected') return
    logLive(`stop() chamado — motivo: ${reason}`)
    this.generation++ // invalidates any still-in-flight callbacks/promises from this attempt
    this.intentionalStop = true
    this.clearTimers()
    if (reason === 'manual') this.setState('stopping')
    const proc = this.proc
    this.proc = null
    if (proc) {
      proc.kill('SIGTERM')
      const killTimer = setTimeout(() => {
        try {
          proc.kill('SIGKILL')
        } catch {
          /* already gone */
        }
      }, KILL_ESCALATION_MS)
      proc.once('close', () => clearTimeout(killTimer))
    }
    this.teardownServer()
    const buffer = this.liveBuffer
    this.liveBuffer = null
    if (buffer) await buffer.dispose()
    if (reason === 'client-disconnected') {
      this.fail('O player deixou de pedir dados do LIVE — a sessão foi terminada. Liga novamente para retomar.')
    } else {
      this.setState('disconnected')
    }
  }

  private clearTimers(): void {
    if (this.connectTimeoutId) {
      clearTimeout(this.connectTimeoutId)
      this.connectTimeoutId = null
    }
    if (this.livenessTimeoutId) {
      clearTimeout(this.livenessTimeoutId)
      this.livenessTimeoutId = null
    }
  }

  // Walks the boxes found in one stdout chunk, in order, assembling: (1) the one-time init segment
  // (ftyp+moov), and (2) a stream of fragments (moof+mdat pairs). Runs serialized through
  // writeQueue (see the field comment) so disk writes never interleave.
  private async handleBoxes(boxes: Mp4Box[], myGeneration: number): Promise<void> {
    for (const box of boxes) {
      if (myGeneration !== this.generation || !this.liveBuffer) return
      if (!this.initReady) {
        if (box.type === 'ftyp' || box.type === 'moov' || box.type === 'free' || box.type === 'styp') {
          this.pendingInitBoxes.push(box)
        } else {
          // Unexpected box before the init segment is complete — log and skip rather than crash;
          // a malformed/unusual muxer output shouldn't take down the whole session.
          console.warn('[live] box inesperada antes do init segment:', box.type)
          continue
        }
        if (box.type === 'moov') {
          const initBytes = Buffer.concat(this.pendingInitBoxes.map((b) => b.bytes))
          this.pendingInitBoxes = []
          this.initReady = true
          await this.liveBuffer.setInitSegment(initBytes)
          if (myGeneration !== this.generation) return
          const videoCodec = extractAvcCodecString(initBytes)
          this.streamInfo.mseCodecs = `${videoCodec},mp4a.40.2` // mp4a.40.2 = AAC-LC, ffmpeg's default -c:a aac profile
          this.emit({ type: 'streamInfo', info: { ...this.streamInfo } })
          this.emitLiveUrl()
          this.armConnectTimeout(myGeneration)
        }
        continue
      }
      if (box.type === 'moof') {
        if (this.pendingMoof) {
          console.warn('[live] moof órfão (sem mdat correspondente) descartado')
        }
        this.pendingMoof = box
        continue
      }
      if (box.type === 'mdat' && this.pendingMoof) {
        const fragmentBytes = Buffer.concat([this.pendingMoof.bytes, box.bytes])
        this.pendingMoof = null
        const meta = await this.liveBuffer.addFragment(fragmentBytes, Date.now())
        if (myGeneration !== this.generation) return
        this.emit({
          type: 'segment',
          id: meta.id,
          startMs: meta.startMs,
          endMs: meta.endMs,
          liveEdgeMs: this.liveBuffer.liveEdgeMs ?? meta.endMs,
          oldestMs: this.liveBuffer.oldestMs ?? meta.startMs
        })
      }
      // any other box type (e.g. a stray 'free') once initReady is simply ignored — not every
      // muxer output is exactly ftyp,moov,(moof,mdat)* with nothing else interleaved, and none of
      // those extras carry media data this phase needs.
    }
  }

  private async startServer(myGeneration: number): Promise<void> {
    const server = http.createServer((req, res) => {
      if (myGeneration !== this.generation || !this.liveBuffer) {
        res.writeHead(410)
        res.end()
        return
      }
      if (req.method !== 'GET' || !req.url) {
        res.writeHead(405)
        res.end()
        return
      }
      void this.handleHttpRequest(req.url, res, myGeneration)
    })
    server.on('error', (err) => {
      if (myGeneration === this.generation) this.fail('Erro no servidor local: ' + err.message)
    })
    await new Promise<void>((resolve, reject) => {
      server.listen(0, '127.0.0.1', () => resolve())
      server.once('error', reject)
    })
    if (myGeneration !== this.generation) {
      // Superseded while the server was still binding (see the `generation` field's comment) —
      // this attempt is already over, don't leave this server referenced/dangling, close it now.
      try {
        server.close()
      } catch {
        /* already closed */
      }
      return
    }
    this.server = server
  }

  // Two resources, deliberately simple routing (no framework needed for two paths):
  //   GET /live/init.mp4        — the ftyp+moov init segment, fetched once by the renderer's MSE
  //                                driver before it can append anything else.
  //   GET /live/segments/:id    — one fragment (moof+mdat), fetched once per 'segment' LiveEvent.
  // Multiple concurrent requests are completely normal now (unlike Fase 1's one-consumer pipe) —
  // each is just a small, independent buffer read.
  private async handleHttpRequest(url: string, res: http.ServerResponse, myGeneration: number): Promise<void> {
    const buffer = this.liveBuffer
    if (!buffer) {
      res.writeHead(503)
      res.end()
      return
    }
    if (url === '/live/init.mp4') {
      const bytes = buffer.getInitSegment()
      if (!bytes) {
        res.writeHead(503, { 'Content-Type': 'text/plain' })
        res.end('Init segment ainda não está pronto.')
        return
      }
      res.writeHead(200, { 'Content-Type': 'video/mp4', 'Cache-Control': 'no-store' })
      res.end(bytes)
      return
    }
    const segMatch = url.match(/^\/live\/segments\/(\d+)$/)
    if (segMatch) {
      const id = Number(segMatch[1])
      const bytes = await buffer.getSegment(id)
      if (myGeneration !== this.generation) {
        res.writeHead(410)
        res.end()
        return
      }
      if (!bytes) {
        res.writeHead(404, { 'Content-Type': 'text/plain' })
        res.end('Segmento já saiu da janela de buffer.')
        return
      }
      res.writeHead(200, { 'Content-Type': 'video/mp4', 'Cache-Control': 'no-store' })
      res.end(bytes)
      this.onSegmentServed(myGeneration, id)
      return
    }
    res.writeHead(404)
    res.end()
  }

  // First successful segment fetch = a real consumer is now actually receiving media — the direct
  // equivalent of Fase 1's "the one HTTP client connected" trigger for the 'live' state, just
  // moved to the segment level. Every fetch after that re-arms the liveness watchdog (see the
  // LIVENESS_TIMEOUT_MS constant).
  //
  // Logged individually (id + timestamp), not just counted — per a real request after the v0.8.53
  // test: a long real session needs to be diagnosable from the log file alone, after the fact, no
  // screenshots. At real-world fragment cadence (one per keyframe, typically every few seconds)
  // this is at most a few thousand short lines over 90 minutes — negligible on disk, and exactly
  // what "did segments stop arriving before minute 40, or did the heartbeat stop instead" needs.
  private onSegmentServed(myGeneration: number, id: number): void {
    if (myGeneration !== this.generation) return
    if (!this.firstSegmentServed) {
      this.firstSegmentServed = true
      if (this.connectTimeoutId) {
        clearTimeout(this.connectTimeoutId)
        this.connectTimeoutId = null
      }
      console.log('[live] primeiro segmento servido — sessão LIVE confirmada')
      this.setState('live')
    }
    logLive(`segmento ${id} servido — watchdog reiniciado`)
    this.armLivenessTimeout(myGeneration)
  }

  private armLivenessTimeout(myGeneration: number): void {
    if (this.livenessTimeoutId) clearTimeout(this.livenessTimeoutId)
    if (process.env.LINHA_LIVE_DISABLE_LIVENESS_WATCHDOG === '1') return
    this.livenessTimeoutId = setTimeout(() => {
      if (myGeneration !== this.generation) return
      const msg = `watchdog: sem heartbeat nem segmentos servidos há ${LIVENESS_TIMEOUT_MS}ms — a terminar a sessão`
      console.log('[live] ' + msg)
      logLive(msg)
      void this.stop('client-disconnected')
    }, LIVENESS_TIMEOUT_MS)
  }

  // Called periodically by the renderer (see window.api.liveHeartbeat / live:heartbeat) purely to
  // say "a window with the LIVE panel open still exists" — independent of whether ffmpeg happens
  // to be between fragments right now (see the LIVENESS_TIMEOUT_MS comment for why segment cadence
  // alone was an unreliable signal). Deliberately does NOT touch firstSegmentServed/state — "the
  // renderer is present" and "media is actually flowing" are two different signals, kept separate.
  // A no-op before a session exists or after one has ended (state check), so a stray/late
  // heartbeat from a just-closed session can never resurrect a stale timer.
  heartbeat(): void {
    if (this.state !== 'connecting' && this.state !== 'live') return
    logLive('heartbeat recebido — watchdog reiniciado')
    this.armLivenessTimeout(this.generation)
  }

  private teardownServer(): void {
    if (this.server) {
      try {
        this.server.close()
      } catch {
        /* already closed */
      }
      this.server = null
    }
    this.firstSegmentServed = false
  }

  // myGeneration threads through this whole call chain (handleStderr -> tryDetectStream) purely so
  // any timer/promise this schedules can capture the value that was current when the STREAM
  // DETECTION happened — by the time an async continuation actually runs, a completely different
  // start()/stop() may have happened, and without this a stale callback could wrongly mutate a
  // NEWER, unrelated session.
  private handleStderr(chunk: string, myGeneration: number): void {
    this.stderrCarry += chunk
    const lines = this.stderrCarry.split('\n')
    this.stderrCarry = lines.pop() || '' // keep the trailing partial line for the next chunk
    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed) continue
      console.log('[live][ffmpeg]', trimmed)
      // Every line, unthrottled — found the hard way (v0.8.54, a real YouTube session that served
      // zero segments for two minutes straight): only console.log'ing this meant the actual reason
      // ffmpeg wasn't producing output existed ONLY in a packaged app's invisible main-process
      // console, never in the one place that could actually be read back afterward. The throttled
      // renderer 'log' event right below is a DIFFERENT, deliberately sparse concern (avoid
      // spamming the on-screen panel) — this file has no such constraint.
      logLive('ffmpeg: ' + trimmed)
      this.maybeEmitThrottledLog(trimmed)
      if (!this.streamDetected) this.tryDetectStream(trimmed)
    }
  }

  // ffmpeg's own startup banner prints the detected input streams, e.g.:
  //   Stream #0:0: Video: h264 (High), yuv420p(progressive), 1280x720, 30 fps, 30 tbr, 1k tbn
  //   Stream #0:1: Audio: aac (LC), 44100 Hz, stereo, fltp, 128 kb/s
  // Seeing the Video line confirms ffmpeg connected AND real media is arriving (as opposed to just
  // having attempted the RTMP handshake). The precise MSE codec string is derived separately, from
  // the actual init segment bytes once assembled (see handleBoxes) — this banner only gives
  // human-readable labels for the on-screen stream info display.
  private tryDetectStream(line: string): void {
    const videoMatch = line.match(/Stream #0:\d+.*?: Video: (\S+?)[,\s].*?(\d{2,5})x(\d{2,5})/)
    const audioMatch = line.match(/Stream #0:\d+.*?: Audio: (\S+?)[,\s]/)
    const fpsMatch = line.match(/(\d+(?:\.\d+)?)\s*fps/)
    if (videoMatch) {
      this.streamInfo.videoCodec = videoMatch[1]
      this.streamInfo.width = Number(videoMatch[2])
      this.streamInfo.height = Number(videoMatch[3])
    }
    if (fpsMatch) this.streamInfo.fps = Number(fpsMatch[1])
    if (audioMatch) this.streamInfo.audioCodec = audioMatch[1]
    if (videoMatch && !this.streamDetected) {
      this.streamDetected = true
      console.log('[live] stream detetado:', JSON.stringify(this.streamInfo))
      this.emit({ type: 'streamInfo', info: { ...this.streamInfo } })
    }
  }

  private armConnectTimeout(myGeneration: number): void {
    if (this.connectTimeoutId) clearTimeout(this.connectTimeoutId)
    this.connectTimeoutId = setTimeout(() => {
      if (myGeneration !== this.generation) return // this session has already ended one way or another — nothing to time out
      if (!this.firstSegmentServed) {
        this.fail('Nenhuma ligação de vídeo foi estabelecida a tempo depois de o stream ter sido detetado.')
      }
    }, CONNECT_TIMEOUT_MS)
  }

  private emitLiveUrl(): void {
    const addr = this.server?.address() as AddressInfo | null
    if (!addr) {
      this.fail('Servidor local não está pronto para aceitar ligações.')
      return
    }
    // A BASE url now, not a single playable resource — the renderer's MSE driver appends
    // /init.mp4 and /segments/:id itself (see loadLiveMse in resources/linha/index.html).
    this.emit({ type: 'url', url: `http://127.0.0.1:${addr.port}/live` })
  }

  private maybeEmitThrottledLog(line: string): void {
    const now = Date.now()
    if (now - this.lastRendererLogMs < RENDERER_LOG_THROTTLE_MS) return
    this.lastRendererLogMs = now
    this.emit({ type: 'log', line })
  }

  private setState(state: LiveState): void {
    this.state = state
    logLive(`estado -> ${state}`)
    this.emit({ type: 'state', state })
  }

  private fail(message: string): void {
    console.error('[live] erro:', message)
    logLive('erro: ' + message)
    this.intentionalStop = false
    this.clearTimers()
    this.teardownServer()
    const buffer = this.liveBuffer
    this.liveBuffer = null
    if (buffer) void buffer.dispose() // fire-and-forget — fail() is called from sync contexts and can't easily become async; dispose() already swallows its own errors
    this.setState('error')
    this.emit({ type: 'error', message })
  }
}
