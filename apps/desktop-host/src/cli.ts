/** Public dsh commands using the immutable runtime carried by the Desktop installation. */

import { basename, delimiter, dirname, join, resolve } from 'node:path'
import { runCli } from '@deepseek-ai/dsh/lib/bin.js'

/**
 * Locate the archive containing a packaged runtime.
 * @param runtimeDir - Prepared or ASAR-contained runtime directory.
 * @returns Parent archive path, or undefined for a prepared directory.
 */
export function runtimeArchivePath(runtimeDir: string): string | undefined {
  const parent = dirname(runtimeDir)
  return basename(parent) === 'app.asar' ? parent : undefined
}

/**
 * Locate the resources directory holding a packaged runtime and its sibling support files.
 *
 * macOS and Windows read the payload through Electron's archive-aware filesystem, so it keeps its
 * `app.asar` directory. The Linux Host runs on the payload's own Node, which cannot read inside an
 * archive, so that release ships the same tree unpacked as a sibling `app.asar.unpacked` directory.
 * Both layouts place the payload two levels below the resources root.
 * @param runtimeDir - Prepared or packaged runtime directory.
 * @returns Resource directory, or undefined for a prepared directory outside an application.
 */
export function runtimeResourcesPath(runtimeDir: string): string | undefined {
  const archive = runtimeArchivePath(runtimeDir)
  if (archive !== undefined) return dirname(archive)
  const parent = dirname(runtimeDir)
  return basename(parent) === 'app.asar.unpacked' ? dirname(parent) : undefined
}

/**
 * Run the ordinary CLI with Desktop's bundled package manager and reserved-profile plugin access.
 * @param supportDir - Physical Desktop runtime directory containing the primary-runtime payload and Node launchers.
 * @returns Completion of the selected CLI command; profile plugins own their process lifetime.
 */
export async function runDesktopCli(supportDir: string): Promise<void> {
  await runCli({
    manageDesktopProfile: true,
    packageManager: {
      command: process.execPath,
      args: ['--expose-internals', join(supportDir, 'primary-runtime', 'dependencies', 'pnpm', 'bin', 'pnpm.mjs')],
      env: {
        ELECTRON_RUN_AS_NODE: '1',
        DSH_DESKTOP_NODE_EXECUTABLE: process.execPath,
        PATH: `${join(supportDir, 'bin')}${delimiter}${process.env.PATH ?? ''}`,
      },
    },
  })
}

if (import.meta.main) {
  if (process.platform === 'win32') {
    const { installWindowsCliSignals } = await import('./windows-cli-signals.ts')
    await installWindowsCliSignals()
  }
  const runtimeDir = resolve(import.meta.dirname, '../../../..')
  const resources = runtimeResourcesPath(runtimeDir)
  // A prepared development tree has no application resources beside it, so its support files are
  // resolved from the repository instead.
  await runDesktopCli(join(resources ?? join(runtimeDir, '..'), 'runtime'))
}
