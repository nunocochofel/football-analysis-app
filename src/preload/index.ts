import { contextBridge, ipcRenderer } from 'electron'
import type {
  DrawingShape,
  EventRecord,
  ExportClipRequest,
  ExportTacticFramesRequest,
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
  cutClip: (args: { sourcePath: string; startSec: number; endSec: number; outputPath: string }): Promise<void> =>
    ipcRenderer.invoke('video:cutClip', args),
  exportSequence: (args: ExportClipRequest): Promise<void> => ipcRenderer.invoke('video:exportSequence', args),
  saveTacticExport: (format: 'mp4' | 'gif'): Promise<string | null> =>
    ipcRenderer.invoke('dialog:saveTacticExport', format),
  exportTacticFrames: (args: ExportTacticFramesRequest): Promise<void> =>
    ipcRenderer.invoke('video:exportTacticFrames', args),

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
  }
}

export type FootballApi = typeof api

contextBridge.exposeInMainWorld('api', api)
