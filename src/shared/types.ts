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

export interface ExportClipRequest {
  matchVideoPath: string
  segments: { startSec: number; endSec: number }[]
  outputPath: string
}

export interface ExportTacticFramesRequest {
  frames: string[] // base64 PNG data (no "data:" prefix), one per animation frame, in order
  fps: number
  outputPath: string
  format: 'mp4' | 'gif'
}
