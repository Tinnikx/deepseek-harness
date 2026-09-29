/**
 * The Linux boot cover: an opaque animated `WebContentsView` raised over the
 * main window before the Host process exists, and the settle poll that decides
 * when the page underneath may be uncovered. The cover is Linux-only; macOS
 * and Windows keep the hidden-until-ready window timing.
 *
 * It is a second renderer rather than an element in the application page
 * because the page is busy: the frontend's boot saturates its own main thread,
 * and a cover living there loses frames in exactly the seconds it is up. The
 * document itself is built by [boot-cover-document](./boot-cover-document.ts).
 * @module
 */

import { WebContentsView, type Rectangle, type View } from 'electron'
import type { EventEmitter } from 'node:events'
import { SETTLED_FLAG, bootCoverDocument, type BootPalette } from './boot-cover-document.ts'

/** The webContents surface the cover fits itself to and the settle poll asks. */
type CoverTarget = Pick<EventEmitter, 'on' | 'off' | 'once'> & {
  isDestroyed(): boolean
  /** Evaluate in the main frame; rejects while the page is mid-navigation. */
  executeJavaScript(script: string, userGesture?: boolean): Promise<unknown>
}

/** The window surface the cover tracks: enough to attach, fit, and follow out. */
type CoverOwner = {
  contentView: Pick<View, 'addChildView' | 'removeChildView'>
  webContents: CoverTarget
  getContentBounds(): Rectangle
  isDestroyed(): boolean
} & Pick<EventEmitter, 'on' | 'off'>

/** Time the painted cover stays on screen even when the page settles sooner. */
export const BOOT_COVER_MIN_VISIBLE_MS = 700

/** The raised cover, until something lifts it. */
export interface BootCover {
  /**
   * Replace the caption line under the spinner.
   * @param caption - the localized line to show.
   */
  say: (caption: string) => void
  /**
   * Take the cover down and release its renderer. Idempotent, and safe on a
   * destroyed window; a lifted cover has no second act.
   */
  lift: () => void
  /**
   * Lift once the cover has been on screen for at least `ms`.
   *
   * A warm local page can settle its theme before the window has shown the
   * cover at all; an instant uncover replaces the animation with a flash of
   * motionless ground. Counted from the cover's first painted frame; before
   * any frame the full hold still lies ahead.
   * @param ms - minimum visible time.
   */
  liftAfterVisible: (ms: number) => void
}

/**
 * Fit the cover to the window's content box. `WebContentsView.setBounds` reads
 * its origin relative to the parent view, while `getContentBounds` reports the
 * content box's absolute screen position; only the size transfers.
 * @param view - the cover view to place.
 * @param window - the window whose content box the cover fills.
 */
function fitCover(view: { setBounds(bounds: Rectangle): void }, window: CoverOwner): void {
  const { width, height } = window.getContentBounds()
  view.setBounds({ x: 0, y: 0, width, height })
}

/**
 * Put an opaque animated cover over `window` and leave it there until the
 * caller lifts it.
 * @param window - the window to cover; the cover tracks its content box.
 * @param palette - the colours to draw with, resolved for this launch.
 * @param caption - the starting line under the spinner.
 * @param onPainted - called once the cover has drawn its first document frame,
 *                    so the caller can show the window without waiting for the
 *                    application's own frame.
 * @returns the handle that lifts it.
 */
