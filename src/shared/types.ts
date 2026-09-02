export interface Team {
  id: number
  name: string
}

export interface Player {
  id: number
  teamId: number
  name: string
  number: number | null
  position: string | null
}

export interface Match {
  id: number
  name: string
  date: string
  homeTeamId: number
  awayTeamId: number
  videoPath: string | null
  videoDurationSec: number | null
}

export interface TagCategory {
  id: number
  matchId: number
  name: string
  color: string
  shortcutKey: string | null
  isContinuous: boolean
}

export interface EventRecord {
  id: number
  matchId: number
  categoryId: number
  playerId: number | null
  teamId: number | null
  startSec: number
  endSec: number
  period: string | null
  fieldX: number | null
  fieldY: number | null
  notes: string | null
}

export interface DrawingShape {
  id: number
  eventId: number
  atSec: number
  type: 'line' | 'arrow' | 'circle' | 'polygon'
  points: number[]
  color: string
}

export interface VideoProbeResult {
  durationSec: number
  width: number
  height: number
  fps: number
  codec: string
}

export interface ExportTacticFramesRequest {
  frames: string[] // base64 PNG data (no "data:" prefix), one per animation frame, in order
  fps: number
  outputPath: string
  format: 'mp4' | 'gif'
}

// LIVE (Fase 1) — RTMP ingest via ffmpeg, Desktop/Electron only. See src/main/liveIngest.ts.
export type LiveState = 'disconnected' | 'connecting' | 'live' | 'error' | 'stopping'

// 'youtube' added for the experimental YouTube LIVE test source — see src/main/liveInput.ts. Not
// a new engine: both source types converge on the same LiveSession (liveIngest.ts, unmodified)
// once a usable stream URL exists, so this type only ever affects WHICH url ffmpeg ends up
// reading, never the states above or the ffmpeg/HTTP machinery itself.
export type LiveSourceType = 'rtmp' | 'youtube'

export interface LiveStartRequest {
  sourceType: LiveSourceType
  url: string
}

export interface LiveStreamInfo {
  width: number | null
  height: number | null
  fps: number | null
  videoCodec: string | null
  audioCodec: string | null
  // Fase LIVE 2 — the exact MSE `codecs` parameter (e.g. "avc1.64001f,mp4a.40.2"), derived from the
  // real init segment's avcC box (see src/main/mp4Boxes.ts), not guessed — ffmpeg is invoked with
  // -c:v copy, so the actual profile/level is whatever the source encoded. null until the init
  // segment has been assembled.
  mseCodecs: string | null
}

// A tagged union so the renderer can switch on `event.type` without a separate event name per
// concern — mirrors the existing video:transcodeProgress/video:exportProgress pattern (one
// channel, payload carries the specifics) rather than inventing N new IPC channels for N event
// kinds.
export type LiveEvent =
  | { type: 'state'; state: LiveState }
  | { type: 'streamInfo'; info: LiveStreamInfo }
  // Fase LIVE 2: a BASE url (e.g. http://127.0.0.1:PORT/live) — the renderer's MSE driver appends
  // /init.mp4 and /segments/:id itself. No longer a single playable <video src>.
  | { type: 'url'; url: string }
  // Fase LIVE 2 — one new fragment has been captured into the ring buffer and is now fetchable at
  // `${baseUrl}/segments/${id}`. liveEdgeMs/oldestMs are the CURRENT window bounds (both move
  // forward together as the window slides), in the same wall-clock-ms basis as startMs/endMs —
  // see the module-level comment in liveIngest.ts about why wall-clock receipt time, not PTS, is
  // this phase's timeline basis.
  | { type: 'segment'; id: number; startMs: number; endMs: number; liveEdgeMs: number; oldestMs: number }
  | { type: 'log'; line: string } // curated (throttled) diagnostic line, for an optional on-screen log — full detail always goes to the main process console regardless
  | { type: 'error'; message: string }
  // A distinct event (not just a 'log' line) for a specific reason: the app auto-reconnecting
  // without the user noticing was flagged as its own real risk — a couple of seconds of gameplay
  // can be lost across the gap, and a plain log line scrolls out of view within seconds under
  // normal ffmpeg stderr traffic (see the git history for the real test that showed exactly this).
  // The renderer keeps a persistent, visible count/timestamp from this, separate from the
  // scrolling log, so a reconnect during a 90-minute session is never silent.
  | { type: 'reconnect'; attempt: number; atMs: number }
