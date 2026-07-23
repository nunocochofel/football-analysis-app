import { dbAll, dbGet, dbRun, lastInsertRowId } from './index'
import type { DrawingShape, EventRecord, Match, Player, TagCategory, Team } from '../../shared/types'

interface TeamRow {
  id: number
  name: string
}
interface PlayerRow {
  id: number
  team_id: number
  name: string
  number: number | null
  position: string | null
}
interface MatchRow {
  id: number
  name: string
  date: string
  home_team_id: number
  away_team_id: number
  video_path: string | null
  video_duration_sec: number | null
}
interface TagCategoryRow {
  id: number
  match_id: number
  name: string
  color: string
  shortcut_key: string | null
  is_continuous: number
}
interface EventRow {
  id: number
  match_id: number
  category_id: number
  player_id: number | null
  team_id: number | null
  start_sec: number
  end_sec: number
  period: string | null
  field_x: number | null
  field_y: number | null
  notes: string | null
}
interface DrawingShapeRow {
  id: number
  event_id: number
  at_sec: number
  type: string
  points: string
  color: string
}

const toTeam = (r: TeamRow): Team => ({ id: r.id, name: r.name })
const toPlayer = (r: PlayerRow): Player => ({
  id: r.id,
  teamId: r.team_id,
  name: r.name,
  number: r.number,
  position: r.position
})
const toMatch = (r: MatchRow): Match => ({
  id: r.id,
  name: r.name,
  date: r.date,
  homeTeamId: r.home_team_id,
  awayTeamId: r.away_team_id,
  videoPath: r.video_path,
  videoDurationSec: r.video_duration_sec
})
const toCategory = (r: TagCategoryRow): TagCategory => ({
  id: r.id,
  matchId: r.match_id,
  name: r.name,
  color: r.color,
  shortcutKey: r.shortcut_key,
  isContinuous: !!r.is_continuous
})
const toEvent = (r: EventRow): EventRecord => ({
  id: r.id,
  matchId: r.match_id,
  categoryId: r.category_id,
  playerId: r.player_id,
  teamId: r.team_id,
  startSec: r.start_sec,
  endSec: r.end_sec,
  period: r.period,
  fieldX: r.field_x,
  fieldY: r.field_y,
  notes: r.notes
})
const toShape = (r: DrawingShapeRow): DrawingShape => ({
  id: r.id,
  eventId: r.event_id,
  atSec: r.at_sec,
  type: r.type as DrawingShape['type'],
  points: JSON.parse(r.points),
  color: r.color
})

// Teams
export function createTeam(name: string): Team {
  dbRun('INSERT INTO teams (name) VALUES (?)', [name])
  return { id: lastInsertRowId(), name }
}

export function listTeams(): Team[] {
  return dbAll<TeamRow>('SELECT * FROM teams ORDER BY name').map(toTeam)
}

// Players
export function createPlayer(
  teamId: number,
  name: string,
  number: number | null,
  position: string | null
): Player {
  dbRun('INSERT INTO players (team_id, name, number, position) VALUES (?, ?, ?, ?)', [
    teamId,
    name,
    number,
    position
  ])
  return { id: lastInsertRowId(), teamId, name, number, position }
}

export function createPlayersBulk(
  teamId: number,
  players: { name: string; number: number | null; position: string | null }[]
): Player[] {
  return players.map((p) => createPlayer(teamId, p.name, p.number, p.position))
}

export function listPlayersByTeam(teamId: number): Player[] {
  return dbAll<PlayerRow>('SELECT * FROM players WHERE team_id = ? ORDER BY number, name', [teamId]).map(toPlayer)
}

// Matches
export function createMatch(name: string, date: string, homeTeamId: number, awayTeamId: number): Match {
  dbRun('INSERT INTO matches (name, date, home_team_id, away_team_id) VALUES (?, ?, ?, ?)', [
    name,
    date,
    homeTeamId,
    awayTeamId
  ])
  return {
    id: lastInsertRowId(),
    name,
    date,
    homeTeamId,
    awayTeamId,
    videoPath: null,
    videoDurationSec: null
  }
}

export function listMatches(): Match[] {
  return dbAll<MatchRow>('SELECT * FROM matches ORDER BY date DESC').map(toMatch)
}

