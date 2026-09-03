import { LiveSession } from './liveIngest'
import { resolveYouTubeUrl, type YouTubeResolveOptions, type ResolvedYouTubeStream } from './youtubeResolve'
import type { LiveEvent, LiveSourceType } from '../shared/types'
import { logLive } from './liveLog'

// Orchestrates "which kind of input is this" on top of the existing, UNMODIFIED LiveSession
// (liveIngest.ts — not a single line of that file's own ffmpeg/HTTP/buffer machinery changes for
// this task). Not a parallel engine: RTMP hands its URL straight to LiveSession.start() exactly as
// Fase 1 already did; YouTube first resolves a real stream URL via yt-dlp (youtubeResolve.ts), then
// hands THAT to the exact same LiveSession.start() call. From the moment a usable URL exists, both
// paths are indistinguishable to LiveSession — it has no idea, and doesn't need one, whether the
// URL came from RTMP or was resolved from YouTube.
//
// Kept as a plain function rather than a RTMPInput/YouTubeInput class hierarchy: the only
// per-source-type behavior is "does this need a resolution step before LiveSession.start()",
// which a single two-way branch already expresses completely. A class per source type would add
// inheritance/dispatch machinery for a fork that doesn't need it — see the task's own "não cries
// abstrações desnecessárias" instruction.
export interface LiveInputStartOptions {
  ffmpegBinOverride?: string
  ytDlpBinOverride?: YouTubeResolveOptions['ytDlpBinOverride']
  // Test-only passthrough to LiveSession.start() — lets tests use a tiny ring-buffer window
  // instead of the real 5-minute production default (see liveBuffer.ts).
  bufferDurationMsOverride?: number
}

// Guards the window BEFORE LiveSession.start() is even called — LiveSession.isActive() alone
// can't cover this, since yt-dlp resolution (a real network round-trip, up to ~25s) happens
// entirely before LiveSession knows anything is happening. Module-level rather than per-call: the
// app has exactly one LiveSession/one LIVE panel, mirroring how liveIngest.ts itself is a single
// instance per app (see ipc.ts).
let resolving = false

// Auto-reconnect supervisor state — added after real-world testing (v0.8.53) showed a 90-minute
// YouTube LIVE session needs to survive network blips and resolved-URL expiry on its own, per the
// task's own goal ("ligo no início do jogo, não toco em mais nada, marco durante 90 minutos").
// Module-level for the same reason `resolving` is — one LIVE panel, one supervised session at a
// time. Cleared by stopLiveInput() (the user's own "Parar"), so a deliberate stop is never
// second-guessed by the supervisor trying to bring the session back.
let currentInput: { sourceType: LiveSourceType; url: string } | null = null
let currentLiveSession: LiveSession | null = null
let currentEmit: ((event: LiveEvent) => void) | null = null
let currentOpts: LiveInputStartOptions = {}
let autoReconnectEnabled = false
let reconnectAttempt = 0
let reconnectTimer: ReturnType<typeof setTimeout> | null = null

// Fixed backoff rather than exponential — a LIVE session either recovers within a few seconds
// (transient network blip, or a fresh yt-dlp resolution) or it's a terminal condition
// (isTerminalError below already routes those away from ever reaching this backoff at all), so
// there's no long-tail scenario here that exponential backoff is meant to protect against. Modest
// enough to feel responsive during a real match, never tight enough to hammer anything.
const RECONNECT_BACKOFF_MS = 5000

