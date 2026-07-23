import initSqlJs, { type Database } from 'sql.js'
import { app } from 'electron'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'

const SCHEMA = `
CREATE TABLE IF NOT EXISTS teams (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS players (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  number INTEGER,
  position TEXT
);

CREATE TABLE IF NOT EXISTS matches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  date TEXT NOT NULL,
  home_team_id INTEGER NOT NULL REFERENCES teams(id),
  away_team_id INTEGER NOT NULL REFERENCES teams(id),
  video_path TEXT,
  video_duration_sec REAL
);

CREATE TABLE IF NOT EXISTS tag_categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  match_id INTEGER NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#3b82f6',
  shortcut_key TEXT,
  is_continuous INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  match_id INTEGER NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  category_id INTEGER NOT NULL REFERENCES tag_categories(id) ON DELETE CASCADE,
  player_id INTEGER REFERENCES players(id),
  team_id INTEGER REFERENCES teams(id),
  start_sec REAL NOT NULL,
  end_sec REAL NOT NULL,
  period TEXT,
  field_x REAL,
  field_y REAL,
  notes TEXT
);

CREATE TABLE IF NOT EXISTS drawing_shapes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  at_sec REAL NOT NULL,
  type TEXT NOT NULL,
  points TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#ef4444'
);

CREATE INDEX IF NOT EXISTS idx_players_team ON players(team_id);
CREATE INDEX IF NOT EXISTS idx_categories_match ON tag_categories(match_id);
CREATE INDEX IF NOT EXISTS idx_events_match ON events(match_id);
CREATE INDEX IF NOT EXISTS idx_events_category ON events(category_id);
CREATE INDEX IF NOT EXISTS idx_events_player ON events(player_id);
CREATE INDEX IF NOT EXISTS idx_drawings_event ON drawing_shapes(event_id);
`

let db: Database | null = null
let dbPath = ''

export async function initDatabase(): Promise<void> {
  if (db) return
  const wasmPath = require.resolve('sql.js/dist/sql-wasm.wasm')
  const SQL = await initSqlJs({ locateFile: () => wasmPath })
  dbPath = join(app.getPath('userData'), 'football-analysis.sqlite')
  db = existsSync(dbPath) ? new SQL.Database(readFileSync(dbPath)) : new SQL.Database()
  db.run('PRAGMA foreign_keys = ON;')
  db.exec(SCHEMA)
  persist()
}

export function getDb(): Database {
  if (!db) throw new Error('Base de dados não inicializada. Chama initDatabase() no arranque da app.')
  return db
}

export function persist(): void {
  if (!db) return
  writeFileSync(dbPath, Buffer.from(db.export()))
}

type SqlParams = (string | number | null)[]

export function dbRun(sql: string, params: SqlParams = []): void {
  getDb().run(sql, params)
  persist()
}

export function dbAll<T>(sql: string, params: SqlParams = []): T[] {
  const stmt = getDb().prepare(sql)
  stmt.bind(params)
  const rows: T[] = []
  while (stmt.step()) {
    rows.push(stmt.getAsObject() as T)
  }
  stmt.free()
  return rows
}

export function dbGet<T>(sql: string, params: SqlParams = []): T | undefined {
  return dbAll<T>(sql, params)[0]
}

export function lastInsertRowId(): number {
  const row = dbGet<{ id: number }>('SELECT last_insert_rowid() AS id')
  return row ? Number(row.id) : 0
}
