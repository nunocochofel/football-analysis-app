import { spawn, type ChildProcess } from 'child_process'
import { createHash, randomUUID } from 'crypto'
import { existsSync } from 'fs'
import { mkdir, mkdtemp, rename, rm, stat, unlink, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { app } from 'electron'
import ffmpegPathRaw from 'ffmpeg-static'
import ffprobeStatic from 'ffprobe-static'
import type { VideoProbeResult } from '../shared/types'

// ffmpeg-static/ffprobe-static compute their own binary path from `__dirname`, which for a
// module loaded out of app.asar always resolves to the path INSIDE the archive — a virtual
// file that can't actually be executed by the OS. asarUnpack (electron-builder config) already
// extracts a real, runnable copy alongside it at the same relative path under
// app.asar.unpacked, so redirecting the string here is the standard fix. A no-op in dev (there's
// no app.asar at all, so the string never contains it).
function unpackAsarPath(p: string): string {
  return p.replace('app.asar', 'app.asar.unpacked')
}

const ffmpegPath = unpackAsarPath(ffmpegPathRaw as unknown as string)
const ffprobePath = { path: unpackAsarPath(ffprobeStatic.path) }

// Thrown (with this exact message) when a tracked export job's process was killed via
// cancelExportJob() rather than failing on its own — callers check for this to skip the
// libx264-fallback-on-failure behavior (a cancel should stay cancelled, not silently keep
// exporting on CPU) and to show the renderer a distinct "cancelled" state instead of an error.
export const EXPORT_CANCELLED_MESSAGE = 'EXPORT_CANCELLED'

function runProcess(
  bin: string,
  args: string[],
  onStderrLine?: (line: string) => void,
  onProcess?: (proc: ChildProcess) => void
): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn(bin, args)
    onProcess?.(proc)
    let stdout = ''
    let stderr = ''
    proc.stdout.on('data', (d) => (stdout += d.toString()))
    proc.stderr.on('data', (d) => {
      const chunk = d.toString()
      stderr += chunk
      if (onStderrLine) {
        for (const line of chunk.split('\n')) onStderrLine(line)
      }
    })
    proc.on('error', reject)
    proc.on('close', (code) => {
      if (code === 0) resolve(stdout)
      else if (proc.killed) reject(new Error(EXPORT_CANCELLED_MESSAGE))
      else reject(new Error(`${bin} exited with code ${code}: ${stderr.slice(-2000)}`))
    })
  })
}

// Export jobs (the ffmpeg encode step of exportClipFramesWithAudio) are tracked by a renderer-
// generated jobId so a queue item's "Cancelar" action can reach the right in-flight process —
// the renderer's own capture loop has its own, separate cancel checkpoint (a flag checked at its
// existing per-frame yield point) for the capture phase that happens before this even starts.
const activeExportJobs = new Map<string, ChildProcess>()
export function cancelExportJob(jobId: string): boolean {
  const proc = activeExportJobs.get(jobId)
  if (!proc) return false
  proc.kill()
  return true
}

// ffmpeg's own progress lines (with -stats, on by default) look like:
// "frame=  120 fps= 30 q=28.0 size=... time=00:00:04.00 bitrate=... speed=1.2x"
function parseFfmpegTimeSec(line: string): number | null {
  const m = line.match(/time=(\d+):(\d\d):(\d\d)\.(\d+)/)
  if (!m) return null
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(m[4]) / 100
}

// Hardware H.264 encoding: the bundled ffmpeg has NVENC/QuickSync/AMF (Windows) and VideoToolbox
// (macOS) compiled in, but whether any of them actually WORK depends on the machine's real GPU
// and drivers — the codec being present in `ffmpeg -encoders` proves nothing on its own. Detected
// once per app run (a real ~0.2s test encode per candidate, cheapest way to know for sure) and
// cached, rather than re-probed on every clip export. libx264 (plain CPU) is the universal
// fallback — always tried if the detected hardware encoder ever fails on a real export too, so a
// GPU/driver hiccup degrades an export's speed, never breaks it outright.
type HwEncoder = { codec: string; args: string[] }
let cachedHwEncoder: HwEncoder | null | undefined // undefined = not probed yet this run

async function probeEncoder(codec: string, args: string[]): Promise<boolean> {
  const testOut = join(tmpdir(), `hwenc-probe-${randomUUID()}.mp4`)
  try {
    await runProcess(ffmpegPath, [
      '-y',
      '-f',
      'lavfi',
      '-i',
      'color=black:size=64x64:duration=0.2:rate=5',
      '-frames:v',
      '1',
      '-c:v',
      codec,
      ...args,
      '-f',
      'mp4',
      testOut
    ])
    const st = await stat(testOut).catch(() => null)
    return !!st && st.size > 0
  } catch {
    return false
  } finally {
    await unlink(testOut).catch(() => {})
  }
}

