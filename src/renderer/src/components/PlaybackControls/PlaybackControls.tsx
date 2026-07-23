interface Props {
  currentTime: number
  duration: number
  playbackRate: number
  isPaused: boolean
  onSeek: (sec: number) => void
  onSetRate: (rate: number) => void
  onTogglePlay: () => void
  onFrameStep: (dir: -1 | 1) => void
  fps: number
  inSec: number | null
  outSec: number | null
  onMarkIn: () => void
  onMarkOut: () => void
}

const RATES = [0.1, 0.25, 0.5, 1, 1.5, 2, 4]

function formatTime(sec: number): string {
  const m = Math.floor(sec / 60)
  const s = (sec % 60).toFixed(2).padStart(5, '0')
  return `${m}:${s}`
}

export default function PlaybackControls(props: Props): JSX.Element {
  const {
    currentTime,
    duration,
    playbackRate,
    isPaused,
    onSeek,
    onSetRate,
    onTogglePlay,
    onFrameStep,
    fps,
    inSec,
    outSec,
    onMarkIn,
    onMarkOut
  } = props

  return (
    <div className="playback-controls">
      <div className="row">
        <button onClick={onTogglePlay}>{isPaused ? '▶ Play' : '⏸ Pause'}</button>
        <button onClick={() => onFrameStep(-1)} title="Frame anterior">
          ⏮ Frame
        </button>
        <button onClick={() => onFrameStep(1)} title="Frame seguinte">
          Frame ⏭
        </button>
        <span className="time-readout">
          {formatTime(currentTime)} / {formatTime(duration)} ({fps.toFixed(1)} fps)
        </span>
      </div>
      <div className="row">
        <input
          type="range"
          min={0}
          max={duration || 0}
          step={0.01}
          value={currentTime}
          onChange={(e) => onSeek(Number(e.target.value))}
          style={{ flex: 1 }}
        />
      </div>
      <div className="row">
        <span>Velocidade:</span>
        {RATES.map((r) => (
          <button key={r} className={r === playbackRate ? 'active' : ''} onClick={() => onSetRate(r)}>
            {r}x
          </button>
        ))}
      </div>
      <div className="row">
        <button onClick={onMarkIn}>Marcar In ({inSec != null ? formatTime(inSec) : '--'})</button>
        <button onClick={onMarkOut}>Marcar Out ({outSec != null ? formatTime(outSec) : '--'})</button>
      </div>
    </div>
  )
}
