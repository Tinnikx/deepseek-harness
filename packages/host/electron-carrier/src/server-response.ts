/**
 * `node:http` response to Fetch `Response` adapter for the Electron carrier.
 * Route handlers own the response lifecycle through a `ServerResponse`; a
 * Chromium custom protocol expects one `Response` whose body may stream, so
 * the carrier presents a writable that produces exactly that.
 * @module @deepseek-ai/dsh-host-electron-carrier/server-response
 */

import { Writable } from 'node:stream'
import type { OutgoingHttpHeaders, ServerResponse } from 'node:http'

/**
 * The `ServerResponse` surface the carrier implements — the union of what
 * every route handler in this repository uses: `writeHead`, `write`, `end`,
 * `destroy`, `writableEnded`, `headersSent`, and `on`/`once`/`off` for
 * `'close'` and `'drain'`. Everything else is absent so an unsupported use
 * fails visibly instead of reading a plausible-looking stub.
 */
export type CarriedResponseSurface = Pick<
  ServerResponse, 'write' | 'end' | 'destroy' | 'writableEnded' | 'headersSent' | 'on' | 'once' | 'off'
> & { writeHead(status: number, headers?: OutgoingHttpHeaders): void }

/** Normalize a `writeHead` header bag into Fetch headers, dropping unset values. */
function toHeaders(headers: OutgoingHttpHeaders | undefined): Headers {
  const out = new Headers()
  for (const [name, value] of Object.entries(headers ?? {})) {
    if (value === undefined) continue
    if (Array.isArray(value)) for (const item of value) out.append(name, item)
    else out.set(name, String(value))
  }
  return out
}

/** Statuses the Fetch specification forbids a body on; constructing one with a stream throws. */
const NULL_BODY_STATUS = new Set([204, 205, 304])

/**
 * A `ServerResponse`-shaped writable backed by a Fetch `Response`.
 *
 * Two lifecycle facts drive the design. First, a handler may never return —
 * `client-hmr` holds its SSE response open for the process lifetime — so the
 * carrier dispatches on {@link headersReady} rather than on handler
 * completion. Second, Chromium reports client disconnect by cancelling the
 * response body's stream, not by aborting the request signal, so
 * {@link ReadableStreamDefaultController} cancellation is what destroys this
 * writable and emits `'close'` with `writableEnded` still false — the exact
 * condition `client-connection`'s bridge and `client-hmr` watch to release
 * their subscriptions.
 */
export class CarriedResponse extends Writable {
  private controller: ReadableStreamDefaultController<Uint8Array> | undefined
  /** Held `_write` callback while the reader has not drained the queue. */
  private draining: (() => void) | undefined
  private status = 200
  private responseHeaders = new Headers()
  private sent = false
  private announceReady!: () => void

  /** Resolves once the status and headers are final and the response may be dispatched. */
  readonly headersReady: Promise<void> = new Promise((resolve) => { this.announceReady = resolve })

  /** The streaming body handed to Chromium. */
  private readonly stream: ReadableStream<Uint8Array> = new ReadableStream({
    start: (controller) => { this.controller = controller },
    pull: () => { this.releaseDraining() },
    cancel: () => { this.onClientGone() },
  })

  /** Whether the status line and headers are final. */
  get headersSent(): boolean {
    return this.sent
  }

  /**
   * Fix the status and headers. A second call is ignored, matching node:http,
   * where headers are immutable once sent.
   * @param status - HTTP status code.
   * @param headers - response headers; array values become repeated headers.
   */
  writeHead(status: number, headers?: OutgoingHttpHeaders): void {
    if (this.sent) return
    this.status = status
    this.responseHeaders = toHeaders(headers)
    this.sent = true
    this.announceReady()
  }

  /**
   * The response Chromium serves, valid once {@link headersReady} settles.
   * A 204, 205, or 304 is emitted bodiless: node:http lets a handler write to
   * one and drops the bytes, while Fetch refuses to construct one with a body
   * at all.
   * @returns the status, headers, and streaming body written so far and hereafter.
   */
  toResponse(): Response {
    const body = NULL_BODY_STATUS.has(this.status) ? null : this.stream
    return new Response(body, { status: this.status, headers: this.responseHeaders })
  }

  override _write(chunk: unknown, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
    if (!this.sent) this.writeHead(this.status)
    const controller = this.controller
    if (controller === undefined) {
      // Post-cancellation write: the client is gone, so the bytes have nowhere
      // to go. Accepting them keeps a handler that has not yet noticed the
      // 'close' event from erroring on its own teardown path.
      callback()
      return
    }
    controller.enqueue(new Uint8Array(chunk as Buffer))
    // Backpressure: hold the callback until the reader pulls again, so a
    // suspended SSE consumer cannot make the producer buffer without bound.
    if ((controller.desiredSize ?? 1) > 0) callback()
    else this.draining = callback
  }

  override _final(callback: (error?: Error | null) => void): void {
    if (!this.sent) this.writeHead(this.status)
    this.closeStream()
    callback()
  }

  override _destroy(error: Error | null, callback: (error?: Error | null) => void): void {
    if (!this.sent) this.writeHead(error === null ? this.status : 500)
    this.closeStream()
    callback(error)
  }

  /** Close the body stream exactly once; a cancelled stream is already closed. */
  private closeStream(): void {
    const controller = this.controller
    this.controller = undefined
    this.releaseDraining()
    if (controller === undefined) return
    controller.close()
  }

  /** Resume a `_write` parked on backpressure. */
  private releaseDraining(): void {
    const callback = this.draining
    this.draining = undefined
    callback?.()
  }

  /**
   * Client disconnect. Dropping the controller first stops every later write
   * from reaching a cancelled stream, which would throw; destroying then emits
   * `'close'` with `writableEnded` false, the disconnect signal handlers read.
   */
  private onClientGone(): void {
    this.controller = undefined
    this.releaseDraining()
    if (!this.destroyed) this.destroy()
  }
}

/**
 * Create the response object a route handler writes to.
 * @returns the writable, typed as the `ServerResponse` handlers expect.
 */
export function createServerResponse(): CarriedResponse & ServerResponse {
  // The adapter deliberately implements a subset (see CarriedResponseSurface);
  // this cast is the one seam where that decision is stated.
  return new CarriedResponse() as unknown as CarriedResponse & ServerResponse
}
