import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test'
import * as Comlink from 'comlink'
import { pluginFrameInfo, publicScreenApi, type ScreenApiTransport } from '../src/screen'
import type { ScreenApi, ThemeName } from '../src/types'

function portEndpoint(port: MessagePort): Comlink.Endpoint {
  const relays = new Map<EventListenerOrEventListenerObject, (event: MessageEvent) => void>()
  return {
    postMessage: (message, transfer) => port.postMessage(message, transfer as MessagePort[]),
    addEventListener: (_type, listener) => {
      const relay = (event: MessageEvent) => {
        if (typeof listener === 'function') listener(event)
        else listener.handleEvent(event)
      }
      relays.set(listener, relay)
      port.addEventListener('message', relay)
      port.start()
    },
    removeEventListener: (_type, listener) => {
      const relay = relays.get(listener)
      if (relay) port.removeEventListener('message', relay)
    },
  }
}

const stockProxyHandler = Comlink.transferHandlers.get('proxy')!

function startProxiedCallbackPorts(): void {
  Comlink.transferHandlers.set('proxy', {
    ...stockProxyHandler,
    serialize: (obj) => {
      const { port1, port2 } = new MessageChannel()
      Comlink.expose(obj, portEndpoint(port1))
      return [port2, [port2]]
    },
  })
}

const { port1, port2 } = new MessageChannel()
let hostOnTheme: ((theme: ThemeName) => void) | undefined
const hostToasts: Array<{ text: string; kind?: string }> = []
let mc: ScreenApi

beforeAll(() => {
  startProxiedCallbackPorts()
  Comlink.expose(
    {
      call: async (method: string, params?: unknown) => ({ method, params }),
      theme: async (): Promise<ThemeName> => 'light',
      onTheme: async (cb: (theme: ThemeName) => void) => {
        hostOnTheme = cb
      },
      ui: {
        toast: async (text: string, kind?: string) => {
          hostToasts.push({ text, kind })
        },
      },
    },
    portEndpoint(port1),
  )
  const remote = Comlink.wrap<ScreenApiTransport>(portEndpoint(port2)) as unknown as ScreenApiTransport
  mc = publicScreenApi(remote)
})

afterAll(() => {
  Comlink.transferHandlers.set('proxy', stockProxyHandler)
  port1.close()
  port2.close()
})

describe('publicScreenApi', () => {
  test('theme() round-trips to the host', async () => {
    await expect(mc.theme()).resolves.toBe('light')
  })

  test('call() round-trips to the host', async () => {
    await expect(mc.call('board.load', { boardId: 'bcd1' })).resolves.toEqual({
      method: 'board.load',
      params: { boardId: 'bcd1' },
    })
  })

  test('nested members such as ui.toast reach the host', async () => {
    await mc.ui.toast('Board loaded', 'info')
    expect(hostToasts).toEqual([{ text: 'Board loaded', kind: 'info' }])
  })

  test('onTheme accepts a plain callback the host can invoke', async () => {
    let pluginSaw: (theme: ThemeName) => void
    const seenTheme = new Promise<ThemeName>((resolve) => {
      pluginSaw = resolve
    })
    await mc.onTheme((theme) => pluginSaw(theme))
    hostOnTheme?.('dark')
    await expect(seenTheme).resolves.toBe('dark')
  })
})

describe('pluginFrameInfo', () => {
  const frameWindow = globalThis as unknown as { window?: Partial<Window> }

  afterEach(() => {
    delete frameWindow.window
  })

  test('is undefined outside a browser', () => {
    expect(pluginFrameInfo()).toBeUndefined()
  })

  test('reads window.__SKD_PLUGIN__', () => {
    frameWindow.window = { __SKD_PLUGIN__: { id: 'clickup-board', runtime: 'isolated' } }
    expect(pluginFrameInfo()).toEqual({ id: 'clickup-board', runtime: 'isolated' })
  })

  test('falls back to the legacy window.__MC_PLUGIN__', () => {
    frameWindow.window = { __MC_PLUGIN__: { id: 'clickup-board', runtime: 'isolated' } }
    expect(pluginFrameInfo()).toEqual({ id: 'clickup-board', runtime: 'isolated' })
  })

  test('prefers __SKD_PLUGIN__ when a host sets both', () => {
    frameWindow.window = {
      __SKD_PLUGIN__: { id: 'new', runtime: 'isolated' },
      __MC_PLUGIN__: { id: 'old', runtime: 'trusted' },
    }
    expect(pluginFrameInfo()?.id).toBe('new')
  })
})
