# Config snapshot import/export — design review

Status: proposal for review. Extends the manifest + inspect → plan → commit
contract from `safe-rule-import-design.md` to application settings, for the
1.7 "Trust, Audit & Security UX" goal of letting users carry their setup
between machines without leaking secrets or silently opening listeners.

## 1. Problem statement

Moving a RelayCraft setup to a new machine today means re-entering every
setting by hand, or copying `config.json` wholesale — which carries the
machine's ports, its certificate-ignore state, legacy plaintext AI keys, and
plugins the other machine may not have installed. Neither path is safe to
hand to a user.

A snapshot must answer three questions honestly:

- What travels (portable settings + plugin manifest).
- What stays (machine-bound fields: anything that opens a listener or is
  tied to this machine's security posture).
- What never leaves (AI keys, the MCP token — by value, not by promise).

## 2. Goals and non-goals

Goals:

1. Export a single self-describing file the user can inspect — JSON, no zip,
   no opaque blobs.
2. Import through the reviewed pipeline: preview (zero writes) → apply
   (re-validates the file, never trusts the serialized preview).
3. Restore plugin enabled state for installed plugins; list — never
   auto-install — missing ones.
4. Keep machine-bound fields local unless the user explicitly checks them in
   the preview.
5. Record every export/import in the structured audit log.

Non-goals:

- Rules, scripts, sessions, logs, certificates, and plugin code are **not**
  part of a v1 snapshot. Rules and scripts keep their own exchange paths;
  sessions are data, not configuration. Scope decision confirmed by the user.
- Cross-version migration of settings shape. `version` exists so a future
  breaking change can be rejected cleanly, not so v1 handles migration.
- Encrypted or password-protected snapshots. The file is plaintext by
  design; secrets are excluded rather than protected.

## 3. Manifest and snapshot schema

Same envelope as `safe-rule-import-design.md` §3, one JSON file:

```json
{
  "kind": "config-snapshot",
  "version": 1,
  "producer": { "name": "relaycraft", "source": "official", "app_version": "1.7.0" },
  "requires": { "host": ">=1.7.0" },
  "created": "2026-11-01T00:00:00.000Z",
  "name": "Work machine setup",
  "settings": {
    "language": "zh",
    "display_density": "comfortable",
    "always_on_top": false,
    "confirm_exit": true,
    "auto_start_proxy": false,
    "verbose_logging": false,
    "enable_vibrancy": true,
    "upstream_proxy": {
      "enabled": true,
      "url": "http://user:pass@proxy.internal:8080",
      "bypass_domains": "localhost,*.internal"
    },
    "plugin_registry_url": "...",
    "theme_registry_url": "...",
    "ai": {
      "enabled": true,
      "provider": "openai",
      "profile_id": null,
      "adapter_mode": null,
      "custom_endpoint": null,
      "model": "gpt-4o",
      "max_tokens": 4096,
      "temperature": 0.7,
      "enable_caching": true,
      "max_history_messages": 20
    },
    "share_upstream_url": "http://localhost:3000"
  },
  "machine_bound": {
    "proxy_port": 8866,
    "mcp_enabled": false,
    "mcp_port": 7090,
    "share_enabled": false,
    "share_port": 9080,
    "share_listen_lan": false,
    "disable_gpu_acceleration": false,
    "ssl_insecure": false
  },
  "plugins": [
    { "id": "mock-factory", "version": "1.2.0", "enabled": true }
  ]
}
```

Field rules:

- `kind` must be `config-snapshot`; unknown top-level keys are rejected, same
  strictness as the diagnostic package.
- `settings` may only contain keys from the portable allowlist below;
  `machine_bound` only keys from the machine-bound list. Unknown keys inside
  either object are **ignored and flagged** in the preview (forward
  compat for files from a newer app version), not rejected — the envelope's
  unknown-key rejection applies to the top level only.
- `requires.host` is compared against the app version; a newer requirement
  surfaces in preview as a blocking notice, same as rule packages.
- Secret keys (`settings.ai.api_key`, `api_key`, `mcp_token`, `token`,
  `password` — case-insensitive match on a denylist) anywhere under
  `settings` are ignored and reported in preview as
  "snapshot contains secret fields — ignored". The exporter never writes
  them; this covers hand-crafted or third-party files.
- `name`/`description` are display metadata only.

## 4. Field classification

Rule of thumb: **a field is machine-bound if applying it opens a listener or
is tied to this machine's security posture.** Everything else is portable.

Portable (`settings`):

- Preferences: `language`, `display_density`, `always_on_top`,
  `confirm_exit`, `auto_start_proxy`, `verbose_logging`, `enable_vibrancy`.
- `upstream_proxy` — exported **as-is**, including credentials embedded in
  `url` (`user:pass@host`). User decision: their file, their custody. The
  export UI must say "snapshot contains the upstream proxy password" when
  credentials are detected; the file save dialog is the warning.
- `plugin_registry_url`, `theme_registry_url`.
- `ai` — every `AIConfig` field **except** `api_key`, which is structurally
  absent (there is no key slot in the schema).
- `share.upstream_url` — a target string, not a listener; harmless while
  share is off, convenient next time it is enabled. Edge case: if share is
  already enabled locally pointing elsewhere, import changes the target
  (effective on next engine start); the preview diff makes this explicit.

Machine-bound (`machine_bound`, written for reference, kept local by default):

- `proxy_port`, `mcp_port`, `share_port` — port availability is machine
  state.
- `mcp_enabled`, `share_enabled`, `share_listen_lan` — importing a file must
  never open an inbound listener.
- `disable_gpu_acceleration` — driver/OS specific.
- `ssl_insecure`, `cert_warning_ignored` — certificate security posture
  belongs to the machine that decided it.

The preview lists machine-bound entries with current vs incoming values and
a per-field "apply anyway" checkbox — default unchecked. This is the only
escape hatch; there is no "apply all machine-bound" switch.

Never exported: AI key files, `config.ai_config.api_key`, the `mcp-token`
file, `enabled_plugins` raw (it becomes the `plugins` manifest instead).

## 5. Export pipeline

`export_config_snapshot(path, name)`:

1. Read `config.json` via the internal loader (not the frontend-facing
   sanitized copy) and split fields into `settings` / `machine_bound` per §4.
2. Build `plugins` from installed manifests ∩ `enabled_plugins` — each entry
   carries `id`, `version`, `enabled`. A plugin installed but disabled
   exports with `enabled: false`.
3. Serialize with `serde_json` (pretty) and write via tempfile + rename —
   no partial snapshot files.
4. Audit `snapshot.export` with counts: settings keys, plugins, and whether
   upstream-proxy credentials were included.

## 6. Import pipeline

```
preview_config_snapshot(path) -> SnapshotPreview
apply_config_snapshot(path, decisions) -> SnapshotImportResult
```

Phase A — inspect (zero writes): parse the file, enforce the envelope
(strict top-level keys, `kind`, `version`), compare `requires.host`, split
`settings`/`machine_bound` against the allowlists, strip denylisted secret
keys, resolve `plugins` against installed manifests.

Phase B — plan: diff each `settings` key against current config (current →
incoming pairs), classify machine-bound entries (shown, kept local unless
checked), bucket plugins into `restore` (installed) / `missing`
(needs marketplace install) / `already matching`. Output: `SnapshotPreview`
— nothing written.

Phase C — commit:

1. Snapshot the current `config.json` bytes in memory.
2. Apply selected settings onto a cloned `AppConfig`; write `config.json`
   via tempfile + fsync + rename.
3. Update `enabled_plugins` for the `restore` set only — enable listed
   plugins, never disable unlisted ones. (Restore-what's-listed semantics;
   a snapshot does not punish plugins the snapshot doesn't know about.)
4. On write failure restore the snapshot bytes; report `partial` the same
   way `commit_mock_rule_changes` does. There is exactly one file to roll
   back, so this stays simple.
5. Audit `snapshot.import` with applied/skipped counts; audit
   `snapshot.import.denied` for envelope/`requires` rejections.

Settings take effect on next read — same contract as `save_config` today;
no engine restart is triggered by import itself, and the preview result
says so for listener-bound fields.

## 7. UI

A "Config snapshot" card at the bottom of the security & privacy settings
page:

- Export: file-save dialog, writes the JSON. When upstream-proxy credentials
  are present, the card shows a one-line warning before export.
- Import: file picker → preview modal reusing the rule-import review layout:
  settings diff rows (current → incoming), machine-bound section with
  checkboxes, plugin restore/missing lists, secret-field-ignored notice.
  Apply button commits; nothing is written before it.

## 8. Changes by file

- `src-tauri/src/snapshot.rs` (new): schema types, `build_snapshot` /
  `inspect_snapshot` / `plan_import` (pure, fs-free core) / `commit_import`,
  commands `export_config_snapshot`, `preview_config_snapshot`,
  `apply_config_snapshot`; registered in `lib.rs`.
- `src-tauri/src/config.rs`: export the internal (unsanitized) config to the
  snapshot builder; atomic `config.json` write if not already atomic.
- `src/components/settings/privacy/ConfigSnapshotSection.tsx` (new) +
  preview modal; `PrivacySettings.tsx` mounts it.
- `src/locales/zh.json` / `en.json`: all UI strings.
- `src-tauri/src/audit.rs`: `snapshot.export`, `snapshot.import`,
  `snapshot.import.denied` actions.

## 9. Acceptance mapping

| Requirement | Covered by |
| --- | --- |
| Exported file never contains key material or the MCP token | schema has no secret slots + denylist test on the exporter output |
| Machine-bound fields never applied by default | plan applies only `settings`; unit test with all-boundary file |
| Apply re-validates, never trusts preview | `apply_config_snapshot` re-runs inspect+plan on the file |
| Failed config write restores original bytes | commit test with failing write closure |
| Missing plugins never auto-install | plan bucketing test + preview lists them only |
| Hand-crafted secrets in `settings` are ignored | denylist test on `inspect_snapshot` |
| `requires.host` newer than app blocks apply | version comparison test |

## 10. Open questions

1. Installed themes: include an `installed theme ids` informational list
   alongside `plugins`, or leave themes to their own path? No active-theme
   field exists in `AppConfig`; recommend leaving out of v1.
2. `requires.host` on export: stamp the exact app version (`>=1.7.0`) or a
   looser floor so a snapshot imports into an older-but-compatible build?
   Recommend the exact version — simpler to reason about.
3. Should importing a snapshot with `share_upstream_url` while share is
   already enabled apply it immediately, or require share to be off?
   Recommend: apply the value (preview shows it), engine picks it up on next
   start — no special-casing.
