/**
 * The Linux boot cover's document: its colors, markup, styles, and caption
 * script, assembled without Electron so specs and gates can read what the cover
 * draws. The cover's lifetime lives in [boot-cover](./boot-cover.ts).
 * @module
 */

/** One polarity of the cover's palette; `background` is also the window fill. */
export interface BootPalette {
  /** The flat launch colour, painted by the window before any renderer frame. */
  readonly background: string
  /** Text and spinner ink. */
  readonly ink: string
  /** The ground gradient; its first stop is `background` so the window fill continues into the document without a step. */
  readonly ground: string
  readonly dark: boolean
}

/** The documentElement dataset key the page's preload raises when its theme background holds. */
export const SETTLED_FLAG = 'dshBootSettled'

const PALETTE_LIGHT: BootPalette = {
  background: '#ffffff',
  ink: '#0f1115',
  ground: 'linear-gradient(155deg, #ffffff 0%, #eef2fb 60%, #e7edf8 100%)',
  dark: false,
}

const PALETTE_DARK: BootPalette = {
  background: '#151517',
  ink: '#f9fafb',
  ground: 'linear-gradient(155deg, #151517 0%, #1b2330 60%, #1e2836 100%)',
  dark: true,
}

/**
 * Take the cover palette for the operating system's current polarity.
 * @param dark - `nativeTheme.shouldUseDarkColors` at window creation.
 * @returns the palette for the cover document and the window background.
 */
export function resolveBootPalette(dark: boolean): BootPalette {
  return dark ? PALETTE_DARK : PALETTE_LIGHT
}

/**
 * HTML-escape caption text for use in a text node or attribute.
 * @param text - shell-owned caption copy.
 * @returns the text as safe markup.
 */
function escapeText(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/** Element id the caption script writes into; stable across the cover's life. */
const CAPTION_ID = 'dsh-boot-caption'

/**
 * The cover's own script: one setter for the caption line. The animation is
 * pure CSS, so this runs only when main writes a caption.
 *
 * The caption hides with `visibility`, never `display`: the column keeps its
 * box from the first frame, so a caption arriving or leaving never shifts the
 * wordmark or spinner.
 */
const COVER_SCRIPT =
  `globalThis.__dshBootCover={say(t){const e=document.getElementById(${JSON.stringify(CAPTION_ID)});` +
  'e.textContent=t;e.style.visibility=t?"visible":"hidden"}};'

/**
 * Assemble the complete cover document.
 *
 * Delivered as a `data:` URL: it loads with no filesystem or network round
 * trip, which is what lets the cover paint before the application page exists,
 * and it keeps the animation out of the packaged file list.
 * @param palette - the colours this launch draws with.
 * @param caption - the localized starting line under the spinner.
 * @returns a complete HTML document.
 */
export function bootCoverDocument(palette: BootPalette, caption: string): string {
  return '<!doctype html><html><head><meta charset="utf-8"><style>' +
    `html,body{margin:0;height:100%;overflow:hidden;background:${palette.ground}}` +
    'body{display:flex;flex-direction:column;align-items:center;justify-content:center;' +
      'font-family:system-ui,-apple-system,"Segoe UI",sans-serif}' +
    '.dsh-boot-wordmark{font-size:22px;line-height:30px;font-weight:600;letter-spacing:.14em;' +
      `color:${palette.ink};animation:dsh-boot-rise .9s ease-out both}` +
    // The same ring construction as the application's in-page boot spinner
    // (packages/client/web/src/boot-page.module.css): a conic arc masked into a
    // 2px ring. Its sweep is fixed because the cover reports no progress.
    '.dsh-boot-spinner{position:relative;width:22px;height:22px;margin-top:22px;border-radius:50%;' +
      `border:2px solid ${palette.ink}1a;animation:dsh-boot-spin .8s linear infinite}` +
    '.dsh-boot-spinner::after{content:"";position:absolute;inset:-2px;border-radius:inherit;' +
      `background:conic-gradient(${palette.ink} 110deg,transparent 0);` +
      'mask:radial-gradient(farthest-side,transparent calc(100% - 2px),#000 0);' +
      '-webkit-mask:radial-gradient(farthest-side,transparent calc(100% - 2px),#000 0)}' +
    '.dsh-boot-caption{margin-top:18px;height:20px;font-size:13px;line-height:20px;' +
      `color:${palette.ink};opacity:.55;white-space:nowrap}` +
    // Transform and opacity only: the compositor keeps animating while the
    // covered application page saturates its own main thread.
    '@keyframes dsh-boot-spin{to{transform:rotate(360deg)}}' +
    '@keyframes dsh-boot-rise{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}' +
    '@media (prefers-reduced-motion:reduce){.dsh-boot-wordmark{animation:none}' +
      '.dsh-boot-spinner{animation:none}}' +
    '</style></head><body>' +
    '<div class="dsh-boot-wordmark">HARNESS</div>' +
    '<div class="dsh-boot-spinner"></div>' +
    `<div class="dsh-boot-caption" id="${CAPTION_ID}">${escapeText(caption)}</div>` +
    `<script>${COVER_SCRIPT}</script>` +
    '</body></html>'
}
