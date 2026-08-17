/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-host-electron-carrier`.
 * @module @deepseek-ai/dsh-host-electron-carrier/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-host-electron-carrier'

/** Cordis companion plugin name. */
export const name = 'host-electron-carrier-invariant'
/** Service required before the companion can register. */
export const inject = ['invariants']

/**
 * No runtime invariant: the carrier owns one claim on a Chromium scheme and a
 * route table, neither of which appears in an authoritative event stream this
 * companion could observe. The scheme claim lives in the Electron main
 * process outside Cordis, and route registration is checked the same way the
 * node:http carrier's is — by disposing the fiber in the package's HMR-safety
 * test and observing removal — not by probing a live registration, which
 * would false-positive on every correct disposal.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
