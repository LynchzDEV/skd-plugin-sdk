import { createMessageConnection, ResponseError, StreamMessageReader, StreamMessageWriter, type MessageConnection } from 'vscode-jsonrpc/node'
import type { MethodHandler, ServerContext } from './types'

export type AnyMethodHandler = MethodHandler<never, unknown>

export type PluginDefinition<M extends Record<string, AnyMethodHandler> = Record<string, AnyMethodHandler>> = { methods: M }

type CallableMethod<H> = H extends (params: infer P, ctx: never) => infer R
  ? (params: [P] extends [never] ? unknown : P, ctx: ServerContext) => R
  : never

export type CallableMethods<M extends Record<string, AnyMethodHandler>> = { [K in keyof M]: CallableMethod<M[K]> }

type WireMethod = MethodHandler<unknown, unknown>

type CallParams = { method: string; params?: unknown }

// ponytail: legacy MC_PLUGIN_ env reads, drop once every host ships the SKD_PLUGIN_ names
export function pluginEnv(name: 'RUNTIME' | 'DATA', env: NodeJS.ProcessEnv = process.env): string | undefined {
  return env[`SKD_PLUGIN_${name}`] ?? env[`MC_PLUGIN_${name}`]
}

export function definePlugin<M extends Record<string, AnyMethodHandler>>(
  definition: PluginDefinition<M>,
): PluginDefinition<CallableMethods<M>> {
  if (pluginEnv('RUNTIME') === 'isolated') serveStdio(definition)
  return definition as unknown as PluginDefinition<CallableMethods<M>>
}

export function serveStdio(definition: PluginDefinition): MessageConnection {
  // stdout carries JSON-RPC frames; any stray console output there corrupts the stream.
  console.log = console.info = console.debug = (...args: unknown[]) => console.error(...args)
  const connection = createMessageConnection(
    new StreamMessageReader(process.stdin),
    new StreamMessageWriter(process.stdout),
  )
  const ctx: ServerContext = {
    settings: {
      get: async (key) => (await connection.sendRequest('settings.get', { key })) as string | null,
      set: async (key, value) => {
        await connection.sendRequest('settings.set', { key, value })
      },
    },
    data: pluginEnv('DATA') ?? '',
    log: (message) => connection.sendNotification('log', { message }),
  }
  connection.onRequest('plugin.call', async (params: CallParams) => {
    const methods = definition.methods as Record<string, WireMethod>
    if (!Object.hasOwn(methods, params.method)) throw new ResponseError(-32601, `No method ${params.method}`)
    return (methods[params.method] as WireMethod)(params.params, ctx)
  })
  connection.onNotification('plugin.shutdown', () => {
    process.exit(0)
  })
  connection.listen()
  return connection
}
