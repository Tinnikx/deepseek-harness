/** Shell-owned cache of the last theme source the application page applied. */

import { readFileSync, writeFileSync } from 'node:fs'

/** Theme sources the Web UI's `data-ds-theme-source` bootstrap and presenter write. */
export type CachedThemeSource = 'light' | 'dark' | 'system'

/**
 * Read the theme source cached by a previous run.
 * @param path - userData file holding exactly one source name.
 * @returns the cached source, or `system` when the file is absent or unreadable;
 *          the cache only tunes the Linux boot cover, so a lost read must not
 *          block startup.
 */
export function readCachedThemeSource(path: string): CachedThemeSource {
  try {
    const value = readFileSync(path, 'utf8').trim()
    return value === 'light' || value === 'dark' || value === 'system' ? value : 'system'
  } catch {
    // Absent on first launch; an unreadable or corrupt file means no better
    // answer than following the system, which is what a fresh install does.
    return 'system'
  }
}

/**
 * Record the theme source the running application applied.
 * @param path - userData file to overwrite with the source name.
 * @param source - value accepted by `nativeTheme.themeSource`.
 */
export function writeCachedThemeSource(path: string, source: CachedThemeSource): void {
  try {
    writeFileSync(path, source)
  } catch {
    // The only consumer is the next launch's boot cover colour; a failed write
    // repeats this run's source next time at worst. Never surfaces to the user.
  }
}
