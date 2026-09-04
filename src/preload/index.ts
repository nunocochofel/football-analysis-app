import { contextBridge, ipcRenderer } from 'electron'
import type {
  DrawingShape,
  EventRecord,
  ExportTacticFramesRequest,
  LiveEvent,
  LiveStartRequest,
  Match,
  Player,
  TagCategory,
  Team,
  VideoProbeResult
} from '../shared/types'

const api = {
  openVideo: (): Promise<{ filePath: string; probe: VideoProbeResult } | null> =>
    ipcRenderer.invoke('dialog:openVideo'),
  openRosterFile: (): Promise<Record<string, string>[] | null> => ipcRenderer.invoke('dialog:openRosterFile'),
  saveExport: (): Promise<string | null> => ipcRenderer.invoke('dialog:saveExport'),

  probeVideo: (filePath: string): Promise<VideoProbeResult> => ipcRenderer.invoke('video:probe', filePath),
  saveTacticExport: (format: 'mp4' | 'gif'): Promise<string | null> =>
    ipcRenderer.invoke('dialog:saveTacticExport', format),
  exportTacticFrames: (args: ExportTacticFramesRequest): Promise<void> =>
    ipcRenderer.invoke('video:exportTacticFrames', args),
  saveTacticImage: (orientation: 'landscape' | 'portrait'): Promise<string | null> =>
    ipcRenderer.invoke('dialog:saveTacticImage', orientation),
  writeTacticImage: (args: { dataUrlBase64: string; outputPath: string }): Promise<void> =>
    ipcRenderer.invoke('image:saveTacticImage', args),
  getCachedPlaybackPath: (sourcePath: string): Promise<string | null> =>
    ipcRenderer.invoke('video:getCachedPlaybackPath', sourcePath),
  transcodeForPlayback: (args: { sourcePath: string; durationSec: number }): Promise<string> =>
    ipcRenderer.invoke('video:transcodeForPlayback', args),
  onTranscodeProgress: (cb: (percent: number) => void): void => {
    ipcRenderer.on('video:transcodeProgress', (_e, percent: number) => cb(percent))
  },

  selectExportFolder: (): Promise<string | null> => ipcRenderer.invoke('dialog:selectExportFolder'),
  exportClipFrames: (args: {
    frames: Uint8Array[]
    fps: number
    sourceVideoPath: string | null
    audioInSec: number
    audioOutSec: number
    outputPath?: string
    folderPath?: string
    filename?: string
    resolution: 'original' | '1080p' | '720p'
    quality: 'high' | 'balanced' | 'small'
    jobId: string
  }): Promise<string> => ipcRenderer.invoke('video:exportClipFrames', args),
  exportClipDirect: (args: {
    sourceVideoPath: string
    inSec: number
    outSec: number
    outputPath?: string
    folderPath?: string
    filename?: string
    resolution: 'original' | '1080p' | '720p'
    quality: 'high' | 'balanced' | 'small'
    jobId: string
  }): Promise<string> => ipcRenderer.invoke('video:exportClipDirect', args),
  cancelExport: (jobId: string): Promise<boolean> => ipcRenderer.invoke('video:cancelExport', jobId),
  concatClips: (args: { clipPaths: string[]; outputPath: string }): Promise<void> =>
    ipcRenderer.invoke('video:concatClips', args),
  onExportProgress: (cb: (jobId: string, percent: number) => void): void => {
    ipcRenderer.on('video:exportProgress', (_e, data: { jobId: string; percent: number }) =>
      cb(data.jobId, data.percent)
    )
  },
  fileExists: (filePath: string): Promise<boolean> => ipcRenderer.invoke('fs:fileExists', filePath),
  showItemInFolder: (filePath: string): Promise<void> => ipcRenderer.invoke('shell:showItemInFolder', filePath),
  setBackgroundThrottling: (enabled: boolean): Promise<void> =>
    ipcRenderer.invoke('video:setBackgroundThrottling', enabled),
  setExportsActive: (active: boolean): Promise<void> => ipcRenderer.invoke('project:setExportsActive', active),

  writeProjectBackup: (args: { projectId: string; projectName: string; payload: unknown }): Promise<string> =>
    ipcRenderer.invoke('project:writeBackup', args),
  openBackupsFolder: (): Promise<void> => ipcRenderer.invoke('project:openBackupsFolder'),

  createTeam: (name: string): Promise<Team> => ipcRenderer.invoke('db:createTeam', name),
  listTeams: (): Promise<Team[]> => ipcRenderer.invoke('db:listTeams'),
  createPlayer: (args: { teamId: number; name: string; number: number | null; position: string | null }): Promise<Player> =>
    ipcRenderer.invoke('db:createPlayer', args),
  createPlayersBulk: (args: {
    teamId: number
    players: { name: string; number: number | null; position: string | null }[]
  }): Promise<Player[]> => ipcRenderer.invoke('db:createPlayersBulk', args),
  listPlayersByTeam: (teamId: number): Promise<Player[]> => ipcRenderer.invoke('db:listPlayersByTeam', teamId),

  createMatch: (args: { name: string; date: string; homeTeamId: number; awayTeamId: number }): Promise<Match> =>
    ipcRenderer.invoke('db:createMatch', args),
  listMatches: (): Promise<Match[]> => ipcRenderer.invoke('db:listMatches'),
  getMatch: (id: number): Promise<Match | null> => ipcRenderer.invoke('db:getMatch', id),
  setMatchVideo: (args: { matchId: number; videoPath: string; durationSec: number }): Promise<void> =>
    ipcRenderer.invoke('db:setMatchVideo', args),

  createCategory: (args: {
    matchId: number
    name: string
    color: string
    shortcutKey: string | null
    isContinuous: boolean
  }): Promise<TagCategory> => ipcRenderer.invoke('db:createCategory', args),
  listCategories: (matchId: number): Promise<TagCategory[]> => ipcRenderer.invoke('db:listCategories', matchId),
  deleteCategory: (id: number): Promise<void> => ipcRenderer.invoke('db:deleteCategory', id),

  createEvent: (event: Omit<EventRecord, 'id'>): Promise<EventRecord> => ipcRenderer.invoke('db:createEvent', event),
  updateEvent: (id: number, patch: Partial<Omit<EventRecord, 'id' | 'matchId'>>): Promise<void> =>
    ipcRenderer.invoke('db:updateEvent', { id, patch }),
  deleteEvent: (id: number): Promise<void> => ipcRenderer.invoke('db:deleteEvent', id),
  listEvents: (
    matchId: number,
    filters?: { categoryId?: number; playerId?: number; period?: string }
  ): Promise<EventRecord[]> => ipcRenderer.invoke('db:listEvents', { matchId, filters }),

  createShape: (shape: Omit<DrawingShape, 'id'>): Promise<DrawingShape> => ipcRenderer.invoke('db:createShape', shape),
  listShapesForEvent: (eventId: number): Promise<DrawingShape[]> =>
    ipcRenderer.invoke('db:listShapesForEvent', eventId),
  deleteShape: (id: number): Promise<void> => ipcRenderer.invoke('db:deleteShape', id),

  onAutoUpdateStatus: (cb: (message: string) => void): void => {
    ipcRenderer.on('autoUpdate:status', (_e, message: string) => cb(message))
  },

  // LIVE (Fase 1, Desktop/Electron only) — see src/main/liveIngest.ts/liveInput.ts.
  liveStart: (req: LiveStartRequest): Promise<void> => ipcRenderer.invoke('live:start', req),
  liveStop: (): Promise<void> => ipcRenderer.invoke('live:stop'),
  // Periodic "the LIVE panel is still open" ping — see LiveSession.heartbeat()'s comment in
  // liveIngest.ts for why this exists as a signal separate from segment-fetch activity.
  liveHeartbeat: (): Promise<void> => ipcRenderer.invoke('live:heartbeat'),
  onLiveEvent: (cb: (event: LiveEvent) => void): void => {
    ipcRenderer.on('live:event', (_e, event: LiveEvent) => cb(event))
  },
  // Fase LIVE 3 — see src/main/liveClip.ts. Mirrors exportClipDirect's shape/naming exactly
  // (inMs/outMs instead of inSec/outSec — wall-clock ms, the basis LiveBuffer indexes by) so the
  // renderer's export queue can treat it as a drop-in alternative for tag.live clips.
  exportLiveClip: (args: {
    inMs: number
    outMs: number
    outputPath?: string
    folderPath?: string
    filename?: string
    resolution: 'original' | '1080p' | '720p'
    quality: 'high' | 'balanced' | 'small'
    jobId: string
  }): Promise<string> => ipcRenderer.invoke('live:exportClip', args)
}

export type FootballApi = typeof api

contextBridge.exposeInMainWorld('api', api)
