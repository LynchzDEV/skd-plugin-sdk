import { z } from 'zod'
import type { PluginManifest, SettingField } from './types'

export const SUPPORTED_PLUGIN_APIS: readonly number[] = [1, 2]
export const CONTRIBUTIONS_PLUGIN_API = 2

const PLUGIN_ID_PATTERN = /^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/
const NETWORK_PERMISSION_PATTERN = /^(?:\*\.)?(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/
const REPO_PATH_PATTERN = /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$)).+$/
const AGENT_PATH_PATTERN = /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$)).+\.md$/
const FLOW_PATH_PATTERN = /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$)).+\.json$/
const SKILL_PATH_PATTERN = /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))(?!.*\.md$)(?!.*\/$).+$/

const repoPath = (field: string) =>
  z.string().regex(REPO_PATH_PATTERN, `${field} must be a path inside the plugin repo`)

const noRepeatedSessions = (kinds: Array<'chat' | 'terminal'>) =>
  new Set(kinds).size === kinds.length

const settingFieldSchema = z.strictObject({
  key: z.string().min(1, 'settings key is required'),
  label: z.string().min(1, 'settings label is required'),
  type: z.enum(['text', 'secret']),
  help: z.string().optional(),
})

const contributesSchema = z.strictObject({
  agents: z.array(z.string().regex(AGENT_PATH_PATTERN, 'agents must be .md files inside the plugin repo')).optional(),
  skills: z.array(z.string().regex(SKILL_PATH_PATTERN, 'skills must be folders inside the plugin repo')).optional(),
  flows: z.array(z.string().regex(FLOW_PATH_PATTERN, 'flows must be .json files inside the plugin repo')).optional(),
})

export const manifestSchema = z.strictObject({
  id: z.string().regex(PLUGIN_ID_PATTERN, 'Plugin id must be 3-40 characters of lowercase letters, digits and dashes'),
  name: z.string().min(1, 'name is required'),
  version: z.string().min(1, 'version is required'),
  description: z.string().min(1, 'description is required'),
  pluginApi: z
    .number()
    .int('pluginApi must be a whole number')
    .refine((value) => SUPPORTED_PLUGIN_APIS.includes(value), 'This plugin needs a newer Shikidan'),
  runtime: z.enum(['trusted', 'isolated']),
  icon: repoPath('icon').optional(),
  server: repoPath('server').optional(),
  screen: repoPath('screen').optional(),
  queueSource: z.boolean().optional(),
  permissions: z.strictObject({
    network: z
      .array(z.string().regex(NETWORK_PERMISSION_PATTERN, 'Network permissions must be plain host names like api.clickup.com, or *. and a host like *.clickup-attachments.com'))
      .optional(),
    sessions: z
      .array(z.enum(['chat', 'terminal']))
      .refine(noRepeatedSessions, 'sessions must not repeat')
      .optional(),
    settings: z.boolean().optional(),
  }),
  settings: z.array(settingFieldSchema).optional(),
  contributes: contributesSchema.optional(),
}).superRefine((manifest, ctx) => {
  const contributes = manifest.contributes
  if (!contributes) return
  if (manifest.pluginApi < CONTRIBUTIONS_PLUGIN_API) {
    ctx.addIssue({ code: 'custom', path: ['contributes'], message: 'contributes needs pluginApi 2' })
  }
  const paths = [...(contributes.agents ?? []), ...(contributes.skills ?? []), ...(contributes.flows ?? [])]
  if (paths.length === 0) {
    ctx.addIssue({ code: 'custom', path: ['contributes'], message: 'contributes must list at least one agent, skill or flow' })
  }
  if (new Set(paths).size !== paths.length) {
    ctx.addIssue({ code: 'custom', path: ['contributes'], message: 'contributes must not repeat a path' })
  }
})

export type ManifestParseResult = { ok: true; manifest: PluginManifest } | { ok: false; errors: string[] }

export function parseManifest(raw: unknown): ManifestParseResult {
  const parsed = manifestSchema.safeParse(raw)
  if (!parsed.success) {
    return { ok: false, errors: parsed.error.issues.map((issue) => issue.message) }
  }
  return { ok: true, manifest: parsed.data }
}

export type { PluginManifest, SettingField }
