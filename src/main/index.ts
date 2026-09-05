import { app, shell, dialog, BrowserWindow } from 'electron'
import { join } from 'path'
import { appendFileSync, mkdirSync, existsSync, cpSync, rmSync, renameSync } from 'fs'
import { registerIpcHandlers } from './ipc'
import { initDatabase } from './db'
import type { LiveSession } from './liveIngest'

// Diagnostic instrumentation for whatever happens from here on (inside app.whenReady()'s own
// try/catch below, inside any IPC handler, any async operation for the rest of the app's life).
// A crash that happens before any window opens previously left nothing to go on beyond a native
// OS crash report — this writes a plain-text log AND shows a dialog for anything that reaches
// JavaScript as a catchable error.
//
// Does NOT cover the static imports of './ipc'/'./db' directly above (which transitively pull in
// ffmpeg.ts, liveIngest.ts, mp4Boxes.ts, youtubeResolve.ts) — tried moving this registration
// before those imports textually, on the theory that this project's esbuild/electron-vite CJS
// output preserves source-line order the way plain CommonJS require() does; built it and
// inspected out/main/index.js directly rather than trusting that theory, and it does NOT hold —
// imported modules' own top-level code always runs before the importing file's own top-level
// statements here, matching real ES module import-hoisting semantics, regardless of where the
// `import` keyword is textually written. A genuinely earlier catch would need those imports
// themselves converted to a real dynamic import() (or the risky code moved inside each module's
// own functions) — a larger change than this task asked for, not attempted here. Separately: also
// tried making './ipc'/'./db' lazy via require() inside app.whenReady() specifically to route
// around this — built THAT too and found the relative require() calls were left unresolved in the
// output (pointing at files this build never emits separately), which would have broken the app
// on every platform, not just macOS. Caught before it went anywhere by inspecting the actual
// build output, not assumed to work — reverted back to the static imports above.
function logStartupError(label: string, err: unknown): void {
  const message = err instanceof Error ? err.stack || err.message : String(err)
  const line = `[${new Date().toISOString()}] ${label}: ${message}\n`
  try {
    const logsDir = app.getPath('logs')
    mkdirSync(logsDir, { recursive: true })
    appendFileSync(join(logsDir, 'startup-errors.log'), line)
  } catch {
    // Best-effort — if even the log directory isn't writable, the dialog below still shows.
  }
  console.error(label, err)
  dialog.showErrorBox(label, message)
}
process.on('uncaughtException', (err) => logStartupError('Erro inesperado (uncaughtException)', err))
process.on('unhandledRejection', (reason) => logStartupError('Erro inesperado (unhandledRejection)', reason))

let mainWindow: BrowserWindow | null = null
// Set once registerIpcHandlers() runs (see app.whenReady() below) — kept here purely so
// 'before-quit' can stop any in-progress RTMP ingest; unrelated to mainWindow's own lifecycle.
let liveSession: LiveSession | null = null
// Mirrors the renderer's export queue (see project:setExportsActive in ipc.ts) purely so the
// 'close' handler below knows whether to warn before letting the window go — a full quit
// destroys the renderer, which is where clip capture happens (video decode only exists in a
// Chromium page context, not in this headless process), so an in-progress export genuinely
// cannot survive that. This never blocks minimizing, only an actual close/quit, and only warns
// rather than silently losing work.
let exportsActive = false

