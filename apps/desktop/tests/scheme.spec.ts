/**
 * The desktop application's scheme contract: the privileges Chromium needs
 * for the carrier to work at all, and the agreement between this application
 * and the bundle patch it boots. Nothing here imports Electron — `main.ts` is
 * the only module that does, and it runs only inside an Electron main process.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { load } from 'js-yaml'
import { describe, expect, it } from 'vitest'
import { entryListSchema } from '@deepseek-ai/cordis-plugin-include'
import {
  DESKTOP_AUTHORITY, DESKTOP_ENTRY_URL, DESKTOP_SCHEME, registerDesktopScheme, type SchemeRegistrar,
} from '../src/scheme.ts'

/** Capture what the application declares to Chromium. */
function captureRegistration(): Parameters<SchemeRegistrar['registerSchemesAsPrivileged']>[0] {
  let captured: Parameters<SchemeRegistrar['registerSchemesAsPrivileged']>[0] = []
  registerDesktopScheme({ registerSchemesAsPrivileged: (schemes) => { captured = schemes } })
  return captured
}

/** The `scheme` config of the desktop bundle patch's carrier row. */
function patchScheme(): unknown {
  const path = fileURLToPath(new URL(
    '../../../packages/bundle/desktop-app/cordis.patch.yml', import.meta.url,
  ))
  // The bundle patch carries `!!js` tags, which only the include plugin's
  // schema knows how to construct.
  const patches = load(readFileSync(path, 'utf8'), { schema: entryListSchema }) as {
    insert?: { id?: string; config?: { scheme?: unknown } }[]
  }[]
  const rows = patches.flatMap(patch => patch.insert ?? [])
  return rows.find(row => row.id === 'webserver')?.config?.scheme
}

describe('desktop scheme', () => {
  it('declares every privilege the carrier and the SSE downlink depend on', () => {
    expect(captureRegistration()).toEqual([{
      scheme: DESKTOP_SCHEME,
      privileges: {
        // A parsed authority (so the carrier can synthesize a Host header from
        // it) and a real origin for storage.
        standard: true,
        secure: true,
        // The page's fetch reaches the scheme; the body arrives in chunks.
        supportFetchAPI: true,
        stream: true,
        corsEnabled: true,
      },
    }])
  })

  it('loads a loopback authority, which the /api trust fence requires', () => {
    // A non-loopback authority would leave every PRIVILEGED_METHODS call
    // (settings, credentials) answering 403 with no way to configure the app.
    expect(DESKTOP_ENTRY_URL).toBe(`${DESKTOP_SCHEME}://${DESKTOP_AUTHORITY}/index.html`)
    expect(['127.0.0.1', '::1', 'localhost']).toContain(DESKTOP_AUTHORITY)
  })

  it('agrees with the carrier row of the bundle patch it boots', () => {
    // The scheme is stated in two places that Chromium never reconciles: a
    // mismatch produces a window that loads nothing, with no error naming why.
    expect(patchScheme()).toBe(DESKTOP_SCHEME)
  })
})
