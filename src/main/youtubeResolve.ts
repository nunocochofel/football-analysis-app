import { spawn } from 'child_process'
import { existsSync } from 'fs'
import { delimiter, join } from 'path'

// Experimental/test-only YouTube LIVE input — see the module-level comment in liveInput.ts for
// why this exists and how it stays decoupled from the real (RTMP) LIVE engine.
//
// TOOL CHOICE: resolving a youtube.com/watch?v=... page into an actual playable media URL means
// replicating YouTube's player-config parsing and signature deciphering — logic that changes
// often enough that YouTube's own official clients update constantly to keep up with it. That is
// exactly what yt-dlp exists to do and actively maintains; hand-rolling a parser for this would be
// fragile from day one and a real ongoing maintenance burden for a feature explicitly scoped as
// "test source, not structural" — reusing the tool built and kept up to date for this problem is
// the appropriate call here, not writing a second, worse version of it.
//
// DISTRIBUTION DECISION: yt-dlp is NOT bundled with LINHA (unlike ffmpeg/ffprobe, which ARE, via
// ffmpeg-static/ffprobe-static — see ffmpeg.ts). Reasons, checked before deciding:
//   - License: yt-dlp is Unlicense (public domain equivalent) — no restriction either way.
//   - Size/distribution: yt-dlp's standalone Windows executable is itself ~20-40MB; bundling it
//     would meaningfully grow every LINHA installer for a feature most users (anyone with a real
//     Veo/RTMP source) will never touch.
//   - Offline requirement: the app must work fully offline when YouTube isn't being used — a
//     resolveYouTubeUrl() call only ever happens when the user explicitly selects "YouTube LIVE"
//     and clicks Ligar. Nothing here runs at app startup, and nothing else in LINHA depends on
//     yt-dlp existing at all.
//   - Cross-platform (future macOS, not implemented this phase): yt-dlp publishes a standalone
//     build for every relevant OS. Looking it up by name on PATH means this file needs zero
//     platform-specific logic to eventually work on macOS too — "when we have Veo, same engine,
//     no rewrite" applies here too: if yt-dlp is ever removed/never installed, only the YouTube
//     option is affected (a clear, contained error — see resolveYouTubeUrl below), RTMP is
//     completely unaffected either way.
// Net effect: yt-dlp is a bring-your-own external tool, looked up on PATH exactly like any other
// CLI utility the OS already knows how to find — not a new dependency LINHA ships or installs.

const YOUTUBE_URL_PATTERN = /^https?:\/\/(www\.|m\.)?(youtube\.com|youtu\.be)\/\S+$/i

export function isValidYouTubeUrl(url: string): boolean {
  if (typeof url !== 'string') return false
  const trimmed = url.trim()
  return YOUTUBE_URL_PATTERN.test(trimmed) && !/\s/.test(trimmed)
}

export interface YouTubeResolveOptions {
  // Test-only, mirrors LiveSessionStartOptions.ffmpegBinOverride in liveIngest.ts — lets tests
  // point at a controlled/broken "yt-dlp" without touching whatever is actually on PATH.
  ytDlpBinOverride?: string
}

// yt-dlp resolving a live stream is a handful of HTTP round-trips to YouTube — generous but
// bounded, so a genuinely stuck/hanging process (bad network, YouTube-side issue) doesn't leave
// the UI on "CONNECTING" forever.
const YTDLP_TIMEOUT_MS = 25000

// Resolves to an ABSOLUTE path by manually walking process.env.PATH, rather than handing a bare
// "yt-dlp"/"yt-dlp.exe" name to spawn() and hoping it does its own PATH search — verified directly
// (not assumed) that it doesn't reliably: child_process.spawn() without shell:true does NOT do
// Windows PATH-based bare-name resolution the way a shell would, so a bare name here would leave
// yt-dlp silently unreachable even when correctly installed and on PATH. This mirrors exactly why
// ffmpeg-static/ffprobe-static (ffmpeg.ts) were never affected by this class of bug in the first
// place — they've always resolved to a real absolute path, never a bare command name for spawn()
// to guess at.
function findExecutableOnPath(name: string): string | null {
  const dirs = (process.env.PATH || '').split(delimiter)
  const candidates = process.platform === 'win32' ? [name, `${name}.exe`, `${name}.cmd`, `${name}.bat`] : [name]
  for (const dir of dirs) {
    for (const candidate of candidates) {
      const full = join(dir, candidate)
      if (existsSync(full)) return full
    }
  }
  return null
}

function defaultYtDlpBin(): string {
  const name = process.platform === 'win32' ? 'yt-dlp' : 'yt-dlp'
  return findExecutableOnPath(name) || name // falls back to the bare name if not found on PATH — spawn() will then fail fast with ENOENT, which resolveYouTubeUrl() below already turns into the clear "yt-dlp não encontrado" message
}

interface YtDlpInfo {
  is_live?: boolean
  live_status?: string
  url?: string
  vcodec?: string
  acodec?: string
  requested_formats?: { url?: string }[]
  title?: string
}

