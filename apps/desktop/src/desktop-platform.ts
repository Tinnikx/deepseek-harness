/** The operating systems a Desktop release ships on, as Platform and the update policy name them. */

/** Release platform carried into the client identity headers and the installed-client policy identity. */
export type DesktopReportedPlatform = 'darwin' | 'linux' | 'win32'

/**
 * Classify a host platform as one the Desktop release ships on.
 * @param platform - Host platform, normally `process.platform`.
 * @returns The reported platform, or `undefined` when this host is not a Desktop release platform.
 */
export function desktopReportedPlatform(platform: NodeJS.Platform): DesktopReportedPlatform | undefined {
  switch (platform) {
    case 'darwin':
    case 'linux':
    case 'win32':
      return platform
    default:
      return undefined
  }
}
