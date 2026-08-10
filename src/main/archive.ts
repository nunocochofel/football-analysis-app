import archiver from 'archiver'
import { createWriteStream } from 'fs'

// Batch clip export: bundles every exported clip into one .zip, organized into one folder per
// category (matching what's on the touchline, not the filesystem) so opening the zip reads like
// the categories list rather than a flat pile of files. Pinned to archiver@7 (last CommonJS
// release — v8 rewrote it as ESM-only, which `require()`s straight into ERR_REQUIRE_ESM from
// Electron's CommonJS main process).
export async function zipClipsByCategory(
  entries: { tempPath: string; categoryLabel: string; filename: string }[],
  outputZipPath: string
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const output = createWriteStream(outputZipPath)
    const archive = archiver('zip', { zlib: { level: 6 } })
    output.on('close', () => resolve())
    archive.on('error', (err: Error) => reject(err))
    archive.pipe(output)
    for (const entry of entries) {
      const safeCategoryFolder = entry.categoryLabel.replace(/[\\/:*?"<>|]+/g, '_').trim() || 'Categoria'
      archive.file(entry.tempPath, { name: `${safeCategoryFolder}/${entry.filename}` })
    }
    archive.finalize()
  })
}
