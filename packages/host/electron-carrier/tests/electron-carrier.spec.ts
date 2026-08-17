/**
 * REAL-composition coverage: a test-only cordis.yml booted through the
 * vendored Loader mounts the carrier row with a stand-in for Electron's
 * `protocol` module, and every assertion drives the handler Chromium would
 * call. What is asserted is the carrier's user-visible behavior — route
 * precedence, the synthesized authority the /api trust fence reads, streaming
 * bodies, client-disconnect propagation, and per-request error containment.
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import ElectronCarrier, { internals } from '../src/index.ts'
import type { ProtocolHost } from '../src/index.ts'

const SCHEME = 'dsh'

let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

interface Composition {
  ctx: Context
  /** Serve one request the way Chromium would. */
  fetch(path: string, init?: RequestInit): Promise<Response>
  /** Whether the scheme is currently claimed. */
  claimed(): boolean
}

/** Write a cordis.yml with one carrier row, then boot it through the real Loader. */
async function loadComposition(): Promise<Composition> {
  root = await mkdtemp(join(tmpdir(), 'dsh-electron-carrier-loader-'))
  const configPath = join(root, 'cordis.yml')
  await writeFile(configPath, [
    "- name: '@deepseek-ai/dsh-host-electron-carrier'",
    '  config:',
    `    scheme: '${SCHEME}'`,
    '',
  ].join('\n'))

  const handlers = new Map<string, (request: Request) => Promise<Response>>()
  const protocol: ProtocolHost = {
    handle: (scheme, handler) => { handlers.set(scheme, handler) },
    unhandle: (scheme) => { handlers.delete(scheme) },
  }
  const restore = internals.loadProtocol
  internals.loadProtocol = () => Promise.resolve(protocol)

  context = new Context()
  context.baseUrl = pathToFileURL(root).href + '/'
  await context.plugin(Loader)
  context.loader.builtins.include = Include
  const modules = new Map<string, unknown>([
    ['@deepseek-ai/dsh-host-electron-carrier', ElectronCarrier],
  ])
  context.loader.internal = {
    version: 'v2',
    async import(specifier: string) {
      if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
      return modules.get(specifier)
    },
  } as unknown as NonNullable<typeof context.loader.internal>
  await context.loader.create({
    name: 'cordis:include',
    config: { path: pathToFileURL(configPath).href },
  })
  await context.loader.await()
  internals.loadProtocol = restore

  const ctx = context
  return {
    ctx,
    fetch: (path, init) => {
      const handler = handlers.get(SCHEME)
      if (handler === undefined) throw new Error('scheme is not claimed')
      return handler(new Request(`${SCHEME}://127.0.0.1${path}`, init))
    },
    claimed: () => handlers.has(SCHEME),
  }
}

/** Read an SSE-style body chunk by chunk, stopping after `count` chunks arrive. */
async function readChunks(response: Response, count: number): Promise<string[]> {
  const reader = (response.body as ReadableStream<Uint8Array>).getReader()
  const decoder = new TextDecoder()
  const out: string[] = []
  while (out.length < count) {
    const { done, value } = await reader.read()
    if (done) break
    out.push(decoder.decode(value))
  }
  await reader.cancel()
  return out
}

