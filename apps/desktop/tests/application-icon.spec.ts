import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BrowserWindow } from 'electron'

const native = vi.hoisted(() => ({
  app: { isPackaged: true, getAppPath: () => '/desktop-test-app' },
  createFromPath: vi.fn<(path: string) => { resize: (size: { width: number }) => { path: string; edge: number } }>(),
}))

vi.mock('electron', () => ({
  app: native.app,
  nativeImage: { createFromPath: native.createFromPath },
}))

const { applicationIconPath, publishWindowIcon } = await import('../src/application-icon.ts')

function fakeWindow() {
  return { setIcon: vi.fn() }
}

beforeEach(() => {
  native.app.isPackaged = true
  vi.stubGlobal('process', { ...process, platform: 'linux', arch: 'x64', resourcesPath: '/desktop-test-resources' })
  native.createFromPath.mockReset()
  native.createFromPath.mockImplementation(path => ({ resize: (size: { width: number }) => ({ path, edge: size.width }) }))
})

afterEach(() => { vi.unstubAllGlobals() })

describe('desktop application icon', () => {
  it('reads the shipped resource when packaged', () => {
    expect(applicationIconPath()).toBe(join('/desktop-test-resources', 'icon.png'))
  })

  it.each([
    ['win32', 'icon-windows.png'],
    ['linux', 'icon.png'],
    ['darwin', 'icon.png'],
  ] as const)('reads the %s development artwork', (platform, file) => {
    native.app.isPackaged = false
    expect(applicationIconPath(platform)).toBe(join('/desktop-test-app', 'resources', file))
  })

  it('publishes a scaled icon on Linux', () => {
    const window = fakeWindow()
    publishWindowIcon(window as unknown as BrowserWindow, 'linux')
    expect(window.setIcon).toHaveBeenCalledWith({ path: join('/desktop-test-resources', 'icon.png'), edge: 256 })
  })

  it.each(['darwin', 'win32'] as const)('leaves the %s window icon to the bundle', (platform) => {
    const window = fakeWindow()
    publishWindowIcon(window as unknown as BrowserWindow, platform)
    expect(window.setIcon).not.toHaveBeenCalled()
    expect(native.createFromPath).not.toHaveBeenCalled()
  })
})