// The LINHA web app (resources/linha/index.html) is the primary UI — it has no build step of
// its own, so it's always loaded directly via loadFile, in dev and packaged builds alike. The
// React source under src/renderer is left in place, just not loaded, so switching back stays
// reversible without extra risk.
function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    // Correção urgente pós-v0.8.69 — sem mínimo nenhum, a janela podia encolher a um tamanho onde
    // a própria barra de ferramentas do quadro tático (dezenas de botões, ver Fases 5-11) já não
    // cabia em cima do campo sem o espremer a quase nada, mesmo com o CSS/JS agora a garantir que
    // o campo nunca fica cortado/distorcido (só pequeno). Este mínimo mantém a app usável desde o
    // arranque, sem impedir quem quiser trabalhar numa janela mais pequena do que 1440x900.
    minWidth: 1000,
    minHeight: 650,
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
  })

  // Only intercepts an actual close (the window's own X, Alt+F4, app quit) — never fires for
  // minimize, so minimizing is always instant and unaffected. dialog.showMessageBox blocks here
  // (same pattern already used for the auto-update prompt below), which is exactly what's wanted:
  // give the user a real choice instead of silently discarding an in-progress export.
  mainWindow.on('close', (event) => {
    if (!exportsActive) return
    event.preventDefault()
    dialog
      .showMessageBox(mainWindow as BrowserWindow, {
        type: 'warning',
        title: 'Exportação em curso',
        message: 'Há uma exportação em curso. Fechar a aplicação agora vai perdê-la.',
        detail: 'Fechar na mesma?',
        buttons: ['Fechar na mesma', 'Cancelar'],
        defaultId: 1,
        cancelId: 1
      })
      .then((result) => {
        if (result.response === 0) {
          exportsActive = false
          mainWindow?.destroy()
        }
      })
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // F12 isn't bound to DevTools by Electron's default menu (that's a browser convention, not an
  // Electron one) — bind it explicitly so it's reliable regardless of menu/focus state.
  mainWindow.webContents.on('before-input-event', (_event, input) => {
    if (input.type === 'keyDown' && input.key === 'F12') {
      mainWindow?.webContents.toggleDevTools()
    }
  })

  // Wait for the page (and its script, which registers the status listener) to finish loading
  // before starting the update check — otherwise an event that fires quickly could be sent before
  // anything in the renderer is listening for it yet.
  mainWindow.webContents.once('did-finish-load', () => setupAutoUpdate())

  mainWindow.loadFile(resolveLinhaPath())
}

function resolveLinhaPath(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'linha', 'index.html')
    : join(__dirname, '..', '..', 'resources', 'linha', 'index.html')
}

// Checks GitHub Releases (see the "publish" field in package.json) for a newer version, downloads
// it silently, then asks once before restarting into it. Only meaningful in a packaged build —
// electron-updater expects an app-update.yml that electron-builder generates at packaging time,
// which doesn't exist when running from source.
//
// Every step also gets pushed to the renderer as a toast (see 'autoUpdate:status' in preload/
// index.ts and the listener in LINHA) — a silent failure here previously looked identical to "no
// update available" from the user's side, since the only trace was a console.error() nobody was
// watching in DevTools.
function setupAutoUpdate(): void {
  if (!app.isPackaged) return
  // Required lazily, here, instead of statically at the top of the file — electron-updater pulls
  // in Squirrel.Mac's native machinery on macOS, which this project has no way to verify behaves
  // identically for an ad-hoc-signed (non-Developer-ID) app versus one signed the way Squirrel.Mac
  // was originally designed around. Deferring the require() to this point (called only once the
  // window has already loaded, well after startup) means that if loading it ever throws, it can
  // no longer take down the whole app before a single window has shown — worst case, auto-update
  // silently doesn't work this run, logged below, instead of the app never opening at all.
  let autoUpdater: typeof import('electron-updater').autoUpdater
  try {
    ;({ autoUpdater } = require('electron-updater') as typeof import('electron-updater'))
  } catch (err) {
    logStartupError('Não foi possível carregar o verificador de atualizações', err)
    return
  }
  const send = (msg: string): void => {
    mainWindow?.webContents.send('autoUpdate:status', msg)
  }
  autoUpdater.autoDownload = true
  autoUpdater.on('checking-for-update', () => send('A verificar se há uma versão mais recente…'))
  autoUpdater.on('update-available', (info) => send(`Nova versão encontrada (v${info.version}) — a transferir…`))
  autoUpdater.on('update-not-available', () => send('Já tens a versão mais recente instalada.'))
  autoUpdater.on('download-progress', (p) => send(`A transferir atualização… ${Math.round(p.percent)}%`))
  autoUpdater.on('update-downloaded', () => {
    send('Atualização transferida.')
    dialog
      .showMessageBox({
        type: 'info',
        title: 'Atualização disponível',
        message: 'Foi transferida uma nova versão. Reiniciar agora para atualizar?',
        buttons: ['Reiniciar agora', 'Mais tarde'],
        defaultId: 0,
        cancelId: 1
      })
      .then((result) => {
        if (result.response === 0) autoUpdater.quitAndInstall()
      })
  })
  autoUpdater.on('error', (err) => {
    console.error('[autoUpdater] error:', err)
    send('Erro ao verificar atualizações: ' + (err?.message || String(err)))
  })
  autoUpdater.checkForUpdates().catch((err) => {
    console.error('[autoUpdater] checkForUpdates failed:', err)
    send('Erro ao verificar atualizações: ' + (err?.message || String(err)))
  })
}