describe('electron carrier', () => {
  it('binds no port and reports loopback', async () => {
    const app = await loadComposition()
    expect(app.ctx.webServer.port).toBe(0)
    expect(app.ctx.webServer.host).toBe('127.0.0.1')
  })

  it('answers 404 while no route claims the path', async () => {
    const app = await loadComposition()
    expect((await app.fetch('/nothing')).status).toBe(404)
  })

  it('prefers an exact route, then the longest matching prefix, then the fallback', async () => {
    const app = await loadComposition()
    const reply = (body: string) => async (_req: unknown, res: import('node:http').ServerResponse) => {
      res.writeHead(200)
      res.end(body)
    }
    app.ctx.webServer.register({ kind: 'exact', path: '/api/exact', handler: reply('exact') })
    app.ctx.webServer.register({ kind: 'prefix', path: '/api', handler: reply('short') })
    app.ctx.webServer.register({ kind: 'prefix', path: '/api/deep', handler: reply('long') })
    app.ctx.webServer.registerFallback(reply('fallback'))

    expect(await (await app.fetch('/api/exact')).text()).toBe('exact')
    expect(await (await app.fetch('/api/deep/x')).text()).toBe('long')
    expect(await (await app.fetch('/api/other')).text()).toBe('short')
    expect(await (await app.fetch('/elsewhere')).text()).toBe('fallback')
  })

  it('presents method, path, and a Host header synthesized from the authority', async () => {
    const app = await loadComposition()
    let seen: Record<string, string | undefined> = {}
    app.ctx.webServer.register({
      kind: 'prefix',
      path: '/api',
      handler: (req, res) => {
        seen = { method: req.method, url: req.url, host: req.headers.host }
        res.writeHead(204)
        res.end()
      },
    })
    await app.fetch('/api/rpc?x=1', { method: 'POST', body: 'ignored' })
    // Chromium sends no Host header for a custom protocol; the /api trust
    // fence refuses a request without one, so the carrier supplies it.
    expect(seen).toEqual({ method: 'POST', url: '/api/rpc?x=1', host: '127.0.0.1' })
  })

  it('delivers the request body to the handler', async () => {
    const app = await loadComposition()
    app.ctx.webServer.register({
      kind: 'exact',
      path: '/echo',
      handler: async (req, res) => {
        const chunks: Buffer[] = []
        for await (const chunk of req) chunks.push(chunk as Buffer)
        res.writeHead(200)
        res.end(Buffer.concat(chunks))
      },
    })
    const response = await app.fetch('/echo', { method: 'POST', body: 'payload' })
    expect(await response.text()).toBe('payload')
  })

  it('streams a response the handler holds open', async () => {
    const app = await loadComposition()
    let push: ((line: string) => void) | undefined
    app.ctx.webServer.register({
      kind: 'exact',
      path: '/events',
      handler: (_req, res) => {
        res.writeHead(200, { 'content-type': 'text/event-stream' })
        res.write(': connected\n\n')
        push = (line) => { res.write(line) }
        // Never ends: this is the shape client-hmr and the SSE downlink use.
      },
    })
    // Dispatch completes on the headers, not on handler completion.
    const response = await app.fetch('/events')
    expect(response.headers.get('content-type')).toBe('text/event-stream')

    const reader = (response.body as ReadableStream<Uint8Array>).getReader()
    const decoder = new TextDecoder()
    expect(decoder.decode((await reader.read()).value)).toBe(': connected\n\n')
    push?.('data: 1\n\n')
    expect(decoder.decode((await reader.read()).value)).toBe('data: 1\n\n')
    await reader.cancel()
  })

  it('reports client disconnect as a close event with the response unfinished', async () => {
    const app = await loadComposition()
    let closedWithoutEnd: boolean | undefined
    app.ctx.webServer.register({
      kind: 'exact',
      path: '/events',
      handler: (_req, res) => {
        res.writeHead(200)
        res.write('open\n')
        // Chromium signals a gone client by cancelling the response stream,
        // not by aborting the request signal. Consumers watch for 'close'
        // with writableEnded still false, which is what releases an SSE
        // subscription; without it a closed tab would leak the stream.
        res.on('close', () => { closedWithoutEnd = !res.writableEnded })
      },
    })
    const response = await app.fetch('/events')
    await readChunks(response, 1)
    await vi.waitFor(() => { expect(closedWithoutEnd).toBe(true) })
  })

  it('contains a handler failure as a 500 without rejecting', async () => {
    const app = await loadComposition()
    app.ctx.webServer.register({
      kind: 'exact',
      path: '/boom',
      handler: () => { throw new Error('handler defect') },
    })
    expect((await app.fetch('/boom')).status).toBe(500)
  })

  it('serves a handler that responds after returning void', async () => {
    const app = await loadComposition()
    // The node:http shape a static-asset route uses: the handler returns as
    // soon as the read is scheduled and writes from its callback. Nothing in
    // its return value marks the response as pending.
    app.ctx.webServer.register({
      kind: 'exact',
      path: '/late',
      handler: (_req, res) => {
        setTimeout(() => {
          res.writeHead(200, { 'content-type': 'image/webp' })
          res.end(Buffer.from([0x52, 0x49, 0x46, 0x46]))
        }, 5)
      },
    })
    const response = await app.fetch('/late')
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('image/webp')
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([0x52, 0x49, 0x46, 0x46]))
  })

  it('refuses duplicate registrations and a second fallback', async () => {
    const app = await loadComposition()
    const noop = (): void => {}
    app.ctx.webServer.register({ kind: 'exact', path: '/dup', handler: noop })
    expect(() => app.ctx.webServer.register({ kind: 'exact', path: '/dup', handler: noop }))
      .toThrow(/duplicate exact route/)
    app.ctx.webServer.registerFallback(noop)
    expect(() => app.ctx.webServer.registerFallback(noop)).toThrow(/fallback already registered/)
  })

  it('applies index taps in registration order', async () => {
    const app = await loadComposition()
    app.ctx.webServer.tapIndex(html => `${html}|one`)
    const dispose = app.ctx.webServer.tapIndex(html => `${html}|two`)
    expect(app.ctx.webServer.applyIndexTaps('base')).toBe('base|one|two')
    dispose()
    expect(app.ctx.webServer.applyIndexTaps('base')).toBe('base|one')
  })

  it('releases routes and the scheme claim on disposal', async () => {
    const app = await loadComposition()
    const fiber = await app.ctx.plugin({
      name: 'route-owner',
      inject: ['webServer'],
      apply: (ctx: Context) => {
        ctx.effect(() => ctx.webServer.register({
          kind: 'exact',
          path: '/owned',
          handler: (_req, res) => { res.writeHead(200); res.end('owned') },
        }))
      },
    })
    expect(await (await app.fetch('/owned')).text()).toBe('owned')
    await fiber.dispose()
    expect((await app.fetch('/owned')).status).toBe(404)

    expect(app.claimed()).toBe(true)
    await app.ctx.fiber.dispose()
    expect(app.claimed()).toBe(false)
  })
})
