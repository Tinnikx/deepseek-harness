import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BOOT_COVER_MIN_VISIBLE_MS, raiseBootCover, waitUntilPageSettled } from '../src/boot-cover.ts'
import { resolveBootPalette } from '../src/boot-cover-document.ts'

interface Rect { x: number; y: number; width: number; height: number }

const electron = await vi.hoisted(async () => {
  const { EventEmitter } = await import('node:events')
  const views: unknown[] = []
  class FakeWebContents extends EventEmitter {
    readonly urls: string[] = []
    destroyed = false
    readonly loadURL = vi.fn(async (url: string) => { this.urls.push(url) })
    readonly isDestroyed = () => this.destroyed
    readonly close = vi.fn(() => { this.destroyed = true })
    readonly setBackgroundColor = vi.fn()
    readonly executeJavaScript = vi.fn(async (): Promise<unknown> => undefined)
  }
  class FakeWebContentsView {
    readonly webContents = new FakeWebContents()
    bounds: Rect | undefined
    readonly setBounds = vi.fn((bounds: Rect) => { this.bounds = bounds })
    readonly setBackgroundColor = vi.fn()
    constructor(readonly options: unknown) { views.push(this) }
  }
  return { views, FakeWebContentsView }
})
vi.mock('electron', () => ({ WebContentsView: electron.FakeWebContentsView }))

class FakePageContents extends EventEmitter {
  destroyed = false
  readonly isDestroyed = () => this.destroyed
  executeJavaScript = vi.fn(async (): Promise<unknown> => false)
}

class FakeOwner extends EventEmitter {
  // A screen-placed window: the cover must not carry this origin into its
  // parent-relative bounds.
  bounds: Rect = { x: 320, y: 180, width: 900, height: 650 }
  destroyed = false
  readonly webContents = new FakePageContents()
  readonly addChildView = vi.fn()
  readonly removeChildView = vi.fn()
  readonly contentView = { addChildView: this.addChildView, removeChildView: this.removeChildView }
  readonly getContentBounds = vi.fn(() => this.bounds)
  readonly isDestroyed = () => this.destroyed
}

function cover() {
  const owner = new FakeOwner()
  const painted = vi.fn()
  const handle = raiseBootCover(owner, resolveBootPalette(true), 'Starting…', painted)
  const view = electron.views.at(-1) as InstanceType<typeof electron.FakeWebContentsView>
  return { owner, handle, view, painted }
}

beforeEach(() => { vi.useFakeTimers(); electron.views.length = 0 })
afterEach(() => { vi.useRealTimers() })