// Errors that retrying can never fix by themselves — the user has to act (correct the URL, install
// yt-dlp, wait for a live that's genuinely over). Matched against the exact message strings
// LiveSession/youtubeResolve already throw/emit — listed here, not re-derived, so this stays in
// sync with those call sites by inspection rather than by guessing at categories.
const TERMINAL_ERROR_PATTERNS = [
  /já terminou/i, // youtubeResolve.ts: "Este LIVE já terminou."
  /não está em direto/i, // youtubeResolve.ts: video exists but isn't currently live (VOD)
  /URL do YouTube inválido/i, // youtubeResolve.ts: isValidYouTubeUrl() failed
  /yt-dlp não encontrado/i, // youtubeResolve.ts: yt-dlp missing/unspawnable
  /Falha ao arrancar o yt-dlp/i, // youtubeResolve.ts: yt-dlp spawn failed for another reason
  /URL de entrada LIVE inválido/i, // liveIngest.ts: isValidLiveInputUrl() failed
  /Não foi possível iniciar o ffmpeg/i // liveIngest.ts: ffmpeg binary missing/unspawnable
]

function isTerminalError(message: string): boolean {
  return TERMINAL_ERROR_PATTERNS.some((p) => p.test(message))
}

function clearReconnectTimer(): void {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer)
    reconnectTimer = null
  }
}

// The user's own explicit "Parar" — see ipc.ts's live:stop handler, which calls this instead of
// liveSession.stop('manual') directly. Disabling the supervisor FIRST (before stop() even runs)
// means the 'error'/'state' events stop() itself emits can never be misread as an unexpected drop
// worth reconnecting from.
export function stopLiveInput(liveSession: LiveSession): Promise<void> {
  autoReconnectEnabled = false
  clearReconnectTimer()
  currentInput = null
  return liveSession.stop('manual')
}

async function connectOnce(
  input: { sourceType: LiveSourceType; url: string },
  liveSession: LiveSession,
  emit: (event: LiveEvent) => void,
  opts: LiveInputStartOptions,
  // C2.1 — true ONLY when called from scheduleReconnect()'s retry timer (see its own call site
  // below); startLiveFromInput() (a real user "Ligar") never passes this, so a fresh manual
  // connect always gets a fresh buffer, exactly as before.
  reuseBuffer = false
): Promise<void> {
  if (input.sourceType === 'rtmp') {
    // Byte-for-byte the Fase 1 behavior — LiveSession does its own URL validation and everything
    // else exactly as before.
    await liveSession.start(input.url, { ffmpegBinOverride: opts.ffmpegBinOverride, bufferDurationMsOverride: opts.bufferDurationMsOverride, reuseBuffer })
    return
  }

  if (input.sourceType !== 'youtube') {
    throw new Error('Tipo de fonte LIVE desconhecido: ' + String(input.sourceType))
  }

  resolving = true
  // 'connecting' is accurate here too — resolving the YouTube URL genuinely IS part of
  // establishing the connection, not a separate concern the existing states can't express. No new
  // state introduced, per the task's explicit instruction.
  emit({ type: 'state', state: 'connecting' })
  emit({ type: 'log', line: 'A resolver o stream do YouTube (yt-dlp)…' })
  let resolved: ResolvedYouTubeStream
  try {
    resolved = await resolveYouTubeUrl(input.url, { ytDlpBinOverride: opts.ytDlpBinOverride })
  } catch (err) {
    resolving = false
    const message = err instanceof Error ? err.message : String(err)
    // Mirrors LiveSession's own fail() convention exactly: once past the initial synchronous
    // guard above, operational failures are reported by emitting 'state'/'error' events, never by
    // rejecting the returned promise — LiveSession was never touched by this failure (its own
    // state, if any, is whatever it already was), so this orchestration layer is the one that has
    // to report it.
    logLive('resolução YouTube falhou: ' + message)
    emit({ type: 'state', state: 'error' })
    emit({ type: 'error', message })
    return
  }
  resolving = false
  logLive(`YouTube resolvido — vídeo separado do áudio: ${resolved.audioUrl ? 'sim' : 'não'}, tem áudio: ${resolved.hasAudio}`)
  await liveSession.start(resolved.videoUrl, {
    ffmpegBinOverride: opts.ffmpegBinOverride,
    bufferDurationMsOverride: opts.bufferDurationMsOverride,
    audioUrl: resolved.audioUrl,
    noAudio: !resolved.hasAudio,
    reuseBuffer
  })
}

