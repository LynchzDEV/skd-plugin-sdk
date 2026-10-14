import * as Comlink from 'comlink'
import type { ScreenApi, SessionRequest, SettingsView, ThemeName, ToastKind } from './types'

export type ScreenMount = (root: HTMLElement, mc: ScreenApi) => void | Promise<void>

export type ScreenDefinition = { mount: ScreenMount }

export type ScreenApiTransport = {
  call(method: string, params?: unknown): Promise<unknown>
  sessions: {
    startChat(req: SessionRequest): Promise<void>
    startTerminal(req: SessionRequest): Promise<void>
  }
  settings: {
    view(): Promise<SettingsView>
    set(key: string, value: string | null): Promise<void>
  }
  folders: { recent(): Promise<string[]> }
  ui: { toast(text: string, kind?: ToastKind): Promise<void> }
  theme(): Promise<ThemeName>
  onTheme(cb: (theme: ThemeName) => void): Promise<void>
}

export type PluginFrameInfo = { id: string; runtime: 'trusted' | 'isolated' }

declare global {
  interface Window {
    __SKD_PLUGIN__?: PluginFrameInfo
    __MC_PLUGIN__?: PluginFrameInfo
  }
}

// ponytail: legacy window.__MC_PLUGIN__ read, drop once every host ships __SKD_PLUGIN__
export function pluginFrameInfo(): PluginFrameInfo | undefined {
  if (typeof window === 'undefined') return undefined
  return window.__SKD_PLUGIN__ ?? window.__MC_PLUGIN__
}

export function defineScreen(mount: ScreenMount): ScreenDefinition {
  if (pluginFrameInfo()?.runtime === 'isolated') {
    void mountIsolated(mount)
  }
  return { mount }
}

export function publicScreenApi(remote: ScreenApiTransport): ScreenApi {
  return {
    call: (method, params) => remote.call(method, params),
    sessions: {
      startChat: (req) => remote.sessions.startChat(req),
      startTerminal: (req) => remote.sessions.startTerminal(req),
    },
    settings: {
      view: () => remote.settings.view(),
      set: (key, value) => remote.settings.set(key, value),
    },
    folders: { recent: () => remote.folders.recent() },
    ui: { toast: (text, kind) => remote.ui.toast(text, kind) },
    theme: () => remote.theme(),
    onTheme: (cb) => remote.onTheme(Comlink.proxy(cb)),
  }
}

async function mountIsolated(mount: ScreenMount): Promise<void> {
  const endpoint = Comlink.windowEndpoint(window.parent, window, '*')
  // Comlink's Remote types promise-wrap nested namespaces, but path proxies resolve them synchronously.
  const remote = Comlink.wrap<ScreenApiTransport>(endpoint) as unknown as ScreenApiTransport
  const mc = publicScreenApi(remote)
  applyTheme(await mc.theme())
  await mc.onTheme(applyTheme)
  const root = document.getElementById('root')
  if (root) await mount(root, mc)
}

function applyTheme(theme: ThemeName): void {
  document.documentElement.dataset.theme = theme
}
