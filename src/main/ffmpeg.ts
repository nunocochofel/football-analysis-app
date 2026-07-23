import { spawn } from 'child_process'
import { mkdtemp, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
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

function runProcess(bin: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn(bin, args)
    let stdout = ''
    let stderr = ''
    proc.stdout.on('data', (d) => (stdout += d.toString()))
    proc.stderr.on('data', (d) => (stderr += d.toString()))
    proc.on('error', reject)
    proc.on('close', (code) => {
      if (code === 0) resolve(stdout)
      else reject(new Error(`${bin} exited with code ${code}: ${stderr.slice(-2000)}`))
    })
  })
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
