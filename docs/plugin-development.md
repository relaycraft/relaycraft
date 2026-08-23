# Plugin Development Guide

RelayCraft plugins extend the app with custom pages, UI slots, context-menu
actions, themes, and scripted access to proxy traffic, rules, storage, AI, and
outbound HTTP — all through a single scoped API object.

This guide is grounded in the source of truth:

- Manifest types: `src/types/plugin.ts` (`PluginManifest`)
- Frontend API: `src/types/plugin.ts` (`PluginAPI`) + `src/plugins/api.ts`
- Plugin loading/injection: `src/plugins/pluginLoader.ts`
- Bridge command contract: `src-tauri/src/plugins/registry.rs`
- Permission risk metadata: `src/plugins/permissions.ts`

A ready-to-use starting point lives in `templates/plugin-template/`.

---

## 1. Quick Start

A plugin is a folder with a manifest (`plugin.yaml`, `plugin.yml`, or
`plugin.json`) plus the files it references. The smallest useful plugin:

```yaml
# plugin.yaml
id: com.example.hello
name: Hello Plugin
version: 0.1.0
engines:
  relaycraft: ">=1.4.0"
capabilities:
  ui:
    entry: index.js
permissions:
  - storage:read
  - storage:write
```

```js
// index.js — runs in the WebView, no build step required.
// The host exposes: globalThis.RelayCraft = { api, components, icons }
// and globalThis.React (used below via React.createElement).
const { api } = globalThis.RelayCraft;
const React = globalThis.React;

function HelloPage() {
  return React.createElement("div", { style: { padding: 16 } }, "Hello from a plugin");
}

api.ui.registerPage({
  id: "hello",
  name: "Hello",
  route: "/plugin/hello",
  component: HelloPage,
});

api.ui.toast("Hello Plugin loaded", "success");
```

Install it:

- **From the UI**: zip the folder contents (manifest at the zip root), rename
  the archive to `hello.rcplugin`, then install it from
  **Settings → Plugins → Install local plugin** (or just double-click the
  `.rcplugin` file — the OS file association installs it).
- **From disk (development)**: copy the folder to
  `{appData}/plugins/com.example.hello/` and restart the app. The plugins page
  shows discovered plugins and lets you enable/disable them.

After enabling, open the page from the sidebar/plugin pages and check the
toast. Plugin state persists under `{appData}/plugins_data/{id}/` (key-value
storage, one file per key).

---

## 2. Manifest Reference

The manifest is `plugin.yaml`, `plugin.yml`, or `plugin.json` at the plugin
root. Authoritative type: `PluginManifest` in `src/types/plugin.ts`.

### Metadata

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `id` | string | yes | Unique reverse-domain id, e.g. `com.example.myplugin`. Also the default i18n namespace (dots are replaced with `_`) and the storage namespace. |
| `name` | string | yes | Display name. |
| `version` | string | yes | SemVer version of the plugin itself, e.g. `0.1.0`. |
| `description` | string | no | Shown in the plugin list/detail panel. |
| `author` | string \| `{name, email?, url?}` | no | |
| `icon` | string | no | Plugin icon (path/identifier shown in the UI). |
| `homepage` | string | no | |
| `license` | string | no | SPDX identifier recommended. |
| `locales` | Record<string, {name?, description?}> | no | Per-locale overrides of `name`/`description` for the plugin listing. |
| `type` | `"plugin" \| "theme"` | no | Defaults to `plugin`. |

### Compatibility: `engines.relaycraft`

```yaml
engines:
  relaycraft: ">=1.4.0"   # SemVer range against the app version
```

- The host evaluates `engines.relaycraft` as a SemVer range against the
  running app version (see `package.json`). The result is reported per plugin
  as `PluginCompatibility` (`requirement`, `current`, `compatible`, `reason`).
- **Incompatible plugins are not loaded**: at startup they are skipped, marked
  as errored in the plugin detail panel, and surfaced via the notification
  center.
- Always declare it. Plugins without `engines.relaycraft` load, but give the
  user no compatibility guarantee.
- `engines.node` exists in the schema but has no effect today (plugins do not
  run under Node).

