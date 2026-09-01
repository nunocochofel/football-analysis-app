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
// ("Análise Tática", every release before v0.8.47-rc2) to whatever the CURRENT platform's
// productName resolves to. Electron derives the userData folder from the packaged
// executable/bundle's product name — Windows EXE VERSIONINFO, macOS CFBundleName — NOT from
// electron-builder's appId (confirmed by extracting an old build's app.asar: no top-level
// "productName" in package.json, and the appId change in v0.8.47-rc1 alone did not move the
// folder). Also confirmed on-disk: Local Storage is still classic LevelDB
// (CURRENT/LOCK/MANIFEST-*/*.ldb/*.log), not a newer SQLite-backed store, so a raw directory
// copy of it IS the actual data, verbatim.
//
// As of the productName split below (global "Análise Tática" for Windows, mac.executableName +
// extendInfo CFBundleName/CFBundleDisplayName "LINHA" for macOS — see package.json), OLD_PRODUCT_NAME
// and the CURRENT Windows productName are the same string again, so oldLocalStorage and
// newLocalStorage below resolve to the identical path on Windows: newAlreadyHasData is always
// true whenever oldHasData is (there's only one folder), so the function always returns at its
// first check on Windows — a real, harmless no-op, not dead code removed, since it still does
// real work on macOS (where CFBundleName stays "LINHA", genuinely different from
// OLD_PRODUCT_NAME) for anyone who somehow has old-productName mac data.
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
