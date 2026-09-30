# Agent Note: Attach the application icon to Linux Desktop windows

Status: implemented

English | [中文](2026-09-30-desktop-linux-window-icon.zh.md)

Packaging follows [the Linux release target](2026-09-28-desktop-linux-release-target.md), which ships one unsigned AppImage and installs nothing.

## Problem

A packaged Linux Desktop window reaches the desktop with no application icon: the task list and the window decorations show a placeholder. The shell never attached one — no `BrowserWindow` construction site passed an `icon`, and the shipped artwork was read only for the About panel. The release installs no launcher entry, so the desktop environment has nothing to resolve an icon from either.

## Decision

[application-icon.ts](../../../../apps/desktop/src/application-icon.ts) owns the two shared facts. `applicationIconPath` resolves the shipped artwork once for every consumer — the packaged resource under `process.resourcesPath`, or the development copy named after the platform's artwork file — and the About panel now reads it instead of holding its own copy of that branch. `publishWindowIcon` scales the bitmap to 256 pixels and calls `BrowserWindow.setIcon`; it returns without touching the window on macOS and Windows, which keep taking their icon from the bundle and the executable resource. `createWindow`, `openWelcomeWindow`, and the policy test-login window each call it right after construction, and the frameless update overlays do not, because they never enter the task list.

Scaling exists because the packaged source is 1104 pixels square, and a window icon is drawn at panel size.

Choosing `setIcon` over the `BrowserWindow` option is settled by observation, not by reading window properties. Every product window starts hidden behind the boot cover, and `setIcon` on such a window draws the icon in a Wayland session. The X11 properties do not track this: the packaged window that shows the icon keeps an empty `_NET_WM_ICON` array and no `WM_HINTS`, while a non-Electron window on the same session publishes a rendered `Icon (128 x 128)` there. Property inspection is therefore not an acceptable verification for this feature; the visible task list and decorations are.

## Alternatives considered

**Pass `icon` in the window options.** Untested on a window that starts hidden, which is every product window here. `setIcon` is verified, so the shell does not carry two mechanisms.

**Redraw the shell on the X11 backend.** A handover that relaunched a Wayland process with `--ozone-platform=x11` was implemented and measured end to end: the replacement started, held the single-instance lock, and produced an X11 window. It was removed because the icon then appeared on native Wayland from `setIcon` alone, so the handover bought nothing for this feature and its cost — every Wayland user downgraded to XWayland, losing compositor-native per-window scaling and input handling — is not paid for. Wayland sessions keep drawing on Wayland.

**Install a launcher entry.** Writing `<appId>.desktop` plus scaled icons into the user's own directories serves the icon through the desktop environment's lookup and adds a launcher entry, but it changes what an AppImage leaves on the system, and the in-place updater cannot re-run that step after it replaces the file. A `deb` or `rpm` target has the same effect through the package manager, and [the Linux release target](2026-09-28-desktop-linux-release-target.md) already rejected those formats because the updater replaces an AppImage.

**Publish the icon over Wayland.** KDE defines `xdg_toplevel_icon_manager_v1` for exactly this, and Electron does not implement it.

## Consequences

Linux users see the application icon in the task list and window decorations in both session types, with no installed file and no change to the release shape. Nothing here touches tray availability, which still depends on [the registered StatusNotifierItem check](2026-09-28-desktop-linux-release-target.md): measured on KDE Plasma 6, the shell exports its item, the watcher never lists it, and the shell destroys the icon after its own confirmation deadline, on X11 and Wayland alike. That gap stays open.

Verification covers the icon path as unit cases — the packaged and development resolutions per platform, the Linux attach, and the non-Linux refusal — plus the window construction sites through their fakes. The visible result is a manual pass: launch the packaged AppImage in a Wayland session and confirm the icon in the task list and window decorations, since reading `_NET_WM_ICON` on that same window reports an empty property and proves nothing.
