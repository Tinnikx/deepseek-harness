/** Application artwork shared by the About panel and the Linux window icon. */

import { join } from 'node:path'
import { app, nativeImage, type BrowserWindow } from 'electron'

/**
 * Edge of the icon a Linux window publishes.
 *
 * The shipped artwork is 1104 px for the About panel and the desktop icon set; a window icon is
 * drawn at panel size, so it is scaled here instead of handing the desktop environment the
 * original bitmap.
 */
const WINDOW_ICON_EDGE = 256

/**
 * Resolve the shipped application icon.
 * @param platform - Operating system whose artwork a development launch reads.
 * @returns the packaged resource, or the development copy named after the platform's artwork.
 */
export function applicationIconPath(platform: NodeJS.Platform = process.platform): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'icon.png')
    : join(app.getAppPath(), 'resources', platform === 'win32' ? 'icon-windows.png' : 'icon.png')
}

/**
 * Attach the application icon to a Linux window.
 *
 * macOS takes its icon from the bundle and Windows from the executable resource, so only Linux
 * needs the shell to attach one. This is a call on the live window rather than a `BrowserWindow`
 * option because every product window here starts hidden behind the boot cover, and `setIcon` on a
 * window that started hidden is what draws the icon in the panel and window decorations of a
 * Wayland session. The X11 window properties do not track that result: the same window keeps an
 * empty `_NET_WM_ICON` array and no `WM_HINTS`, which is why the visible icon, not the property,
 * is the check. See the [decision record](../../../.agents/notes/implemented/architecture/2026-09-30-desktop-linux-window-icon.md).
 * @param window - A freshly constructed Desktop window.
 * @param platform - Operating system hosting Electron.
 */
export function publishWindowIcon(window: BrowserWindow, platform: NodeJS.Platform = process.platform): void {
  if (platform !== 'linux') return
  window.setIcon(nativeImage.createFromPath(applicationIconPath(platform))
    .resize({ width: WINDOW_ICON_EDGE, height: WINDOW_ICON_EDGE }))
}
