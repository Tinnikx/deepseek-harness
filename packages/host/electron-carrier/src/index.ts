/**
 * @deepseek-ai/dsh-host-electron-carrier — the zero-port `webServer` provider:
 * the same route-registration service `dsh-host-webserver` offers, carried
 * over an Electron custom protocol instead of a TCP socket. Requests are
 * routed inside Chromium, so a desktop composition binds no port and every
 * existing route consumer (`client-connection`, `client-modules`,
 * `client-hmr`, `frontend-static`) mounts unchanged.
 *
 * Two obligations sit with the composing application, not this plugin.
 * `protocol.registerSchemesAsPrivileged` must run before `app.whenReady`
 * — long before a Cordis tree exists — declaring the scheme `standard`,
 * `secure`, `supportFetchAPI`, `stream`, and `corsEnabled`. And the window
 * must load a loopback authority (`<scheme>://127.0.0.1/`), because the /api
 * trust fence reads the authority this carrier synthesizes into the `Host`
 * header.
 *
 * Downstream events travel over SSE here: a Chromium custom protocol carries
 * no HTTP upgrade, so `registerUpgrade` is accepted for service parity and
 * never dispatched. Mount `client-connection` with `downlink: sse`.
 * @module @deepseek-ai/dsh-host-electron-carrier
 */

import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { WebRoute, WebUpgradeRoute } from '@deepseek-ai/dsh-host-webserver'
import { WebRouteTable } from './route-table.ts'
import { dispatch } from './dispatch.ts'

/** The `electron.protocol` members this carrier uses. */
export interface ProtocolHost {
  /**
   * Route every request for a scheme through one handler.
   * @param scheme - the registered custom scheme.
   * @param handler - answers each request.
   */
  handle(scheme: string, handler: (request: Request) => Promise<Response>): void
  /**
   * Release a scheme registered through {@link ProtocolHost.handle}.
   * @param scheme - the scheme to release.
   */
  unhandle(scheme: string): void
}

/** Carrier config: which custom scheme this instance serves. */
export interface Config {
  /**
   * The custom scheme, without `://`. Required rather than defaulted: it must
   * match both the application's `registerSchemesAsPrivileged` call and the
   * URL its window loads, and a silent default would desynchronize from either.
   */
  scheme: string
}

/** Test seam for the `electron` import, which resolves only inside an Electron main process. */
export const internals = {
  /**
   * Load the protocol module.
   * @returns Electron's `protocol` module.
   */
  loadProtocol: async (): Promise<ProtocolHost> => (await import('electron')).protocol,
}

/**
 * The custom-protocol carrier. Activation claims the scheme; disposal releases
 * it. `port` is 0 and `host` is `127.0.0.1` — this carrier never listens, and
 * loopback is what its synthesized authority reports to consumers that ask
 * where the surface is reachable.
 *
 * This is the second provider of the `webServer` service, so it implements
 * every member of that service `dsh-host-webserver` declares and nothing more.
 * The declared type of `ctx.webServer` names the node:http provider's class;
 * that declaration stays accurate for consumers because the members below
 * match it, and Cordis binds a service by name rather than by class.
 */
export class ElectronCarrier extends Service {
  static Config: z<Config> = z.object({
    scheme: z.string().required(),
  })

  private readonly routes = new WebRouteTable()

  constructor(ctx: Context, private readonly config: Config) {
    super(ctx, 'webServer')
  }

  /** Always 0: requests are routed inside Chromium, so no port is bound. */
  get port(): number {
    return 0
  }

  /** Always loopback: the authority this carrier synthesizes for every request. */
  get host(): '127.0.0.1' {
    return '127.0.0.1'
  }

  /**
   * Register a named route.
   * @param route - kind, path, and the owning handler.
   * @returns the disposer removing the route.
   */
  register(route: WebRoute): () => void {
    return this.routes.register(route)
  }

  /**
   * Register an exact-path upgrade route, accepted and never dispatched — a
   * Chromium custom protocol carries no HTTP upgrade.
   * @param route - pathname and handler.
   * @returns the disposer removing the route.
   */
  registerUpgrade(route: WebUpgradeRoute): () => void {
    return this.routes.registerUpgrade(route)
  }

  /**
   * Claim the fallback seat for every path no named route matches.
   * @param handler - owns the full response lifecycle of unmatched requests.
   * @returns the disposer releasing the seat.
   */
  registerFallback(handler: WebRoute['handler']): () => void {
    return this.routes.registerFallback(handler)
  }

  /**
   * Register an index.html transform applied by the fallback owner.
   * @param transform - pure html-to-html function.
   * @returns the disposer removing the transform.
   */
  tapIndex(transform: (html: string) => string): () => void {
    return this.routes.tapIndex(transform)
  }

  /**
   * Run an index.html body through the registered taps in registration order.
   * @param html - the raw index.html body.
   * @returns the transformed body.
   */
  applyIndexTaps(html: string): string {
    return this.routes.applyIndexTaps(html)
  }

  /** Claim the scheme; a claim failure rejects initialization and fails the fiber. */
  async [Service.init](): Promise<void> {
    const protocol = await internals.loadProtocol()
    const scheme = this.config.scheme
    protocol.handle(scheme, request => dispatch(request, this.routes, (error) => {
      this.ctx.logger.warn(error)
    }))
    this.ctx.effect(() => () => { protocol.unhandle(scheme) }, 'electronCarrier.handle')
  }
}

export default ElectronCarrier
