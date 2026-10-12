import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { manifestSchema, parseManifest, SUPPORTED_PLUGIN_APIS } from '../src/manifest'
import type { PluginManifest } from '../src/types'

const PLUGIN_ID_PATTERN = '^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$'

const clickupManifest: PluginManifest = {
  id: 'clickup-board',
  name: 'ClickUp board',
  version: '1.0.0',
  description: 'See a ClickUp board and start a chat or terminal on any task.',
  pluginApi: 1,
  runtime: 'isolated',
  icon: 'assets/icon.svg',
  server: 'src/server.ts',
  screen: 'src/screen.ts',
  permissions: {
    network: ['api.clickup.com'],
    sessions: ['chat', 'terminal'],
    settings: true,
  },
  settings: [
    { key: 'token', label: 'ClickUp token', type: 'secret', help: 'ClickUp, Settings, Apps, Generate.' },
  ],
}

function errorsOf(raw: unknown): string[] {
  const result = parseManifest(raw)
  if (!result.ok) return result.errors
  throw new Error('expected the manifest to be refused')
}

describe('parseManifest', () => {
  test('parses the ClickUp manifest from the spec', () => {
    const result = parseManifest(clickupManifest)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.manifest).toEqual(clickupManifest)
  })

  test('accepts a minimal manifest with only a server part', () => {
    const result = parseManifest({
      id: 'tiny-tool',
      name: 'Tiny tool',
      version: '0.1.0',
      description: 'Does one thing.',
      pluginApi: 1,
      runtime: 'trusted',
      server: 'src/server.ts',
      permissions: {},
    })
    expect(result.ok).toBe(true)
  })

  test('pluginApi 3 says it needs a newer Mission Control', () => {
    const errors = errorsOf({ ...clickupManifest, pluginApi: 3 })
    expect(errors).toContain('This plugin needs a newer Mission Control')
  })

  test('rejects an id with uppercase and underscores', () => {
    expect(errorsOf({ ...clickupManifest, id: 'Bad_ID' }).length).toBeGreaterThan(0)
  })

  test('rejects ids shorter than 3 or longer than 40 characters', () => {
    expect(errorsOf({ ...clickupManifest, id: 'ab' }).length).toBeGreaterThan(0)
    expect(errorsOf({ ...clickupManifest, id: 'a'.repeat(41) }).length).toBeGreaterThan(0)
  })

  test('rejects a server path outside the repo', () => {
    expect(errorsOf({ ...clickupManifest, server: '../x.ts' }).length).toBeGreaterThan(0)
  })

  test('rejects an absolute screen path', () => {
    expect(errorsOf({ ...clickupManifest, screen: '/etc/passwd' }).length).toBeGreaterThan(0)
  })

  test('accepts a *. wildcard over a host of at least two labels', () => {
    const permissions = { ...clickupManifest.permissions, network: ['api.clickup.com', '*.clickup-attachments.com'] }
    expect(parseManifest({ ...clickupManifest, permissions }).ok).toBe(true)
  })

  test('rejects any other wildcard shape', () => {
    for (const host of ['*.com', '*', 'a.*.b', '**.x', '**.clickup.com', '*clickup.com', '*.', '.clickup.com']) {
      const permissions = { ...clickupManifest.permissions, network: [host] }
      expect(errorsOf({ ...clickupManifest, permissions }).length, host).toBeGreaterThan(0)
    }
  })

  test('rejects network entries that are not plain host names', () => {
    const urlForm = { ...clickupManifest.permissions, network: ['https://api.clickup.com'] }
    expect(errorsOf({ ...clickupManifest, permissions: urlForm }).length).toBeGreaterThan(0)
    const localhostForm = { ...clickupManifest.permissions, network: ['localhost'] }
    expect(errorsOf({ ...clickupManifest, permissions: localhostForm }).length).toBeGreaterThan(0)
  })

  test('rejects a session kind other than chat and terminal', () => {
    const permissions = { ...clickupManifest.permissions, sessions: ['chat', 'irc'] }
    expect(errorsOf({ ...clickupManifest, permissions }).length).toBeGreaterThan(0)
  })

  test('rejects a repeated session kind', () => {
    const permissions = { ...clickupManifest.permissions, sessions: ['chat', 'chat'] }
    expect(errorsOf({ ...clickupManifest, permissions })).toContain('sessions must not repeat')
  })

  test('accepts queueSource true or false and rejects a non-boolean', () => {
    for (const queueSource of [true, false]) {
      const result = parseManifest({ ...clickupManifest, queueSource })
      expect(result.ok).toBe(true)
      if (result.ok) expect(result.manifest.queueSource).toBe(queueSource)
    }
    expect(errorsOf({ ...clickupManifest, queueSource: 'yes' }).length).toBeGreaterThan(0)
  })

  test('rejects an unknown top-level field', () => {
    expect(errorsOf({ ...clickupManifest, homepage: 'https://example.com' }).length).toBeGreaterThan(0)
  })

  test('rejects an unknown permissions field', () => {
    const permissions = { ...clickupManifest.permissions, filesystem: true }
    expect(errorsOf({ ...clickupManifest, permissions }).length).toBeGreaterThan(0)
  })

  test('rejects an unknown settings field property', () => {
    const settings = [{ key: 'token', label: 'Token', type: 'secret', placeholder: 'paste it' }]
    expect(errorsOf({ ...clickupManifest, settings }).length).toBeGreaterThan(0)
  })

  test('rejects a manifest missing its name', () => {
    const { name: _name, ...withoutName } = clickupManifest
    expect(errorsOf(withoutName).length).toBeGreaterThan(0)
  })

  test('rejects a settings field with an unknown type', () => {
    const settings = [{ key: 'token', label: 'Token', type: 'password' }]
    expect(errorsOf({ ...clickupManifest, settings }).length).toBeGreaterThan(0)
  })
})

