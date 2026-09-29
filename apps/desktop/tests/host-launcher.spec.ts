/** Host launcher selection per release platform. */

import { join } from 'node:path'
import { expect, it } from 'vitest'
import { desktopHostExecutable } from '../src/host-launcher.ts'

const ELECTRON = '/app/electron'
const PRIMARY_RUNTIME = '/app/resources/runtime/primary-runtime'

it('runs the Linux Host with the payload Node, whose GLib does not collide with sharp', () => {
  expect(desktopHostExecutable(ELECTRON, PRIMARY_RUNTIME, 'linux'))
    .toBe(join(PRIMARY_RUNTIME, 'dependencies', 'node', 'bin', 'node'))
})

it.each(['darwin', 'win32'] as const)('runs the %s Host with Electron in Node mode', (platform) => {
  expect(desktopHostExecutable(ELECTRON, PRIMARY_RUNTIME, platform)).toBe(ELECTRON)
})
