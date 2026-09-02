import { spawn } from 'child_process'
import { ensureYtDlpBin } from './ytdlpProvision'

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

interface YtDlpFormat {
  url?: string
  vcodec?: string
  acodec?: string
}
interface YtDlpInfo extends YtDlpFormat {
  is_live?: boolean
  live_status?: string
  requested_formats?: YtDlpFormat[]
  title?: string
}

// What liveIngest.ts's start() actually needs to build an ffmpeg command from. YouTube LIVE
// (confirmed by running `yt-dlp -F` against three real, currently-live public streams while
// diagnosing v0.8.54's "connects but zero segments ever arrive" report — never assumed) never
// offers a single pre-muxed video+audio format the way VOD does: every video format is
// "video only", audio lives in a completely separate "audio only" format. audioUrl is non-null
// exactly when that split happened; videoUrl alone is used with -an when a format genuinely has
// no audio track anywhere (rare, but handled rather than assumed away).
export interface ResolvedYouTubeStream {
  videoUrl: string
  audioUrl: string | null
  hasAudio: boolean
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

// Resolves a youtube.com/watch or youtu.be LIVE url to real, ffmpeg-readable stream URL(s).
// Deliberately rejects anything yt-dlp doesn't report as currently live (is_live !== true) — this
// experimental source is scoped to LIVE only, per the task; a normal finished/VOD video is a
// clear, distinct error rather than silently "working" as if it were a live feed.
export async function resolveYouTubeUrl(youtubeUrl: string, opts: YouTubeResolveOptions = {}): Promise<ResolvedYouTubeStream> {
  if (!isValidYouTubeUrl(youtubeUrl)) {
    throw new Error('URL do YouTube inválido — usa um link como https://www.youtube.com/watch?v=... ou https://youtu.be/...')
  }
  // ensureYtDlpBin() (see ytdlpProvision.ts) already throws its own clear, actionable error — with
  // exactly what it tried (PATH, then the download URL) and what to do about it — if it can't
  // produce a usable yt-dlp at all, so there's no separate "not found" case to handle here anymore
  // beyond the opts.ytDlpBinOverride test escape hatch.
  const bin = opts.ytDlpBinOverride || (await ensureYtDlpBin())
  // -j: dump metadata as JSON instead of downloading anything.
  // -f "bv*+ba/b": best video + best audio, falling back to a single best pre-muxed format if one
  //   exists. The fallback used to be the ONLY thing requested (plain "b") — found, via `yt-dlp -F`
  //   against three real, currently-live public streams, that YouTube LIVE never actually offers a
  //   pre-muxed format at all (every video format is "video only", audio is a separate "audio
  //   only" format) — "b" alone either hard-errors ("Requested format is not available") or, on
  //   some yt-dlp versions, silently falls back to a merge whose video-only URL was the ONLY one
  //   this code used to keep (info.requested_formats?.[0]?.url) — asking ffmpeg to encode an audio
  //   track (-c:a aac) that was never in that URL's input at all, which is exactly what made a
  //   whole v0.8.54 test session connect, read the manifest, and then serve zero segments for two
  //   minutes straight. bv*+ba explicitly asks for both halves and reports them separately (see
  //   ResolvedYouTubeStream) instead of silently keeping only one.
  // --no-warnings --no-playlist: keeps stdout to exactly the JSON we asked for, and a channel/
  //   playlist-shaped URL never accidentally resolves to "the first N videos" instead of erroring.
  const args = ['-j', '-f', 'bv*+ba/b', '--no-warnings', '--no-playlist', youtubeUrl]
  console.log('[live][youtube] a resolver:', bin, args.join(' '))

  return new Promise<ResolvedYouTubeStream>((resolve, reject) => {
    let proc
    try {
      // No shell involved — same reasoning as liveIngest.ts's ffmpeg spawn: the URL is one argv
      // element, never concatenated into a command string, so there is no shell-injection surface
      // here regardless of its contents.
      proc = spawn(bin, args, { windowsHide: true })
    } catch (err) {
      reject(new Error(`yt-dlp não encontrado em "${bin}". Verifica a tua ligação à internet (para o download automático) ou instala manualmente: winget install yt-dlp (Windows) / brew install yt-dlp (macOS).`))
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
      reject(new Error(`A resolução do URL do YouTube demorou demasiado tempo (${bin} ${args.join(' ')}).`))
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
        reject(new Error(`yt-dlp não encontrado em "${bin}". Verifica a tua ligação à internet (para o download automático) ou instala manualmente: winget install yt-dlp (Windows) / brew install yt-dlp (macOS).`))
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
      // Real bug fixed here (found via a v0.8.54 test session, not by inspection): the old code
      // took requested_formats?.[0]?.url unconditionally, assuming a merge's first entry was
      // always usable alone — for bv*+ba it's the VIDEO half specifically, silently dropping
      // audio. Selected explicitly by codec presence instead, so it's correct regardless of the
      // array's order (never actually documented/guaranteed by yt-dlp). Identified by vcodec, not
      // acodec — checked against a real YouTube LIVE format's actual JSON and found acodec on the
      // audio-only entry is `undefined` (not even the string "none"), so an acodec-based check
      // would silently fail to find it; vcodec on that same entry is reliably the literal string
      // "none", and the video entry's vcodec is reliably a real codec string — this is the field
      // that's actually trustworthy here.
      let videoUrl: string | undefined
      let audioUrl: string | null = null
      let hasAudio = false
      if (info.requested_formats && info.requested_formats.length > 0) {
        const videoFmt = info.requested_formats.find((f) => f.vcodec && f.vcodec !== 'none')
        const audioFmt = info.requested_formats.find((f) => f !== videoFmt && f.vcodec === 'none')
        videoUrl = videoFmt?.url || info.requested_formats[0]?.url
        audioUrl = audioFmt?.url || null
        hasAudio = !!audioUrl
      } else {
        videoUrl = info.url
        hasAudio = !!info.acodec && info.acodec !== 'none'
      }
      if (!videoUrl) {
        reject(new Error('yt-dlp não devolveu nenhum URL de stream utilizável para este LIVE.'))
        return
      }
      console.log(
        '[live][youtube] stream resolvido:',
        info.title || '(sem título)',
        '· vídeo:', info.vcodec || '(separado)',
        '· áudio:', audioUrl ? 'separado' : hasAudio ? 'incluído' : 'AUSENTE'
      )
      resolve({ videoUrl, audioUrl, hasAudio })
    })
  })
}
