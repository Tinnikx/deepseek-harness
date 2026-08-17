/**
 * dsh desktop — the Electron entry. The harness runs in this same main
 * process: `runProfile` is the CLI's own launcher, so the desktop surface
 * composes the `desktop` profile through exactly the code path
 * `dsh --profile <name>` uses, with the same installation anchor, the same
 * user patch layers, and the same shipped agent presets.
 *
 * Nothing here binds a socket. The composed tree's `webServer` provider is
 * the Electron carrier, which routes requests inside Chromium, so the window
 * talks to the harness with no local port in between.
 *
 * Startup order is fixed by Chromium: the scheme's privileges must be
 * declared at module load (before `app.whenReady()`), the carrier can only
 * claim the scheme after ready, and the window can only load a URL the
 * carrier already answers.
 * @module @deepseek-ai/dsh-desktop
 */

/* v8 ignore file -- the Electron entry runs only inside an Electron main process. */

import { app, dialog, protocol, type BrowserWindow } from 'electron'
import { loadLayeredEnv } from '@deepseek-ai/dsh-app-boot'
import { runProfile } from '@deepseek-ai/dsh/profile-boot'
import { registerDesktopScheme } from './scheme.ts'
import { createDesktopWindow } from './window.ts'

/** The profile this application boots; its template is shipped, so a first run initializes it. */
const DESKTOP_PROFILE = 'desktop'

/** What the startup sequence produces, readable by the lifetime handlers below. */
const surface: {
  window?: BrowserWindow
  shutdown?: Awaited<ReturnType<typeof runProfile>>['shutdown']
} = {}

registerDesktopScheme(protocol)

// A second launch hands its invocation to the running instance and exits: one
// harness process owns the Harness home's session and settings state, and two
// would race over it.
if (!app.requestSingleInstanceLock()) app.exit(0)

/** Report a failure that leaves nothing to show, then exit non-zero. */
function failLoud(error: unknown): void {
  // Both faces: a dialog for a desktop launch, stderr for a terminal one. A
  // composition failure carries nested causes a dialog truncates.
  console.error('dsh failed to start:', error)
  dialog.showErrorBox('dsh failed to start', error instanceof Error ? error.stack ?? error.message : String(error))
  app.exit(1)
}

// Deliberately not a top-level `await`: Electron loads an ESM main through
// dynamic import and emits `ready` only once that module has finished
// evaluating, so awaiting whenReady() at top level deadlocks the application
// before a single window exists.
void app.whenReady().then(async () => {
  const booted = await runProfile({
    environment: loadLayeredEnv('dsh'),
    profile: DESKTOP_PROFILE,
    patchFiles: [],
    // The GUI takes no flags: every composition choice lives in the profile's
    // patch layers, where it survives the next launch.
    args: [],
  })
  surface.shutdown = booted.shutdown
  // Only now does the carrier answer the scheme, so only now can a window
  // load a URL on it.
  surface.window = createDesktopWindow()
}).catch(failLoud)

app.on('second-instance', () => {
  // A launch during startup has no window to raise; the one being created
  // will come up on its own.
  const window = surface.window
  if (window === undefined || window.isDestroyed()) return
  if (window.isMinimized()) window.restore()
  window.focus()
})

// Closing the window ends the session on this platform, so quitting is the
// honest response — a headless harness with no surface serves nobody.
app.on('window-all-closed', () => { app.quit() })

let quitting = false
app.on('before-quit', (event) => {
  if (quitting || surface.shutdown === undefined) return
  // The tree owns subprocesses, watchers, and open session files; Electron
  // would tear the process down before any of them settled.
  event.preventDefault()
  quitting = true
  void surface.shutdown.shutdown(0).finally(() => { app.quit() })
})
