# Agent Note: Reveal the Linux Desktop window behind an animated boot cover

Status: implemented

English | [中文](2026-09-29-desktop-linux-boot-cover.zh.md)

Window timing for macOS and Windows remains governed by [the immediate-window decision](2026-09-09-desktop-immediate-window-and-direct-start.md); this Agent Note partially supersedes it for Linux, where the window appears during startup instead of after it. Close-to-background interplay follows [hiding the Desktop window on close](2026-09-23-desktop-close-to-background-and-quit-confirmation.md), and the Linux packaging this ships into follows [the Linux release target](2026-09-28-desktop-linux-release-target.md).

## Problem

A cold-started Linux Desktop gave the user no visible surface until the Host process reported ready: `createMainWindow` built the window hidden, and only `enterWorkspace` or the welcome window showed it, which can be many seconds after launch. [The immediate-window decision](2026-09-09-desktop-immediate-window-and-direct-start.md) chose to show a loading page before Host readiness, but the shipped timing kept the window offscreen on every platform, and the loading page it promised (the in-page `BootPage`) is only visible once the window is visible.

Simply showing the window earlier fails in two ways. The application document loads from `dsh-app://app/`, whose non-static routes answer 503 until the Host exists and whose theme background arrives only after the client plugins mount, so an early window flashes an unthemed rectangle. And the cover cannot live inside the page: the frontend's boot saturates the page's own main thread, so an in-page spinner loses frames in exactly the seconds it exists, and an in-page cover cannot hide the page's own unthemed first frames.

## Decision

Linux launches show an opaque, animated boot cover; macOS and Windows keep the hidden-until-ready timing with no code change on those paths. The shell owns the cover end to end in `apps/desktop`:

- [boot-cover-document.ts](../../../../apps/desktop/src/boot-cover-document.ts) assembles a complete HTML document as a pure function — the `HARNESS` wordmark, a ring spinner using the application boot page's own construction (conic arc masked into a 2px ring), the localized caption, and a gradient ground whose first stop is the flat launch colour. Every keyframe animates transform and opacity only, so the compositor keeps the motion running while the covered page is busy. The document and its palette (light `#ffffff`/`#0f1115`, dark `#151517`/`#f9fafb`) are chosen by `nativeTheme.shouldUseDarkColors` at window creation, and `prefers-reduced-motion` stills the animation. The caption is a locale-owned string (`bootCoverCaption` in both dictionaries).
- [boot-cover.ts](../../../../apps/desktop/src/boot-cover.ts) raises that document as a `WebContentsView` — a second renderer with its own frame production — attached to the main window's content view, and fills the window's `backgroundColor` with the same launch colour so the frames before the view paints show the right ground instead of white. The paint signal is the first of the view's `dom-ready`, `did-stop-loading`, and `did-finish-load` events: measured on Electron 44 Linux, a `data:` URL view never fires `did-finish-load`, so waiting on it alone would keep the window hidden until the application document's own first load finishes (the retained fallback). The cover carries no skip control, no failure panel, and no progress narration: startup failures stay with the native recovery dialog, and plugin-level progress stays with the page's `BootPage`.
- The lift signal is theme settlement, not mount: the application preload samples the computed `--dsw-alias-bg-base` and background color of `body` every 50ms and raises `document.documentElement.dataset.dshBootSettled` once the themed value has held for 400ms, which covers the two-step arrival of light stylesheets and the dark-theme attribute. Main polls that one attribute every 100ms through `executeJavaScript` with a 10-second deadline that uncovers anyway; the sampler is a timer, not `requestAnimationFrame`, and the Linux main window sets `backgroundThrottling: false` because a page covered edge to edge produces no frames. A statically themed page can settle before the cover has been on screen long enough to read as a splash, so the settle lift keeps the painted cover up for at least 700 ms (`BOOT_COVER_MIN_VISIBLE_MS`); measured on a warm local launch the whole cover phase runs 15+ seconds ahead of Host readiness. The page never learns the cover exists — lifting is main reading the page, not the page asking main.
- The cover lifts early on: backend startup failure (before `reportFatal` opens the native dialog, on both the controller error publication and the reconciliation catch), the window hiding (welcome path and close-to-background), window destruction, a lost page renderer, and a fresh main-frame navigation after the covered first load — startup's own initial navigation is the load the cover bridges, so it does not lift (measured: without that rule the cover died inside 400 ms of its own first navigation). `lift()` is idempotent, and each window has at most one cover.

## Alternatives considered

**Show the plain window and let the page's `BootPage` be the splash.** The page must load first, and until its theme stylesheets arrive it is an unthemed rectangle over a 503-forwarding carrier; frames dropped while plugins compose are exactly the frames the splash needs.

**A separate splash `BrowserWindow`.** Two top-level windows need focus and geometry choreography on every Linux desktop, and replacing one with the other is user-visible; a view inside the final window neither moves nor refocuses anything.

**Raise the cover on all three platforms now.** macOS draws through a transparent vibrancy window and Windows through a `titleBarOverlay` caption; both adaptations need their own measured verification, and this branch's scope is the Linux release.

**Narrate Host startup stages onto the cover.** `backend.start` exposes no phase events, and the in-page `BootPage` already reports per-plugin progress after the lift; the cover's `say` channel exists for a future stage source and uses none today.

**Have the page notify main over IPC when it is ready.** That makes lifting a capability the product page can exercise; reading one dataset attribute from main keeps the cover a shell-private surface and stays correct across reloads, where the flag belongs to the new document.

## Consequences

Linux users get a themed, animated window at launch instead of an unexplained pause, and the first visible frame is never an unthemed flash. What it costs: one extra renderer process alive during boot, a Linux-only branch in the window-creation and failure paths, and two Electron test mocks extended (`WebContentsView`, window `contentView`) so Linux paths stay covered in the suites. The 400ms hold and 10-second deadline are measured margins: too generous costs one more spin of the ring, too tight uncovers over a flash. macOS and Windows still do not show the loading window that the 2026-09-09 decision promised; whether they adopt this cover is an open question this note does not decide. Verification is the `boot-cover` and `boot-cover-document` specs, the Linux cases in `main-startup` and `preload-app`, and a real cold start on a Linux desktop.