describe('raiseBootCover', () => {
  it('attaches an opaque cover sized to the content box and reports its first frame', () => {
    const { owner, view, painted } = cover()
    expect(view.setBackgroundColor).toHaveBeenCalledWith('#151517')
    expect(owner.addChildView).toHaveBeenCalledWith(view)
    expect(view.bounds).toEqual({ x: 0, y: 0, width: 900, height: 650 })
    expect(view.webContents.urls[0]!.startsWith('data:text/html;charset=utf-8,')).toBe(true)
    expect(painted).not.toHaveBeenCalled()
    view.webContents.emit('did-finish-load')
    expect(painted).toHaveBeenCalledOnce()
  })

  it('lifts once: removes the view and releases its renderer', () => {
    const { owner, handle, view } = cover()
    handle.lift()
    handle.lift()
    expect(owner.removeChildView).toHaveBeenCalledExactlyOnceWith(view)
    expect(view.webContents.close).toHaveBeenCalledOnce()
  })

  it('lifts when the window hides and stops tracking it', async () => {
    const { owner, view } = cover()
    owner.emit('hide')
    expect(owner.removeChildView).toHaveBeenCalledWith(view)
    owner.bounds = { x: 480, y: 260, width: 1200, height: 800 }
    owner.emit('resize')
    await vi.advanceTimersByTimeAsync(0)
    expect(view.bounds).toEqual({ x: 0, y: 0, width: 900, height: 650 })
  })

  it('releases the renderer without touching a destroyed window', () => {
    const { owner, handle, view } = cover()
    owner.destroyed = true
    handle.lift()
    expect(owner.removeChildView).not.toHaveBeenCalled()
    expect(view.webContents.close).toHaveBeenCalledOnce()
  })

  it.each(['render-process-gone', 'destroyed'])('lifts when the page %s', (event) => {
    const { owner, view } = cover()
    owner.webContents.emit(event)
    expect(owner.removeChildView).toHaveBeenCalledWith(view)
  })

  it('lifts on a fresh main-frame document after the covered load but not before', () => {
    const { owner, view } = cover()
    owner.webContents.emit('did-start-navigation', {}, 'dsh-app://app/', false, true)
    expect(owner.removeChildView).not.toHaveBeenCalled()
    owner.webContents.emit('did-finish-load')
    owner.webContents.emit('did-start-navigation', {}, 'dsh-app://app/', false, false)
    expect(owner.removeChildView).not.toHaveBeenCalled()
    owner.webContents.emit('did-start-navigation', {}, 'dsh-app://app/', true, true)
    expect(owner.removeChildView).not.toHaveBeenCalled()
    owner.webContents.emit('did-start-navigation', {}, 'dsh-app://app/', false, true)
    expect(owner.removeChildView).toHaveBeenCalledExactlyOnceWith(view)
  })

  it('refits the cover one tick after the window resizes, at the content origin', async () => {
    const { owner, view } = cover()
    owner.bounds = { x: 480, y: 260, width: 1200, height: 800 }
    owner.emit('resize')
    expect(view.bounds).toEqual({ x: 0, y: 0, width: 900, height: 650 })
    await vi.advanceTimersByTimeAsync(0)
    expect(view.bounds).toEqual({ x: 0, y: 0, width: 1200, height: 800 })
  })

  it('writes captions only after the cover document is up and never after lifting', async () => {
    const { handle, view } = cover()
    handle.say('Before')
    view.webContents.emit('did-finish-load')
    await vi.advanceTimersByTimeAsync(0)
    expect(view.webContents.executeJavaScript).toHaveBeenCalledWith(
      expect.stringContaining('globalThis.__dshBootCover.say("Before")'), true)
    handle.lift()
    view.webContents.executeJavaScript.mockClear()
    handle.say('After')
    await vi.advanceTimersByTimeAsync(0)
    expect(view.webContents.executeJavaScript).not.toHaveBeenCalled()
  })

  it('takes the earliest document event as the paint signal exactly once', () => {
    const { view, painted } = cover()
    view.webContents.emit('dom-ready')
    view.webContents.emit('did-stop-loading')
    view.webContents.emit('did-finish-load')
    expect(painted).toHaveBeenCalledOnce()
  })

  it('holds a painted cover for the minimum visible time before lifting', async () => {
    const { owner, handle, view } = cover()
    view.webContents.emit('did-finish-load')
    handle.liftAfterVisible(BOOT_COVER_MIN_VISIBLE_MS)
    await vi.advanceTimersByTimeAsync(BOOT_COVER_MIN_VISIBLE_MS - 1)
    expect(owner.removeChildView).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(owner.removeChildView).toHaveBeenCalledExactlyOnceWith(view)
  })

  it('lifts a long-visible cover immediately and holds a never-painted one for the full time', async () => {
    const painted = cover()
    painted.view.webContents.emit('did-finish-load')
    vi.advanceTimersByTime(2_000)
    painted.handle.liftAfterVisible(BOOT_COVER_MIN_VISIBLE_MS)
    expect(painted.owner.removeChildView).toHaveBeenCalledOnce()
    const blank = cover()
    blank.handle.liftAfterVisible(BOOT_COVER_MIN_VISIBLE_MS)
    expect(blank.owner.removeChildView).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(BOOT_COVER_MIN_VISIBLE_MS)
    expect(blank.owner.removeChildView).toHaveBeenCalledOnce()
    blank.handle.liftAfterVisible(BOOT_COVER_MIN_VISIBLE_MS)
    expect(blank.owner.removeChildView).toHaveBeenCalledOnce()
  })
})

describe('waitUntilPageSettled', () => {
  it('resolves when the page reports the settled flag', async () => {
    const owner = new FakeOwner()
    const read = vi.fn(async (): Promise<unknown> => false)
      .mockResolvedValueOnce(false).mockResolvedValueOnce(true)
    owner.webContents.executeJavaScript = read
    const done = vi.fn()
    void waitUntilPageSettled(owner.webContents, 10_000, 100).then(() => { done() })
    await vi.advanceTimersByTimeAsync(100)
    expect(done).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(100)
    expect(done).toHaveBeenCalledOnce()
    expect(read).toHaveBeenCalledWith(expect.stringContaining("document.documentElement.dataset.dshBootSettled === '1'"), true)
  })

  it('keeps asking across a rejected read and answers on the deadline anyway', async () => {
    const owner = new FakeOwner()
    const read = vi.fn(async (): Promise<unknown> => false)
      .mockRejectedValueOnce(new Error('mid-navigation'))
    owner.webContents.executeJavaScript = read
    const done = vi.fn()
    void waitUntilPageSettled(owner.webContents, 300, 100).then(() => { done() })
    await vi.advanceTimersByTimeAsync(100)
    expect(done).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(300)
    expect(done).toHaveBeenCalledOnce()
    expect(read).toHaveBeenCalledTimes(3)
  })

  it('answers immediately once the contents are destroyed', async () => {
    const owner = new FakeOwner()
    owner.webContents.destroyed = true
    const done = vi.fn()
    void waitUntilPageSettled(owner.webContents, 10_000, 100).then(() => { done() })
    await vi.advanceTimersByTimeAsync(100)
    expect(done).toHaveBeenCalledOnce()
    expect(owner.webContents.executeJavaScript).not.toHaveBeenCalled()
  })
})
