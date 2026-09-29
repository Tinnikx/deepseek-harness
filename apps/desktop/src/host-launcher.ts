/** The executable that runs the packaged dsh Host child process. */

import { join } from 'node:path'

/**
 * Choose the Host launcher for the release platform.
 *
 * Electron contributes its own GLib to the process on Linux, and sharp's bundled libvips then binds
 * a second copy of the same object API, which crashes image decoding inside the Host. The payload's
 * own Node has no conflicting copy, so a Linux release runs the Host with it; macOS and Windows run
 * it with Electron in Node mode.
 * @param electronExecutable - Electron binary that acts as the Node runtime on macOS and Windows.
 * @param primaryRuntime - Bundled Node and Python dependency payload.
 * @param platform - Operating system the Host runs on.
 * @returns Executable that must launch the Host.
 */
export function desktopHostExecutable(electronExecutable: string, primaryRuntime: string,
  platform: NodeJS.Platform = process.platform): string {
  return platform === 'linux'
    ? join(primaryRuntime, 'dependencies', 'node', 'bin', 'node')
    : electronExecutable
}
