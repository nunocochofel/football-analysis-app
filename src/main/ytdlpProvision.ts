import { app } from 'electron'
import { existsSync, mkdirSync, writeFileSync, chmodSync, readFileSync } from 'fs'
import { delimiter, join } from 'path'
import { spawn } from 'child_process'
import { logLive } from './liveLog'

// Problem 3 (v0.8.53 real-world test): yt-dlp only worked because the user manually installed it
// via winget first — "nenhum treinador vai fazer isso". This module makes that step unnecessary,
// WITHOUT literally bundling a frozen binary in the installer the way ffmpeg-static does.
//
// Why NOT bundle it like ffmpeg: ffmpeg's wire protocol/container formats are stable — a bundled
// binary stays correct indefinitely. yt-dlp is different in kind: it reverse-engineers YouTube's
// player internals, which change often enough that yt-dlp cuts new releases constantly just to
// keep working. A binary frozen at package time would start failing again within months — exactly
// the "empacota mas fica desatualizado" problem the task asked to solve, not work around. So:
//   1. Prefer a yt-dlp already on PATH (unchanged from before — someone managing their own copy,
//      e.g. via winget, keeps full control and this never overrides it).
//   2. Otherwise, download yt-dlp's official standalone binary from its own GitHub Releases
//      "latest" alias into userData/bin/ on first actual use of YouTube LIVE — never at app
//      startup, keeping the "must work fully offline when YouTube isn't used" property intact.
//   3. Self-update that managed copy via yt-dlp's OWN built-in `-U` flag (it updates itself in
//      place from the same release feed its maintainers already keep current) — reusing yt-dlp's
///     own maintenance mechanism instead of re-implementing release-checking here. Throttled to at
//      most once a day (see UPDATE_CHECK_FILE below) so a normal LIVE connect never waits on a
//      network round-trip beyond what resolving the stream itself already needs.
// Net effect: zero installer size cost (nothing is bundled), and no LINHA release is ever needed
// just to refresh yt-dlp.

const YTDLP_ASSET_NAME = process.platform === 'win32' ? 'yt-dlp.exe' : process.platform === 'darwin' ? 'yt-dlp_macos' : 'yt-dlp'
const YTDLP_DOWNLOAD_URL = `https://github.com/yt-dlp/yt-dlp/releases/latest/download/${YTDLP_ASSET_NAME}`
const UPDATE_CHECK_THROTTLE_MS = 24 * 60 * 60 * 1000 // once a day at most
const DOWNLOAD_TIMEOUT_MS = 30000
const SELF_UPDATE_TIMEOUT_MS = 20000

function managedBinDir(): string {
  return join(app.getPath('userData'), 'bin')
}
function managedBinPath(): string {
  return join(managedBinDir(), YTDLP_ASSET_NAME)
}
function lastUpdateCheckFile(): string {
  return join(managedBinDir(), '.yt-dlp-last-update-check')
}

// Same lookup youtubeResolve.ts already had (kept here, not imported from there, to avoid a
// dependency in the "wrong" direction — youtubeResolve.ts is the one that should depend on THIS
// module, provisioning is a lower-level concern than resolving a URL).
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

async function downloadManagedYtDlp(): Promise<void> {
  logLive('yt-dlp: a descarregar ' + YTDLP_DOWNLOAD_URL)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS)
  try {
    const res = await fetch(YTDLP_DOWNLOAD_URL, { signal: controller.signal })
    if (!res.ok) {
      throw new Error(`GitHub devolveu ${res.status} ao descarregar ${YTDLP_DOWNLOAD_URL}`)
    }
    const bytes = Buffer.from(await res.arrayBuffer())
    mkdirSync(managedBinDir(), { recursive: true })
    writeFileSync(managedBinPath(), bytes)
    if (process.platform !== 'win32') chmodSync(managedBinPath(), 0o755)
    logLive(`yt-dlp: descarregado com sucesso (${bytes.length} bytes) para ${managedBinPath()}`)
  } finally {
    clearTimeout(timer)
  }
}

function shouldCheckForUpdate(): boolean {
  try {
    const raw = readFileSync(lastUpdateCheckFile(), 'utf8')
    const last = Number(raw)
    return !Number.isFinite(last) || Date.now() - last > UPDATE_CHECK_THROTTLE_MS
  } catch {
    return true // never checked before
  }
}

function markUpdateChecked(): void {
  try {
    mkdirSync(managedBinDir(), { recursive: true })
    writeFileSync(lastUpdateCheckFile(), String(Date.now()))
  } catch {
    // Best-effort — worst case, the next connect just checks again instead of waiting a full day.
  }
}

// Fire-and-forget by design: called right before a connect attempt, but never allowed to block or
// fail that attempt — a stale-but-working managed copy is still fine to use immediately, and
// self-updating is strictly an improvement for NEXT time, not a precondition for this one.
function selfUpdateManagedYtDlp(): void {
  if (!shouldCheckForUpdate()) return
  markUpdateChecked()
  logLive('yt-dlp: a verificar atualizações (yt-dlp -U)')
  try {
    const proc = spawn(managedBinPath(), ['-U'], { windowsHide: true })
    const timer = setTimeout(() => {
      try {
        proc.kill()
      } catch {
        /* already gone */
      }
    }, SELF_UPDATE_TIMEOUT_MS)
    let out = ''
    proc.stdout?.on('data', (d: Buffer) => (out += d.toString('utf8')))
    proc.on('close', (code) => {
      clearTimeout(timer)
      logLive(`yt-dlp: verificação de atualização terminou (code=${String(code)}) — ${out.trim().split('\n').pop() || ''}`)
    })
    proc.on('error', (err) => {
      clearTimeout(timer)
      logLive('yt-dlp: falha ao verificar atualização — ' + err.message)
    })
  } catch (err) {
    logLive('yt-dlp: falha ao arrancar verificação de atualização — ' + (err instanceof Error ? err.message : String(err)))
  }
}

// Resolves to an absolute, ready-to-spawn yt-dlp path: PATH first (unchanged behavior — respects
// whatever the user already manages themselves), then LINHA's own managed copy, downloading it on
// first need if it isn't there yet. Throws a clear, actionable error only if BOTH fail — the exact
// two things tried, and what to do about each, not a generic "instala o yt-dlp".
export async function ensureYtDlpBin(): Promise<string> {
  const onPath = findExecutableOnPath('yt-dlp')
  if (onPath) return onPath

  const managed = managedBinPath()
  if (!existsSync(managed)) {
    try {
      await downloadManagedYtDlp()
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err)
      logLive('yt-dlp: download automático falhou — ' + detail)
      throw new Error(
        'Não foi possível obter o yt-dlp automaticamente (tentei: PATH do sistema, e descarregar ' +
          YTDLP_DOWNLOAD_URL +
          '). Detalhe: ' +
          detail +
          '. Verifica a tua ligação à internet, ou instala o yt-dlp manualmente: winget install yt-dlp (Windows) ' +
          'ou brew install yt-dlp (macOS), e reabre a app.'
      )
    }
  } else {
    selfUpdateManagedYtDlp() // best-effort, never blocks this connect attempt
  }
  return managed
}
