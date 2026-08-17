/**
 * The desktop surface's scheme: the one fact the Electron application, the
 * carrier row in the desktop bundle's patch, and the window URL must all
 * agree on.
 *
 * The authority is loopback because the `/api` trust fence reads the `Host`
 * header the carrier synthesizes from it; a non-loopback authority would make
 * every privileged RPC (settings, credentials) 403.
 * @module @deepseek-ai/dsh-desktop/scheme
 */

/** The custom scheme this application serves; matches the bundle patch's `webserver` row config. */
export const DESKTOP_SCHEME = 'dsh'

/** The loopback authority every desktop request carries. */
export const DESKTOP_AUTHORITY = '127.0.0.1'

/** The window's entry URL. */
export const DESKTOP_ENTRY_URL = `${DESKTOP_SCHEME}://${DESKTOP_AUTHORITY}/index.html`

/** The `electron.protocol` member this module uses, named so the registration is testable without Electron. */
export interface SchemeRegistrar {
  /**
   * Declare custom schemes and their privileges.
   * @param schemes - one entry per scheme.
   */
  registerSchemesAsPrivileged(schemes: {
    scheme: string
    privileges: Record<string, boolean>
  }[]): void
}

/**
 * Declare the desktop scheme's privileges. Chromium reads this table once,
 * while building the renderer's scheme registry, so it MUST run before
 * `app.whenReady()` — after that the call is silently ineffective and the
 * window loads an opaque origin that can neither fetch nor stream.
 *
 * Each privilege is load-bearing: `standard` gives the scheme a parsed
 * authority and a real origin (without it `127.0.0.1` would be path text and
 * storage would be unavailable), `secure` puts it in the trusted-origin set so
 * service workers and `crypto.subtle` work as they do over https,
 * `supportFetchAPI` lets the page's `fetch` reach it at all, `stream` lets a
 * response body arrive in chunks (the SSE downlink is exactly that), and
 * `corsEnabled` lets the carrier's own CORS headers govern instead of a blanket
 * block.
 * @param registrar - Electron's `protocol` module.
 */
export function registerDesktopScheme(registrar: SchemeRegistrar): void {
  registrar.registerSchemesAsPrivileged([{
    scheme: DESKTOP_SCHEME,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
      corsEnabled: true,
    },
  }])
}