describe('manifestSchema', () => {
  test('accepts the spec manifest', () => {
    expect(manifestSchema.safeParse(clickupManifest).success).toBe(true)
  })

  test('SUPPORTED_PLUGIN_APIS lists versions 1 and 2', () => {
    expect(SUPPORTED_PLUGIN_APIS).toEqual([1, 2])
  })

  test('rejects pluginApi 3 like the JSON Schema enum', () => {
    expect(manifestSchema.safeParse({ ...clickupManifest, pluginApi: 3 }).success).toBe(false)
  })

  test('rejects repeated session kinds like the JSON Schema uniqueItems', () => {
    const permissions = { ...clickupManifest.permissions, sessions: ['chat', 'chat'] }
    expect(manifestSchema.safeParse({ ...clickupManifest, permissions }).success).toBe(false)
  })

  test('rejects unknown fields like the JSON Schema additionalProperties', () => {
    expect(manifestSchema.safeParse({ ...clickupManifest, homepage: 'https://example.com' }).success).toBe(false)
    const permissions = { ...clickupManifest.permissions, filesystem: true }
    expect(manifestSchema.safeParse({ ...clickupManifest, permissions }).success).toBe(false)
  })
})

describe('schema/mc-plugin.schema.json', () => {
  test('mirrors the manifest rules for editors', () => {
    const schema = JSON.parse(readFileSync('schema/mc-plugin.schema.json', 'utf8'))
    expect(schema.$schema).toBe('https://json-schema.org/draft/2020-12/schema')
    expect(schema.properties.id.pattern).toBe(PLUGIN_ID_PATTERN)
    expect(schema.properties.pluginApi.enum).toEqual([1, 2])
    expect(schema.properties.runtime.enum).toEqual(['trusted', 'isolated'])
    expect(schema.properties.permissions.properties.sessions.uniqueItems).toBe(true)
    expect(new RegExp(schema.$defs.repoPath.pattern).test('../x.ts')).toBe(false)
    expect(new RegExp(schema.$defs.repoPath.pattern).test('src/server.ts')).toBe(true)
    const network = new RegExp(schema.properties.permissions.properties.network.items.pattern)
    for (const host of ['api.clickup.com', '*.clickup-attachments.com']) expect(network.test(host), host).toBe(true)
    for (const host of ['*.com', '*', 'a.*.b', '**.x', 'https://api.clickup.com']) expect(network.test(host), host).toBe(false)
    expect(schema.properties.queueSource.type).toBe('boolean')
    const contributes = schema.properties.contributes
    expect(contributes.additionalProperties).toBe(false)
    expect(new RegExp(contributes.properties.agents.items.pattern).test('agents/biz-gate.md')).toBe(true)
    expect(new RegExp(contributes.properties.agents.items.pattern).test('agents/biz-gate.txt')).toBe(false)
    expect(new RegExp(contributes.properties.agents.items.pattern).test('../agents/x.md')).toBe(false)
    expect(new RegExp(contributes.properties.skills.items.pattern).test('skills/card-refine')).toBe(true)
    expect(new RegExp(contributes.properties.skills.items.pattern).test('/skills/x')).toBe(false)
    expect(new RegExp(contributes.properties.flows.items.pattern).test('flows/card-pipeline.json')).toBe(true)
    expect(new RegExp(contributes.properties.flows.items.pattern).test('flows/card-pipeline.yaml')).toBe(false)
  })
})

