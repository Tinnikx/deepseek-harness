/**
 * Desktop runtime glue behavior: dist resolution through the bundle's own
 * hook, the frontend-static child claiming the fallback seat, and the
 * harness-source and desktop-surface prompt sections under both settings of
 * `surfaceContext`.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import type { WebServer } from '@deepseek-ai/dsh-host-webserver'
import { apply, Config, internals } from '../src/index.ts'

const originalResolve = internals.resolveDistIndex

let dist: string | undefined

afterEach(() => {
  internals.resolveDistIndex = originalResolve
  if (dist !== undefined) rmSync(dist, { recursive: true, force: true })
  dist = undefined
})

/** Stage a dist fixture and point the bundle's resolver at it. */
function stageDist(): void {
  dist = mkdtempSync(join(tmpdir(), 'dsh-desktop-app-'))
  mkdirSync(join(dist, 'dist'))
  const index = join(dist, 'dist', 'index.html')
  writeFileSync(index, '<head></head><body>shell</body>')
  internals.resolveDistIndex = () => index
}

/**
 * A fake webServer capturing the fallback seat. The carrier's own values stand
 * in for the http one's: no port, loopback authority.
 */
function fakeCarrier(): { server: WebServer; seat: () => unknown } {
  let fallback: unknown
  const server = {
    host: '127.0.0.1',
    port: 0,
    registerFallback: (handler: unknown) => {
      fallback = handler
      return () => { fallback = undefined }
    },
    applyIndexTaps: (html: string) => html,
  } as unknown as WebServer
  return { server, seat: () => fallback }
}

describe('desktop-app runtime glue', () => {
  it('mounts dist serving and both prompt sections, and prints nothing', async () => {
    stageDist()
    const ctx = new Context()
    const { server, seat } = fakeCarrier()
    ctx.provide('webServer', server)
    apply(ctx, new Config({ surfaceContext: true }))
    await ctx.plugin(SystemPrompt, { persona: '' })
    // Settle the injected registrations.
    await new Promise(resolve => setTimeout(resolve, 0))

    expect(seat()).toBeDefined() // frontend-static claimed the fallback
    const assembly = await ctx.systemPrompt.assemble()
    expect(assembly.sections.find(entry => entry.name === 'harness:source')?.text)
      .toContain('DeepSeek Harness implementation checkout')
    const section = assembly.sections.find(entry => entry.name === 'app:desktop-surface')
    // The port-free acceptance boundary: no URL exists to hand another tool,
    // and a replacement web server would not update this window.
    expect(section?.text).toContain('listens on no port')
    expect(section?.text).toContain('do not start one unless the user asks')
    // Nothing here reads a bound authority, so no URL line and no LAN snapshot.
    expect(ctx.get('webRuntime')).toBeUndefined()
    await ctx.fiber.dispose()
  })

  it('skips the surface context when disabled (the one-shot layer): neither section registers', async () => {
    stageDist()
    const ctx = new Context()
    ctx.provide('webServer', fakeCarrier().server)
    apply(ctx, new Config({ surfaceContext: false }))
    await ctx.plugin(SystemPrompt, { persona: '' })
    await new Promise(resolve => setTimeout(resolve, 0))
    const assembly = await ctx.systemPrompt.assemble()
    expect(assembly.sections.some(entry => entry.name === 'app:desktop-surface')).toBe(false)
    expect(assembly.sections.some(entry => entry.name === 'harness:source')).toBe(false)
    await ctx.fiber.dispose()
  })

  it('drops the dist serving and the sections on disposal', async () => {
    stageDist()
    const ctx = new Context()
    const { server, seat } = fakeCarrier()
    ctx.provide('webServer', server)
    const fiber = ctx.plugin({ inject: ['webServer'], apply }, new Config({ surfaceContext: true }))
    await ctx.plugin(SystemPrompt, { persona: '' })
    await fiber
    expect(seat()).toBeDefined()
    await fiber.dispose()
    expect(seat()).toBeUndefined()
    const assembly = await ctx.systemPrompt.assemble()
    expect(assembly.sections.some(entry => entry.name === 'app:desktop-surface')).toBe(false)
    await ctx.fiber.dispose()
  })

  it('resolves the real built frontend dist through the package exports, failing loud unbuilt', () => {
    // The production resolver (not the test hook). A built checkout resolves
    // the frontend package's index.html; a dist-less one (the CI coverage
    // lane runs before any build) must fail with the build hint, never a
    // silent fallback.
    try {
      expect(originalResolve()).toMatch(/dist[/\\]index\.html$/)
    } catch (error) {
      expect((error as Error).message).toContain('frontend dist not built')
    }
  })
})
