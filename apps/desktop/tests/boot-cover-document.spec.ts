import { describe, expect, it } from 'vitest'
import { bootCoverIsDark, bootCoverDocument, resolveBootPalette } from '../src/boot-cover-document.ts'

describe('bootCoverIsDark', () => {
  it.each([
    ['dark', false, true], ['dark', true, true],
    ['light', true, false], ['light', false, false],
    ['system', true, true], ['system', false, false],
  ] as const)('source %s with system dark %s resolves to %s', (source, systemDark, expected) => {
    expect(bootCoverIsDark(source, systemDark)).toBe(expected)
  })
})

describe('resolveBootPalette', () => {
  it('keeps the ground gradient starting at the flat launch colour', () => {
    for (const dark of [true, false]) {
      const palette = resolveBootPalette(dark)
      expect(palette.dark).toBe(dark)
      expect(palette.ground.startsWith(`linear-gradient(155deg, ${palette.background} 0%,`)).toBe(true)
    }
  })
})

describe('bootCoverDocument', () => {
  it('draws the aurora field, wordmark, and caption as one document', () => {
    const html = bootCoverDocument(resolveBootPalette(false), 'Starting…')
    expect(html.startsWith('<!doctype html>')).toBe(true)
    expect(html).toContain('<div class="dsh-boot-field"><div class="dsh-boot-blob dsh-boot-orbit-1"></div>')
    expect(html).toContain('<div class="dsh-boot-wordmark">HARNESS</div>')
    expect(html).toContain('id="dsh-boot-caption"')
    expect(html).toContain('Starting…</div>')
    expect(html).toContain('globalThis.__dshBootCover={say(')
  })

  it('animates only compositor-driven properties so the cover survives a busy page', () => {
    const html = bootCoverDocument(resolveBootPalette(false), '')
    expect(html).toContain('@keyframes dsh-boot-rise{from{opacity:0;transform:scale(.78)}to{opacity:1;transform:scale(1)}}')
    expect(html).toContain('@keyframes dsh-boot-halo{from{opacity:.9;transform:translate(-50%,-50%) scale(.55)}' +
      'to{opacity:0;transform:translate(-50%,-50%) scale(1.9)}}')
    const frames = [...html.matchAll(/@keyframes [^{]+\{([^}]*)\}/g)].map(match => match[1]!)
    expect(frames.length).toBe(5)
    for (const block of frames) {
      for (const property of block.match(/(?:^|[;{])([a-z-]+):/g) ?? []) {
        expect(['transform:', 'opacity:']).toContain(property.replace(/[;{]/g, ''))
      }
    }
  })

  it('stills the motion when the desktop asks for reduced motion', () => {
    const html = bootCoverDocument(resolveBootPalette(false), '')
    expect(html).toContain('@media (prefers-reduced-motion:reduce){.dsh-boot-wordmark{animation:none}' +
      '.dsh-boot-wordmark::after{animation:none;opacity:0}.dsh-boot-blob{animation:none}')
  })

  it('paints the dark aurora onto the dark ground', () => {
    const html = bootCoverDocument(resolveBootPalette(true), '')
    expect(html).toContain('background:linear-gradient(155deg, #12081f 0%,')
    expect(html).toContain('color:#f6f4ff')
    expect(html).toContain('radial-gradient(circle,rgba(93,52,208,.85) 0%')
    expect(html).toContain('text-shadow:0 0 20px rgba(0,240,255,.75)')
  })

  it('restrains the light aurora so ink stays readable', () => {
    const html = bootCoverDocument(resolveBootPalette(false), '')
    expect(html).toContain('radial-gradient(circle,rgba(93,52,208,.28) 0%')
    expect(html).not.toContain('rgba(93,52,208,.85)')
  })

  it('escapes caption markup so only text reaches the document', () => {
    const html = bootCoverDocument(resolveBootPalette(false), '<img onerror="x">')
    expect(html).toContain('&lt;img onerror=&quot;x&quot;&gt;')
    expect(html).not.toContain('<img')
  })

  it('keeps the caption box from the first frame', () => {
    const html = bootCoverDocument(resolveBootPalette(false), '')
    expect(html).toMatch(/\.dsh-boot-caption\{[^}]*height:20px/)
    expect(html).not.toMatch(/\.dsh-boot-caption\{[^}]*display:none/)
  })
})