async function detectHardwareEncoder(): Promise<HwEncoder | null> {
  if (cachedHwEncoder !== undefined) return cachedHwEncoder
  const candidates: HwEncoder[] =
    process.platform === 'darwin'
      ? [{ codec: 'h264_videotoolbox', args: ['-b:v', '6M'] }]
      : [
          { codec: 'h264_nvenc', args: ['-rc', 'vbr', '-cq', '20', '-b:v', '0'] },
          { codec: 'h264_qsv', args: ['-global_quality', '20'] },
          { codec: 'h264_amf', args: ['-rc', 'cqp', '-qp_i', '20', '-qp_p', '20'] }
        ]
  for (const candidate of candidates) {
    if (await probeEncoder(candidate.codec, candidate.args)) {
      cachedHwEncoder = candidate
      return candidate
    }
  }
  cachedHwEncoder = null
  return null
}

// Playback fallback: some codecs a camera phone records with (HEVC/H.265 in a .mov being the
// most common case — the iPhone default since ~2017) have no decoder bundled in Chromium, so the
// native <video> element can never play them no matter how the file is loaded. ffmpeg itself has
// no such restriction, so re-encoding once to widely-supported H.264/AAC and playing THAT copy
// is the fix — cut/export still runs against the original file, untouched, so nothing there loses
// quality. Cached by a hash of the source path so repeat opens of the same match don't re-pay the
// (multi-minute, for a full match) conversion cost.
function playbackCacheDir(): string {
  return join(app.getPath('userData'), 'playback-cache')
}
export function transcodedCachePath(sourcePath: string): string {
  const hash = createHash('sha1').update(sourcePath).digest('hex').slice(0, 16)
  return join(playbackCacheDir(), `${hash}.mp4`)
}
export function hasTranscodedCache(sourcePath: string): boolean {
  return existsSync(transcodedCachePath(sourcePath))
}
export async function transcodeForPlayback(
  sourcePath: string,
  durationSec: number,
  onProgress: (percent: number) => void
): Promise<string> {
  await mkdir(playbackCacheDir(), { recursive: true })
  const outputPath = transcodedCachePath(sourcePath)
  // ffmpeg picks the output container purely from the filename's last extension — "*.mp4.tmp"
  // has none it recognizes ("Unable to choose an output format"), so -f mp4 pins it explicitly
  // regardless of what the temp filename looks like.
  const tmpOutputPath = outputPath + '.tmp'
  function buildArgs(hw: HwEncoder | null): string[] {
    const videoArgs = hw ? ['-c:v', hw.codec, ...hw.args] : ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20']
    return ['-y', '-i', sourcePath, ...videoArgs, '-c:a', 'aac', '-f', 'mp4', tmpOutputPath]
  }
  async function runTranscode(hw: HwEncoder | null): Promise<void> {
    await runProcess(ffmpegPath, buildArgs(hw), (line) => {
      const t = parseFfmpegTimeSec(line)
      if (t != null && durationSec > 0) onProgress(Math.min(99, Math.round((t / durationSec) * 100)))
    })
  }
  const hw = await detectHardwareEncoder()
  try {
    await runTranscode(hw)
  } catch (err) {
    if (hw) {
      await runTranscode(null)
    } else {
      throw err
    }
  }
  // Renamed into place only once fully written, so a half-converted file left behind by a crash
  // or force-quit mid-transcode is never mistaken for a valid cache hit on the next attempt.
  await rename(tmpOutputPath, outputPath)
  return outputPath
}

export async function probeVideo(filePath: string): Promise<VideoProbeResult> {
  const out = await runProcess(ffprobePath.path, [
    '-v',
    'error',
    '-print_format',
    'json',
    '-show_format',
    '-show_streams',
    filePath
  ])
  const data = JSON.parse(out)
  const videoStream = data.streams.find((s: { codec_type: string }) => s.codec_type === 'video')
  if (!videoStream) throw new Error('Nenhuma stream de vídeo encontrada no ficheiro.')
  const [num, den] = String(videoStream.avg_frame_rate ?? videoStream.r_frame_rate ?? '25/1').split('/')
  const fps = den && Number(den) !== 0 ? Number(num) / Number(den) : Number(num)
  return {
    durationSec: Number(data.format.duration ?? videoStream.duration ?? 0),
    width: Number(videoStream.width),
    height: Number(videoStream.height),
    fps,
    codec: String(videoStream.codec_name)
  }
}

