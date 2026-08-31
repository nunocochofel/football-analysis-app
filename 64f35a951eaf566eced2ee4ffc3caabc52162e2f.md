# Smoke test
EXIT CODE: 137

--- DIAGNOSTICO (codesign / lipo / ElectronAsarIntegrity) ---
===== codesign -dvvv =====
Executable=/Users/runner/work/football-analysis-app/football-analysis-app/dist/mac-arm64/LINHA.app/Contents/MacOS/LINHA
Identifier=com.nunocochofel.linha
Format=app bundle with Mach-O thin (arm64)
CodeDirectory v=20400 size=431 flags=0x2(adhoc) hashes=3+7 location=embedded
Hash type=sha256 size=32
CandidateCDHash sha256=84aa9b8c9d24fb22d57d7872c6fc3d1e3051f24a
CandidateCDHashFull sha256=84aa9b8c9d24fb22d57d7872c6fc3d1e3051f24a3ad1345fe38b8bc8eeee2247
Hash choices=sha256
CMSDigest=84aa9b8c9d24fb22d57d7872c6fc3d1e3051f24a3ad1345fe38b8bc8eeee2247
CMSDigestType=2
CDHash=84aa9b8c9d24fb22d57d7872c6fc3d1e3051f24a
Signature=adhoc
Info.plist entries=32
TeamIdentifier=not set
Sealed Resources version=2 rules=13 files=34
Internal requirements count=0 size=12
===== codesign -vvv --strict =====
--prepared:/Users/runner/work/football-analysis-app/football-analysis-app/dist/mac-arm64/LINHA.app/Contents/Frameworks/Squirrel.framework/Versions/Current/.
--validated:/Users/runner/work/football-analysis-app/football-analysis-app/dist/mac-arm64/LINHA.app/Contents/Frameworks/Squirrel.framework/Versions/Current/.
--prepared:/Users/runner/work/football-analysis-app/football-analysis-app/dist/mac-arm64/LINHA.app/Contents/Frameworks/ReactiveObjC.framework/Versions/Current/.
--validated:/Users/runner/work/football-analysis-app/football-analysis-app/dist/mac-arm64/LINHA.app/Contents/Frameworks/ReactiveObjC.framework/Versions/Current/.
--prepared:/Users/runner/work/football-analysis-app/football-analysis-app/dist/mac-arm64/LINHA.app/Contents/Frameworks/Mantle.framework/Versions/Current/.
--validated:/Users/runner/work/football-analysis-app/football-analysis-app/dist/mac-arm64/LINHA.app/Contents/Frameworks/Mantle.framework/Versions/Current/.
--prepared:/Users/runner/work/football-analysis-app/football-analysis-app/dist/mac-arm64/LINHA.app/Contents/Frameworks/LINHA Helper (GPU).app
--prepared:/Users/runner/work/football-analysis-app/football-analysis-app/dist/mac-arm64/LINHA.app/Contents/Frameworks/LINHA Helper.app
--validated:/Users/runner/work/football-analysis-app/football-analysis-app/dist/mac-arm64/LINHA.app/Contents/Frameworks/LINHA Helper (GPU).app
--validated:/Users/runner/work/football-analysis-app/football-analysis-app/dist/mac-arm64/LINHA.app/Contents/Frameworks/LINHA Helper.app
--prepared:/Users/runner/work/football-analysis-app/football-analysis-app/dist/mac-arm64/LINHA.app/Contents/Frameworks/LINHA Helper (Renderer).app
--validated:/Users/runner/work/football-analysis-app/football-analysis-app/dist/mac-arm64/LINHA.app/Contents/Frameworks/LINHA Helper (Renderer).app
--prepared:/Users/runner/work/football-analysis-app/football-analysis-app/dist/mac-arm64/LINHA.app/Contents/Frameworks/LINHA Helper (Plugin).app
--validated:/Users/runner/work/football-analysis-app/football-analysis-app/dist/mac-arm64/LINHA.app/Contents/Frameworks/LINHA Helper (Plugin).app
--prepared:/Users/runner/work/football-analysis-app/football-analysis-app/dist/mac-arm64/LINHA.app/Contents/Frameworks/Electron Framework.framework/Versions/Current/.
--validated:/Users/runner/work/football-analysis-app/football-analysis-app/dist/mac-arm64/LINHA.app/Contents/Frameworks/Electron Framework.framework/Versions/Current/.
dist/mac-arm64/LINHA.app: valid on disk
dist/mac-arm64/LINHA.app: satisfies its Designated Requirement
===== lipo -archs (executável principal) =====
arm64
===== ElectronAsarIntegrity (Info.plist) =====
Dict {
    Resources/app.asar = Dict {
        hash = 87e5f161216e147fb855ecac0b6883b3d022201f80b09f5bcf6faeec456e9a57
        algorithm = SHA256
    }
}