export function getMatch(id: number): Match | null {
  const row = dbGet<MatchRow>('SELECT * FROM matches WHERE id = ?', [id])
  return row ? toMatch(row) : null
}

export function setMatchVideo(matchId: number, videoPath: string, durationSec: number): void {
  dbRun('UPDATE matches SET video_path = ?, video_duration_sec = ? WHERE id = ?', [
    videoPath,
    durationSec,
    matchId
  ])
}

// Tag categories
export function createCategory(
  matchId: number,
  name: string,
  color: string,
  shortcutKey: string | null,
  isContinuous: boolean
): TagCategory {
  dbRun('INSERT INTO tag_categories (match_id, name, color, shortcut_key, is_continuous) VALUES (?, ?, ?, ?, ?)', [
    matchId,
    name,
    color,
    shortcutKey,
    isContinuous ? 1 : 0
  ])
  return { id: lastInsertRowId(), matchId, name, color, shortcutKey, isContinuous }
}

export function listCategories(matchId: number): TagCategory[] {
  return dbAll<TagCategoryRow>('SELECT * FROM tag_categories WHERE match_id = ? ORDER BY id', [matchId]).map(
    toCategory
  )
}

export function deleteCategory(id: number): void {
  dbRun('DELETE FROM tag_categories WHERE id = ?', [id])
}

// Events
export function createEvent(e: Omit<EventRecord, 'id'>): EventRecord {
  dbRun(
    `INSERT INTO events (match_id, category_id, player_id, team_id, start_sec, end_sec, period, field_x, field_y, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      e.matchId,
      e.categoryId,
      e.playerId,
      e.teamId,
      e.startSec,
      e.endSec,
      e.period,
      e.fieldX,
      e.fieldY,
      e.notes
    ]
  )
  return { ...e, id: lastInsertRowId() }
}

export function updateEvent(id: number, patch: Partial<Omit<EventRecord, 'id' | 'matchId'>>): void {
  const columnMap: Record<string, string> = {
    categoryId: 'category_id',
    playerId: 'player_id',
    teamId: 'team_id',
    startSec: 'start_sec',
    endSec: 'end_sec',
    period: 'period',
    fieldX: 'field_x',
    fieldY: 'field_y',
    notes: 'notes'
  }
  const fields = Object.keys(patch).filter((f) => f in columnMap)
  if (fields.length === 0) return
  const setClause = fields.map((f) => `${columnMap[f]} = ?`).join(', ')
  const values = fields.map((f) => (patch as Record<string, string | number | null>)[f])
  dbRun(`UPDATE events SET ${setClause} WHERE id = ?`, [...values, id])
}

export function deleteEvent(id: number): void {
  dbRun('DELETE FROM events WHERE id = ?', [id])
}

export function listEvents(
  matchId: number,
  filters?: { categoryId?: number; playerId?: number; period?: string }
): EventRecord[] {
  let sql = 'SELECT * FROM events WHERE match_id = ?'
  const params: (string | number)[] = [matchId]
  if (filters?.categoryId) {
    sql += ' AND category_id = ?'
    params.push(filters.categoryId)
  }
  if (filters?.playerId) {
    sql += ' AND player_id = ?'
    params.push(filters.playerId)
  }
  if (filters?.period) {
    sql += ' AND period = ?'
    params.push(filters.period)
  }
  sql += ' ORDER BY start_sec'
  return dbAll<EventRow>(sql, params).map(toEvent)
}

// Drawing shapes
export function createShape(s: Omit<DrawingShape, 'id'>): DrawingShape {
  dbRun('INSERT INTO drawing_shapes (event_id, at_sec, type, points, color) VALUES (?, ?, ?, ?, ?)', [
    s.eventId,
    s.atSec,
    s.type,
    JSON.stringify(s.points),
    s.color
  ])
  return { ...s, id: lastInsertRowId() }
}

export function listShapesForEvent(eventId: number): DrawingShape[] {
  return dbAll<DrawingShapeRow>('SELECT * FROM drawing_shapes WHERE event_id = ?', [eventId]).map(toShape)
}

export function deleteShape(id: number): void {
  dbRun('DELETE FROM drawing_shapes WHERE id = ?', [id])
}
