import { useState } from 'react'
import { Stage, Layer, Line, Circle, Arrow } from 'react-konva'
import type Konva from 'konva'
import type { DrawingShape } from '@shared/types'

type KonvaMouseEvent = Konva.KonvaEventObject<MouseEvent>

type Tool = 'none' | 'line' | 'arrow' | 'circle' | 'polygon'

interface Props {
  width: number
  height: number
  shapes: DrawingShape[]
  activeTool: Tool
  color: string
  onToolChange: (tool: Tool) => void
  onColorChange: (color: string) => void
  onShapeComplete: (type: DrawingShape['type'], points: number[]) => void
  canDraw: boolean
}

export default function DrawingOverlay({
  width,
  height,
  shapes,
  activeTool,
  color,
  onToolChange,
  onColorChange,
  onShapeComplete,
  canDraw
}: Props): JSX.Element {
  const [draftPoints, setDraftPoints] = useState<number[]>([])
  const [isDrawing, setIsDrawing] = useState(false)

  function handleMouseDown(e: KonvaMouseEvent): void {
    if (!canDraw || activeTool === 'none') return
    const stage = e.target.getStage()
    const pos = stage?.getPointerPosition()
    if (!pos) return
    if (activeTool === 'polygon') {
      setDraftPoints((prev) => [...prev, pos.x, pos.y])
      setIsDrawing(true)
    } else {
      setDraftPoints([pos.x, pos.y, pos.x, pos.y])
      setIsDrawing(true)
    }
  }

  function handleMouseMove(e: KonvaMouseEvent): void {
    if (!isDrawing || activeTool === 'none' || activeTool === 'polygon') return
    const stage = e.target.getStage()
    const pos = stage?.getPointerPosition()
    if (!pos) return
    setDraftPoints((prev) => [prev[0], prev[1], pos.x, pos.y])
  }

  function handleMouseUp(): void {
    if (!isDrawing || activeTool === 'none' || activeTool === 'polygon') return
    if (draftPoints.length === 4) {
      onShapeComplete(activeTool === 'circle' ? 'circle' : activeTool, draftPoints)
    }
    setDraftPoints([])
    setIsDrawing(false)
  }

  function handleDoubleClick(): void {
    if (activeTool === 'polygon' && draftPoints.length >= 6) {
      onShapeComplete('polygon', draftPoints)
      setDraftPoints([])
      setIsDrawing(false)
    }
  }

  return (
    <div className="drawing-overlay-wrap">
      <div className="drawing-toolbar">
        {(['none', 'line', 'arrow', 'circle', 'polygon'] as Tool[]).map((t) => (
          <button key={t} className={activeTool === t ? 'active' : ''} onClick={() => onToolChange(t)} disabled={!canDraw}>
            {t === 'none' ? 'Selecionar' : t}
          </button>
        ))}
        <input type="color" value={color} onChange={(e) => onColorChange(e.target.value)} />
        {!canDraw && <span className="hint">Pausa o vídeo e seleciona um evento para desenhar</span>}
      </div>
      <Stage
        width={width}
        height={height}
        className="drawing-stage"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onDblClick={handleDoubleClick}
      >
        <Layer>
          {shapes.map((s) => {
            if (s.type === 'circle') {
              const [x1, y1, x2, y2] = s.points
              const r = Math.hypot(x2 - x1, y2 - y1)
              return <Circle key={s.id} x={x1} y={y1} radius={r} stroke={s.color} strokeWidth={3} />
            }
            if (s.type === 'arrow') {
              return <Arrow key={s.id} points={s.points} stroke={s.color} fill={s.color} strokeWidth={3} />
            }
            return <Line key={s.id} points={s.points} stroke={s.color} strokeWidth={3} closed={s.type === 'polygon'} />
          })}
          {isDrawing && draftPoints.length >= 4 && activeTool === 'circle' && (
            <Circle
              x={draftPoints[0]}
              y={draftPoints[1]}
              radius={Math.hypot(draftPoints[2] - draftPoints[0], draftPoints[3] - draftPoints[1])}
              stroke={color}
              strokeWidth={3}
              dash={[4, 4]}
            />
          )}
          {isDrawing && draftPoints.length >= 4 && activeTool === 'arrow' && (
            <Arrow points={draftPoints} stroke={color} fill={color} strokeWidth={3} dash={[4, 4]} />
          )}
          {isDrawing && draftPoints.length >= 4 && activeTool === 'line' && (
            <Line points={draftPoints} stroke={color} strokeWidth={3} dash={[4, 4]} />
          )}
          {isDrawing && activeTool === 'polygon' && draftPoints.length >= 2 && (
            <Line points={draftPoints} stroke={color} strokeWidth={3} dash={[4, 4]} />
          )}
        </Layer>
      </Stage>
    </div>
  )
}