export type ExportResolution = 'original' | '1080p' | '720p'
export type ExportQuality = 'high' | 'balanced' | 'small'

const CRF_BY_QUALITY: Record<ExportQuality, number> = { high: 18, balanced: 20, small: 24 }

// Per-codec quality knobs are different shapes (CRF-like for nvenc/qsv/amf, bitrate-tiered for
// videotoolbox, which has no per-frame quality control in older ffmpeg builds) — kept separate
// from detectHardwareEncoder's own probe args (those only need to produce *a* valid frame quickly
// to confirm the codec works at all; quality doesn't matter there).
function hwQualityArgs(codec: string, quality: ExportQuality): string[] {
  const crf = CRF_BY_QUALITY[quality]
  switch (codec) {
    case 'h264_nvenc':
      return ['-rc', 'vbr', '-cq', String(crf), '-b:v', '0']
    case 'h264_qsv':
      return ['-global_quality', String(crf)]
    case 'h264_amf':
      return ['-rc', 'cqp', '-qp_i', String(crf), '-qp_p', String(crf)]
    case 'h264_videotoolbox':
      return ['-b:v', quality === 'high' ? '10M' : quality === 'balanced' ? '6M' : '3M']
    default:
      return []
  }
}

// min(iw,W)/min(ih,H) before force_original_aspect_ratio=decrease is what actually prevents
// upscaling — decrease alone still scales UP a smaller source to fill the target box; capping the
// target to the source's own size first makes it a no-op whenever the source is already smaller.
function scaleFilterArgs(resolution: ExportResolution): string[] {
  if (resolution === 'original') return []
  const [w, h] = resolution === '1080p' ? [1920, 1080] : [1280, 720]
  return ['-vf', `scale=w='min(iw,${w})':h='min(ih,${h})':force_original_aspect_ratio=decrease:force_divisible_by=2`]
}

// Fast clip export: the renderer seeks the video frame-by-frame (not real-time playback) and
// draws each one onto an offscreen canvas — video frame + zoom crop + whatever drawings/freezes
// are active at that instant — so a 10-minute clip with 40 drawings takes as long as it takes to
// seek+draw ~240 frames, not 10 real minutes of MediaRecorder capture. This takes that JPEG
// sequence (JPEG, not PNG — these are throwaway intermediates re-encoded to H.264 a moment later,
// so lossless compression buys nothing and only costs encode/decode/transfer time) and encodes it
// into the video track, then muxes in the ORIGINAL audio for the same [audioInSec, audioOutSec]
// window (audio doesn't need per-frame JS rendering, so cutting it straight from the source file
// is both fast and lossless). If a clip has freeze points the video track ends up slightly longer
// than the audio; -shortest just lets it run out near the end rather than stretching to fit.
export async function exportClipFramesWithAudio(
  frames: string[],
  fps: number,
  sourceVideoPath: string | null,
  audioInSec: number,
  audioOutSec: number,
  outputPath: string,
  resolution: ExportResolution,
  quality: ExportQuality,
  jobId: string,
  onProgress: (percent: number) => void
): Promise<void> {
  const workDir = await mkdtemp(join(tmpdir(), 'football-clip-frames-'))
  try {
    for (let i = 0; i < frames.length; i++) {
      const framePath = join(workDir, `frame_${String(i).padStart(5, '0')}.jpg`)
      await writeFile(framePath, Buffer.from(frames[i], 'base64'))
    }
    const pattern = join(workDir, 'frame_%05d.jpg')
    const durationSec = frames.length / fps
    const tmpOutputPath = outputPath + '.tmp'
    const hasAudio = !!sourceVideoPath && audioOutSec > audioInSec

    function buildArgs(hw: HwEncoder | null): string[] {
      const args = ['-y', '-framerate', String(fps), '-i', pattern]
      if (hasAudio) {
        args.push('-ss', String(audioInSec), '-to', String(audioOutSec), '-i', sourceVideoPath as string)
      }
      args.push('-map', '0:v')
      if (hasAudio) args.push('-map', '1:a?')
      args.push(...scaleFilterArgs(resolution))
      if (hw) {
        args.push('-c:v', hw.codec, ...hwQualityArgs(hw.codec, quality), '-pix_fmt', 'yuv420p')
      } else {
        args.push('-c:v', 'libx264', '-preset', 'veryfast', '-crf', String(CRF_BY_QUALITY[quality]), '-pix_fmt', 'yuv420p')
      }
      if (hasAudio) args.push('-c:a', 'aac', '-b:a', '192k', '-shortest')
      // ffmpeg picks the output container purely from the filename's last extension — "*.mp4.tmp"
      // has none it recognizes ("Unable to choose an output format"), so -f mp4 pins it explicitly.
      // This was the actual cause of "Não foi possível concluir a exportação": every export failed
      // at this exact ffmpeg invocation, regardless of anything upstream (frames, audio, JPEG vs PNG).
      args.push('-movflags', '+faststart', '-f', 'mp4', tmpOutputPath)
      return args
    }

    async function runEncode(hw: HwEncoder | null): Promise<void> {
      await runProcess(
        ffmpegPath,
        buildArgs(hw),
        (line) => {
          const t = parseFfmpegTimeSec(line)
          if (t != null && durationSec > 0) onProgress(Math.min(99, Math.round((t / durationSec) * 100)))
        },
        (proc) => activeExportJobs.set(jobId, proc)
      )
    }

    const hw = await detectHardwareEncoder()
    try {
      await runEncode(hw)
    } catch (err) {
      // A cancelled job stays cancelled — never silently keep exporting on CPU after the user
      // asked to stop. Otherwise: a codec passing the earlier lightweight probe doesn't guarantee
      // it survives a real encode (driver quirks under load, VRAM limits, etc.) — if the hardware
      // path fails here for a real reason, fall back to libx264 once rather than losing the
      // export outright.
      const cancelled = err instanceof Error && err.message === EXPORT_CANCELLED_MESSAGE
      if (cancelled || !hw) {
        throw err
      }
      await runEncode(null)
    } finally {
      activeExportJobs.delete(jobId)
    }
    await rename(tmpOutputPath, outputPath)
  } finally {
    await rm(workDir, { recursive: true, force: true })
  }
}

