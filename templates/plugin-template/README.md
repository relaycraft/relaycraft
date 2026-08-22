# RelayCraft Plugin Template

A minimal, no-build-step RelayCraft plugin: one page, a persisted counter,
i18n (en/zh), and toasts. Full documentation:
[`docs/plugin-development.md`](../../docs/plugin-development.md).

## Structure

```
plugin-template/
├── plugin.yaml       # Manifest: id, version, engines, capabilities, permissions
├── index.js          # UI entry (capabilities.ui.entry) — plain JS, React.createElement
├── icon.svg          # Plugin icon referenced by the manifest
├── locales/
│   ├── en.json       # English resources (i18n namespace: "template")
│   └── zh.json       # 中文资源
└── README.md
```

## Try it

Install from disk (development loop):

```bash
# Copy the folder into the app's plugins directory, then restart RelayCraft.
# {appData} is the OS app-data dir (e.g. ~/Library/Application Support/<bundle id> on macOS).
cp -R templates/plugin-template "{appData}/plugins/com.relaycraft.plugins.template"
```

Or package and install through the UI:

```bash
cd templates/plugin-template
zip -r ../../template-plugin.rcplugin .
# Then: Settings → Plugins → Install local plugin, or double-click the .rcplugin file.
```

Validate the manifest before packaging:

```bash
node scripts/validate-plugin-manifest.mjs templates/plugin-template
# or: pnpm validate:plugin templates/plugin-template
```

## Notes

- The plugin runtime has no bundler and no imports. Use
  `globalThis.RelayCraft.api` and `globalThis.React` (both provided by the
  host).
- Bump `version` per release and keep `engines.relaycraft` honest — the host
  refuses to load incompatible plugins.
- Declared permissions (`storage:read`, `storage:write`) gate
  `api.storage.*`; remove the demo counter if you don't need them.