--- STDOUT ---
Checking for update
Generated new staging user ID: fe94362a-b168-53b1-8942-5cfcbc786520

--- STDERR ---
[20847:0831/214935.311629:INFO:CONSOLE:2220] "[LINHA] build: __BUILD_SHA__ · __BUILD_DATE__", source: file:///Users/runner/work/football-analysis-app/football-analysis-app/dist/mac-arm64/LINHA.app/Contents/Resources/linha/index.html (2220)
Error: Error: Cannot find latest-mac.yml in the latest release artifacts (https://github.com/nunocochofel/football-analysis-app/releases/download/v0.8.50/latest-mac.yml): HttpError: 404 
"method: GET url: https://github.com/nunocochofel/football-analysis-app/releases/download/v0.8.50/latest-mac.yml\n\nPlease double check that your authentication token is correct. Due to security reasons, actual status maybe not reported, but 404.\n"
Headers: {
  "cache-control": "no-cache",
  "content-encoding": "gzip",
  "content-length": "29",
  "content-security-policy": "default-src 'none'; base-uri 'self'; connect-src 'self'; form-action 'self'; img-src 'self' data:; script-src 'self'; style-src 'unsafe-inline'",
  "content-type": "text/plain; charset=utf-8",
  "date": "Mon, 31 Aug 2026 21:49:37 GMT",
  "referrer-policy": "no-referrer-when-downgrade",
  "server": "github.com",
  "strict-transport-security": "max-age=31536000; includeSubdomains; preload",
  "vary": "X-PJAX, X-PJAX-Container, Turbo-Visit, Turbo-Frame, X-Requested-With, X-GitHub-Client-Version, Sec-Fetch-Site,Accept-Encoding, Accept, X-Requested-With",
  "x-content-type-options": "nosniff",
  "x-frame-options": "deny",
  "x-github-edge-region": "westus3",
  "x-github-request-id": "9E53:270222:173EDC:1D20E4:6A95F6F1",
  "x-xss-protection": "0"
}
    at createHttpError (/Users/runner/work/football-analysis-app/football-analysis-app/dist/mac-arm64/LINHA.app/Contents/Resources/app.asar/node_modules/builder-util-runtime/out/httpExecutor.js:53:12)
    at ElectronHttpExecutor.handleResponse (/Users/runner/work/football-analysis-app/football-analysis-app/dist/mac-arm64/LINHA.app/Contents/Resources/app.asar/node_modules/builder-util-runtime/out/httpExecutor.js:157:20)
    at ClientRequest.<anonymous> (/Users/runner/work/football-analysis-app/football-analysis-app/dist/mac-arm64/LINHA.app/Contents/Resources/app.asar/node_modules/builder-util-runtime/out/httpExecutor.js:122:26)
    at ClientRequest.emit (node:events:509:28)
    at SimpleURLLoaderWrapper.<anonymous> (node:electron/js2c/browser_init:2:138237)
    at SimpleURLLoaderWrapper.emit (node:events:509:28)
    at newError (/Users/runner/work/football-analysis-app/football-analysis-app/dist/mac-arm64/LINHA.app/Contents/Resources/app.asar/node_modules/builder-util-runtime/out/error.js:5:19)
    at fetchData (/Users/runner/work/football-analysis-app/football-analysis-app/dist/mac-arm64/LINHA.app/Contents/Resources/app.asar/node_modules/electron-updater/out/providers/GitHubProvider.js:125:63)
    at async GitHubProvider.getLatestVersion (/Users/runner/work/football-analysis-app/football-analysis-app/dist/mac-arm64/LINHA.app/Contents/Resources/app.asar/node_modules/electron-updater/out/providers/GitHubProvider.js:135:23)
    at async MacUpdater.getUpdateInfoAndProvider (/Users/runner/work/football-analysis-app/football-analysis-app/dist/mac-arm64/LINHA.app/Contents/Resources/app.asar/node_modules/electron-updater/out/AppUpdater.js:389:19)
    at async MacUpdater.doCheckForUpdates (/Users/runner/work/football-analysis-app/football-analysis-app/dist/mac-arm64/LINHA.app/Contents/Resources/app.asar/node_modules/electron-updater/out/AppUpdater.js:402:24)
[autoUpdater] error: Error: Cannot find latest-mac.yml in the latest release artifacts (https://github.com/nunocochofel/football-analysis-app/releases/download/v0.8.50/latest-mac.yml): HttpError: 404 
"method: GET url: https://github.com/nunocochofel/football-analysis-app/releases/download/v0.8.50/latest-mac.yml\n\nPlease double check that your authentication token is correct. Due to security reasons, actual status maybe not reported, but 404.\n"
Headers: {
  "cache-control": "no-cache",
  "content-encoding": "gzip",
  "content-length": "29",
  "content-security-policy": "default-src 'none'; base-uri 'self'; connect-src 'self'; form-action 'self'; img-src 'self' data:; script-src 'self'; style-src 'unsafe-inline'",
  "content-type": "text/plain; charset=utf-8",
  "date": "Mon, 31 Aug 2026 21:49:37 GMT",
  "referrer-policy": "no-referrer-when-downgrade",
  "server": "github.com",
  "strict-transport-security": "max-age=31536000; includeSubdomains; preload",
  "vary": "X-PJAX, X-PJAX-Container, Turbo-Visit, Turbo-Frame, X-Requested-With, X-GitHub-Client-Version, Sec-Fetch-Site,Accept-Encoding, Accept, X-Requested-With",
  "x-content-type-options": "nosniff",
  "x-frame-options": "deny",
  "x-github-edge-region": "westus3",
  "x-github-request-id": "9E53:270222:173EDC:1D20E4:6A95F6F1",
  "x-xss-protection": "0"
}
    at createHttpError (/Users/runner/work/football-analysis-app/football-analysis-app/dist/mac-arm64/LINHA.app/Contents/Resources/app.asar/node_modules/builder-util-runtime/out/httpExecutor.js:53:12)
    at ElectronHttpExecutor.handleResponse (/Users/runner/work/football-analysis-app/football-analysis-app/dist/mac-arm64/LINHA.app/Contents/Resources/app.asar/node_modules/builder-util-runtime/out/httpExecutor.js:157:20)
    at ClientRequest.<anonymous> (/Users/runner/work/football-analysis-app/football-analysis-app/dist/mac-arm64/LINHA.app/Contents/Resources/app.asar/node_modules/builder-util-runtime/out/httpExecutor.js:122:26)
    at ClientRequest.emit (node:events:509:28)
    at SimpleURLLoaderWrapper.<anonymous> (node:electron/js2c/browser_init:2:138237)
    at SimpleURLLoaderWrapper.emit (node:events:509:28)
    at newError (/Users/runner/work/football-analysis-app/football-analysis-app/dist/mac-arm64/LINHA.app/Contents/Resources/app.asar/node_modules/builder-util-runtime/out/error.js:5:19)
    at fetchData (/Users/runner/work/football-analysis-app/football-analysis-app/dist/mac-arm64/LINHA.app/Contents/Resources/app.asar/node_modules/electron-updater/out/providers/GitHubProvider.js:125:63)
    at async GitHubProvider.getLatestVersion (/Users/runner/work/football-analysis-app/football-analysis-app/dist/mac-arm64/LINHA.app/Contents/Resources/app.asar/node_modules/electron-updater/out/providers/GitHubProvider.js:135:23)
    at async MacUpdater.getUpdateInfoAndProvider (/Users/runner/work/football-analysis-app/football-analysis-app/dist/mac-arm64/LINHA.app/Contents/Resources/app.asar/node_modules/electron-updater/out/AppUpdater.js:389:19)
    at async MacUpdater.doCheckForUpdates (/Users/runner/work/football-analysis-app/football-analysis-app/dist/mac-arm64/LINHA.app/Contents/Resources/app.asar/node_modules/electron-updater/out/AppUpdater.js:402:24) {
  code: 'ERR_UPDATER_CHANNEL_FILE_NOT_FOUND'
}
[autoUpdater] checkForUpdates failed: Error: Cannot find latest-mac.yml in the latest release artifacts (https://github.com/nunocochofel/football-analysis-app/releases/download/v0.8.50/latest-mac.yml): HttpError: 404 
"method: GET url: https://github.com/nunocochofel/football-analysis-app/releases/download/v0.8.50/latest-mac.yml\n\nPlease double check that your authentication token is correct. Due to security reasons, actual status maybe not reported, but 404.\n"
Headers: {
  "cache-control": "no-cache",
  "content-encoding": "gzip",
  "content-length": "29",
  "content-security-policy": "default-src 'none'; base-uri 'self'; connect-src 'self'; form-action 'self'; img-src 'self' data:; script-src 'self'; style-src 'unsafe-inline'",
  "content-type": "text/plain; charset=utf-8",
  "date": "Mon, 31 Aug 2026 21:49:37 GMT",
  "referrer-policy": "no-referrer-when-downgrade",
  "server": "github.com",
  "strict-transport-security": "max-age=31536000; includeSubdomains; preload",
  "vary": "X-PJAX, X-PJAX-Container, Turbo-Visit, Turbo-Frame, X-Requested-With, X-GitHub-Client-Version, Sec-Fetch-Site,Accept-Encoding, Accept, X-Requested-With",
  "x-content-type-options": "nosniff",
  "x-frame-options": "deny",
  "x-github-edge-region": "westus3",
  "x-github-request-id": "9E53:270222:173EDC:1D20E4:6A95F6F1",
  "x-xss-protection": "0"
}
    at createHttpError (/Users/runner/work/football-analysis-app/football-analysis-app/dist/mac-arm64/LINHA.app/Contents/Resources/app.asar/node_modules/builder-util-runtime/out/httpExecutor.js:53:12)
    at ElectronHttpExecutor.handleResponse (/Users/runner/work/football-analysis-app/football-analysis-app/dist/mac-arm64/LINHA.app/Contents/Resources/app.asar/node_modules/builder-util-runtime/out/httpExecutor.js:157:20)
    at ClientRequest.<anonymous> (/Users/runner/work/football-analysis-app/football-analysis-app/dist/mac-arm64/LINHA.app/Contents/Resources/app.asar/node_modules/builder-util-runtime/out/httpExecutor.js:122:26)
    at ClientRequest.emit (node:events:509:28)
    at SimpleURLLoaderWrapper.<anonymous> (node:electron/js2c/browser_init:2:138237)
    at SimpleURLLoaderWrapper.emit (node:events:509:28)
    at newError (/Users/runner/work/football-analysis-app/football-analysis-app/dist/mac-arm64/LINHA.app/Contents/Resources/app.asar/node_modules/builder-util-runtime/out/error.js:5:19)
    at fetchData (/Users/runner/work/football-analysis-app/football-analysis-app/dist/mac-arm64/LINHA.app/Contents/Resources/app.asar/node_modules/electron-updater/out/providers/GitHubProvider.js:125:63)
    at async GitHubProvider.getLatestVersion (/Users/runner/work/football-analysis-app/football-analysis-app/dist/mac-arm64/LINHA.app/Contents/Resources/app.asar/node_modules/electron-updater/out/providers/GitHubProvider.js:135:23)
    at async MacUpdater.getUpdateInfoAndProvider (/Users/runner/work/football-analysis-app/football-analysis-app/dist/mac-arm64/LINHA.app/Contents/Resources/app.asar/node_modules/electron-updater/out/AppUpdater.js:389:19)
    at async MacUpdater.doCheckForUpdates (/Users/runner/work/football-analysis-app/football-analysis-app/dist/mac-arm64/LINHA.app/Contents/Resources/app.asar/node_modules/electron-updater/out/AppUpdater.js:402:24) {
  code: 'ERR_UPDATER_CHANNEL_FILE_NOT_FOUND'
}

--- CRASH REPORTS (~/Library/Logs/DiagnosticReports) ---
total 0
drwxrwx---   3 runner  staff             96 Jul 28 05:26 .
drwx------+ 14 runner  staff            448 Aug 31 21:47 ..
drwxrwx---   2 runner  _analyticsusers   64 Jul 28 05:26 Retired

# Controlos A/B
(sem controls-full-report.txt)
