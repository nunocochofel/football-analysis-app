import { useState } from 'react'
import type { TagCategory } from '@shared/types'

interface Props {
  categories: TagCategory[]
  openCategoryIds: Set<number>
  onTagPress: (category: TagCategory) => void
  onCreateCategory: (input: {
    name: string
    color: string
    shortcutKey: string | null
    isContinuous: boolean
  }) => void
  onDeleteCategory: (id: number) => void
}

const DEFAULT_COLORS = ['#3b82f6', '#ef4444', '#22c55e', '#f59e0b', '#a855f7', '#14b8a6', '#eab308']

export default function TaggingPanel({
  categories,
  openCategoryIds,
  onTagPress,
  onCreateCategory,
  onDeleteCategory
}: Props): JSX.Element {
  const [name, setName] = useState('')
  const [shortcutKey, setShortcutKey] = useState('')
  const [isContinuous, setIsContinuous] = useState(false)
  const [color, setColor] = useState(DEFAULT_COLORS[0])

  function handleCreate(): void {
    if (!name.trim()) return
    onCreateCategory({
      name: name.trim(),
      color,
      shortcutKey: shortcutKey.trim() || null,
      isContinuous
    })
    setName('')
    setShortcutKey('')
    setIsContinuous(false)
    setColor(DEFAULT_COLORS[(categories.length + 1) % DEFAULT_COLORS.length])
  }

  return (
    <div className="tagging-panel">
      <h3>Categorias de Eventos</h3>
      <div className="tag-buttons">
        {categories.map((c) => {
          const isOpen = openCategoryIds.has(c.id)
          return (
            <button
              key={c.id}
              className={`tag-button ${isOpen ? 'tag-open' : ''}`}
              style={{ borderColor: c.color, background: isOpen ? c.color : undefined }}
              onClick={() => onTagPress(c)}
              title={c.isContinuous ? 'Tag contínua: clicar para iniciar/terminar' : 'Tag pontual'}
            >
              <span className="tag-name">{c.name}</span>
              {c.shortcutKey && <span className="tag-shortcut">[{c.shortcutKey}]</span>}
              <button
                className="tag-delete"
                onClick={(e) => {
                  e.stopPropagation()
                  onDeleteCategory(c.id)
                }}
              >
                ×
              </button>
            </button>
          )
        })}
      </div>

      <details className="new-category">
        <summary>+ Nova categoria</summary>
        <div className="row">
          <input placeholder="Nome (ex: Remate)" value={name} onChange={(e) => setName(e.target.value)} />
          <input
            placeholder="Atalho (ex: r)"
            value={shortcutKey}
            maxLength={1}
            onChange={(e) => setShortcutKey(e.target.value)}
            style={{ width: 60 }}
          />
        </div>
        <div className="row">
          {DEFAULT_COLORS.map((c) => (
            <button
              key={c}
              className={`color-swatch ${c === color ? 'selected' : ''}`}
              style={{ background: c }}
              onClick={() => setColor(c)}
            />
          ))}
        </div>
        <label className="row">
          <input type="checkbox" checked={isContinuous} onChange={(e) => setIsContinuous(e.target.checked)} />
          Tag contínua (início/fim)
        </label>
        <button onClick={handleCreate}>Criar categoria</button>
      </details>
    </div>
  )
}
