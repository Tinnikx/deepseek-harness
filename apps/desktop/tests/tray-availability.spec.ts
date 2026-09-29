import { execFileSync } from 'node:child_process'
import { afterEach, expect, it, vi } from 'vitest'
import { hasStatusNotifierHost, readRegisteredStatusNotifierItems, trayRegistrationConfirmed } from '../src/tray-availability.ts'

vi.mock('node:child_process', () => ({ execFileSync: vi.fn() }))

afterEach(() => { vi.clearAllMocks() })

it('asks the session bus whether a shell owns the StatusNotifier watcher', () => {
  vi.mocked(execFileSync).mockReturnValue('(true,)')
  expect(hasStatusNotifierHost()).toBe(true)
  const [command, args, options] = vi.mocked(execFileSync).mock.calls[0]!
  expect(command).toBe('gdbus')
  expect(args).toContain('org.kde.StatusNotifierWatcher')
  // The probe runs during startup, so an unanswered bus must not hold the application open.
  expect(options).toEqual({ encoding: 'utf8', timeout: 1_000 })
})

it('reports no tray host when the session bus probe fails', () => {
  vi.mocked(execFileSync).mockImplementation(() => { throw new Error('gdbus: command not found') })
  expect(hasStatusNotifierHost()).toBe(false)
})

it.each([
  ['(true,)', true],
  ['(false,)', false],
  ['', false],
])('reads the %s reply as %s', (reply, expected) => {
  expect(hasStatusNotifierHost(() => reply)).toBe(expected)
})

it('treats a thrown or timed-out query as no tray host', () => {
  expect(hasStatusNotifierHost(() => { throw new Error('gdbus: not responding') })).toBe(false)
  expect(hasStatusNotifierHost(() => { throw Object.assign(new Error('timed out'), { code: 'ETIMEDOUT' }) })).toBe(false)
})

it('asks the watcher which tray items a shell has registered', () => {
  vi.mocked(execFileSync).mockReturnValue("(<[':1.83/StatusNotifierItem'],)>)")
  expect(readRegisteredStatusNotifierItems()).toStrictEqual([':1.83/StatusNotifierItem'])
  const [command, args, options] = vi.mocked(execFileSync).mock.calls[0]!
  expect(command).toBe('gdbus')
  expect(args).toContain('RegisteredStatusNotifierItems')
  expect(args).toContain('org.kde.StatusNotifierWatcher')
  expect(options).toEqual({ encoding: 'utf8', timeout: 1_000 })
})

it.each([
  ["(<[':1.83/StatusNotifierItem', 'org.kde.StatusNotifierItem-7-1/StatusNotifierItem'],)>)",
    [':1.83/StatusNotifierItem', 'org.kde.StatusNotifierItem-7-1/StatusNotifierItem']],
  ['(<[]>,)', []],
])('reads the %s reply as the %j item list', (reply, expected) => {
  expect(readRegisteredStatusNotifierItems(() => reply)).toStrictEqual(expected)
})

it('reads a refused registered-item query as no answer rather than an empty list', () => {
  expect(readRegisteredStatusNotifierItems(() => { throw new Error('gdbus: Unknown object') })).toBeUndefined()
})

it('confirms the tray once the watcher lists an item it did not hold before', async () => {
  const read = vi.fn<() => readonly string[] | undefined>()
    .mockReturnValueOnce([':1.83/StatusNotifierItem'])
    .mockReturnValue([':1.83/StatusNotifierItem', ':1.99/StatusNotifierItem'])
  await expect(trayRegistrationConfirmed([':1.83/StatusNotifierItem'], { read, wait: async () => {} })).resolves.toBe(true)
  expect(read).toHaveBeenCalledTimes(2)
})

it('gives up when the registered list keeps holding only the items read before the tray', async () => {
  const read = vi.fn<() => readonly string[] | undefined>().mockReturnValue([':1.83/StatusNotifierItem'])
  const wait = vi.fn<() => Promise<void>>().mockResolvedValue(undefined)
  await expect(trayRegistrationConfirmed([':1.83/StatusNotifierItem'], { read, wait, deadlineMs: 1_000, pollMs: 250 }))
    .resolves.toBe(false)
  expect(read).toHaveBeenCalledTimes(5)
  expect(wait).toHaveBeenCalledTimes(4)
})

it('stops waiting when the watcher stops answering', async () => {
  const read = vi.fn<() => readonly string[] | undefined>().mockReturnValue(undefined)
  await expect(trayRegistrationConfirmed([], { read, wait: async () => {}, deadlineMs: 1_000, pollMs: 250 })).resolves.toBe(false)
  expect(read).toHaveBeenCalledOnce()
})
