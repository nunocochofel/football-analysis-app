import { dialog, ipcMain, BrowserWindow } from 'electron'
import { readFile } from 'fs/promises'
import * as XLSX from 'xlsx'
import Papa from 'papaparse'
import { probeVideo, cutClip, exportSequence, exportImageSequence } from './ffmpeg'
import * as q from './db/queries'
import type { ExportClipRequest, ExportTacticFramesRequest } from '../shared/types'

export function registerIpcHandlers(getWindow: () => BrowserWindow | null): void {
  // File dialogs
  ipcMain.handle('dialog:openVideo', async () => {
    const win = getWindow()
    if (!win) return null
    const result = await dialog.showOpenDialog(win, {
      properties: ['openFile'],
      filters: [{ name: 'Vídeo', extensions: ['mp4', 'mkv', 'mov', 'avi', 'm4v', 'webm'] }]
    })
    if (result.canceled || result.filePaths.length === 0) return null
    const filePath = result.filePaths[0]
    const probe = await probeVideo(filePath)
    return { filePath, probe }
  })

  ipcMain.handle('dialog:openRosterFile', async () => {
    const win = getWindow()
    if (!win) return null
    const result = await dialog.showOpenDialog(win, {
      properties: ['openFile'],
      filters: [{ name: 'Escalação', extensions: ['csv', 'xlsx', 'xls'] }]
    })
    if (result.canceled || result.filePaths.length === 0) return null
    const filePath = result.filePaths[0]
    const ext = filePath.split('.').pop()?.toLowerCase()
    let rows: Record<string, string>[] = []
    if (ext === 'csv') {
      const content = await readFile(filePath, 'utf-8')
      const parsed = Papa.parse<Record<string, string>>(content, { header: true, skipEmptyLines: true })
      rows = parsed.data
    } else {
      const buf = await readFile(filePath)
      const wb = XLSX.read(buf, { type: 'buffer' })
      const sheet = wb.Sheets[wb.SheetNames[0]]
      rows = XLSX.utils.sheet_to_json(sheet)
    }
    return rows
  })

  ipcMain.handle('dialog:saveExport', async () => {
    const win = getWindow()
    if (!win) return null
    const result = await dialog.showSaveDialog(win, {
      defaultPath: 'export.mp4',
      filters: [{ name: 'MP4', extensions: ['mp4'] }]
    })
    if (result.canceled || !result.filePath) return null
    return result.filePath
  })

  ipcMain.handle('dialog:saveTacticExport', async (_e, format: 'mp4' | 'gif') => {
    const win = getWindow()
    if (!win) return null
    const ext = format === 'gif' ? 'gif' : 'mp4'
    const result = await dialog.showSaveDialog(win, {
      defaultPath: `quadro-tatico.${ext}`,
      filters: [{ name: format === 'gif' ? 'GIF' : 'MP4', extensions: [ext] }]
    })
    if (result.canceled || !result.filePath) return null
    return result.filePath
  })

  // Video processing
  ipcMain.handle('video:probe', (_e, filePath: string) => probeVideo(filePath))
  ipcMain.handle(
    'video:cutClip',
    (_e, args: { sourcePath: string; startSec: number; endSec: number; outputPath: string }) =>
      cutClip(args.sourcePath, args.startSec, args.endSec, args.outputPath)
  )
  ipcMain.handle('video:exportSequence', (_e, args: ExportClipRequest) =>
    exportSequence(args.matchVideoPath, args.segments, args.outputPath)
  )
  ipcMain.handle('video:exportTacticFrames', (_e, args: ExportTacticFramesRequest) =>
    exportImageSequence(args.frames, args.fps, args.outputPath, args.format)
  )

  // Teams / players
  ipcMain.handle('db:createTeam', (_e, name: string) => q.createTeam(name))
  ipcMain.handle('db:listTeams', () => q.listTeams())
  ipcMain.handle(
    'db:createPlayer',
    (_e, args: { teamId: number; name: string; number: number | null; position: string | null }) =>
      q.createPlayer(args.teamId, args.name, args.number, args.position)
  )
  ipcMain.handle(
    'db:createPlayersBulk',
    (_e, args: { teamId: number; players: { name: string; number: number | null; position: string | null }[] }) =>
      q.createPlayersBulk(args.teamId, args.players)
  )
  ipcMain.handle('db:listPlayersByTeam', (_e, teamId: number) => q.listPlayersByTeam(teamId))

  // Matches
  ipcMain.handle(
    'db:createMatch',
    (_e, args: { name: string; date: string; homeTeamId: number; awayTeamId: number }) =>
      q.createMatch(args.name, args.date, args.homeTeamId, args.awayTeamId)
  )
  ipcMain.handle('db:listMatches', () => q.listMatches())
  ipcMain.handle('db:getMatch', (_e, id: number) => q.getMatch(id))
  ipcMain.handle(
    'db:setMatchVideo',
    (_e, args: { matchId: number; videoPath: string; durationSec: number }) =>
      q.setMatchVideo(args.matchId, args.videoPath, args.durationSec)
  )

  // Tag categories
  ipcMain.handle(
    'db:createCategory',
    (
      _e,
      args: { matchId: number; name: string; color: string; shortcutKey: string | null; isContinuous: boolean }
    ) => q.createCategory(args.matchId, args.name, args.color, args.shortcutKey, args.isContinuous)
  )
  ipcMain.handle('db:listCategories', (_e, matchId: number) => q.listCategories(matchId))
  ipcMain.handle('db:deleteCategory', (_e, id: number) => q.deleteCategory(id))

  // Events
  ipcMain.handle('db:createEvent', (_e, event: Parameters<typeof q.createEvent>[0]) => q.createEvent(event))
  ipcMain.handle(
    'db:updateEvent',
    (_e, args: { id: number; patch: Parameters<typeof q.updateEvent>[1] }) => q.updateEvent(args.id, args.patch)
  )
  ipcMain.handle('db:deleteEvent', (_e, id: number) => q.deleteEvent(id))
  ipcMain.handle(
    'db:listEvents',
    (_e, args: { matchId: number; filters?: Parameters<typeof q.listEvents>[1] }) =>
      q.listEvents(args.matchId, args.filters)
  )

  // Drawing shapes
  ipcMain.handle('db:createShape', (_e, shape: Parameters<typeof q.createShape>[0]) => q.createShape(shape))
  ipcMain.handle('db:listShapesForEvent', (_e, eventId: number) => q.listShapesForEvent(eventId))
  ipcMain.handle('db:deleteShape', (_e, id: number) => q.deleteShape(id))
}
