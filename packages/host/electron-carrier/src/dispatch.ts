/**
 * Request dispatch for the Electron carrier: resolve one Fetch request against
 * the route table, run the owning `node:http` handler over the adapters, and
 * hand Chromium the response.
 * @module @deepseek-ai/dsh-host-electron-carrier/dispatch
 */

import { toIncomingMessage } from './incoming-message.ts'
import { createServerResponse } from './server-response.ts'
import type { WebRouteTable } from './route-table.ts'

/** Errors reaching this reporter answered the request; they never reach Chromium. */
export type ErrorReporter = (error: Error) => void

function asError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value))
}

/**
 * Serve one custom-protocol request.
 *
 * Dispatch completes as soon as the handler fixes its status and headers, not
 * when the handler returns: an SSE route keeps its response open indefinitely,
 * and Chromium needs the `Response` before the first byte can flow. A handler
 * that finishes without ever responding, or that throws before responding, is
 * a defect in that route rather than a client error, so it answers 500 and
 * reports.
 *
 * @param request - the request Chromium routed to the scheme.
 * @param table - the carrier's registrations.
 * @param onError - receives per-request handler failures.
 * @returns the response for Chromium; never rejects.
 */
export async function dispatch(request: Request, table: WebRouteTable, onError: ErrorReporter): Promise<Response> {
  let pathname: string
  try {
    pathname = new URL(request.url).pathname
  } catch (error) {
    // A malformed URL cannot be routed; answering 400 keeps one bad request
    // from becoming an unhandled rejection inside Chromium's protocol handler.
    onError(asError(error))
    return new Response(null, { status: 400 })
  }

  const handler = table.resolve(pathname)
  if (handler === undefined) return new Response(null, { status: 404 })

  const req = toIncomingMessage(request)
  const res = createServerResponse()

  const finished = (async () => {
    try {
      await handler(req, res)
    } catch (error) {
      onError(asError(error))
      if (!res.headersSent) res.writeHead(500)
      if (!res.writableEnded) res.destroy()
    }
    return 'returned' as const
  })()

  const first = await Promise.race([res.headersReady.then(() => 'responded' as const), finished])
  if (first === 'returned' && !res.headersSent) {
    onError(new Error(`electron-carrier: route "${pathname}" returned without responding`))
    res.writeHead(500)
    res.end()
  }
  await res.headersReady
  return res.toResponse()
}
