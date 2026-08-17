/**
 * Route table for the Electron carrier: the registration surface and match
 * order the `webServer` service defines (exact path, then longest matching
 * prefix, then the single fallback seat), with no transport knowledge.
 * Separated from the carrier so the match order is testable under plain Node,
 * where `electron` cannot be imported.
 * @module @deepseek-ai/dsh-host-electron-carrier/route-table
 */

import type { WebRoute, WebUpgradeRoute } from '@deepseek-ai/dsh-host-webserver'

/**
 * The registration state behind one carrier instance. Duplicate registrations
 * throw rather than overwrite: route patterns are a composition-level
 * contract, so a collision is a misconfiguration that must fail loudly.
 */
export class WebRouteTable {
  private readonly exact = new Map<string, WebRoute>()
  private readonly prefixes = new Map<string, WebRoute>()
  private readonly upgrades = new Map<string, WebUpgradeRoute>()
  private readonly indexTaps: ((html: string) => string)[] = []
  private fallback: WebRoute['handler'] | undefined

  /**
   * Register a named route.
   * @param route - kind, path, and the owning handler.
   * @returns the disposer removing the route.
   * @throws when (kind, path) is already registered.
   */
  register(route: WebRoute): () => void {
    const table = route.kind === 'exact' ? this.exact : this.prefixes
    if (table.has(route.path)) {
      throw new Error(`electron-carrier: duplicate ${route.kind} route "${route.path}"`)
    }
    table.set(route.path, route)
    return () => { table.delete(route.path) }
  }

  /**
   * Register an exact-path HTTP upgrade route. Accepted for service parity and
   * never dispatched: a Chromium custom protocol carries no HTTP upgrade, so
   * downstream events travel over SSE on this carrier instead.
   * @param route - pathname and handler owning negotiation plus socket use.
   * @returns the disposer removing the route.
   * @throws when the path is already registered.
   */
  registerUpgrade(route: WebUpgradeRoute): () => void {
    if (this.upgrades.has(route.path)) {
      throw new Error(`electron-carrier: duplicate upgrade route "${route.path}"`)
    }
    this.upgrades.set(route.path, route)
    return () => { this.upgrades.delete(route.path) }
  }

  /**
   * Claim the fallback seat: the handler answering every request no named
   * route matches. One owner only, because two fallbacks cannot compose.
   * @param handler - owns the full response lifecycle of unmatched requests.
   * @returns the disposer releasing the seat.
   * @throws when the seat is already claimed.
   */
  registerFallback(handler: WebRoute['handler']): () => void {
    if (this.fallback !== undefined) {
      throw new Error('electron-carrier: fallback already registered')
    }
    this.fallback = handler
    return () => { this.fallback = undefined }
  }

  /**
   * Register an index.html transform, applied by the fallback owner through
   * {@link applyIndexTaps} in registration order.
   * @param transform - pure html-to-html function.
   * @returns the disposer removing the transform.
   */
  tapIndex(transform: (html: string) => string): () => void {
    this.indexTaps.push(transform)
    return () => {
      const at = this.indexTaps.indexOf(transform)
      if (at !== -1) this.indexTaps.splice(at, 1)
    }
  }

  /**
   * Run an index.html body through the registered taps in registration order.
   * @param html - the raw index.html body.
   * @returns the transformed body.
   */
  applyIndexTaps(html: string): string {
    let out = html
    for (const transform of this.indexTaps) out = transform(out)
    return out
  }

  /**
   * Resolve the handler owning one request path.
   * @param pathname - decoded absolute pathname of the request.
   * @returns the matched named route, else the fallback seat's handler, else undefined for an unclaimed path.
   */
  resolve(pathname: string): WebRoute['handler'] | undefined {
    return this.match(pathname)?.handler ?? this.fallback
  }

  /** Longest-prefix-wins over the prefix table after an exact-table miss. */
  private match(pathname: string): WebRoute | undefined {
    const exact = this.exact.get(pathname)
    if (exact !== undefined) return exact
    let best: WebRoute | undefined
    for (const [prefix, route] of this.prefixes) {
      if (pathname !== prefix && !pathname.startsWith(`${prefix}/`)) continue
      if (best === undefined || prefix.length > best.path.length) best = route
    }
    return best
  }
}
