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
  /** Text and halo ink. */
  readonly ink: string
  /** The ground gradient; its first stop is `background` so the window fill continues into the document without a step. */
  readonly ground: string
  /** The three aurora blobs, alpha included, orbiting behind the wordmark. */
  readonly aurora: { readonly violet: string; readonly magenta: string; readonly cyan: string }
  /** The wordmark's static glow; a restrained tint on light grounds. */
  readonly glow: string
  readonly dark: boolean
}

/** The documentElement dataset key the page's preload raises when its theme background holds. */
export const SETTLED_FLAG = 'dshBootSettled'

const PALETTE_LIGHT: BootPalette = {
  background: '#ffffff',
  ink: '#0f1115',
  ground: 'linear-gradient(155deg, #ffffff 0%, #eef2fb 60%, #e7edf8 100%)',
  aurora: { violet: 'rgba(93,52,208,.28)', magenta: 'rgba(255,0,110,.18)', cyan: 'rgba(0,190,255,.24)' },
  glow: '0 0 18px rgba(93,52,208,.30)',
  dark: false,
}

const PALETTE_DARK: BootPalette = {
  background: '#12081f',
  ink: '#f6f4ff',
  ground: 'linear-gradient(155deg, #12081f 0%, #170b2b 60%, #101a2e 100%)',
  aurora: { violet: 'rgba(93,52,208,.85)', magenta: 'rgba(255,0,110,.6)', cyan: 'rgba(0,240,255,.5)' },
  glow: '0 0 20px rgba(0,240,255,.75)',
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
 * Resolve the cover polarity for this launch from the application's own theme
 * choice, which only reaches the shell after the page mounts.
 * @param source - the theme source cached by the previous run
 *                 (see [theme-source-cache](./theme-source-cache.ts)); the page's
 *                 bootstrap re-applies the durable preference at every launch.
 * @param systemDark - `nativeTheme.shouldUseDarkColors` under the default
 *                     `system` source.
 * @returns whether the cover draws with the dark palette.
 */
export function bootCoverIsDark(source: 'light' | 'dark' | 'system', systemDark: boolean): boolean {
  return source === 'dark' ? true : source === 'light' ? false : systemDark
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
 * wordmark or halo.
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
 * @param caption - the localized starting line under the wordmark.
 * @returns a complete HTML document.
 */
export function bootCoverDocument(palette: BootPalette, caption: string): string {
  return '<!doctype html><html><head><meta charset="utf-8"><style>' +
    `html,body{margin:0;height:100%;overflow:hidden;background:${palette.ground}}` +
    'body{display:flex;flex-direction:column;align-items:center;justify-content:center;' +
      'font-family:system-ui,-apple-system,"Segoe UI",sans-serif}' +
    // Three radial-gradient blobs orbit the centre on different periods; their
    // overlap and phase drift read as a living mesh gradient without any image.
    '.dsh-boot-field{position:fixed;inset:0;overflow:hidden}' +
    '.dsh-boot-blob{position:absolute;top:50%;left:50%;width:78vmin;height:78vmin;' +
      'margin:-39vmin 0 0 -39vmin;border-radius:50%}' +
    `.dsh-boot-orbit-1{background:radial-gradient(circle,${palette.aurora.violet} 0%,transparent 62%);` +
      'animation:dsh-boot-orbit-a 6.4s ease-in-out infinite alternate}' +
    `.dsh-boot-orbit-2{background:radial-gradient(circle,${palette.aurora.magenta} 0%,transparent 58%);` +
      'animation:dsh-boot-orbit-b 7.6s ease-in-out infinite alternate}' +
    `.dsh-boot-orbit-3{background:radial-gradient(circle,${palette.aurora.cyan} 0%,transparent 54%);` +
      'animation:dsh-boot-orbit-c 5.8s ease-in-out infinite alternate}' +
    '.dsh-boot-wordmark{position:relative;font-size:42px;line-height:52px;font-weight:700;' +
      `letter-spacing:.1em;color:${palette.ink};text-shadow:${palette.glow};` +
      'animation:dsh-boot-rise 1s cubic-bezier(.22,1.2,.32,1) both}' +
    // A halo ring pulses out from the wordmark for the cover's whole life: the
    // activity signal, without claiming any progress.
    '.dsh-boot-wordmark::after{content:"";position:absolute;top:50%;left:50%;' +
      `width:118px;height:118px;border-radius:50%;border:2px solid ${palette.ink}59;` +
      'animation:dsh-boot-halo 1.6s cubic-bezier(.2,.8,.3,1) infinite}' +
    '.dsh-boot-caption{margin-top:18px;height:20px;font-size:13px;line-height:20px;' +
      `color:${palette.ink};opacity:.55;white-space:nowrap}` +
    // Transform and opacity only: the compositor keeps animating while the
    // covered application page saturates its own main thread.
    '@keyframes dsh-boot-rise{from{opacity:0;transform:scale(.78)}to{opacity:1;transform:scale(1)}}' +
    '@keyframes dsh-boot-halo{from{opacity:.9;transform:translate(-50%,-50%) scale(.55)}' +
      'to{opacity:0;transform:translate(-50%,-50%) scale(1.9)}}' +
    '@keyframes dsh-boot-orbit-a{from{transform:translate3d(-26vmin,14vmin,0) scale(.6)}' +
      'to{transform:translate3d(12vmin,-12vmin,0) scale(1.05)}}' +
    '@keyframes dsh-boot-orbit-b{from{transform:translate3d(24vmin,-18vmin,0) scale(1)}' +
      'to{transform:translate3d(-16vmin,14vmin,0) scale(.62)}}' +
    '@keyframes dsh-boot-orbit-c{from{transform:translate3d(6vmin,22vmin,0) scale(.72)}' +
      'to{transform:translate3d(-10vmin,-16vmin,0) scale(1.1)}}' +
    '@media (prefers-reduced-motion:reduce){.dsh-boot-wordmark{animation:none}' +
      '.dsh-boot-wordmark::after{animation:none;opacity:0}.dsh-boot-blob{animation:none}' +
      '.dsh-boot-orbit-1{transform:translate3d(-20vmin,10vmin,0) scale(.8)}' +
      '.dsh-boot-orbit-2{transform:translate3d(18vmin,-14vmin,0)}' +
      '.dsh-boot-orbit-3{transform:translate3d(4vmin,16vmin,0) scale(.9)}}' +
    '</style></head><body>' +
    '<div class="dsh-boot-field"><div class="dsh-boot-blob dsh-boot-orbit-1"></div>' +
      '<div class="dsh-boot-blob dsh-boot-orbit-2"></div>' +
      '<div class="dsh-boot-blob dsh-boot-orbit-3"></div></div>' +
    '<div class="dsh-boot-wordmark">HARNESS</div>' +
    `<div class="dsh-boot-caption" id="${CAPTION_ID}">${escapeText(caption)}</div>` +
    `<script>${COVER_SCRIPT}</script>` +
    '</body></html>'
}