### Capabilities (entry points)

```yaml
capabilities:
  ui:
    entry: index.js                # path to the JS entry (required for UI plugins)
    settings_schema: settings.json # optional JSON Schema file for plugin settings
    theme: theme.json              # optional theme definition file
  logic:
    entry: main.py                 # RESERVED: engine-side traffic processing.
                                   # Declared now, executed by the 2.0 engine.
  i18n:
    namespace: myplugin            # optional; defaults to the plugin id (dots → _)
    locales:
      en: locales/en.json
      zh: locales/zh.json
```

- `capabilities.ui.entry` — JS file executed at load time (see §3).
- `capabilities.ui.settings_schema` — JSON Schema describing user-editable
  settings; rendered in the plugin settings UI and readable at runtime via
  `api.settings.get()`.
- `capabilities.logic.entry` — **reserved**. It declares intent for
  engine-side traffic processing; the current (mitmproxy-based) engine does
  not execute it. It takes effect with the 2.0 engine.
- `capabilities.proxy` and the top-level `entry.ui`/`entry.python` fields are
  deprecated; use `capabilities.ui.entry` / `capabilities.logic.entry`.
- `capabilities.i18n` — per-locale JSON resource files. The namespace defaults
  to the plugin id with dots replaced by underscores; translations are loaded
  for the current language (with `en` as fallback) and reloaded on language
  change.

Non-standard top-level fields (e.g. a `build` block used by plugin build
tooling, as in the official `api-manager` plugin) are tolerated — the host
ignores unknown fields.

### Permissions

Permissions are declared in the manifest and gate access to restricted bridge
commands. The model is **declare-to-allow**: listing a permission in the
manifest grants it; there is no runtime approval prompt. Declare the minimum
set your plugin needs — users see the declared list and its risk levels in
the plugin detail panel.

| Permission | Risk | Unlocks (API surface) |
| --- | --- | --- |
| `proxy:read` | low | `api.proxy.getStatus()` |
| `traffic:read` | low | `api.traffic.listFlows()`, `api.traffic.getFlow()` |
| `rules:read` | low | `api.rules.list()`, `api.rules.get()` |
| `storage:read` | low | `api.storage.get()`, `api.storage.list()` |
| `stats:read` | low | `api.stats.getProcessStats()` |
| `storage:write` | medium | `api.storage.set()`, `api.storage.delete()`, `api.storage.clear()` |
| `rules:write` | medium | `api.rules.createMock()` |
| `fs:read_logs` | medium | Reserved (no bridge command yet) |
| `network:outbound` | high | `api.http.send()` |
| `ai:chat` | high | `api.ai.chat()`, `api.ai.chatStream()` (calls are audit-logged) |
| `proxy:write` | high | Reserved (no bridge command yet) |

Calling a gated API without the permission throws an error of the form
`Security Violation: Missing '<permission>' permission`. Unknown permission
strings are ignored by the host (forward compatibility), but the validation
tool (§6) flags them.

---

## 3. Runtime Environment

UI plugins run inside the app WebView:

- The entry file is read from the plugin directory and executed via a
  Blob URL `<script>` (required by the production CSP), wrapped in an IIFE.
- Inside that scope the host provides:
  - `globalThis.RelayCraft = { api, components, icons }` — your entry point to
    everything. (`globalThis.ProxyPilot` is a legacy alias.)
  - `globalThis.React` — the app's own React instance. Use
    `React.createElement` directly; **do not bundle your own React copy** into
    a no-build plugin (bundled plugins like `api-manager` may bundle React
    deliberately, but for plain scripts the global is the contract).
  - `RelayCraft.components` — shared host UI components: `Button`, `Input`,
    `Switch`, `Select`, `Skeleton`, `Tabs` (+ `TabsList`/`TabsTrigger`/
    `TabsContent`), `Textarea`, `Tooltip`.
  - `RelayCraft.icons` — 47 curated lucide icon components (`Plus`, `Search`,
    `Settings`, `Trash2`, `Globe`, `Bug`, `Sparkles`, …; full list in
    `src/plugins/pluginLoader.ts`).
