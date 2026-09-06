# Smoke test
EXIT CODE: 137

--- DIAGNOSTICO (codesign / lipo / ElectronAsarIntegrity) ---
===== codesign -dvvv =====
Executable=/Users/runner/work/football-analysis-app/football-analysis-app/dist/mac-arm64/LINHA.app/Contents/MacOS/LINHA
Identifier=com.local.analise-tatica
Format=app bundle with Mach-O thin (arm64)
CodeDirectory v=20400 size=433 flags=0x2(adhoc) hashes=3+7 location=embedded
Hash type=sha256 size=32
CandidateCDHash sha256=885c492543e5a041adf1edd8b4d4d09e03553531
CandidateCDHashFull sha256=885c492543e5a041adf1edd8b4d4d09e03553531564fff33ac106034df21f124
Hash choices=sha256
CMSDigest=885c492543e5a041adf1edd8b4d4d09e03553531564fff33ac106034df21f124
CMSDigestType=2
CDHash=885c492543e5a041adf1edd8b4d4d09e03553531
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
--prepared:/Users/runner/work/football-analysis-app/football-analysis-app/dist/mac-arm64/LINHA.app/Contents/Frameworks/Electron Framework.framework/Versions/Current/.
--validated:/Users/runner/work/football-analysis-app/football-analysis-app/dist/mac-arm64/LINHA.app/Contents/Frameworks/Electron Framework.framework/Versions/Current/.
--prepared:/Users/runner/work/football-analysis-app/football-analysis-app/dist/mac-arm64/LINHA.app/Contents/Frameworks/LINHA Helper (GPU).app
--prepared:/Users/runner/work/football-analysis-app/football-analysis-app/dist/mac-arm64/LINHA.app/Contents/Frameworks/LINHA Helper.app
--validated:/Users/runner/work/football-analysis-app/football-analysis-app/dist/mac-arm64/LINHA.app/Contents/Frameworks/LINHA Helper (GPU).app
--validated:/Users/runner/work/football-analysis-app/football-analysis-app/dist/mac-arm64/LINHA.app/Contents/Frameworks/LINHA Helper.app
--prepared:/Users/runner/work/football-analysis-app/football-analysis-app/dist/mac-arm64/LINHA.app/Contents/Frameworks/LINHA Helper (Renderer).app
--prepared:/Users/runner/work/football-analysis-app/football-analysis-app/dist/mac-arm64/LINHA.app/Contents/Frameworks/LINHA Helper (Plugin).app
--validated:/Users/runner/work/football-analysis-app/football-analysis-app/dist/mac-arm64/LINHA.app/Contents/Frameworks/LINHA Helper (Renderer).app
--validated:/Users/runner/work/football-analysis-app/football-analysis-app/dist/mac-arm64/LINHA.app/Contents/Frameworks/LINHA Helper (Plugin).app
dist/mac-arm64/LINHA.app: valid on disk
dist/mac-arm64/LINHA.app: satisfies its Designated Requirement
===== lipo -archs (executável principal) =====
arm64
===== ElectronAsarIntegrity (Info.plist) =====
Dict {
    Resources/app.asar = Dict {
        hash = 77371a1f09059b283f4ad81466bd20899cca3ad1c1a1fe4d663dfabc698394e0
        algorithm = SHA256
    }
}

--- STDOUT ---
Checking for update
Generated new staging user ID: a3d11681-598b-5b25-8a96-ab1e5e38748b
Update for version 0.8.83 is not available (latest version: 0.8.82, downgrade is disallowed).

--- STDERR ---
[20921:0906/224324.042912:INFO:CONSOLE:2775] "[LINHA] build: __BUILD_SHA__ · __BUILD_DATE__", source: file:///Users/runner/work/football-analysis-app/football-analysis-app/dist/mac-arm64/LINHA.app/Contents/Resources/linha/index.html (2775)

--- CRASH REPORTS (~/Library/Logs/DiagnosticReports) ---
total 0
drwxrwx---   2 runner  staff   64 Aug 31 04:03 .
drwx------+ 13 runner  staff  416 Sep  6 22:41 ..

# Controlos A/B
(sem controls-full-report.txt)
