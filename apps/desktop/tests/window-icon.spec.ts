/**
 * The window icon's packaging contract. `window.ts` resolves the icon
 * relative to its own module, so both the source module and the bundled
 * `lib/main.js` reach `assets/icon.png` one level up — but neither Electron
 * nor the packager reports a missing icon: the window simply comes up with
 * the generic Electron mark. These assertions are the report.
 *
 * Nothing here imports `window.ts`; it imports Electron, which exists only
 * inside an Electron main process.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/** Resolve a path inside the desktop package, as `window.ts` resolves its icon. */
function packagePath(relative: string): string {
  return fileURLToPath(new URL(`../${relative}`, import.meta.url))
}

describe('desktop window icon', () => {
  it('ships a PNG the desktop environment can display', () => {
    // Electron's Linux and Windows window icons take a raster file; an SVG
    // (what the frontend's hero mark is) would load as an empty image.
    const icon = readFileSync(packagePath('assets/icon.png'))
    expect([...icon.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])
    // The IHDR width and height, big-endian, at the fixed offsets the PNG
    // signature guarantees. 512px covers every scale a task bar asks for.
    expect(icon.readUInt32BE(16)).toBe(512)
    expect(icon.readUInt32BE(20)).toBe(512)
  })

  it('publishes the asset directory, which the product closure copies', () => {
    // `pnpm deploy` stages this package by its `files` list; without `assets`
    // the packaged application resolves an icon path that does not exist.
    const manifest = JSON.parse(readFileSync(packagePath('package.json'), 'utf8')) as { files: string[] }
    expect(manifest.files).toContain('assets')
  })
})
