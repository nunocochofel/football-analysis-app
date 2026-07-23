import { useEffect, useMemo, useRef, useState } from 'react'
import type { DrawingShape, EventRecord, Match, Player, TagCategory, Team } from '@shared/types'
import PlaybackControls from '../PlaybackControls/PlaybackControls'
import TaggingPanel from '../TaggingPanel/TaggingPanel'
import Timeline from '../Timeline/Timeline'
import DrawingOverlay from '../DrawingOverlay/DrawingOverlay'
import FieldDiagram from '../FieldDiagram/FieldDiagram'
import StatsMatrix from '../StatsMatrix/StatsMatrix'

interface Props {
  match: Match
  onBack: () => void
}

const VIDEO_WIDTH = 960
const VIDEO_HEIGHT = 540

export default function Workspace({ match: initialMatch, onBack }: Props): JSX.Element {
  const [match, setMatch] = useState(initialMatch)
  const [teams, setTeams] = useState<Team[]>([])
  const [players, setPlayers] = useState<Player[]>([])
  const [categories, setCategories] = useState<TagCategory[]>([])
  const [events, setEvents] = useState<EventRecord[]>([])
  const [shapes, setShapes] = useState<DrawingShape[]>([])

  const videoRef = useRef<HTMLVideoElement>(null)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(match.videoDurationSec ?? 0)
  const [playbackRate, setPlaybackRate] = useState(1)
  const [isPaused, setIsPaused] = useState(true)
  const [fps, setFps] = useState(25)
  const [inSec, setInSec] = useState<number | null>(null)
  const [outSec, setOutSec] = useState<number | null>(null)

  const [openTags, setOpenTags] = useState<Map<number, number>>(new Map())
  const [selectedEventId, setSelectedEventId] = useState<number | null>(null)
  const [selectedForExport, setSelectedForExport] = useState<Set<number>>(new Set())
  const [drawingTool, setDrawingTool] = useState<'none' | 'line' | 'arrow' | 'circle' | 'polygon'>('none')
  const [drawingColor, setDrawingColor] = useState('#ef4444')
  const [status, setStatus] = useState<string | null>(null)

  useEffect(() => {
    window.api.listTeams().then(setTeams)
    window.api.listCategories(match.id).then(setCategories)
    window.api.listEvents(match.id).then(setEvents)
  }, [match.id])

  useEffect(() => {
    const homeId = match.homeTeamId
    const awayId = match.awayTeamId
    Promise.all([window.api.listPlayersByTeam(homeId), window.api.listPlayersByTeam(awayId)]).then(
      ([home, away]) => setPlayers([...home, ...away])
    )
  }, [match.homeTeamId, match.awayTeamId])

  useEffect(() => {
    if (selectedEventId == null) {
      setShapes([])
      return
    }
    window.api.listShapesForEvent(selectedEventId).then(setShapes)
  }, [selectedEventId])

  const selectedEvent = useMemo(
    () => events.find((e) => e.id === selectedEventId) ?? null,
    [events, selectedEventId]
  )

  async function handleImportVideo(): Promise<void> {
    const result = await window.api.openVideo()
    if (!result) return
    await window.api.setMatchVideo({
      matchId: match.id,
      videoPath: result.filePath,
      durationSec: result.probe.durationSec
    })
    setMatch((m) => ({ ...m, videoPath: result.filePath, videoDurationSec: result.probe.durationSec }))
    setDuration(result.probe.durationSec)
    setFps(result.probe.fps || 25)
  }

  function seek(sec: number): void {
    const v = videoRef.current
    if (!v) return
    v.currentTime = Math.max(0, Math.min(sec, duration))
  }

  function togglePlay(): void {
    const v = videoRef.current
    if (!v) return
    if (v.paused) v.play()
    else v.pause()
  }

  function frameStep(dir: -1 | 1): void {
    const v = videoRef.current
    if (!v) return
    v.pause()
    v.currentTime = Math.max(0, Math.min(v.currentTime + dir * (1 / (fps || 25)), duration))
  }

  async function refreshEvents(): Promise<void> {
    setEvents(await window.api.listEvents(match.id))
  }

  async function handleTagPress(category: TagCategory): Promise<void> {
    if (category.isContinuous) {
      const open = openTags.get(category.id)
      if (open == null) {
        setOpenTags((prev) => new Map(prev).set(category.id, currentTime))
      } else {
        const startSec = Math.min(open, currentTime)
        const endSec = Math.max(open, currentTime)
        const created = await window.api.createEvent({
          matchId: match.id,
          categoryId: category.id,
          playerId: null,
          teamId: null,
          startSec,
          endSec,
          period: null,
          fieldX: null,
          fieldY: null,
          notes: null
        })
        setOpenTags((prev) => {
          const next = new Map(prev)
          next.delete(category.id)
          return next
        })
        await refreshEvents()
        setSelectedEventId(created.id)
      }
    } else {
      const created = await window.api.createEvent({
        matchId: match.id,
        categoryId: category.id,
        playerId: null,
        teamId: null,
        startSec: currentTime,
        endSec: currentTime,
        period: null,
        fieldX: null,
        fieldY: null,
        notes: null
      })
      await refreshEvents()
      setSelectedEventId(created.id)
    }
  }

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent): void {
      const target = e.target as HTMLElement
      if (['INPUT', 'SELECT', 'TEXTAREA'].includes(target.tagName)) return
      if (e.code === 'Space') {
        e.preventDefault()
        togglePlay()
        return
      }
      const category = categories.find((c) => c.shortcutKey?.toLowerCase() === e.key.toLowerCase())
      if (category) handleTagPress(category)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [categories, currentTime, openTags])

  async function handleCreateCategory(input: {
    name: string
    color: string
    shortcutKey: string | null
    isContinuous: boolean
  }): Promise<void> {
    const created = await window.api.createCategory({ matchId: match.id, ...input })
    setCategories((prev) => [...prev, created])
  }

  async function handleDeleteCategory(id: number): Promise<void> {
    await window.api.deleteCategory(id)
    setCategories((prev) => prev.filter((c) => c.id !== id))
  }

  async function handleAssignPlayer(eventId: number, playerId: number | null): Promise<void> {
    const player = playerId != null ? players.find((p) => p.id === playerId) : undefined
    await window.api.updateEvent(eventId, { playerId, teamId: player?.teamId ?? null })
    await refreshEvents()
  }

  async function handleDeleteEvent(eventId: number): Promise<void> {
    await window.api.deleteEvent(eventId)
    if (selectedEventId === eventId) setSelectedEventId(null)
    setSelectedForExport((prev) => {
      const next = new Set(prev)
      next.delete(eventId)
      return next
    })
    await refreshEvents()
  }

  async function handleFieldPick(x: number, y: number): Promise<void> {
    if (!selectedEvent) return
    await window.api.updateEvent(selectedEvent.id, { fieldX: x, fieldY: y })
    await refreshEvents()
  }

  async function handleShapeComplete(type: DrawingShape['type'], points: number[]): Promise<void> {
    if (!selectedEvent) return
    const created = await window.api.createShape({
      eventId: selectedEvent.id,
      atSec: currentTime,
      type,
      points,
      color: drawingColor
    })
    setShapes((prev) => [...prev, created])
  }

  function toggleExportSelection(eventId: number): void {
    setSelectedForExport((prev) => {
      const next = new Set(prev)
      if (next.has(eventId)) next.delete(eventId)
      else next.add(eventId)
      return next
    })
  }

  async function handleExportSelected(): Promise<void> {
    if (!match.videoPath) return
    const segments = events
      .filter((e) => selectedForExport.has(e.id))
      .sort((a, b) => a.startSec - b.startSec)
      .map((e) => ({
        startSec: Math.max(0, e.startSec - 3),
        endSec: Math.min(duration, (e.endSec > e.startSec ? e.endSec : e.startSec) + 3)
      }))
    if (segments.length === 0) {
      setStatus('Seleciona pelo menos um evento na timeline para exportar.')
      return
    }
    const outputPath = await window.api.saveExport()
    if (!outputPath) return
    setStatus('A exportar...')
    try {
      await window.api.exportSequence({ matchVideoPath: match.videoPath, segments, outputPath })
      setStatus(`Exportado com sucesso: ${outputPath}`)
    } catch (err) {
      setStatus(`Erro ao exportar: ${(err as Error).message}`)
    }
  }

  async function handleExportInOut(): Promise<void> {
    if (!match.videoPath || inSec == null || outSec == null) return
    const outputPath = await window.api.saveExport()
    if (!outputPath) return
    setStatus('A exportar clip...')
    try {
      await window.api.cutClip({
        sourcePath: match.videoPath,
        startSec: Math.min(inSec, outSec),
        endSec: Math.max(inSec, outSec),
        outputPath
      })
      setStatus(`Clip exportado: ${outputPath}`)
    } catch (err) {
      setStatus(`Erro ao exportar: ${(err as Error).message}`)
    }
  }

  const teamName = (id: number): string => teams.find((t) => t.id === id)?.name ?? '—'

  return (
    <div className="workspace">
      <div className="workspace-header row">
        <button onClick={onBack}>← Voltar</button>
        <h2>
          {match.name} · {teamName(match.homeTeamId)} vs {teamName(match.awayTeamId)}
        </h2>
        {status && <span className="status-message">{status}</span>}
      </div>

      {!match.videoPath ? (
        <div className="panel">
          <p>Esta partida ainda não tem vídeo associado.</p>
          <button onClick={handleImportVideo}>Importar vídeo</button>
        </div>
      ) : (
        <div className="workspace-grid">
          <div className="video-column">
            <div className="video-stage" style={{ width: VIDEO_WIDTH, height: VIDEO_HEIGHT }}>
              <video
                ref={videoRef}
                src={`file://${match.videoPath}`}
                width={VIDEO_WIDTH}
                height={VIDEO_HEIGHT}
                onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
                onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
                onPlay={() => setIsPaused(false)}
                onPause={() => setIsPaused(true)}
              />
              <DrawingOverlay
                width={VIDEO_WIDTH}
                height={VIDEO_HEIGHT}
                shapes={shapes}
                activeTool={drawingTool}
                color={drawingColor}
                onToolChange={setDrawingTool}
                onColorChange={setDrawingColor}
                onShapeComplete={handleShapeComplete}
                canDraw={isPaused && selectedEvent != null}
              />
            </div>
            <PlaybackControls
              currentTime={currentTime}
              duration={duration}
              playbackRate={playbackRate}
              isPaused={isPaused}
              onSeek={seek}
              onSetRate={(r) => {
                setPlaybackRate(r)
                if (videoRef.current) videoRef.current.playbackRate = r
              }}
              onTogglePlay={togglePlay}
              onFrameStep={frameStep}
              fps={fps}
              inSec={inSec}
              outSec={outSec}
              onMarkIn={() => setInSec(currentTime)}
              onMarkOut={() => setOutSec(currentTime)}
            />
            <div className="row">
              <button disabled={inSec == null || outSec == null} onClick={handleExportInOut}>
                Exportar clip In/Out
              </button>
              <button disabled={selectedForExport.size === 0} onClick={handleExportSelected}>
                Exportar sequência selecionada ({selectedForExport.size})
              </button>
            </div>

            <TaggingPanel
              categories={categories}
              openCategoryIds={new Set(openTags.keys())}
              onTagPress={handleTagPress}
              onCreateCategory={handleCreateCategory}
              onDeleteCategory={handleDeleteCategory}
            />

            {selectedEvent && (
              <div className="panel">
                <h3>Localização do evento selecionado</h3>
                <FieldDiagram x={selectedEvent.fieldX} y={selectedEvent.fieldY} onPick={handleFieldPick} />
              </div>
            )}
          </div>

          <div className="side-column">
            <Timeline
              events={events}
              categories={categories}
              players={players}
              selectedEventId={selectedEventId}
              selectedForExport={selectedForExport}
              onSeek={seek}
              onSelectEvent={(e) => setSelectedEventId(e.id)}
              onToggleExportSelection={toggleExportSelection}
              onAssignPlayer={handleAssignPlayer}
              onDelete={handleDeleteEvent}
            />
            <StatsMatrix events={events} categories={categories} players={players} />
          </div>
        </div>
      )}
    </div>
  )
}
