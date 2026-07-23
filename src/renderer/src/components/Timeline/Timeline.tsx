import { useMemo, useState } from 'react'
import type { EventRecord, Player, TagCategory } from '@shared/types'

interface Props {
  events: EventRecord[]
  categories: TagCategory[]
  players: Player[]
  selectedEventId: number | null
  selectedForExport: Set<number>
  onSeek: (sec: number) => void
  onSelectEvent: (event: EventRecord) => void
  onToggleExportSelection: (eventId: number) => void
  onAssignPlayer: (eventId: number, playerId: number | null) => void
  onDelete: (eventId: number) => void
}

function formatTime(sec: number): string {
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

export default function Timeline({
  events,
  categories,
  players,
  selectedEventId,
  selectedForExport,
  onSeek,
  onSelectEvent,
  onToggleExportSelection,
  onAssignPlayer,
  onDelete
}: Props): JSX.Element {
  const [categoryFilter, setCategoryFilter] = useState<number | ''>('')
  const [playerFilter, setPlayerFilter] = useState<number | ''>('')

  const categoryById = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories])
  const playerById = useMemo(() => new Map(players.map((p) => [p.id, p])), [players])

  const filtered = useMemo(
    () =>
      events.filter((e) => {
        if (categoryFilter !== '' && e.categoryId !== categoryFilter) return false
        if (playerFilter !== '' && e.playerId !== playerFilter) return false
        return true
      }),
    [events, categoryFilter, playerFilter]
  )

  return (
    <div className="timeline-panel">
      <div className="row">
        <h3>Timeline ({filtered.length})</h3>
        <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value ? Number(e.target.value) : '')}>
          <option value="">Todas as categorias</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <select value={playerFilter} onChange={(e) => setPlayerFilter(e.target.value ? Number(e.target.value) : '')}>
          <option value="">Todos os jogadores</option>
          {players.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </div>
      <ul className="timeline-list">
        {filtered.map((e) => {
          const cat = categoryById.get(e.categoryId)
          const player = e.playerId != null ? playerById.get(e.playerId) : undefined
          return (
            <li
              key={e.id}
              className={`timeline-row ${selectedEventId === e.id ? 'selected' : ''}`}
              style={{ borderLeftColor: cat?.color ?? '#666' }}
            >
              <input
                type="checkbox"
                checked={selectedForExport.has(e.id)}
                onChange={() => onToggleExportSelection(e.id)}
              />
              <button className="link-button" onClick={() => onSeek(e.startSec)}>
                {formatTime(e.startSec)}
              </button>
              <button className="link-button timeline-select" onClick={() => onSelectEvent(e)}>
                {cat?.name ?? '—'}
                {e.endSec > e.startSec ? ` (${formatTime(e.endSec - e.startSec)})` : ''}
              </button>
              <select
                value={e.playerId ?? ''}
                onChange={(ev) => onAssignPlayer(e.id, ev.target.value ? Number(ev.target.value) : null)}
              >
                <option value="">Jogador...</option>
                {players.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              {player && <span className="tag-hint">{player.name}</span>}
              <button className="link-button danger" onClick={() => onDelete(e.id)}>
                Remover
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
