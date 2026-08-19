import { mkdtemp, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { exportClipDirect, type ExportQuality, type ExportResolution } from './ffmpeg'
import type { LiveBuffer } from './liveBuffer'

// Fase LIVE 3 — the "CLIP ENGINE" from the task's own architecture diagram: a small, isolated seam
// between LiveBuffer (read-only here — never modified to double as an exporter, per the task's
// explicit instruction) and the EXISTING export pipeline in ffmpeg.ts, reused as-is. LiveBuffer's
// fragments are raw ISO-BMFF boxes (moof+mdat, see mp4Boxes.ts) — concatenating the session's init
// segment (ftyp+moov) followed by the fragments covering [inMs, outMs] in order produces a byte-for-
// byte NORMAL, valid fragmented MP4 file (this is literally the same box sequence ffmpeg's own
// -movflags frag_keyframe output has when written to a file instead of streamed) — so once that
// concatenation is written to one temp file, exportClipDirect() can trim/encode it exactly like any
// other source video, with zero new encoding logic of its own.
export async function exportLiveClip(
  liveBuffer: LiveBuffer,
  inMs: number,
  outMs: number,
  outputPath: string,
  resolution: ExportResolution,
  quality: ExportQuality,
  jobId: string,
  onProgress: (percent: number) => void
): Promise<void> {
  if (!Number.isFinite(inMs) || !Number.isFinite(outMs) || outMs <= inMs) {
    throw new Error('Intervalo do corte LIVE inválido.')
  }
  const initBytes = liveBuffer.getInitSegment()
  if (!initBytes) {
    throw new Error('O buffer LIVE ainda não tem um segmento inicial — tenta novamente dentro de momentos.')
  }

  // Overlap, not exact containment — a fragment covering only PART of [inMs, outMs] still needs to
  // be included (its content is trimmed precisely afterwards by exportClipDirect's own -ss/-t, not
  // by which fragments got selected here).
  const index = liveBuffer.getIndexSnapshot()
  const covering = index.filter((s) => s.endMs > inMs && s.startMs < outMs).sort((a, b) => a.id - b.id)
  if (!covering.length) {
    const oldest = liveBuffer.oldestMs
    const edge = liveBuffer.liveEdgeMs
    throw new Error(
      `Este intervalo já não está disponível no buffer LIVE (pedido ${Math.round(inMs)}–${Math.round(outMs)}, ` +
        `janela atual ${oldest !== null ? Math.round(oldest) : '?'}–${edge !== null ? Math.round(edge) : '?'}).`
    )
  }

  // Fetched in parallel and eagerly — minimizes the (small, real) window in which a segment this
  // clip needs could be trimmed out of the ring buffer by a fragment arriving concurrently (see the
  // task's own "o clip não pode desaparecer" requirement: once these bytes are read into our own
  // temp file below, LiveBuffer trimming them afterwards can no longer affect this export at all).
  const segmentBytesList = await Promise.all(covering.map((s) => liveBuffer.getSegment(s.id)))
  if (segmentBytesList.some((b) => b === null)) {
    throw new Error(
      'Um ou mais segmentos deste corte saíram do buffer LIVE antes de serem lidos — tenta um intervalo mais recente ou mais próximo do live edge.'
    )
  }

  const workDir = await mkdtemp(join(tmpdir(), 'linha-live-clip-'))
  try {
    const tempInputPath = join(workDir, 'source.mp4')
    const merged = Buffer.concat([initBytes, ...(segmentBytesList as Buffer[])])
    await writeFile(tempInputPath, merged)

    // Segments are indexed by wall-clock receipt time (see the module-level comment in
    // liveIngest.ts), not by the file's own internal PTS — but ffmpeg's -c:v copy remux never
    // rewrites the source's real timestamps, and a live stream is paced in real time, so the two
    // track each other closely (no accumulating drift: each segment boundary is freshly wall-clock-
    // stamped at the moment it was received, not integrated from session start). -ss below is a
    // real, accurate, demuxer-level seek WITHIN this concatenated file — not an external wall-clock
    // assumption imposed on ffmpeg — so any such skew only shifts the cut point by that small
    // amount, never corrupts or wildly mis-times the output. Measured and reported in this phase's
    // test report.
    const rangeStartMs = covering[0].startMs
    const relativeInSec = Math.max(0, (inMs - rangeStartMs) / 1000)
    const relativeOutSec = Math.max(relativeInSec + 0.05, (outMs - rangeStartMs) / 1000)

    // exportClipDirect always re-encodes (never a raw stream-copy trim — see its own comment in
    // ffmpeg.ts) precisely because -c copy can only cut on keyframe boundaries; reusing it here
    // means a LIVE clip gets the SAME frame-accurate IN point local-video clips already get, for
    // free, without a second encoding strategy to build/maintain.
    await exportClipDirect(tempInputPath, relativeInSec, relativeOutSec, outputPath, resolution, quality, jobId, onProgress)
  } finally {
    await rm(workDir, { recursive: true, force: true })
  }
}
