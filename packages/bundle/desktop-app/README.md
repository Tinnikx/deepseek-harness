# `@deepseek-ai/dsh-desktop-app`

The dsh Electron desktop-surface bundle. [`cordis.patch.yml`](cordis.patch.yml) rides over [`dsh-base`](../base/README.md) with the same host rows, browser plugin roster, and agent-plane preset arrangement as [`dsh-web-app`](../web-app/README.md); the difference is the transport. The `webserver` row is [`dsh-host-electron-carrier`](../../host/electron-carrier/README.md), which offers the same `webServer` service over an Electron custom protocol, so the application binds no port. The `connection` row therefore takes `downlink: sse` (a Chromium custom protocol carries no HTTP upgrade) and an empty `trustedHosts` (nothing beyond loopback can reach the scheme). There is no command-line provider row: this surface takes no flags, so every row's config is literal.

This package's `desktop-runtime` glue plugin (config `{surfaceContext}`) resolves the built frontend dist through `@deepseek-ai/dsh-web-frontend`'s exports, mounts the [`frontend-static`](../../host/frontend-static/README.md) fallback owner, and registers the harness-source and desktop-surface prompt sections. It prints no URL line and samples no LAN trust: the carrier binds no socket, so neither exists to report.

The Electron application that composes this bundle is [`apps/desktop`](../../../apps/desktop/README.md). It registers the `dsh` scheme before `app.whenReady()` and loads `dsh://127.0.0.1/index.html`; both obligations are documented on the carrier.

## Model Experience

### Harness-source and desktop-surface context

#### What the model sees

When `surfaceContext` is true, the `harness:source` section identifies the on-disk Harness implementation without claiming it is the working directory, and the `app:desktop-surface` global section (order −98) orients the model to the window: the "this app" referent, the fact that the application listens on no port so there is no local URL to hand another tool, and the instruction not to start a replacement server. When it is false, neither section is registered.

#### Token effect

One source line and one prompt paragraph per session; constant per process.

#### KV Cache effect

The prompt section sits near the system prompt's head and is fixed text, so it does not invalidate the cache across turns.

## Known Limitations and Deferred Work

- **The frontend dist must be built** — `require.resolve` of the dist fails loud at activation with a build hint; there is no source-serving fallback.
- **The scheme is fixed at `dsh` in the patch** — the carrier takes it as config, but the application's `registerSchemesAsPrivileged` call and window URL must match, and those live in `apps/desktop`. Changing it means editing both together.