// One-time migration from the userData profile of the productName this app used to have
// ("Análise Tática", every release before v0.8.47-rc2) to whatever the CURRENT userData
// profile is.
//
// CORRECTION (v0.8.54, found while verifying a REAL packaged Windows build, not assumed): on
// Windows this function has almost certainly been a no-op this entire time. Electron's own
// app.getName()/userData resolution prefers a TOP-LEVEL "productName" field in package.json over
// "name" — but this project's package.json has never had one (checked: not in v0.8.38's packaged
// asar, not in v0.8.53's), so Electron falls back to "name", which has been the literal constant
// "football-analysis-app" for the project's entire git history (checked). Confirmed directly
// against dist/win-unpacked/LINHA.exe (a real packaged build, launched with no overrides):
// app.getPath('userData') = "...\football-analysis-app", not "...\LINHA" — unaffected by
// productName OR appId. What earlier reasoning got right: extracting an old app.asar showed no
// top-level productName, and the appId-alone change in v0.8.47-rc1 didn't move anything — both
// still true. What it got wrong: concluding from that + community reports about
// electron-builder's productName mattering, without directly testing a real non-dev, non-
// --user-data-dir-overridden packaged build — which is what would have caught this.
// Net effect for Windows: this function still runs, still checks, and still safely no-ops if
// there's genuinely nothing to migrate — it just very likely never had real "Análise Tática" data
// to find, because Windows userData was never actually keyed by productName to begin with. Kept
// (not removed) because it's harmless and still correct AS a migration, and because macOS is NOT
// yet verified either way — CFBundleName IS set differently at packaging time there
// (electron-builder's own macPackager.js), but whether Electron's runtime userData resolution
// actually reads that on macOS, the same way it reads plain "name" here, has not been checked
// against a real Mac build. Someone should verify this on macOS before trusting either claim there.
//
// Confirmed on-disk (still true, unrelated to the above): Local Storage is still classic LevelDB
// (CURRENT/LOCK/MANIFEST-*/*.ldb/*.log), not a newer SQLite-backed store, so a raw directory copy
// of it IS the actual data, verbatim.
//
// A per-platform productName split (global "Análise Tática" for Windows, "LINHA" only on macOS
// via mac.executableName + extendInfo) was tried and reverted: electron-builder names the
// Helper.app bundles (GPU/Renderer/Plugin — required by Chromium's multi-process architecture on
// macOS) from the GLOBAL productName only, with no override available (confirmed in
// electron-builder's own source, electron/electronMac.js — appFilename = appInfo.sanitizedProductName,
// which ignores executableName). Electron's native bootstrap resolves Helper apps BY CFBundleName
// (see the comment above that line, citing electron_main_delegate_mac.mm and
// electron-builder issue #6962) — so overriding CFBundleName without the Helper folders matching
// makes Electron unable to find them, and it crashes on launch (confirmed: reproduced exit 133 on
// the real macOS CI runner). productName is "LINHA" globally again, on both platforms — this
// function is real and necessary on both, exactly as it was before that detour.
//
// Safe by construction: copies into a staging directory first and only renames it into place if
// the whole copy succeeds, so a failed/interrupted copy never leaves a half-written "Local
// Storage" behind; never touches or deletes the OLD folder, so there's always a way back; and is
// naturally idempotent — once the new profile has its own Local Storage/leveldb/CURRENT, this
// returns immediately on every later launch, migration or not.
//
// One real, NOT fully solvable-from-here risk: copying while the OLD build is still actually
// running. LevelDB tolerates being copied while idle, because CURRENT/MANIFEST/*.log/*.ldb form
// a self-consistent snapshot as long as nothing is concurrently compacting it — but if the old
// app is open at the same moment as this one, that assumption breaks and the copy could capture
// a torn state. Low real-world odds (two different installed apps — a user has to deliberately
// keep both open across the switch), and if the copy throws for any reason, including that, the
// dialog below offers a retry instead of silently losing the user's old data.
const OLD_PRODUCT_NAME = 'Análise Tática'
function migrateUserDataFromOldProductName(): void {
  try {
    const oldLocalStorage = join(app.getPath('appData'), OLD_PRODUCT_NAME, 'Local Storage')
    const newUserData = app.getPath('userData')
    const newLocalStorage = join(newUserData, 'Local Storage')

    const oldHasData = existsSync(join(oldLocalStorage, 'leveldb', 'CURRENT'))
    const newAlreadyHasData = existsSync(join(newLocalStorage, 'leveldb', 'CURRENT'))
    if (!oldHasData || newAlreadyHasData) return

    const staging = join(newUserData, '.migration-staging-local-storage')
    rmSync(staging, { recursive: true, force: true })
    mkdirSync(newUserData, { recursive: true })
    cpSync(oldLocalStorage, staging, { recursive: true })
    // Only ever removes something INSIDE the new profile (an empty scaffold Chromium may have
    // pre-created, never real data — newAlreadyHasData already ruled that out above) or nothing
    // at all if it doesn't exist yet. Never touches the old profile.
    rmSync(newLocalStorage, { recursive: true, force: true })
    renameSync(staging, newLocalStorage)
    console.log('[migration] copied Local Storage from the "' + OLD_PRODUCT_NAME + '" profile')
  } catch (err) {
    try {
      rmSync(join(app.getPath('userData'), '.migration-staging-local-storage'), {
        recursive: true,
        force: true
      })
    } catch {
      // Best-effort cleanup of our own staging dir — leaving it behind is harmless (never mistaken
      // for real data, since newAlreadyHasData only ever checks Local Storage/leveldb/CURRENT).
    }
    console.error('[migration] failed to copy Local Storage from previous version:', err)
    const oldPath = join(app.getPath('appData'), OLD_PRODUCT_NAME)
    const choice = dialog.showMessageBoxSync({
      type: 'warning',
      buttons: ['Tentar novamente', 'Continuar sem migrar'],
      defaultId: 0,
      cancelId: 1,
      title: 'Projetos da versão anterior',
      message:
        'Encontrámos projetos de uma versão anterior desta app, mas não foi possível copiá-los automaticamente.',
      detail:
        String(err instanceof Error ? err.message : err) +
        '\n\nOs teus dados antigos continuam intactos em:\n' +
        oldPath +
        '\n\nPodes tentar novamente agora, ou continuar e migrar mais tarde (basta reabrir a app).'
    })
    if (choice === 0) migrateUserDataFromOldProductName()
  }
}