- There is no bundler, no JSX, no `import`/`require`, and no Node.js APIs.
  Write plain ES2020+ JavaScript.
- Top-level errors in your entry are caught by the loader: the plugin is
  marked as errored (visible in the plugin detail panel) and an error toast is
  shown. Other plugins still load.

Everything below is reachable through `globalThis.RelayCraft.api`.

---

## 4. API Reference

The API is organized by **stability tier** (mirrors the bridge registry in
`src-tauri/src/plugins/registry.rs`):

- **Frontend-local (host-stable)**: `i18n`, `theme`, `ui`, `settings`, `log`,
  `events`. Implemented entirely in the renderer; never cross the bridge.
- **Host services (host-stable)**: `ai`, `stats`, `http`, `storage`, `host`.
  Bridge to engine-independent host capabilities — stable across the 2.0
  engine swap.
- **Engine-backed (stable shape, swappable implementation)**: `proxy`,
  `traffic`, `rules`. Backed by the current mitmproxy-based engine. **When the
  2.0 engine lands, these API shapes stay identical — only the host-side
  implementation layer is replaced.** Code written against them today keeps
  working.

### i18n

| Signature | Description | Permission |
| --- | --- | --- |
| `i18n.t(key, options?) → string` | Translate a key in your plugin namespace (auto-namespaced). Supports i18next interpolation via `options`. | — |
| `i18n.language → string` | Current UI language code. | — |
| `i18n.onLanguageChange(cb) → () => void` | Subscribe to language changes; returns an unsubscribe function. | — |
| `i18n.registerLocale(lang, resources)` | Manually register a resource bundle (legacy; prefer `capabilities.i18n.locales` in the manifest). | — |

### theme

| Signature | Description | Permission |
| --- | --- | --- |
| `theme.register(theme)` | Register a theme: `{ id, name, type: "light" \| "dark", colors: Record<string,string>, css?, path? }`. | — |
| `theme.set(themeId)` | Activate a registered theme. | — |

### ui

| Signature | Description | Permission |
| --- | --- | --- |
| `ui.registerPage(page)` | Add a full page. `page`: `{ id, name, route, component, nameKey?, i18nNamespace?, icon?, order? }`. `nameKey` is translated via your i18n namespace. | — |
| `ui.registerSlot(slotId, { id?, component, order? })` | Inject a component into a host extension slot. | — |
| `ui.toast(message, type?)` | Ephemeral toast (`"info" \| "success" \| "error"`). Errors also land in the notification center. | — |
| `ui.components` | `{ Editor, DiffEditor, Markdown }` — host editor/markdown components. | — |
| `ui.registerContextMenuItem(config) → () => void` | Add an item to the traffic flow right-click menu. `config`: `{ id, label, icon?, when?, onClick }` where `when`/`onClick` receive a `TrafficFlowSummary` (`{ method, url, headers, body }`). Returns an unregister function. | — |

### ai — requires `ai:chat`

| Signature | Description |
| --- | --- |
| `ai.chat(messages) → Promise<string>` | Single completion. `messages`: `{role, content}[]` or `[role, content][]` tuples. Throws a `PluginAIError` with `code` ∈ `permission \| params \| provider \| timeout \| unknown`. Invocations are audit-logged. |
| `ai.chatStream(messages, onChunk, options?) → Promise<void>` | Streaming completion; `options`: `{ temperature?, includeContext? }`. `includeContext: true` attaches the app's current traffic context. |
| `ai.isEnabled() → boolean` | Whether the user has enabled AI features in settings. |

### stats — requires `stats:read`

| Signature | Description |
| --- | --- |
| `stats.getProcessStats() → Promise<{ cpu_usage, memory_usage, up_time }>` | Host process CPU/memory/uptime snapshot. |

### http — requires `network:outbound`

| Signature | Description |
| --- | --- |
| `http.send(request) → Promise<HttpSendResponse>` | Send an HTTP request through the Rust layer (captured by the local proxy, bypasses WebView CORS/CSP). `request`: `{ method, url, headers?, body? }`. Response: `{ status, headers, body, encoding: "text" \| "base64", truncated, total_bytes }`. |

### storage