function interpretYtDlpStderr(stderr: string): string | null {
  // yt-dlp's own error messages are already reasonably clear — these just translate the most
  // common ones so the panel doesn't show a raw Python-flavoured stack trace for the everyday
  // cases (link not live yet, link is a normal video, video removed/private/region-blocked).
  if (/This live event will begin in|Premieres in/i.test(stderr)) {
    return 'Este stream ainda não começou — volta a tentar quando estiver em direto.'
  }
  if (/live stream recording is not available|live event has ended/i.test(stderr)) {
    return 'Este LIVE já terminou.'
  }
  if (/Video unavailable|content isn.t available|Private video|This video is unavailable/i.test(stderr)) {
    return 'Vídeo do YouTube indisponível (privado, removido ou bloqueado nesta região).'
  }
  if (/Unable to extract|Unsupported URL/i.test(stderr)) {
    return 'Não foi possível reconhecer este URL como um vídeo do YouTube válido.'
  }
  const lastLine = stderr
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .pop()
  return lastLine ? lastLine.replace(/^ERROR:\s*/i, '') : null
}

// Resolves a youtube.com/watch or youtu.be LIVE url to a real, ffmpeg-readable stream URL (an HLS
// manifest URL for YouTube LIVE specifically, confirmed by direct testing against a real,
// currently-live public stream). Deliberately rejects anything yt-dlp doesn't report as currently
// live (is_live !== true) — this experimental source is scoped to LIVE only, per the task; a
// normal finished/VOD video is a clear, distinct error rather than silently "working" as if it
// were a live feed.
export async function resolveYouTubeUrl(youtubeUrl: string, opts: YouTubeResolveOptions = {}): Promise<string> {
  if (!isValidYouTubeUrl(youtubeUrl)) {
    throw new Error('URL do YouTube inválido — usa um link como https://www.youtube.com/watch?v=... ou https://youtu.be/...')
  }
  const bin = opts.ytDlpBinOverride || defaultYtDlpBin()
  // -j: dump metadata as JSON instead of downloading anything.
  // -f b: "best" single format that already muxes video+audio into one URL — avoids needing to
  //   combine separate video-only/audio-only streams (which would need two -i inputs in ffmpeg).
  // --no-warnings --no-playlist: keeps stdout to exactly the JSON we asked for, and a channel/
  //   playlist-shaped URL never accidentally resolves to "the first N videos" instead of erroring.
  const args = ['-j', '-f', 'b', '--no-warnings', '--no-playlist', youtubeUrl]
  console.log('[live][youtube] a resolver:', bin, args.join(' '))

  return new Promise<string>((resolve, reject) => {
    let proc
    try {
      // No shell involved — same reasoning as liveIngest.ts's ffmpeg spawn: the URL is one argv
      // element, never concatenated into a command string, so there is no shell-injection surface
      // here regardless of its contents.
      proc = spawn(bin, args, { windowsHide: true })
    } catch (err) {
      reject(new Error('yt-dlp não encontrado. Instala o yt-dlp e garante que fica acessível no PATH para testares com YouTube.'))
      return
    }
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => {
      try {
        proc.kill()
      } catch {
        /* already gone */
      }
      reject(new Error('A resolução do URL do YouTube demorou demasiado tempo.'))
    }, YTDLP_TIMEOUT_MS)
    proc.stdout?.on('data', (d: Buffer) => (stdout += d.toString('utf8')))
    proc.stderr?.on('data', (d: Buffer) => {
      const line = d.toString('utf8')
      stderr += line
      console.log('[live][yt-dlp]', line.trim())
    })
    proc.on('error', (err: NodeJS.ErrnoException) => {
      clearTimeout(timer)
      if (err.code === 'ENOENT') {
        reject(new Error('yt-dlp não encontrado. Instala o yt-dlp e garante que fica acessível no PATH para testares com YouTube.'))
      } else {
        reject(new Error('Falha ao arrancar o yt-dlp: ' + err.message))
      }
    })
    proc.on('close', (code) => {
      clearTimeout(timer)
      if (code !== 0) {
        reject(new Error(interpretYtDlpStderr(stderr) || `yt-dlp terminou com código ${String(code)}.`))
        return
      }
      let info: YtDlpInfo
      try {
        info = JSON.parse(stdout)
      } catch {
        reject(new Error('Não foi possível interpretar a resposta do yt-dlp.'))
        return
      }
      if (!info.is_live) {
        reject(
          new Error(
            `Este vídeo do YouTube não está em direto agora (${info.live_status || 'vídeo normal'}) — esta fonte experimental só aceita transmissões LIVE.`
          )
        )
        return
      }
      const resolvedUrl = info.url || info.requested_formats?.[0]?.url
      if (!resolvedUrl) {
        reject(new Error('yt-dlp não devolveu nenhum URL de stream utilizável para este LIVE.'))
        return
      }
      console.log('[live][youtube] stream resolvido:', info.title || '(sem título)', '·', info.vcodec, '/', info.acodec)
      resolve(resolvedUrl)
    })
  })
}
