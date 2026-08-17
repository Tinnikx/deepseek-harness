/**
 * Fetch `Request` to `node:http` request adapter for the Electron carrier.
 * Route handlers registered on `webServer` are written against
 * `IncomingMessage`; a Chromium custom protocol hands the carrier a Web
 * `Request` instead, so the carrier presents one over the other.
 * @module @deepseek-ai/dsh-host-electron-carrier/incoming-message
 */

import { Readable } from 'node:stream'
import type { IncomingHttpHeaders, IncomingMessage } from 'node:http'

/**
 * The `IncomingMessage` surface the carrier actually populates — the union of
 * what every route handler in this repository reads: `method` and `url`
 * (routing and method gates), `headers` (the /api trust fence and the
 * body-size precheck), async iteration (request-body buffering), and
 * `destroy` (the bridge's oversized-body path). Members outside this list are
 * absent, so a future handler reaching for one fails visibly rather than
 * reading a plausible-looking stub.
 */
type CarriedRequest = Readable & Pick<IncomingMessage, 'method' | 'url' | 'headers'>

/**
 * Headers a route handler sees, with `host` synthesized from the request URL's
 * authority.
 *
 * Chromium sends no `Host` header on a custom-protocol request, but the /api
 * trust fence requires one and refuses the request without it. The authority
 * is the honest source for this carrier: it comes from the URL Chromium
 * resolved, the request never crosses a network, and only pages this
 * application itself loaded can reach the scheme — so the DNS-rebinding and
 * cross-site attacks the fence defends have no path here. A caller-supplied
 * `host` header never overrides the authority.
 */
function carriedHeaders(request: Request, authority: string): IncomingHttpHeaders {
  const headers: IncomingHttpHeaders = {}
  for (const [name, value] of request.headers) headers[name] = value
  headers.host = authority
  return headers
}

/** Request body as a Node stream: `Buffer` chunks, or an immediately-ended stream when there is no body. */
function carriedBody(request: Request): Readable {
  const body = request.body
  if (body === null) return Readable.from([])
  return Readable.from((async function* () {
    for await (const chunk of body) yield Buffer.from(chunk)
  })())
}

/**
 * Present one Fetch request as the `IncomingMessage` route handlers expect.
 * @param request - the request Chromium routed to the custom protocol.
 * @returns a readable stream of the body carrying `method`, `url` (path and query, as node:http reports it), and headers.
 */
export function toIncomingMessage(request: Request): IncomingMessage {
  const url = new URL(request.url)
  const carried = Object.assign(carriedBody(request), {
    method: request.method,
    url: `${url.pathname}${url.search}`,
    headers: carriedHeaders(request, url.host),
  }) satisfies CarriedRequest
  // The adapter deliberately implements a subset (see CarriedRequest); the
  // cast is the seam where that decision is stated once.
  return carried as unknown as IncomingMessage
}
