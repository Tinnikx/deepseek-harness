/**
 * Custom-protocol API carrier: HTTP upstream plus server-sent events for each
 * downstream stream. Used where the page has no WebSocket — an Electron custom
 * scheme is not an http(s) origin, so `ws:`/`wss:` cannot be constructed from
 * it — and the host serves `/api/events/*` as streaming GETs (`downlink: sse`).
 */

import { AbstractApiClient } from './api.ts'

/**
 * Platform subclass carrying every call over `fetch`. The downstream streams
 * are deliberately not overridden: {@link AbstractApiClient} reads them as SSE
 * by default, which is exactly this transport.
 */
export class SseApiClient extends AbstractApiClient {
  protected doFetch(input: URL, init?: RequestInit): Promise<Response> {
    return globalThis.fetch(input, init)
  }
}