function scheduleReconnect(message: string): void {
  if (!autoReconnectEnabled || !currentInput || !currentLiveSession || !currentEmit) return
  clearReconnectTimer()
  reconnectAttempt += 1
  const attempt = reconnectAttempt
  const line = `A ligação caiu (${message}) — a tentar reconectar automaticamente em ${RECONNECT_BACKOFF_MS / 1000}s (tentativa ${attempt})…`
  logLive('reconnect: ' + line)
  currentEmit({ type: 'log', line })
  const input = currentInput
  const liveSession = currentLiveSession
  const emit = currentEmit
  const opts = currentOpts
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null
    if (!autoReconnectEnabled) return // stopLiveInput() ran while this was pending
    logLive(`reconnect: tentativa ${attempt} — a ligar de novo`)
    // Distinct from the 'log' line above (see LiveEvent's own comment) — emitted right as the
    // retry actually starts, not merely when it was scheduled, so the timestamp is the moment
    // that matters for correlating with what was being tagged at the time.
    emit({ type: 'reconnect', attempt, atMs: Date.now() })
    // reuseBuffer=true — the whole point of C2.1: an auto-reconnect keeps whatever's already in
    // the ring buffer from before the drop, instead of LiveSession.start() creating a fresh one.
    connectOnce(input, liveSession, emit, opts, true).catch((err) => {
      const msg = err instanceof Error ? err.message : String(err)
      logLive('reconnect: tentativa ' + attempt + ' falhou ao arrancar: ' + msg)
      emit({ type: 'state', state: 'error' })
      emit({ type: 'error', message: msg })
    })
  }, RECONNECT_BACKOFF_MS)
}

// Wraps the renderer-facing emit ONCE, at LiveSession construction time (see ipc.ts) — NOT per
// connect call. Real bug found by this task's own testing, not by inspection: LiveSession stores
// whatever emit its constructor received and uses THAT internally for every event it emits itself
// (state transitions, fail() when ffmpeg dies mid-session, segments, everything) — a wrapper built
// fresh inside startLiveFromInput() and handed only to connectOnce() would catch a YouTube
// resolution failure (which calls the passed-in emit directly), but would never see an error
// LiveSession raises on its own, which is the far more common real case (a stream actually
// dropping mid-session). Constructing the wrapper here and passing it INTO `new LiveSession(...)`
// as its one and only emit means every event, from anywhere, always passes through this same
// supervision point.
export function createSupervisedLiveEmit(rawEmit: (event: LiveEvent) => void): (event: LiveEvent) => void {
  return (event: LiveEvent): void => {
    rawEmit(event)
    if (event.type === 'error') {
      if (isTerminalError(event.message)) {
        autoReconnectEnabled = false
        logLive('reconnect: erro terminal, não vou tentar reconectar — ' + event.message)
      } else {
        scheduleReconnect(event.message)
      }
    }
  }
}

export async function startLiveFromInput(
  input: { sourceType: LiveSourceType; url: string },
  liveSession: LiveSession,
  emit: (event: LiveEvent) => void,
  opts: LiveInputStartOptions = {}
): Promise<void> {
  if (liveSession.isActive() || resolving) {
    throw new Error('Já existe uma sessão LIVE em curso — termina-a primeiro.')
  }

  currentInput = input
  currentLiveSession = liveSession
  currentEmit = emit
  currentOpts = opts
  autoReconnectEnabled = true
  reconnectAttempt = 0

  // Emitted exactly once per logical session, HERE (the one call site that's a real user "Ligar",
  // never an internal reconnect — scheduleReconnect() calls connectOnce() directly, bypassing this
  // function entirely) — see LiveEvent's own comment for why this has to be a wall-clock anchor
  // the renderer keeps across every reconnect, not something re-sent per attempt.
  const sessionEpochMs = Date.now()
  logLive('sessão lógica a iniciar — sessionEpochMs=' + sessionEpochMs)
  emit({ type: 'sessionEpoch', epochMs: sessionEpochMs })

  await connectOnce(input, liveSession, emit, opts)
}
