import { useEffect, useState } from 'react'
import type { Match, Player, Team } from '@shared/types'

interface Props {
  onMatchReady: (match: Match) => void
}

export default function MatchSetup({ onMatchReady }: Props): JSX.Element {
  const [teams, setTeams] = useState<Team[]>([])
  const [matches, setMatches] = useState<Match[]>([])
  const [newTeamName, setNewTeamName] = useState('')
  const [homeTeamId, setHomeTeamId] = useState<number | ''>('')
  const [awayTeamId, setAwayTeamId] = useState<number | ''>('')
  const [matchName, setMatchName] = useState('')
  const [matchDate, setMatchDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [rosterTeamId, setRosterTeamId] = useState<number | ''>('')
  const [rosterPlayers, setRosterPlayers] = useState<Player[]>([])
  const [playerName, setPlayerName] = useState('')
  const [playerNumber, setPlayerNumber] = useState('')
  const [playerPosition, setPlayerPosition] = useState('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    window.api.listTeams().then(setTeams)
    window.api.listMatches().then(setMatches)
  }, [])

  useEffect(() => {
    if (rosterTeamId === '') {
      setRosterPlayers([])
      return
    }
    window.api.listPlayersByTeam(rosterTeamId).then(setRosterPlayers)
  }, [rosterTeamId])

  async function handleCreateTeam(): Promise<void> {
    if (!newTeamName.trim()) return
    const team = await window.api.createTeam(newTeamName.trim())
    setTeams((prev) => [...prev, team].sort((a, b) => a.name.localeCompare(b.name)))
    setNewTeamName('')
  }

  async function handleAddPlayer(): Promise<void> {
    if (rosterTeamId === '' || !playerName.trim()) return
    const player = await window.api.createPlayer({
      teamId: rosterTeamId,
      name: playerName.trim(),
      number: playerNumber ? Number(playerNumber) : null,
      position: playerPosition.trim() || null
    })
    setRosterPlayers((prev) => [...prev, player])
    setPlayerName('')
    setPlayerNumber('')
    setPlayerPosition('')
  }

  async function handleImportRoster(): Promise<void> {
    if (rosterTeamId === '') {
      setError('Escolhe primeiro a equipa para importar a escalação.')
      return
    }
    const rows = await window.api.openRosterFile()
    if (!rows) return
    const players = rows
      .map((row) => {
        const name = row.name ?? row.nome ?? row.Name ?? row.Nome ?? row.player ?? row.Jogador
        if (!name) return null
        const numberRaw = row.number ?? row.numero ?? row.Number ?? row.Numero ?? row['número']
        const position = row.position ?? row.posicao ?? row.Position ?? row['Posição'] ?? null
        return {
          name: String(name).trim(),
          number: numberRaw ? Number(numberRaw) : null,
          position: position ? String(position).trim() : null
        }
      })
      .filter((p): p is { name: string; number: number | null; position: string | null } => !!p)
    if (players.length === 0) {
      setError('Não foi possível identificar colunas de nome no ficheiro (esperado: name/nome).')
      return
    }
    const created = await window.api.createPlayersBulk({ teamId: rosterTeamId, players })
    setRosterPlayers((prev) => [...prev, ...created])
    setError(null)
  }

  async function handleCreateMatch(): Promise<void> {
    if (!matchName.trim() || homeTeamId === '' || awayTeamId === '') {
      setError('Preenche nome da partida e as duas equipas.')
      return
    }
    if (homeTeamId === awayTeamId) {
      setError('As equipas de casa e fora têm de ser diferentes.')
      return
    }
    const match = await window.api.createMatch({
      name: matchName.trim(),
      date: matchDate,
      homeTeamId,
      awayTeamId
    })
    setMatches((prev) => [match, ...prev])
    onMatchReady(match)
  }

  return (
    <div className="setup-screen">
      <h1>Análise de Vídeo de Futebol</h1>

      <section className="panel">
        <h2>1. Equipas</h2>
        <div className="row">
          <input
            placeholder="Nome da equipa"
            value={newTeamName}
            onChange={(e) => setNewTeamName(e.target.value)}
          />
          <button onClick={handleCreateTeam}>Criar equipa</button>
        </div>
        <ul className="chip-list">
          {teams.map((t) => (
            <li key={t.id} className="chip">
              {t.name}
            </li>
          ))}
        </ul>
      </section>

      <section className="panel">
        <h2>2. Jogadores / Escalação</h2>
        <div className="row">
          <select value={rosterTeamId} onChange={(e) => setRosterTeamId(e.target.value ? Number(e.target.value) : '')}>
            <option value="">Escolher equipa</option>
            {teams.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
          <button onClick={handleImportRoster} disabled={rosterTeamId === ''}>
            Importar CSV/XLSX
          </button>
        </div>
        {rosterTeamId !== '' && (
          <>
            <div className="row">
              <input placeholder="Nome" value={playerName} onChange={(e) => setPlayerName(e.target.value)} />
              <input
                placeholder="Nº"
                type="number"
                value={playerNumber}
                onChange={(e) => setPlayerNumber(e.target.value)}
                style={{ width: 70 }}
              />
              <input
                placeholder="Posição"
                value={playerPosition}
                onChange={(e) => setPlayerPosition(e.target.value)}
                style={{ width: 120 }}
              />
              <button onClick={handleAddPlayer}>Adicionar jogador</button>
            </div>
            <ul className="player-list">
              {rosterPlayers.map((p) => (
                <li key={p.id}>
                  {p.number != null ? `#${p.number} ` : ''}
                  {p.name}
                  {p.position ? ` · ${p.position}` : ''}
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      <section className="panel">
        <h2>3. Nova Partida</h2>
        <div className="row">
          <input placeholder="Nome da partida" value={matchName} onChange={(e) => setMatchName(e.target.value)} />
          <input type="date" value={matchDate} onChange={(e) => setMatchDate(e.target.value)} />
        </div>
        <div className="row">
          <select value={homeTeamId} onChange={(e) => setHomeTeamId(e.target.value ? Number(e.target.value) : '')}>
            <option value="">Equipa de casa</option>
            {teams.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
          <select value={awayTeamId} onChange={(e) => setAwayTeamId(e.target.value ? Number(e.target.value) : '')}>
            <option value="">Equipa de fora</option>
            {teams.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
          <button onClick={handleCreateMatch}>Criar partida e continuar</button>
        </div>
      </section>

      {error && <p className="error">{error}</p>}

      <section className="panel">
        <h2>Partidas existentes</h2>
        <ul className="player-list">
          {matches.map((m) => (
            <li key={m.id}>
              <button className="link-button" onClick={() => onMatchReady(m)}>
                {m.name} — {m.date}
              </button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
