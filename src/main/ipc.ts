import { app, dialog, ipcMain, shell, BrowserWindow } from 'electron'
import { existsSync } from 'fs'
import { mkdir, readdir, readFile, unlink, writeFile } from 'fs/promises'
import { join } from 'path'
import * as XLSX from 'xlsx'
import Papa from 'papaparse'
import {
  probeVideo,
  exportClipFramesWithAudio,
  exportClipDirect,
  exportImageSequence,
  concatClips,
  hasTranscodedCache,
  transcodedCachePath,
  transcodeForPlayback,
  cancelExportJob,
  type ExportResolution,
  type ExportQuality
} from './ffmpeg'
import * as q from './db/queries'
import { LiveSession } from './liveIngest'
import { startLiveFromInput, stopLiveInput, createSupervisedLiveEmit } from './liveInput'
import { exportLiveClip } from './liveClip'
import type { ExportTacticFramesRequest, LiveEvent, LiveStartRequest } from '../shared/types'

// Returned so index.ts can stop any in-progress RTMP ingest on app quit (see the 'before-quit'
// handler there) — kept as a plain return value rather than a module-level singleton so a future
// test can construct its own registerIpcHandlers() call with an isolated session.
export function registerIpcHandlers(
  getWindow: () => BrowserWindow | null,
  onExportsActiveChange: (active: boolean) => void
): LiveSession {
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

  // Export queue destination — clips are written directly into this folder as individual files
  // (Categoria_N.mp4), not bundled into a .zip, so the queue panel can offer a real "Abrir" action
  // per finished item without waiting for a whole batch to be archived first.
  ipcMain.handle('dialog:selectExportFolder', async () => {
    const win = getWindow()
    if (!win) return null
    const result = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'] })
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })

  // Video processing
  ipcMain.handle('video:probe', (_e, filePath: string) => probeVideo(filePath))
  ipcMain.handle('video:exportTacticFrames', (_e, args: ExportTacticFramesRequest) =>
    exportImageSequence(args.frames, args.fps, args.outputPath, args.format)
  )

  // Playback fallback for codecs (e.g. HEVC/.mov straight off an iPhone) that Chromium's <video>
  // element can't decode — see the big comment above transcodeForPlayback() in ffmpeg.ts.
  ipcMain.handle('video:getCachedPlaybackPath', (_e, sourcePath: string) =>
    hasTranscodedCache(sourcePath) ? transcodedCachePath(sourcePath) : null
  )
  ipcMain.handle('video:transcodeForPlayback', (e, args: { sourcePath: string; durationSec: number }) =>
    transcodeForPlayback(args.sourcePath, args.durationSec, (percent) => {
      e.sender.send('video:transcodeProgress', percent)
    })
  )

  // Export queue: the renderer already did the slow part (capturing frames from a hidden video
  // element and drawing video+shapes+zoom onto a canvas per frame) and just hands over the
  // resulting JPEG sequence — this turns that into a real MP4 with the original audio muxed back
  // in. See the big comment above exportClipFramesWithAudio() in ffmpeg.ts. jobId lets a queue
  // item's "Cancelar" action reach this exact in-flight ffmpeg process via video:cancelExport;
  // progress is tagged with jobId so the renderer can route it to the right queue row even if a
  // later export starts before an earlier progress event for a different job arrives.
  ipcMain.handle(
    'video:exportClipFrames',
    async (
      e,
      args: {
        frames: Uint8Array[]
        fps: number
        sourceVideoPath: string | null
        audioInSec: number
        audioOutSec: number
        outputPath?: string
        folderPath?: string
        filename?: string
        resolution: ExportResolution
        quality: ExportQuality
        jobId: string
      }
    ) => {
      const outputPath = args.outputPath ?? join(args.folderPath as string, args.filename as string)
      await exportClipFramesWithAudio(
        args.frames,
        args.fps,
        args.sourceVideoPath,
        args.audioInSec,
        args.audioOutSec,
        outputPath,
        args.resolution,
        args.quality,
        args.jobId,
        (percent) => {
          e.sender.send('video:exportProgress', { jobId: args.jobId, percent })
        }
      )
      return outputPath
    }
  )
  // Direct trim (no renderer capture at all): see the big comment above exportClipDirect() in
  // ffmpeg.ts — used instead of video:exportClipFrames when a clip has no shapes/zoom/freezes for
  // the renderer to composite, so there's nothing for the JS capture pipeline to contribute.
  ipcMain.handle(
    'video:exportClipDirect',
    async (
      e,
      args: {
        sourceVideoPath: string
        inSec: number
        outSec: number
        outputPath?: string
        folderPath?: string
        filename?: string
        resolution: ExportResolution
        quality: ExportQuality
        jobId: string
      }
    ) => {
      const outputPath = args.outputPath ?? join(args.folderPath as string, args.filename as string)
      await exportClipDirect(
        args.sourceVideoPath,
        args.inSec,
        args.outSec,
        outputPath,
        args.resolution,
        args.quality,
        args.jobId,
        (percent) => {
          e.sender.send('video:exportProgress', { jobId: args.jobId, percent })
        }
      )
      return outputPath
    }
  )
  ipcMain.handle('video:cancelExport', (_e, jobId: string) => cancelExportJob(jobId))

  // The export capture loop (a hidden <video> + requestVideoFrameCallback, in the renderer) is
  // otherwise subject to Electron's default backgroundThrottling — Chromium slows down a
  // renderer's timers/frame delivery once its window isn't visible or focused, which is exactly
  // what made export feel slower or stuck when minimized or switched away from. Only disabled
  // while an export is actually in flight (toggled by the renderer via video:setBackgroundThrottling
  // as the queue goes active/idle), not left off permanently — there's no reason to pay whatever
  // power-saving cost this optimization buys during ordinary use.
  ipcMain.handle('video:setBackgroundThrottling', (_e, enabled: boolean) => {
    getWindow()?.webContents.setBackgroundThrottling(enabled)
  })

  // Mirrors the same "exports in flight" transition so the main process can warn before letting
  // the window actually close (see the 'close' handler in index.ts) — a full app quit destroys
  // the renderer, which is where video decode happens, so an in-progress export cannot survive
  // that regardless of this flag; this only lets the user choose to avoid losing it accidentally,
  // it never blocks minimizing or otherwise interacting with the app.
  ipcMain.handle('project:setExportsActive', (_e, active: boolean) => {
    onExportsActiveChange(active)
  })

  // Export queue panel actions: confirm a previously-exported file is still there before trusting
  // a cache hit (state.exportCache in the renderer only remembers a path, not whether the user
  // moved/deleted it since), and reveal a finished export in the OS file manager.
  ipcMain.handle('fs:fileExists', (_e, filePath: string) => existsSync(filePath))
  ipcMain.handle('shell:showItemInFolder', (_e, filePath: string) => shell.showItemInFolder(filePath))

  // "Vídeo compilado" — see the big comment above concatClips() in ffmpeg.ts.
  ipcMain.handle('video:concatClips', (_e, args: { clipPaths: string[]; outputPath: string }) =>
    concatClips(args.clipPaths, args.outputPath)
  )

  // Automatic project backups: a periodic, on-disk safety net independent of the browser's own
  // Local Storage (leveldb) — that engine keeps writes buffered and only durable after its own
  // internal flush, so an unclean shutdown (crash, BSOD, power loss) can lose whatever hadn't been
  // flushed yet, with no way to recover it from inside the browser storage itself afterwards.
  // Plain JSON files written straight to disk on every backup tick don't have that failure mode.
  // Uses the exact same {linhaProjectExport, name, exportedAt, state} shape as the manual "Exportar
  // projeto" download, so a backup file can be dragged straight into "Importar projeto" to restore.
  function backupsDir(): string {
    return join(app.getPath('userData'), 'project-backups')
  }
  const MAX_BACKUPS_PER_PROJECT = 8
  ipcMain.handle(
    'project:writeBackup',
    async (_e, args: { projectId: string; projectName: string; payload: unknown }) => {
      const dir = join(backupsDir(), args.projectId)
      await mkdir(dir, { recursive: true })
      const safeName = (args.projectName || 'projeto').replace(/[^\w-]+/g, '_')
      const stamp = new Date().toISOString().replace(/[:.]/g, '-')
      const filePath = join(dir, `${safeName}_${stamp}.linha.json`)
      await writeFile(filePath, JSON.stringify(args.payload, null, 2), 'utf-8')
      const files = (await readdir(dir)).filter((f) => f.endsWith('.linha.json')).sort()
      if (files.length > MAX_BACKUPS_PER_PROJECT) {
        const toDelete = files.slice(0, files.length - MAX_BACKUPS_PER_PROJECT)
        await Promise.all(toDelete.map((f) => unlink(join(dir, f)).catch(() => {})))
      }
      return filePath
    }
  )
  ipcMain.handle('project:openBackupsFolder', async () => {
    const dir = backupsDir()
    await mkdir(dir, { recursive: true })
    await shell.openPath(dir)
  })

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

  // LIVE (Fase 1: RTMP; +YouTube LIVE as an experimental test source) — see liveIngest.ts
  // (untouched, the actual ffmpeg/HTTP engine) and liveInput.ts (the thin RTMP/YouTube dispatch
  // in front of it). Pushed state/stream-info/log/error events reach the renderer over a single
  // 'live:event' channel (mirrors the video:transcodeProgress/video:exportProgress pattern
  // already used above: one channel, a typed payload per kind, instead of one IPC channel per
  // event kind).
  const liveEmit = (event: LiveEvent): void => {
    getWindow()?.webContents.send('live:event', event)
  }
  // Wrapped ONCE here, before LiveSession even exists, and used as its ONE AND ONLY emit — see
  // createSupervisedLiveEmit's own comment in liveInput.ts for the real bug this fixes (a wrapper
  // built inside startLiveFromInput() instead would miss every error LiveSession raises on its
  // own, which is most of them).
  const supervisedLiveEmit = createSupervisedLiveEmit(liveEmit)
  const liveSession = new LiveSession(supervisedLiveEmit)
  ipcMain.handle('live:start', (_e, req: LiveStartRequest) =>
    startLiveFromInput(req, liveSession, supervisedLiveEmit, { bufferDurationMsOverride: req.bufferDurationMs })
  )
  // Routed through stopLiveInput() (liveInput.ts), not liveSession.stop('manual') directly — it
  // disables the auto-reconnect supervisor FIRST, so the user's own "Parar" is never immediately
  // undone by the session trying to reconnect itself.
  ipcMain.handle('live:stop', () => stopLiveInput(liveSession))
  // Renderer heartbeat (see LiveSession.heartbeat()'s own comment in liveIngest.ts) — a plain
  // fire-and-forget ping, independent of segment-fetch activity, so "is anyone actually watching"
  // doesn't get conflated with "did a fragment happen to arrive in the last few seconds".
  ipcMain.handle('live:heartbeat', () => liveSession.heartbeat())

  // Fase LIVE 3 — clip export straight from the ring buffer (see liveClip.ts). inMs/outMs are
  // wall-clock milliseconds (the same basis LiveBuffer's own segments are indexed by — the
  // renderer converts videoEl.currentTime to this via its LiveTimeline anchor before calling this,
  // see resources/linha/index.html). Reuses the exact same 'video:exportProgress' channel/jobId
  // convention as video:exportClipDirect, so the existing export queue panel needs no changes to
  // show progress/errors for a LIVE clip.
  ipcMain.handle(
    'live:exportClip',
    async (
      e,
      args: {
        inMs: number
        outMs: number
        outputPath?: string
        folderPath?: string
        filename?: string
        resolution: ExportResolution
        quality: ExportQuality
        jobId: string
      }
    ) => {
      const buffer = liveSession.getLiveBuffer()
      if (!buffer) throw new Error('Não existe uma sessão LIVE em curso para exportar este corte.')
      const outputPath = args.outputPath ?? join(args.folderPath as string, args.filename as string)
      await exportLiveClip(buffer, args.inMs, args.outMs, outputPath, args.resolution, args.quality, args.jobId, (percent) => {
        e.sender.send('video:exportProgress', { jobId: args.jobId, percent })
      })
      return outputPath
    }
  )

  return liveSession
}
