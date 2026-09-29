/**
 * Whether this Linux session can display a tray icon.
 *
 * Electron builds the Linux `Tray` as a StatusNotifierItem, which only appears when some shell
 * owns `org.kde.StatusNotifierWatcher` (KDE, Xfce, Cinnamon, or GNOME with the AppIndicator
 * extension). Electron exposes no support query and constructing a `Tray` without a watcher fails
 * silently, so the shell asks the session bus once at startup and treats any other answer as
 * "nothing will show", which the window close path turns into a quit rather than a stranded
 * invisible window.
 *
 * A watcher answering for itself is not enough: measured on KDE Plasma 6, Electron exported
 * `org.freedesktop.StatusNotifierItem-<pid>-1` on the bus while the watcher's registered list never
 * gained it, so the drawn tray is confirmed by reading that list back after the icon is built.
 */

import { execFileSync } from 'node:child_process'

/** Session-bus name a tray-capable shell owns. */
const STATUS_NOTIFIER_WATCHER = 'org.kde.StatusNotifierWatcher'

/** How long the bus may take to answer before the shell assumes no watcher. */
const PROBE_TIMEOUT_MS = 1_000

/** How long a built tray may take to reach the watcher's registered list before it counts as undrawn. */
const REGISTRATION_DEADLINE_MS = 3_000

/** Gap between registered-list reads while waiting for a built tray to appear. */
const REGISTRATION_POLL_MS = 250

/**
 * Read one `org.freedesktop.DBus.NameHasOwner` reply for the watcher name.
 * @param timeoutMs - Kill the query after this long.
 * @returns The `gdbus` reply text, such as `(true,)`.
 */
function readNameHasOwnerReply(timeoutMs: number): string {
  return execFileSync('gdbus', [
    'call', '--session',
    '--dest', 'org.freedesktop.DBus',
    '--object-path', '/org/freedesktop/DBus',
    '--method', 'org.freedesktop.DBus.NameHasOwner',
    STATUS_NOTIFIER_WATCHER,
  ], { encoding: 'utf8', timeout: timeoutMs })
}

/**
 * Ask the session bus whether a tray-capable shell is registered.
 * @param query - Command runner returning the `NameHasOwner` reply; injected so specs decide the answer.
 * @returns true only when the bus reports an owner for the watcher name.
 */
export function hasStatusNotifierHost(
  query: (timeoutMs: number) => string = readNameHasOwnerReply,
): boolean {
  let reply: string
  try {
    reply = query(PROBE_TIMEOUT_MS)
  }
  catch {
    // No session bus, no `gdbus`, and a refused query each mean no shell will draw the icon.
    return false
  }
  return /\(\s*true\s*,\s*\)/u.test(reply)
}

/**
 * Read the watcher's registered item addresses.
 * @param timeoutMs - Kill the query after this long.
 * @returns The `gdbus` reply text, such as `(<[':1.83/StatusNotifierItem'],)>`.
 */
function readRegisteredItemsReply(timeoutMs: number): string {
  return execFileSync('gdbus', [
    'call', '--session',
    '--dest', STATUS_NOTIFIER_WATCHER,
    '--object-path', '/StatusNotifierWatcher',
    '--method', 'org.freedesktop.DBus.Properties.Get',
    STATUS_NOTIFIER_WATCHER, 'RegisteredStatusNotifierItems',
  ], { encoding: 'utf8', timeout: timeoutMs })
}

/**
 * Read the tray items a shell has registered.
 * @param query - Command runner returning the property reply; injected so specs decide the answer.
 * @returns Item addresses, or undefined when the bus did not answer, which is not an empty list.
 */
export function readRegisteredStatusNotifierItems(
  query: (timeoutMs: number) => string = readRegisteredItemsReply,
): readonly string[] | undefined {
  let reply: string
  try {
    reply = query(PROBE_TIMEOUT_MS)
  }
  catch {
    return undefined
  }
  return reply.match(/'([^']*)'/gu)?.map(address => address.slice(1, -1)) ?? []
}

/**
 * Wait until a shell registers an item that was not registered before, which is how a built tray
 * proves the desktop actually draws it. A concurrent registration by another application reads as
 * drawn, which is the safe direction: the window then hides behind a visible icon.
 * @param before - Item addresses read before the tray was built.
 * @param options - Reader, waiter, and timing, injected so specs drive the rounds without a session bus.
 * @returns true once a new item appears, false when the deadline passes or the bus stops answering.
 */
export async function trayRegistrationConfirmed(
  before: readonly string[],
  options: {
    readonly read?: () => readonly string[] | undefined
    readonly wait?: (ms: number) => Promise<void>
    readonly deadlineMs?: number
    readonly pollMs?: number
  } = {},
): Promise<boolean> {
  const read = options.read ?? readRegisteredStatusNotifierItems
  const wait = options.wait ?? ((ms: number) => new Promise<void>((resolve) => { setTimeout(resolve, ms) }))
  const deadlineMs = options.deadlineMs ?? REGISTRATION_DEADLINE_MS
  const pollMs = options.pollMs ?? REGISTRATION_POLL_MS
  for (let waited = 0;; waited += pollMs) {
    const registered = read()
    if (registered === undefined) return false
    if (registered.some(address => !before.includes(address))) return true
    if (waited + pollMs > deadlineMs) return false
    await wait(pollMs)
  }
}
