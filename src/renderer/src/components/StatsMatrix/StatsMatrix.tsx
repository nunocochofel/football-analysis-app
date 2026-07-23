import { useMemo } from 'react'
import type { EventRecord, Player, TagCategory } from '@shared/types'

interface Props {
  events: EventRecord[]
  categories: TagCategory[]
  players: Player[]
}

export default function StatsMatrix({ events, categories, players }: Props): JSX.Element {
  const matrix = useMemo(() => {
    const counts = new Map<string, number>()
    for (const e of events) {
      const key = `${e.categoryId}:${e.playerId ?? 'none'}`
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
    return counts
  }, [events])

  const categoryTotals = useMemo(() => {
    const totals = new Map<number, number>()
    for (const e of events) totals.set(e.categoryId, (totals.get(e.categoryId) ?? 0) + 1)
    return totals
  }, [events])

  function exportCsv(): void {
    const header = ['jogador', ...categories.map((c) => c.name), 'total']
    const lines = [header.join(',')]
    for (const p of players) {
      const values = categories.map((c) => matrix.get(`${c.id}:${p.id}`) ?? 0)
      const total = values.reduce((a, b) => a + b, 0)
      lines.push([p.name, ...values, total].join(','))
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'estatisticas.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="stats-matrix">
      <div className="row">
        <h3>Estatísticas</h3>
        <button onClick={exportCsv}>Exportar CSV</button>
      </div>
      <div className="matrix-scroll">
        <table>
          <thead>
            <tr>
              <th>Jogador</th>
              {categories.map((c) => (
                <th key={c.id} style={{ color: c.color }}>
                  {c.name} ({categoryTotals.get(c.id) ?? 0})
                </th>
              ))}
              <th>Total</th>
            </tr>
          </thead>
          <tbody>
            {players.map((p) => {
              const values = categories.map((c) => matrix.get(`${c.id}:${p.id}`) ?? 0)
              const total = values.reduce((a, b) => a + b, 0)
              return (
                <tr key={p.id}>
                  <td>{p.name}</td>
                  {values.map((v, i) => (
                    <td key={categories[i].id}>{v || ''}</td>
                  ))}
                  <td>{total || ''}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
