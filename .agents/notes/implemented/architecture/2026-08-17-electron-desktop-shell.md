# Agent Note: The desktop shell carries the harness over a custom scheme, with no port

Status: implemented

## Problem

`dsh web` binds `127.0.0.1:3080` and the browser reaches it over HTTP and a WebSocket. A desktop product must not occupy a local port, and must ship as an unpacked, VSCode-shaped directory launched by its own executable. Doing that without a second product would mean either duplicating the harness's HTTP surface or rewriting the roster of route consumers.

## Decision

The desktop surface is a second **provider of the existing `webServer` service**, not a second carrier design. `packages/host/electron-carrier` implements the same six members (`register`, `registerUpgrade`, `registerFallback`, `tapIndex`, `applyIndexTaps`, `port`/`host`) on top of `protocol.handle('dsh', …)`, which routes inside Chromium and never opens a socket. `client-connection`, `client-modules`, `frontend-static`, and `client-hmr` register their routes unchanged.

Two seams were extended rather than branched:

- `dsh-client-connection` gained a `downlink: 'websocket' | 'sse'` config field, defaulting to `websocket`. The web path is byte-identical; the desktop path selects the SSE downlink that `AbstractApiClient` already implements as its base behavior. A custom scheme has no WebSocket, so `registerUpgrade` accepts registrations that never fire.
- The window loads `dsh://127.0.0.1/index.html`, and the carrier injects `host: 127.0.0.1` from the request authority. The browser-trust fence requires a loopback `Host`, and Chromium sends none on a custom scheme. The injection is sound because the request never leaves the process.

`apps/desktop` boots the `desktop` profile through `runProfile` — the CLI's own launcher — in the Electron main process, so the harness runs with the same installation anchor, user patch layers, and presets as `dsh --profile desktop`.

## Consequences

Three host assumptions surfaced only under Electron, and each is logged in `vendor/README.md`:

- **19** — the loader's bare-specifier fallback anchored on the loader package's own directory, because Electron cannot reach Node's internal ESM loader. It now resolves through `createRequire(ctx.baseUrl)`. The `node:` imports this needs are dynamic: `tree.ts` is also bundled for the browser, where a static builtin import fails the Rollup build.
- **20** — HMR rejected a missing internal loader in its constructor, even though config-only watching never uses one.
- **21** — HMR resolved `process.argv[1]` unconditionally. An embedded host runs no entry script, so the packaged GUI failed its whole loader tree with `ERR_INVALID_ARG_TYPE`.

`scripts/build-desktop.ts` stages the closure with `pnpm deploy --legacy --prod`, materializes links that escape it, packages with `@electron/packager` (`asar: false`, `derefSymlinks: false`), and relativizes the absolute links the packager's copy leaves behind. A legacy deploy records its `--prod` selection at the workspace root, so the script reinstalls the workspace afterwards in a `finally`; without that, every later `pnpm run` in the repository reinstalls without development dependencies.

`apps/desktop/package.json` declares the full 97-package runtime closure as direct dependencies. pnpm does not deploy a workspace `peerDependency` unless some package in the closure names it as a real dependency, and 24 packages were unresolvable in the product without this. `pnpm run verify-runtime-closure:desktop` gates it, and `hygiene` runs it.

## Verification

Linux x64 only, per the platform decision.

- `dist/desktop/dsh-linux-x64/dsh` renders the full harness UI, including the native directory picker; 0 broken links, 0 absolute links in the product.
- `ss -tlnp | grep -c dsh` is 0 with nine desktop processes running.
- `dist/desktop/dsh-linux-x64/bin/dsh --help` and `--version` run the CLI on the same binary under `ELECTRON_RUN_AS_NODE`.
- `dsh web` is unchanged: index 200, `/api/events.mux` still 426 (WebSocket required), RPC past the trust fence.
- 270 tests across `app-boot`, `cmdline`, `electron-carrier`, `webserver`, `frontend-static`, `web-app`, `client-connection`, and `directory-picker-auto`.

Per the agreed delivery tier this shipped as a runnable shell: no bilingual documentation, no coverage gate, and no snapshot replay for the desktop surface yet.