app.whenReady().then(async () => {
  try {
    migrateUserDataFromOldProductName()
    await initDatabase()
    liveSession = registerIpcHandlers(
      () => mainWindow,
      (active) => {
        exportsActive = active
      }
    )
    createWindow()
  } catch (err) {
    // A startup failure here used to just mean the app never opened, with nothing to go on —
    // exactly the "não consegui abrir" report with no way to tell what actually broke. Now
    // whatever failed is at least visible and reportable back (see logStartupError above).
    logStartupError('Não foi possível iniciar a aplicação', err)
    app.quit()
    return
  }

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// Same idea for a crash after the window is already open (e.g. the renderer/GPU process dies
// mid-session on unusual hardware) — a visible reason beats the window silently going blank.
app.on('render-process-gone', (_event, _webContents, details) => {
  console.error('[render-process-gone]', details)
  dialog.showErrorBox(
    'A aplicação fechou inesperadamente',
    `Motivo: ${details.reason}\n\nTenta abrir a app outra vez. Se voltar a acontecer, avisa com esta mensagem.`
  )
})
// Best-effort, not blocking: an in-progress RTMP ingest has its own ffmpeg child process that
// would otherwise survive the app quitting (an orphaned process still connected to the RTMP
// source). Unlike the export-in-progress warning above, this doesn't prompt the user first —
// killing a live PREVIEW session loses nothing durable (no file has been written yet in this
// phase), so there's nothing worth interrupting quit to ask about.
app.on('before-quit', () => {
  liveSession?.stop('manual').catch((err) => console.error('[live] erro ao parar no quit:', err))
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
