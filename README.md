# @mission-control/plugin-sdk

The toolkit for writing [Mission Control](https://github.com/LynchzDEV/mission-control) plugins.
One API, two runtimes: your plugin runs either **trusted** (inside Mission Control) or
**isolated** (an OS sandbox + locked iframe), and you write the same code either way.

A plugin is a git repo with a `mc-plugin.json` manifest at the root, an optional server
part (`server`) and an optional screen part (`screen`). The fastest start is to copy the
template repo [mc-plugin-template](https://github.com/LynchzDEV/mc-plugin-template).

```json
{
  "dependencies": { "@mission-control/plugin-sdk": "github:LynchzDEV/mc-plugin-sdk#v0.1.0" }
}
```

The SDK ships TypeScript source; Bun runs it directly, so there is no build step for the
server part. Mission Control builds the screen part for you at install time.

## The two runtimes, and the trust trade

| | `trusted` | `isolated` |
|---|---|---|
| Where the server part runs | Inside the Mission Control process | A separate process in an OS sandbox |
| File access | Full, like Mission Control itself | Its own folder and its data folder only |
| Network | Anything | Only the hosts in `permissions.network` |
| Secrets | Can read anything the host can | Its own settings only, one key at a time |
| Screen | Imported into the page | A locked iframe with no access to the host page |
| Install prompt | Full-access warning + "I trust this plugin" | The exact permission list |

Default to `isolated`. Choose `trusted` only when a plugin genuinely needs deep local
access, and expect users to think twice before installing it.

## Manifest reference: `mc-plugin.json`

| Field | Rule |
|---|---|
| `id` | 3–40 chars, lowercase letters, digits, dashes. Unique among installed plugins. |
| `name`, `version`, `description` | Non-empty strings shown in the Marketplace. |
| `pluginApi` | `1`, or `2` for a plugin with `contributes`. Any other value installs nothing and shows "Needs a newer Mission Control". |
| `runtime` | `"trusted"` or `"isolated"`. |
| `icon` | Optional path inside the repo (svg/png), e.g. `assets/icon.svg`. |
| `server` | Optional path inside the repo, e.g. `src/server.ts`. Relative, no `..`, no leading `/`. |
| `screen` | Optional path inside the repo, e.g. `src/screen.ts`. Same path rules. |
| `queueSource` | Optional boolean. `true` shows the Mission Control queue under this plugin in the sidebar (even when empty) and offers the plugin as a source in Add item. |
| `permissions.network` | Plain host names (`api.clickup.com`), or `*.` and a host of at least two labels (`*.clickup-attachments.com`, which matches any address ending in `.clickup-attachments.com`). No other wildcards, no URLs. Meaningful for isolated plugins. |
| `permissions.sessions` | A subset of `["chat", "terminal"]`. Needed to start sessions from the screen. |
| `permissions.settings` | `true` when the plugin keeps its own settings (secrets included). |
| `settings` | Declared fields render in the plugin's Marketplace detail. `secret` fields are masked and never sent back to the screen. |
| `contributes.agents` | `pluginApi` 2. Agent `.md` files inside the repo, each with `name:` in its frontmatter. |
| `contributes.skills` | `pluginApi` 2. Skill folders inside the repo, each holding `SKILL.md` with `name:`. |
| `contributes.flows` | `pluginApi` 2. Studio flow `.json` files inside the repo. |

Point editors at `schema/mc-plugin.schema.json` (JSON Schema draft 2020-12) for
validation and completion while you edit the manifest.

## Contributing agents, skills and Studio flows

A plugin can carry work for the engines, not only code for Mission Control:

```json
"pluginApi": 2,
"contributes": {
  "agents": ["agents/biz-gate.md"],
  "skills": ["skills/card-refine"],
  "flows": ["flows/card-pipeline.json"]
}
```

- **Agents and skills** are copied into each engine's config (`~/.claude/agents`, `~/.claude/skills`, the worker and chat profiles, and mirrored to Codex) while the plugin is installed and enabled. Disable or uninstall removes exactly the files Mission Control wrote.
- **Flows** appear in Studio as read-only entries named `<plugin name>: <flow name>`. Save a copy to change one; uninstalling the plugin removes the entry, never your copy. Each flow is checked with Studio's own rules at install.
- **Settings in files.** Contributed files may contain `{{setting:<key>}}` (a declared `text` setting) and `{{mc:mctl}}` (the command that runs this Mission Control's `mctl`). Mission Control fills them when it copies the files and again whenever the setting changes. Secret settings can never be filled into a file.
- **Collisions.** If an agent or skill with the same name already exists and Mission Control did not write it, the install stops and names it; nothing of the user's is moved or overwritten.
- **Trust.** Agents, skills and flows run with the user's full permissions, so a plugin with `contributes` needs the trust confirmation even when its runtime is `isolated`. The install prompt lists every item and where it goes; an update that adds one asks again.

## Server part

```ts
import { definePlugin } from '@mission-control/plugin-sdk/server'

export default definePlugin({
  methods: {
    'board.load': async ({ boardId }: { boardId: string }, ctx) => {
      const token = await ctx.settings.get('token')
      if (!token) throw new Error('Connect ClickUp first')
      return loadBoard(token, boardId)
    },
  },
})
```

`ctx` gives the server part:

| Call | Does |
|---|---|
| `ctx.settings.get(key)` | The plugin's own setting, secrets included, or `null` |
| `ctx.settings.set(key, value)` | Saves (or deletes, with `null`) one of the plugin's own settings |
| `ctx.data` | Absolute path of the plugin's private writable folder |
| `ctx.log(message)` | A line in the Mission Control server log, prefixed with the plugin id |

Every method the screen can `mc.call` must be listed in `methods`. Anything else —
including inherited names like `toString` — answers `No method <name>`. Annotate
`params` with the shape you expect: unannotated params are `unknown` on the outside, and
TypeScript flags any unannotated params the handler body uses.

## Screen part

```ts
import { defineScreen } from '@mission-control/plugin-sdk/screen'

export default defineScreen((root, mc) => {
  root.innerHTML = '<h2>Pick a task</h2>'
  root.querySelector('h2')?.addEventListener('click', () => mc.ui.toast('Picked'))
})
```

Import `@mission-control/plugin-sdk/ui.css` alongside your screen (Mission Control already
serves it to isolated screens): it carries the host's tokens and the `mk-*` component
classes — cards (`mk-card`, `mk-meta`, `mk-acts`), columns (`mk-cols`, `mk-col`), empty
states (`mk-empty`), dialogs (`mk-dialog`), fields (`mk-field`) and buttons
(`connection-button`, `pill`). Dark mode follows the host through `mc.theme()`; the SDK
sets `data-theme` on the frame's `<html>` for you.

`mc` gives the screen part (every call returns a Promise, and each is checked against the
manifest before it runs):

| Call | Does |
|---|---|
| `mc.call(method, params)` | Calls the plugin's own server method |
| `mc.sessions.startChat({ title, cwd, context, prompt? })` | Opens the host's launcher pre-filled; the user confirms. A plugin can never start a session silently. |
| `mc.sessions.startTerminal({ title, cwd, context, prompt? })` | Same, for a terminal |
| `mc.settings.view()` | The plugin's declared settings; secrets show only `configured: true`, never their value |
| `mc.settings.set(key, value)` | Saves a declared setting |
| `mc.folders.recent()` | The user's recent working folders, for folder fields |
| `mc.ui.toast(text, 'info' | 'error')` | A host toast |
| `mc.theme()` + `mc.onTheme(cb)` | `'light'` or `'dark'`, plus change callbacks, so the screen matches |

`context` is `{ name, markdown }` — a task dossier the host writes to a file the session
reads first. Keep it under 512 KB.

## A whole plugin in twenty lines

```json
// mc-plugin.json
{ "id": "hello-board", "name": "Hello board", "version": "0.1.0",
  "description": "Three cards, one click each.", "pluginApi": 1, "runtime": "trusted",
  "server": "src/server.ts", "screen": "src/screen.ts",
  "permissions": { "sessions": ["chat"], "settings": true },
  "settings": [{ "key": "greeting", "label": "Greeting", "type": "text" }] }
```

```ts
// src/server.ts
import { definePlugin } from '@mission-control/plugin-sdk/server'
export default definePlugin({
  methods: {
    'hello.cards': async (_p, ctx) => [{ id: 1, title: await ctx.settings.get('greeting') ?? 'Hello' }],
  },
})
```

```ts
// src/screen.ts
import { defineScreen } from '@mission-control/plugin-sdk/screen'
export default defineScreen(async (root, mc) => {
  for (const card of await mc.call('hello.cards') as { id: number; title: string }[]) {
    const button = document.createElement('button')
    button.className = 'mk-card'
    button.textContent = card.title
    button.onclick = () => mc.sessions.startChat({ title: card.title, cwd: '~' })
    root.append(button)
  }
})
```

## Listing a plugin in a marketplace

A marketplace is a git repo with a `marketplace.json` at the root:

```json
{
  "name": "KlangTech marketplace",
  "plugins": [
    { "id": "hello-board", "repo": "https://github.com/LynchzDEV/mc-plugin-template",
      "ref": "v0.1.0", "name": "Hello board", "description": "Template plugin", "runtime": "trusted" }
  ]
}
```

Users add the marketplace URL once; every listed plugin becomes installable. The listing
is for browsing only — what gets installed and granted always comes from the plugin's own
manifest at the pinned `ref`. Tag a release (`v1.0.0`) and point `ref` at the tag so
updates are deliberate.

## Testing locally

1. Run Mission Control, open **Marketplace** in the sidebar.
2. Under the list, use **Install from a link** with your repo:
   - a local checkout: `file:///Users/you/code/my-plugin` (fastest loop), or
   - a git URL plus a ref, exactly like a real install.
3. Mission Control clones, validates the manifest, builds the screen, and shows the
   permission prompt before anything is granted.

Install failures name the step (`clone`, `manifest`, `dependencies`, `build`) and leave
nothing half-installed, so a bad manifest costs nothing. `bun test` in your plugin repo
covers the server part the normal way:

```ts
import { expect, test } from 'bun:test'
import plugin from '../src/server'

test('hello.cards returns the greeting', async () => {
  const ctx = { settings: { get: async () => 'Hi', set: async () => {} }, data: '/tmp', log: () => {} }
  const cards = await plugin.methods['hello.cards'](undefined, ctx)
  expect(cards).toEqual([{ id: 1, title: 'Hi' }])
})
```

For isolated plugins, `definePlugin` starts the stdio JSON-RPC server on its own when the
host spawns it with `MC_PLUGIN_RUNTIME=isolated`; nothing extra to wire.

## Isolated protocol (reference)

The host talks JSON-RPC 2.0 with the isolated server part over stdin/stdout
(Content-Length framing, `vscode-jsonrpc`): host requests `plugin.call { method, params }`,
host notification `plugin.shutdown`; the plugin may request `settings.get { key }` /
`settings.set { key, value }` and notify `log { message }`. The plugin process receives
`MC_PLUGIN_RUNTIME`, `MC_PLUGIN_ID` and `MC_PLUGIN_DATA` in its environment and never
sees the settings file itself — only the values it asks for. The screen runs inside a
sandboxed iframe (`allow-scripts`, opaque origin) and reaches the host only through `mc`
over `postMessage`.

## License

MIT — see [LICENSE](LICENSE).