Plugin-scoped key-value storage persisted to disk under
`{appData}/plugins_data/{pluginId}/`. Keys must match `[a-zA-Z0-9-_]`, max 128
chars. Each plugin only sees its own namespace. Quotas apply per plugin: a
single value may be at most 1 MB, at most 1000 keys, and 50 MB total —
writes beyond a quota fail with a `Storage quota exceeded` error.

| Signature | Description | Permission |
| --- | --- | --- |
| `storage.get(key) → Promise<string \| null>` | Read a value. | `storage:read` |
| `storage.set(key, value) → Promise<void>` | Write a value. | `storage:write` |
| `storage.delete(key) → Promise<void>` | Delete a key. | `storage:write` |
| `storage.list(prefix?) → Promise<string[]>` | List keys, optionally by prefix. | `storage:read` |
| `storage.clear() → Promise<void>` | Delete all keys. | `storage:write` |

### settings / log / events

| Signature | Description | Permission |
| --- | --- | --- |
| `settings.get(key?) → any` | Read the user's saved values for your `settings_schema` (one key, or all when omitted). | — |
| `log.info(message, context?)` / `log.warn(...)` / `log.error(message, errorObj?)` | Write to the app log, tagged with your plugin id; visible in the log viewer. | — |
| `events.on(eventName, callback) → () => void` | Subscribe to Tauri events emitted by the host or other plugins; returns an unlisten function. | — |

#### Subscribable host events

The host emits the following events that plugins may subscribe to. They are
registered in `PLUGIN_EVENTS` in `src-tauri/src/plugins/registry.rs`, which is
the single source of truth for the event contract; events not registered there
are not guaranteed to be stable.

| Event | Domain | Payload | Description |
| --- | --- | --- | --- |
| `rules-changed` | engine | empty (notification only) | Emitted when the active rule set changes; refetch rules to observe the new state. |
| `proxy-engine-crashed` | engine | string (error message) | Emitted when the proxy engine process crashes. |
| `mcp-activity` | host | object (MCP activity record) | Emitted when an MCP tool call is handled by the host. |
| `plugin-installed-from-file` | host | string (plugin id) | Emitted when a plugin is successfully installed from a local file. |
| `plugin-install-failed-from-file` | host | string (error message) | Emitted when installing a plugin from a local file fails. |

### host

| Signature | Description | Permission |
| --- | --- | --- |
| `host.getRuntime() → Promise<HostRuntime>` | Read host runtime state: `{ proxyPort, proxyRunning, proxyActive, mcpEnabled, mcpRunning, mcpPort }`. | — |

### proxy — requires `proxy:read` (engine-backed)

| Signature | Description |
| --- | --- |
| `proxy.getStatus() → Promise<{ running, active, active_scripts: string[] }>` | Proxy engine status and active scripts. |

### traffic — requires `traffic:read` (engine-backed)

| Signature | Description |
| --- | --- |
| `traffic.listFlows(filter?) → Promise<PluginFlowListResult>` | List captured flows with filtering (`sessionId`, `method`, `host`, `urlPattern` substring, `status` like `"200"`/`"4xx"`) and offset pagination (`offset`, `limit` ≤ 1000, default 100). Returns `{ flows, total, offset, limit, hasMore }` where each flow is a `PluginFlowSummary` (`id`, `method`, `url`, `host`, `path`, `status`, `contentType`, `startedAt`, `durationMs`, `sizeBytes`, `hasError`, `hasRequestBody`, `hasResponseBody`). |
| `traffic.getFlow(id, options?) → Promise<PluginFlowDetail>` | Full request/response detail of one flow. `options`: `{ includeBodies?, maxBodyBytes? }`. Bodies are omitted unless `includeBodies: true`; `bodyTruncated`/`bodySize` report capping. Includes `ruleHits` (matching rule ids, or `null`). |

### rules (engine-backed)

