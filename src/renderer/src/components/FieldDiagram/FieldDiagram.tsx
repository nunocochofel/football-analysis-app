interface Props {
  x: number | null
  y: number | null
  onPick: (x: number, y: number) => void
  disabled?: boolean
}

export default function FieldDiagram({ x, y, onPick, disabled }: Props): JSX.Element {
  function handleClick(e: React.MouseEvent<HTMLDivElement>): void {
    if (disabled) return
    const rect = e.currentTarget.getBoundingClientRect()
    const px = ((e.clientX - rect.left) / rect.width) * 100
    const py = ((e.clientY - rect.top) / rect.height) * 100
    onPick(Math.round(px * 10) / 10, Math.round(py * 10) / 10)
  }

  return (
    <div className={`field-diagram ${disabled ? 'disabled' : ''}`} onClick={handleClick}>
      <div className="field-halfway-line" />
      <div className="field-center-circle" />
      {x != null && y != null && <div className="field-marker" style={{ left: `${x}%`, top: `${y}%` }} />}
    </div>
  )
}