export function raiseBootCover(
  window: CoverOwner,
  palette: BootPalette,
  caption: string,
  onPainted?: () => void,
): BootCover {
  const view = new WebContentsView({
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
  })
  // Painted by the compositor before the document parses, covering the handful
  // of frames between the window appearing and the cover drawing.
  view.setBackgroundColor(palette.background)
  fitCover(view, window)
  window.contentView.addChildView(view)

  let lifted = false
  let paintedAt = 0
  // Measured in the reference shell on X11: inside a `resize` handler
  // `getContentBounds()` still reports the previous size, so the refit runs
  // one tick after the event, where the reading is current.
  const resize = (): void => {
    setImmediate(() => {
      if (!lifted && !window.isDestroyed()) fitCover(view, window)
    })
  }
  const removeOwnerListeners = (): void => {
    window.off('resize', resize)
    window.off('hide', lift)
    window.off('closed', lift)
    window.webContents.off('render-process-gone', lift)
    window.webContents.off('destroyed', lift)
  }
  function lift(): void {
    if (lifted) return
    lifted = true
    removeOwnerListeners()
    if (!window.isDestroyed()) window.contentView.removeChildView(view)
    if (!view.webContents.isDestroyed()) view.webContents.close()
  }
  // The cover covers the committed page, not whatever replaces it: startup's
  // own first navigation is the load the cover exists to bridge, so only a
  // fresh main-frame document after that first committed load lifts it.
  let initialLoadCommitted = false
  window.webContents.once('did-finish-load', () => { initialLoadCommitted = true })
  const navigate = (_event: Electron.Event, _url: string, isInPlace: boolean, isMainFrame: boolean): void => {
    if (isMainFrame && !isInPlace && initialLoadCommitted) lift()
  }
  window.on('resize', resize)
  // A hidden window keeps no animation alive: close-to-background and the
  // welcome path both hide the main window, and the cover must not outlive it.
  window.on('hide', lift)
  window.on('closed', lift)
  window.webContents.on('render-process-gone', lift)
  window.webContents.on('destroyed', lift)
  window.webContents.on('did-start-navigation', navigate)

  // Measured on Electron 44 Linux: a `data:` URL view never fires
  // `did-finish-load`, so the first of these document events is the paint
  // signal; `say` waits on it and the window shows on it.
  let paintedFired = false
  const markPainted = (): void => {
    if (paintedFired) return
    paintedFired = true
    paintedAt = Date.now()
    resolveLoaded()
    onPainted?.()
  }
  let resolveLoaded!: () => void
  const loaded = new Promise<void>((resolve) => { resolveLoaded = resolve })
  view.webContents.once('dom-ready', markPainted)
  view.webContents.once('did-stop-loading', markPainted)
  view.webContents.once('did-finish-load', markPainted)
  const document = bootCoverDocument(palette, caption)
  void view.webContents.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(document)}`)
    .catch(() => {
      // A cover document that fails to load leaves the window on its
      // application-page fallback; there is nothing here to report past that.
    })

  return {
    say: (text: string): void => {
      void loaded.then(() => {
        if (lifted || view.webContents.isDestroyed()) return
        void view.webContents.executeJavaScript(
          `globalThis.__dshBootCover.say(${JSON.stringify(text)})`, true,
        ).catch(() => { /* the cover is already on its way out */ })
      })
    },
    lift,
    liftAfterVisible: (ms: number): void => {
      if (lifted) return
      const waited = paintedAt === 0 ? 0 : Date.now() - paintedAt
      if (waited >= ms) { lift(); return }
      const timer = setTimeout(() => { lift() }, ms - waited)
      timer.unref()
    },
  }
}

/**
 * Ask the application page until it reports a settled theme background.
 *
 * Settled rather than mounted: the page's theme lands after its stylesheets,
 * and uncovering before that shows the flash the cover exists to hide. The
 * flag is raised by the application preload
 * (see preload-app.ts) and belongs to a document, so the answer describes
 * whatever document is loaded now.
 * @param contents - the application window's webContents to ask.
 * @param deadlineMs - how long to wait before answering anyway; the cover of a
 *                     page that never settles must not become a hung window.
 * @param pollMs - how often to ask; the flag is an attribute read, so the cost
 *                 is the round trip rather than the work.
 * @returns once the page reports settled, the deadline passes, or its renderer
 *          is gone. Never rejects — every one of those is a reason to uncover.
 */
export function waitUntilPageSettled(
  contents: CoverTarget,
  deadlineMs = 10_000,
  pollMs = 100,
): Promise<void> {
  return new Promise((resolve) => {
    const deadline = Date.now() + deadlineMs
    const timer = setInterval(() => {
      if (contents.isDestroyed() || Date.now() > deadline) {
        clearInterval(timer)
        resolve()
        return
      }
      contents.executeJavaScript(`document.documentElement.dataset.${SETTLED_FLAG} === '1'`, true)
        .then((settled) => {
          if (settled !== true) return
          clearInterval(timer)
          resolve()
        })
        .catch(() => {
          // The page is mid-navigation, so there is no frame to ask. The next
          // tick asks again, and the deadline covers a page that never returns.
        })
    }, pollMs)
    timer.unref()
  })
}