| Signature | Description | Permission |
| --- | --- | --- |
| `rules.createMock(config) → Promise<string>` | Create (or update, via `config.ruleId`) a Map Local mock rule and return its id. `config`: `{ name, urlPattern, responseBody, statusCode?, contentType?, responseHeaders?, method?, ruleId? }`. `metadata.source` is set to `plugin:<yourId>` automatically. | `rules:write` |
| `rules.list(filter?) → Promise<PluginRule[]>` | List rules, optionally filtered by `{ enabled?, source?, type? }`. Each item: `{ id, name, type, enabled, priority, urlPattern, source, groupId }`. | `rules:read` |
| `rules.get(id) → Promise<unknown>` | Get one full rule object by id. | `rules:read` |

---

## 5. Packaging & Publishing

### Package format

A `.rcplugin` file is a plain ZIP archive with the manifest at the root:

```
my-plugin.rcplugin   (zip)
├── plugin.yaml          # or plugin.yml / plugin.json — required at root
├── index.js             # capabilities.ui.entry
├── locales/
│   ├── en.json
│   └── zh.json
└── settings.json        # if capabilities.ui.settings_schema is set
```

Build it with any zip tool, then rename:

```bash
cd my-plugin
zip -r ../my-plugin.rcplugin .
```

The installer rejects archives without a manifest and enforces a manifest size
cap; keep bundles lean. `.zip` files install the same way — `.rcplugin` is the
convention for OS file association and clarity.

### Versioning

- `version` is your plugin's own SemVer; bump it per release. The marketplace
  registry keys upgrades on it.
- Keep `engines.relaycraft` honest: a range like `">=1.4.0 <2.0.0"` protects
  users from breaking host changes and lets them see *why* a plugin stopped
  loading after an app upgrade.

### Marketplace

The official marketplace registry lives in
[relaycraft/relaycraft-plugins](https://github.com/relaycraft/relaycraft-plugins)
(the `plugins.json` registry and official plugin sources). To publish:

1. Host your `.rcplugin` asset somewhere with a stable URL (e.g. a GitHub
   release on your plugin's repo).
2. Open a PR against `relaycraft-plugins` adding your plugin entry to the
   registry, following the schema of the existing entries (see the official
   `api-manager` plugin for a real-world structure — vite-built single-file
   `index.js`, `plugin.yaml` manifest).
3. Users then see the plugin under **Settings → Plugins → Marketplace** and
   install with one click.

---

## 6. Manifest Validation

The repo ships a validator that catches manifest mistakes before you zip:

```bash
node scripts/validate-plugin-manifest.mjs path/to/plugin-dir
# or, inside this repo:
pnpm validate:plugin templates/plugin-template
```

- **Errors (exit 1)**: missing/unparseable manifest, missing `id`/`name`/
  `version`, malformed id or non-SemVer version, unknown permissions,
  `capabilities.ui.entry` / i18n locale files that don't exist, invalid
  `engines.relaycraft` range.
- **Warnings (exit 0)**: missing `description`/`author`/`icon`, undeclared
  `engines.relaycraft`.

Run it in CI on your plugin repo to keep releases clean.

The host runs the same validation again at install time
(`install_plugin_from_zip`): required `id`/`name`/`version`, reverse-domain
id shape, SemVer version, `permissions` restricted to the same known set as
the CLI, and — after staging extraction — `capabilities.ui.entry` must point
to a file inside the package. Failures abort the install with a stage-tagged
error (`[manifest]` / `[archive]` / `[filesystem]`).

---

## 7. Debugging

- **Logs**: `api.log.info/warn/error` writes to the app log tagged with your
  plugin id; open the log viewer in the app to inspect them. Loader-level
  failures (file read errors, locale parse errors) also go there.
- **Load failures**: if your entry throws at load time, the plugin is marked
  errored — open the plugin's **detail panel** in Settings → Plugins to see
  the error message, plus the bridge contract and per-command call stats.
- **Toasts & notification center**: `api.ui.toast(msg, "error")` shows an
  ephemeral toast and records the message in the notification center, so
  users can report plugin errors without log diving.
- **Compatibility**: if a plugin silently disappeared after an app update,
  check the detail panel for the incompatibility reason (`engines.relaycraft`
  vs. current app version) and the notification center warning.
- **Permission errors**: `Security Violation: Missing '<permission>'
  permission` means the manifest is missing a permission for the API you
  called — add it, reinstall, re-enable.
