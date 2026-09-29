import { describe, expect, it } from 'vitest'
import { bootCoverDocument, resolveBootPalette } from '../src/boot-cover-document.ts'

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
  it('draws the wordmark, a fixed-sweep spinner, and the caption as one document', () => {
    const html = bootCoverDocument(resolveBootPalette(false), 'Starting…')
    expect(html.startsWith('<!doctype html>')).toBe(true)
    expect(html).toContain('<div class="dsh-boot-wordmark">HARNESS</div>')
    expect(html).toContain('<div class="dsh-boot-spinner"></div>')
    expect(html).toContain('id="dsh-boot-caption"')
    expect(html).toContain('Starting…</div>')
    expect(html).toContain('globalThis.__dshBootCover={say(')
  })

  it('animates only compositor-driven properties so the cover survives a busy page', () => {
    const html = bootCoverDocument(resolveBootPalette(false), '')
    expect(html).toContain('@keyframes dsh-boot-spin{to{transform:rotate(360deg)}}')
    expect(html).toContain('@keyframes dsh-boot-rise{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}')
    const frames = [...html.matchAll(/@keyframes [^{]+\{([^}]*)\}/g)].map(match => match[1]!)
    for (const block of frames) {
      for (const property of block.match(/(?:^|[;{])([a-z-]+):/g) ?? []) {
        expect(['transform:', 'opacity:']).toContain(property.replace(/[;{]/g, ''))
      }
    }
  })

  it('stills the motion when the desktop asks for reduced motion', () => {
    const html = bootCoverDocument(resolveBootPalette(false), '')
    expect(html).toContain('@media (prefers-reduced-motion:reduce){.dsh-boot-wordmark{animation:none}' +
      '.dsh-boot-spinner{animation:none}}')
  })

  it('paints the dark palette ink onto the dark ground', () => {
    const html = bootCoverDocument(resolveBootPalette(true), '')
    expect(html).toContain('background:linear-gradient(155deg, #151517 0%,')
    expect(html).toContain('color:#f9fafb')
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