const contributingManifest: PluginManifest = {
  id: 'card-pipeline',
  name: 'Card pipeline',
  version: '0.1.0',
  description: 'Refine ClickUp cards with the biz-gate agent.',
  pluginApi: 2,
  runtime: 'isolated',
  permissions: { settings: true },
  settings: [{ key: 'reposRoot', label: 'Repos folder', type: 'text' }],
  contributes: { agents: ['agents/biz-gate.md'], skills: ['skills/card-refine'], flows: ['flows/card-pipeline.json'] },
}

describe('contributes', () => {
  test('accepts agents and skills under pluginApi 2', () => {
    const result = parseManifest(contributingManifest)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.manifest.contributes).toEqual({ agents: ['agents/biz-gate.md'], skills: ['skills/card-refine'], flows: ['flows/card-pipeline.json'] })
  })

  test('accepts pluginApi 2 without contributes', () => {
    const { contributes: _contributes, ...plain } = contributingManifest
    expect(parseManifest(plain).ok).toBe(true)
  })

  test('accepts only agents, only skills or only flows', () => {
    expect(parseManifest({ ...contributingManifest, contributes: { agents: ['agents/a.md'] } }).ok).toBe(true)
    expect(parseManifest({ ...contributingManifest, contributes: { skills: ['skills/b'] } }).ok).toBe(true)
    expect(parseManifest({ ...contributingManifest, contributes: { flows: ['flows/c.json'] } }).ok).toBe(true)
  })

  test('a flow is a .json file inside the repo', () => {
    expect(errorsOf({ ...contributingManifest, contributes: { flows: ['flows/c.yaml'] } })).toContain('flows must be .json files inside the plugin repo')
    expect(errorsOf({ ...contributingManifest, contributes: { flows: ['../c.json'] } })).toContain('flows must be .json files inside the plugin repo')
  })

  test('needs pluginApi 2', () => {
    expect(errorsOf({ ...contributingManifest, pluginApi: 1 })).toContain('contributes needs pluginApi 2')
  })

  test('must list at least one agent, skill or flow', () => {
    expect(errorsOf({ ...contributingManifest, contributes: {} })).toContain('contributes must list at least one agent, skill or flow')
    expect(errorsOf({ ...contributingManifest, contributes: { agents: [], skills: [], flows: [] } })).toContain('contributes must list at least one agent, skill or flow')
  })

  test('an agent is a .md file inside the repo', () => {
    expect(errorsOf({ ...contributingManifest, contributes: { agents: ['agents/biz-gate.txt'] } })).toContain('agents must be .md files inside the plugin repo')
    expect(errorsOf({ ...contributingManifest, contributes: { agents: ['../biz-gate.md'] } })).toContain('agents must be .md files inside the plugin repo')
    expect(errorsOf({ ...contributingManifest, contributes: { agents: ['/abs/biz-gate.md'] } })).toContain('agents must be .md files inside the plugin repo')
  })

  test('a skill is a folder inside the repo', () => {
    expect(errorsOf({ ...contributingManifest, contributes: { skills: ['../skills/x'] } })).toContain('skills must be folders inside the plugin repo')
    expect(errorsOf({ ...contributingManifest, contributes: { skills: ['skills/x/SKILL.md'] } })).toContain('skills must be folders inside the plugin repo')
  })

  test('rejects a repeated path', () => {
    expect(errorsOf({ ...contributingManifest, contributes: { agents: ['agents/a.md', 'agents/a.md'] } })).toContain('contributes must not repeat a path')
  })

  test('rejects an unknown contributes field', () => {
    expect(errorsOf({ ...contributingManifest, contributes: { agents: ['agents/a.md'], hooks: ['hooks/x.json'] } }).length).toBeGreaterThan(0)
  })
})
