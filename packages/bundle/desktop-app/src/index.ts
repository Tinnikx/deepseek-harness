/**
 * @deepseek-ai/dsh-desktop-app — the Electron desktop-surface bundle's runtime
 * glue plugin plus the bundle patch (`cordis.patch.yml`, declared by the
 * `dsh.bundle.patch` manifest field). The plugin resolves the built frontend
 * dist (workspace knowledge of this bundle, never user config), mounts the
 * `frontend-static` fallback owner over it, and registers the harness-source
 * and desktop-surface prompt sections.
 *
 * It is the web bundle's glue minus everything that describes a socket: the
 * carrier binds no port, so there is no URL to print, no bash variable naming
 * one, and no LAN authority to sample for the trust fence.
 * @module @deepseek-ai/dsh-desktop-app
 */

import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { addHarnessSourceSection } from '@deepseek-ai/dsh-app-boot'
import * as FrontendStatic from '@deepseek-ai/dsh-host-frontend-static'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-system-prompt'

/** Stable Cordis plugin name. */
export const name = 'desktop-app'

/** This dsh installation's root, from either this package's source or built entry. */
const SOURCE_ROOT = fileURLToPath(new URL('../../../..', import.meta.url))

/** Services required before the desktop runtime can mount. */
export const inject = ['webServer']

/** Plugin config. */
export interface Config {
  /**
   * Register the model-visible surface context (the `app:desktop-surface`
   * prompt section). A layer whose user is not in the GUI turns it off, so the
   * orientation text cannot be false.
   */
  surfaceContext: boolean
}

export const Config: z<Config> = z.object({
  surfaceContext: z.boolean().default(true),
})

/** Model-visible orientation and acceptance boundary for sessions created in the desktop app. */
function desktopSurfacePrompt(): string {
  return 'You are interacting with the user through the DeepSeek Harness desktop application. '
    + 'When the user refers to "this window", "this GUI", or "this app" without naming another target, they mean this application. '
    + 'It renders the same interface as the browser surface, but the window is served over an in-process custom protocol: '
    + 'the application listens on no port, so there is no local URL to open, curl, or hand to another tool. '
    + 'The GUI provides no implicit DOM, route, or screenshot context. '
    + 'Changes to the harness require rebuilding the affected artifacts and restarting the application; '
    + 'starting a web server does not update this window, so do not start one unless the user asks.'
}

/** Dist location is workspace knowledge of this bundle: resolved through the frontend package exports, not configured. */
function resolveDistIndex(): string {
  const require = createRequire(import.meta.url)
  try {
    return require.resolve('@deepseek-ai/dsh-web-frontend/dist/index.html')
  } catch {
    /* v8 ignore next 2 -- reachable only on a checkout without a built dist; the test tree builds it */
    throw new Error('desktop-app: frontend dist not built; run pnpm run build from the repository root first')
  }
}

/** Test hook: hosts with no built frontend dist substitute the resolver; production never touches this. */
export const internals: { resolveDistIndex: () => string } = { resolveDistIndex }

/**
 * Mount the desktop runtime: dist serving and the surface prompt sections.
 * @param ctx - plugin context carrying the webServer service.
 * @param config - validated {@link Config}.
 */
export function apply(ctx: Context, config: Config): void {
  ctx.plugin(FrontendStatic, { distIndex: internals.resolveDistIndex() })
  if (!config.surfaceContext) return
  ctx.inject(['systemPrompt'], (promptCtx) => {
    addHarnessSourceSection(promptCtx, SOURCE_ROOT)
    promptCtx.systemPrompt.section({
      name: 'app:desktop-surface',
      order: -98,
      text: () => desktopSurfacePrompt(),
    })
  })
}
