/**
 * The desktop window: a VSCode-shaped shell around the same frontend the
 * browser surface serves. It holds no Node capability — `contextIsolation`
 * with `sandbox` and no preload means the page reaches the harness only
 * through the custom scheme, exactly as a browser tab reaches it only through
 * the HTTP carrier.
 * @module @deepseek-ai/dsh-desktop/window
 */

import { fileURLToPath } from 'node:url'
import { BrowserWindow, shell } from 'electron'
import { DESKTOP_ENTRY_URL } from './scheme.ts'

/** Opening dimensions and the floor below which the two-pane layout stops working. */
const WINDOW_SIZE = { width: 1280, height: 800, minWidth: 680, minHeight: 480 }

/** Painted before the first frame arrives so the window never flashes white over a dark theme. */
const BACKGROUND_COLOR = '#1f1f1f'

/**
 * The window icon the desktop environment shows in its task bar, dock, and
 * window switcher: the frontend's hero mark (`FishLogo`) rendered at 512px in
 * the brand ink over transparency, so it reads on both light and dark shells.
 *
 * Resolved from this module rather than the process cwd, and identical from
 * `src/window.ts` and the bundled `lib/main.js` — both sit one level under the
 * package root that holds `assets/`. Windows and Linux read it; macOS takes
 * its icon from the application bundle instead and ignores this.
 */
const ICON_PATH = fileURLToPath(new URL('../assets/icon.png', import.meta.url))

/**
 * Create the application window and load the surface.
 *
 * The window is shown on `ready-to-show` rather than at construction: the
 * frontend boots its Cordis client tree before it renders anything, and a
 * window shown earlier would sit empty for that whole time.
 * @returns the created window, already loading.
 */
export function createDesktopWindow(): BrowserWindow {
  const window = new BrowserWindow({
    ...WINDOW_SIZE,
    show: false,
    backgroundColor: BACKGROUND_COLOR,
    icon: ICON_PATH,
    // The menu bar carries nothing this application defines; Alt still reveals
    // Electron's default roles for the few a user expects (copy, devtools).
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  window.once('ready-to-show', () => { window.show() })
  // A link to documentation or a provider console belongs in the user's
  // browser; nothing in this application renders a second window.
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://') || url.startsWith('http://')) void shell.openExternal(url)
    return { action: 'deny' }
  })
  void window.loadURL(DESKTOP_ENTRY_URL)
  return window
}
