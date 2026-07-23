import { spawn } from 'child_process'
import { createHash } from 'crypto'
import { existsSync } from 'fs'
import { mkdir, mkdtemp, rename, rm, writeFile } from 'fs/promises'
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

function runProcess(bin: string, args: string[], onStderrLine?: (line: string) => void): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn(bin, args)
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
      else reject(new Error(`${bin} exited with code ${code}: ${stderr.slice(-2000)}`))
    })
  })
}

// ffmpeg's own progress lines (with -stats, on by default) look like:
// "frame=  120 fps= 30 q=28.0 size=... time=00:00:04.00 bitrate=... speed=1.2x"
function parseFfmpegTimeSec(line: string): number | null {
  const m = line.match(/time=(\d+):(\d\d):(\d\d)\.(\d+)/)
  if (!m) return null
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(m[4]) / 100
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
  const tmpOutputPath = outputPath + '.tmp'
  await runProcess(
    ffmpegPath,
    ['-y', '-i', sourcePath, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-c:a', 'aac', tmpOutputPath],
    (line) => {
      const t = parseFfmpegTimeSec(line)
      if (t != null && durationSec > 0) onProgress(Math.min(99, Math.round((t / durationSec) * 100)))
    }
  )
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

export async function cutClip(
  sourcePath: string,
  startSec: number,
  endSec: number,
  outputPath: string
): Promise<void> {
  const duration = Math.max(0, endSec - startSec)
  await runProcess(ffmpegPath, [
    '-y',
    '-ss',
    String(startSec),
    '-i',
    sourcePath,
    '-t',
    String(duration),
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-crf',
    '18',
    '-c:a',
    'aac',
    outputPath
  ])
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

export async function exportSequence(
  sourcePath: string,
  segments: { startSec: number; endSec: number }[],
  outputPath: string
): Promise<void> {
  const workDir = await mkdtemp(join(tmpdir(), 'football-clips-'))
  try {
    const clipPaths: string[] = []
    for (let i = 0; i < segments.length; i++) {
      const clipPath = join(workDir, `clip_${i}.mp4`)
      await cutClip(sourcePath, segments[i].startSec, segments[i].endSec, clipPath)
      clipPaths.push(clipPath)
    }
    const listFile = join(workDir, 'list.txt')
    const listContent = clipPaths.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join('\n')
    await writeFile(listFile, listContent, 'utf-8')
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
      outputPath
    ])
  } finally {
    await rm(workDir, { recursive: true, force: true })
  }
}
