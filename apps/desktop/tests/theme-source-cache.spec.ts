import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readCachedThemeSource, writeCachedThemeSource } from '../src/theme-source-cache.ts'

let dir: string
let path: string
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'dsh-theme-cache-')); path = join(dir, 'theme-source') })
afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

describe('readCachedThemeSource', () => {
  it('answers system for a first launch with no cache file', () => {
    expect(readCachedThemeSource(path)).toBe('system')
  })

  it('answers system for unreadable or unknown contents', () => {
    writeFileSync(path, 'garbage\n')
    expect(readCachedThemeSource(path)).toBe('system')
    expect(readCachedThemeSource(join(dir, 'missing', 'nested'))).toBe('system')
  })

  it('round-trips each applied source', () => {
    for (const source of ['light', 'dark', 'system'] as const) {
      writeCachedThemeSource(path, source)
      expect(readCachedThemeSource(path)).toBe(source)
      expect(readFileSync(path, 'utf8')).toBe(source)
    }
  })

  it('keeps a failed write from surfacing at the next read', () => {
    writeCachedThemeSource(join(dir, 'missing', 'nested'), 'dark')
    expect(readCachedThemeSource(join(dir, 'missing', 'nested'))).toBe('system')
  })
})
