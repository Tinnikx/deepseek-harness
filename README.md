# DeepSeek Harness

English | [中文](README.zh.md)

DeepSeek Harness (`dsh`) is an open-source agent harness developed by [DeepSeek AI](https://deepseek.com).

It uses an architecture where **everything is a plugin**, and is powered by [Cordis](https://github.com/cordiverse/cordis), whose design is described in [_A Programming Paradigm for Spatiotemporal Composability_](https://github.com/cordiverse/paper).

## Developer preview

DeepSeek Harness is currently in _developer preview_ and is iterating rapidly. **THERE WILL BE COMPATIBILITY-BREAKING CHANGES.**

## Run

### Run from `npm`

Install `Node.js`, then run:

```sh
npx @deepseek-ai/dsh web
```

The command starts the Web UI, served at `http://127.0.0.1:3080` by default. See [Web UI guide](docs/user/guide/index.md).

### Run from source

To run from a repository checkout:

```sh
git clone https://github.com/deepseek-ai/deepseek-harness.git
cd deepseek-harness
pnpm install
pnpm run build
pnpm dsh web
```

## Desktop application

`dsh` also ships as an unpacked desktop application. It runs the same harness as `dsh web` — same plugins, same UI — but **opens no local port**.

### Build

```sh
pnpm run build:desktop                 # full build, then stage and package
pnpm run build:desktop --skip-build    # reuse existing lib/ and apps/web/dist
pnpm run build:desktop --dry-run       # print every command and file change
```

Linux x64 only. The product lands in `dist/desktop/dsh-linux-x64/`:

```
dist/desktop/dsh-linux-x64/
├── dsh                  renamed Electron binary — opens the GUI
├── bin/dsh              CLI wrapper — the same binary under ELECTRON_RUN_AS_NODE
├── resources/app/       the application, plain files (asar disabled)
│   ├── package.json     main: lib/main.js
│   ├── lib/main.js
│   └── node_modules/    pnpm-deployed production closure
└── locales/, *.pak, …   Electron runtime
```

Run `./dsh` for the GUI and `./bin/dsh` for the command line.

### Distribute

The product contains no absolute paths and runs from any directory on any machine. Archive it with a format that preserves symbolic links:

```sh
tar -czf dsh-linux-x64.tar.gz -C dist/desktop dsh-linux-x64
```

`resources/app/node_modules` is a pnpm isolated store reached through 2980 relative links. A plain `zip` dereferences them and inflates the 738 MB directory several-fold; use `tar` or `zip -y`.

Two host requirements no archive can carry:

- `chrome-sandbox` ships without its setuid bit, so it relies on unprivileged user namespaces being enabled on the target host. An installer running as root should `chown root:root` and `chmod 4755` it instead.
- Linux x64 against glibc. No other platform is built.

### How it works

Zero ports comes from **replacing the carrier, not the server**. `dsh web` serves HTTP through `dsh-host-webserver`; the desktop profile substitutes `dsh-host-electron-carrier`, a second provider of the same `webServer` service, implemented over Electron's `protocol.handle('dsh', …)`. Chromium routes those requests inside the process and never opens a socket, so `client-connection`, `client-modules`, `frontend-static`, and `client-hmr` register their routes unchanged.

Three consequences follow from that substitution:

- **Downlink.** A custom scheme has no WebSocket, so `dsh-client-connection` gained a `downlink: 'websocket' | 'sse'` field. The desktop bundle selects `sse`, which `AbstractApiClient` already implements as its base behavior; `websocket` remains the default and the browser path is byte-identical.
- **Trust fence.** `isTrustedApiRequest` requires a loopback `Host` header and Chromium sends none on a custom scheme. The window loads `dsh://127.0.0.1/index.html`, and the carrier injects `host: 127.0.0.1` from the request authority — sound because the request never leaves the process.
- **One binary, two entry points.** `bin/dsh` execs the Electron binary with `ELECTRON_RUN_AS_NODE=1`. The variable stays exported rather than consumed, because the harness re-launches `process.execPath` for its subprocess and worker capabilities.

Packaging is a pipeline in [`scripts/build-desktop.ts`](scripts/build-desktop.ts): build, `pnpm deploy --legacy --prod` into `dist/desktop-staging`, `@electron/packager` with `asar: false` and `derefSymlinks: false`, then two link repairs. Both repairs are mandatory. A `link:` workspace dependency — every vendored Cordis package is one — still points into the repository after the deploy, so its target is copied in before packaging; and the packager's copy resolves relative links into absolute staging paths the product does not contain, so they are rewritten relative afterwards. The deploy also records its `--prod` selection at the workspace root, so the script reinstalls the workspace when it finishes.

The design decision and its verification are recorded in [the Agent Note](.agents/notes/implemented/architecture/2026-08-17-electron-desktop-shell.md).

## Community and support

- Feel free to submit feedback or bug reports through [GitHub Discussions](https://github.com/deepseek-ai/deepseek-harness/discussions).
- Add the [`dsh-plugin`](https://github.com/topics/dsh-plugin) topic to your plugin repository for discoverability.
- Join <a href="https://discord.gg/Ycq5dCaS4">DeepSeek Harness Discord community</a>.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## Development

Start with the [development guide](docs/development.md) and [architecture documentation](docs/architecture.md).

For agents, follow [AGENTS.md](AGENTS.md).

## License

[MIT](LICENSE)

Third-party dependencies and their licenses are disclosed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
