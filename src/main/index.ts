import { app, shell, dialog, BrowserWindow } from 'electron'
import { join } from 'path'
import { autoUpdater } from 'electron-updater'
import { registerIpcHandlers } from './ipc'
import { initDatabase } from './db'

let mainWindow: BrowserWindow | null = null

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

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // F12 isn't bound to DevTools by Electron's default menu (that's a browser convention, not an
  // Electron one) — bind it explicitly so it's reliable regardless of menu/focus state. Same for
  // F11/real fullscreen — Electron doesn't wire either by default.
  mainWindow.webContents.on('before-input-event', (_event, input) => {
    if (input.type === 'keyDown' && input.key === 'F12') {
      mainWindow?.webContents.toggleDevTools()
    }
    if (input.type === 'keyDown' && input.key === 'F11') {
      mainWindow?.setFullScreen(!mainWindow.isFullScreen())
    }
  })

  // Wait for the page (and its script, which registers the status listener) to finish loading
  // before starting the update check — otherwise an event that fires quickly could be sent before
  // anything in the renderer is listening for it yet.
  mainWindow.webContents.once('did-finish-load', () => setupAutoUpdate())

  // Keeps the on-screen fullscreen button's active state correct no matter how fullscreen was
  // toggled — F11, the button itself, or an OS-level shortcut (e.g. the window manager's own).
  mainWindow.on('enter-full-screen', () => mainWindow?.webContents.send('window:fullscreenChanged', true))
  mainWindow.on('leave-full-screen', () => mainWindow?.webContents.send('window:fullscreenChanged', false))

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

app.whenReady().then(async () => {
  try {
    await initDatabase()
    registerIpcHandlers(() => mainWindow)
    createWindow()
  } catch (err) {
    // A startup failure here used to just mean the app never opened, with nothing to go on —
    // exactly the "não consegui abrir" report with no way to tell what actually broke. Now
    // whatever failed is at least visible and reportable back.
    dialog.showErrorBox(
      'Não foi possível iniciar a aplicação',
      String(err instanceof Error ? err.stack || err.message : err)
    )
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
process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', err)
  dialog.showErrorBox('Erro inesperado', String(err.stack || err.message))
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