export async function exportImageSequence(
  frames: string[],
  fps: number,
  outputPath: string,
  format: 'mp4' | 'gif'
): Promise<void> {
  const workDir = await mkdtemp(join(tmpdir(), 'football-frames-'))
  try {
    for (let i = 0; i < frames.length; i++) {
      const framePath = join(workDir, `frame_${String(i).padStart(4, '0')}.png`)
      await writeFile(framePath, Buffer.from(frames[i], 'base64'))
    }
    const pattern = join(workDir, 'frame_%04d.png')
    if (format === 'gif') {
      // Two-pass palette encode — a direct single-pass GIF from ffmpeg bands/dithers badly on the
      // pitch's flat green background.
      const palettePath = join(workDir, 'palette.png')
      await runProcess(ffmpegPath, [
        '-y',
        '-framerate',
        String(fps),
        '-i',
        pattern,
        '-vf',
        'palettegen',
        palettePath
      ])
      await runProcess(ffmpegPath, [
        '-y',
        '-framerate',
        String(fps),
        '-i',
        pattern,
        '-i',
        palettePath,
        '-lavfi',
        'paletteuse',
        outputPath
      ])
    } else {
      await runProcess(ffmpegPath, [
        '-y',
        '-framerate',
        String(fps),
        '-i',
        pattern,
        '-c:v',
        'libx264',
        '-pix_fmt',
        'yuv420p',
        outputPath
      ])
    }
  } finally {
    await rm(workDir, { recursive: true, force: true })
  }
}

// "Vídeo compilado": joins already-exported individual clips (in the order given) into one file.
// A plain stream-copy concat (no re-encode) is valid and lossless here specifically because every
// clip in one export batch was just encoded with the exact same codec/resolution/quality by
// exportClipFramesWithAudio above — concat demuxer's -c copy requires matching stream parameters,
// which this guarantees by construction.
export async function concatClips(clipPaths: string[], outputPath: string): Promise<void> {
  const workDir = await mkdtemp(join(tmpdir(), 'football-concat-'))
  try {
    const listFile = join(workDir, 'list.txt')
    const listContent = clipPaths.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join('\n')
    await writeFile(listFile, listContent, 'utf-8')
    const tmpOutputPath = outputPath + '.tmp'
    await runProcess(ffmpegPath, [
      '-y',
      '-f',
      'concat',
      '-safe',
      '0',
      '-i',
      listFile,
      '-c',
      'copy',
      '-f',
      'mp4',
      tmpOutputPath
    ])
    await rename(tmpOutputPath, outputPath)
  } finally {
    await rm(workDir, { recursive: true, force: true })
  }
}

