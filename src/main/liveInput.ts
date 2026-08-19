import { LiveSession } from './liveIngest'
import { resolveYouTubeUrl, type YouTubeResolveOptions } from './youtubeResolve'
import type { LiveEvent, LiveSourceType } from '../shared/types'

// Orchestrates "which kind of input is this" on top of the existing, UNMODIFIED LiveSession
// (liveIngest.ts — not a single line of that file changes for this task). Not a parallel engine:
// RTMP hands its URL straight to LiveSession.start() exactly as Fase 1 already did; YouTube first
// resolves a real stream URL via yt-dlp (youtubeResolve.ts), then hands THAT to the exact same
// LiveSession.start() call. From the moment a usable URL exists, both paths are indistinguishable
// to LiveSession — it has no idea, and doesn't need one, whether the URL came from RTMP or was
// resolved from YouTube.
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

export async function startLiveFromInput(
  input: { sourceType: LiveSourceType; url: string },
  liveSession: LiveSession,
  emit: (event: LiveEvent) => void,
  opts: LiveInputStartOptions = {}
): Promise<void> {
  if (liveSession.isActive() || resolving) {
    throw new Error('Já existe uma sessão LIVE em curso — termina-a primeiro.')
  }

  if (input.sourceType === 'rtmp') {
    // Byte-for-byte the Fase 1 behavior — LiveSession does its own URL validation and everything
    // else exactly as before.
    await liveSession.start(input.url, { ffmpegBinOverride: opts.ffmpegBinOverride, bufferDurationMsOverride: opts.bufferDurationMsOverride })
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
  let resolvedUrl: string
  try {
    resolvedUrl = await resolveYouTubeUrl(input.url, { ytDlpBinOverride: opts.ytDlpBinOverride })
  } catch (err) {
    resolving = false
    // Mirrors LiveSession's own fail() convention exactly: once past the initial synchronous
    // guard above, operational failures are reported by emitting 'state'/'error' events, never by
    // rejecting the returned promise — LiveSession was never touched by this failure (its own
    // state, if any, is whatever it already was), so this orchestration layer is the one that has
    // to report it.
    emit({ type: 'state', state: 'error' })
    emit({ type: 'error', message: err instanceof Error ? err.message : String(err) })
    return
  }
  resolving = false
  await liveSession.start(resolvedUrl, { ffmpegBinOverride: opts.ffmpegBinOverride, bufferDurationMsOverride: opts.bufferDurationMsOverride })
}
