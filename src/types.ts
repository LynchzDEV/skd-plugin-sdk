export type SettingField = { key: string; label: string; type: 'text' | 'secret'; help?: string }

export type PluginRuntime = 'trusted' | 'isolated'

export type PluginContributions = { agents?: string[]; skills?: string[]; flows?: string[] }

export type PluginManifest = {
  id: string
  name: string
  version: string
  description: string
  pluginApi: number
  runtime: PluginRuntime
  icon?: string
  server?: string
  screen?: string
  queueSource?: boolean
  permissions: { network?: string[]; sessions?: Array<'chat' | 'terminal'>; settings?: boolean }
  settings?: SettingField[]
  contributes?: PluginContributions
}

export type TaskContext = { name: string; markdown: string }

export type SessionRequest = { title: string; cwd: string; context?: TaskContext; prompt?: string }

export type ThemeName = 'light' | 'dark'

export type ToastKind = 'info' | 'error'

export type SettingsView = { values: Record<string, string>; configured: Record<string, boolean> }

export interface ScreenApi {
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

export interface ServerContext {
  settings: {
    get(key: string): Promise<string | null>
    set(key: string, value: string | null): Promise<void>
  }
  data: string
  log(message: string): void
}

export type MethodHandler<P = unknown, R = unknown> = (params: P, ctx: ServerContext) => Promise<R> | R
