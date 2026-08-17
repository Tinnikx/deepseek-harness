# `@deepseek-ai/dsh-host-electron-carrier`

The zero-port `webServer` provider. It offers the same route-registration service as [webserver](../webserver/README.md) — `register`, `registerUpgrade`, `registerFallback`, `tapIndex`, `applyIndexTaps`, `port`, `host` — but carries requests over an Electron custom protocol instead of a TCP socket. Chromium routes them in-process, so a desktop composition binds no port, and every existing route consumer ([client-connection](../../client/connection/README.md), [client-modules](../../client/modules/README.md), [client-hmr](../../client/hmr/README.md), [frontend-static](../frontend-static/README.md)) mounts unchanged.

Config is one required field, `scheme` (the custom scheme without `://`). It is required rather than defaulted because it must match both the application's `registerSchemesAsPrivileged` call and the URL its window loads; a silent default would desynchronize from either.

## Application obligations

Two things sit with the composing Electron application, because they happen before a Cordis tree exists:

- **Declare the scheme before `app.whenReady()`** with `protocol.registerSchemesAsPrivileged([{ scheme, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } }])`. `standard` makes relative URLs and origins resolve, `supportFetchAPI` and `stream` are what let the API client fetch and read a streaming body.
- **Load a loopback authority**, `<scheme>://127.0.0.1/`. Chromium sends no `Host` header on a custom-protocol request, and the /api trust fence refuses a request without one, so this carrier synthesizes `Host` from the request URL's authority. A caller-supplied `host` header never overrides it. The synthesis is sound here because the request never crosses a network and only pages this application loaded can reach the scheme, so neither DNS rebinding nor a cross-site initiator — the two paths that fence defends — has a route in.

## Downstream events travel over SSE

A Chromium custom protocol carries no HTTP upgrade, so `registerUpgrade` is accepted for service parity and never dispatched. Mount `client-connection` with `downlink: sse`; its client half selects the SSE reader for a custom-protocol page, and both ends of that path already exist for the browser carrier.

Client disconnect arrives as a cancellation of the response body's stream, not as an abort of the request signal. The carrier turns that into the `'close'` event with `writableEnded` still false — the condition the bridge and `client-hmr` watch to release a subscription.

## Model Experience

None, as the package carries HTTP-shaped requests between Chromium and the route consumers; nothing here reaches a model request.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **`registerUpgrade` registrations are inert** — they are accepted so a composition can mount the same rows on either carrier, but nothing dispatches them. A row whose only downstream path is an upgrade is silently idle here; `downlink: sse` is what makes the event stream work.
- **The `node:http` adapters implement a subset** — `IncomingMessage` carries `method`, `url`, `headers`, async iteration, and `destroy`; `ServerResponse` carries `writeHead`, `write`, `end`, `destroy`, `writableEnded`, `headersSent`, and the `'close'`/`'drain'` events. The subset is the union of what every route handler in this repository uses, so a handler reaching further fails visibly rather than reading a stub.
- **The request-body size precheck does not apply** — a Fetch request carries no `content-length` for a streamed body, so the bridge's early 413 never fires on this carrier. Its cumulative byte cap still bounds the buffered body.
