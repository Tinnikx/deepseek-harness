# `@deepseek-ai/dsh-desktop`

The dsh desktop application: an Electron shell around the same frontend the browser surface serves, with the harness running inside the Electron main process and **no local port bound**.

## How it runs

`src/main.ts` does three things in the order Chromium forces:

1. **At module load**, before `app.whenReady()`, it declares the `dsh` scheme through [`registerDesktopScheme`](src/scheme.ts). Chromium reads the privilege table once while building the renderer's scheme registry; a later call is silently ineffective.
2. **After ready**, it calls `runProfile` — the CLI's own launcher, imported as `@deepseek-ai/dsh/profile-boot` — with profile `desktop`. Composition, user patch layers (`$DSH_HOME/profiles/desktop/cordis.patch.yml` and `$DSH_HOME/cordis.patch.yml`), the shipped agent presets, hot reload, and bounded shutdown are therefore identical to `dsh --profile desktop`. The `desktop` profile template ships in `dsh-app-boot`, so a first launch initializes the directory itself.
3. **After the tree settles**, it opens the window on `dsh://127.0.0.1/index.html`. By then [`dsh-host-electron-carrier`](../../packages/host/electron-carrier/README.md) — the `webServer` provider the [`dsh-desktop-app`](../../packages/bundle/desktop-app/README.md) bundle mounts in place of `dsh-host-webserver` — has claimed the scheme, so the first request already has a route table to hit.

The window carries no Node capability: `contextIsolation` and `sandbox` are on, `nodeIntegration` is off, and there is no preload script. The page reaches the harness only through the custom scheme, exactly as a browser tab reaches it only through the HTTP carrier.

The window's icon is [`assets/icon.png`](assets/icon.png) — the frontend's hero mark (`FishLogo`) rendered at 512px in brand blue over transparency, so it reads on both light and dark shells. `window.ts` resolves it relative to its own module, which lands on the same file from `src/` and from the bundled `lib/main.js`; `package.json` lists `assets` in `files` so the deployed closure carries it. This is what Linux desktop environments and Windows show in the task bar, dock, and window switcher. macOS reads the application bundle instead and ignores it.

## Zero ports

Requests on a custom scheme are routed inside Chromium and never touch the network stack, so the application listens on nothing. `ss -tlnp` shows no socket for the process. The loopback authority in the URL is not a bind address — it is the value the carrier synthesizes into the `Host` header that the `/api` trust fence reads, which is why it must stay loopback: a different authority would make every privileged RPC (settings, credentials) answer 403.

## Build and launch

```sh
pnpm run build                        # tsc -b, tsdown, and the frontend dist the bundle serves
pnpm exec electron apps/desktop       # launch from the source checkout
pnpm run build:desktop                # package into dist/desktop/dsh-linux-x64/
```

The packaged directory and its launcher are described in [`scripts/build-desktop.ts`](../../scripts/build-desktop.ts).

## Known Limitations and Deferred Work

- **Native window frame, not a custom title bar.** VSCode draws its own title bar; this application keeps the platform's, with the menu bar auto-hidden. Hiding the frame requires a `-webkit-app-region: drag` region in the frontend shell, which `dsh-client-web` does not have — without one the window could not be moved or closed.
- **Linux x64 only.** `scripts/build-desktop.ts` targets one platform. macOS and Windows need their own packager targets, icons, and (on macOS) the `activate`/`window-all-closed` conventions this entry deliberately omits.
- **Native addons are not rebuilt for the Electron ABI.** The desktop composition inherits the web bundle's rows, which avoid the sandbox addon; a composition that adds one needs an `electron-rebuild` step.
