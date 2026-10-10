# Safe rule import & package manifest — design review

Status: proposal for review. Implements the gate described in
`sharing-migration-templates-plan.md` §1 ("Safe exchange foundation"). Per the
plan, the staging and group-file replacement strategy is exactly what this
document must get reviewed before implementation.

## 1. Problem statement

Three import paths exist today, with different semantics and different failure
modes:

| Path | Entry point | Semantics | Failure modes observed |
| --- | --- | --- | --- |
| JSON bundle (frontend) | `ruleStore.importBundle` | **Merge**: new ids, name dedup, group merge by name; then `save_all_rules` | Rides on backend write reliability below |
| YAML bundle (backend) | `storage.import_bundle` | **Restore**: per-rule `save()` in loop, then `save_groups(bundle.groups)` — *replaces* the entire groups file | Partial rule writes on mid-failure; existing groups silently clobbered by bundle groups |
| ZIP (backend) | `storage.import_zip` | **Raw restore**: stream-extract entries into the live rules dir | `File::create` truncates existing files in place; a `groups.yaml` entry overwrites the live groups file; no entry-count / decompressed-size limits (zip bomb); entry content is never parsed — malformed YAML lands on disk and surfaces later as `load_all` parse errors; mid-iteration failure leaves a partial import |

Cross-cutting gaps:

- `save_groups` uses plain `fs::write` — a failed write truncates the live
  groups file. `save()` is already atomic per file (tempfile + fsync + rename);
  `groups.yaml` needs the same treatment.
- `save_all_rules` (the frontend's batch save on every edit) loops `save()`
  then `save_groups()` — partial-write exposure exists on the normal save path
  too, not just import. Fixing `save_groups` removes the worst half of it.
- Trust boundary: nothing parses archive content before it reaches the live
  directory. Validation must complete before the first byte is written.

## 2. Goals and non-goals

Goals (from the plan's §1 acceptance list):

1. Read and validate every entry — limits, paths, decompressed bytes, semantic
   content — without modifying live rules.
2. Report id/name/group conflicts and unsupported actions; no implicit
   overwrite, no symlink traversal, no silent partial import.
3. Commit accepted results through staging/rollback that works on macOS,
   Windows and Linux. Preserve existing rules and groups, including merging a
   new group into an existing `groups.yaml`.

Non-goals:

- Multi-file atomicity. This is failure rollback for controlled writes (the
  same contract `commit_mock_rule_changes` already documents), not a
  transaction and not protection against a mid-commit crash.
- Freezing the internal `Rule` JSON/YAML as a stable public format. The
  manifest (§3) is the public contract; rule payload shape stays internal.
- Converting third-party formats. Adapters emit the same reviewed `ImportPlan`
  the safe importer consumes; format support is a separate gate.

## 3. Package manifest

One host-owned, versioned envelope for every distributable artifact. Live
location: `manifest.json` at archive root for ZIP packages; the same keys at
top level for single-file JSON artifacts.

```json
{
  "kind": "rule-template",
  "version": 1,
  "producer": { "name": "relaycraft", "source": "official" },
  "requires": { "host": ">=1.6.0", "capabilities": [] },
  "resources": [{ "type": "file", "path": "payloads/login.json", "for": "rule:r1" }],
  "created": "2026-10-10T00:00:00.000Z",
  "name": "Block tracking endpoints",
  "description": "..."
}
```

Field rules:

- `kind` ∈ `"rule-template" | "rule-bundle" | "diagnostic"`. `version` is
  per-kind integer, not semver.
- Unknown top-level keys are rejected (same strictness as
  `diagnosticPackage.parseDiagnosticPackage`).
- `requires.host` is checked against the app version; `capabilities` lists
  host permissions a template would need — surfaced in the preview UI before
  commit, never auto-granted.
- `resources` declares payload files inside the package (e.g. a file-backed
  Map Local body). A rule referencing a path outside `resources` is flagged
  as an external dependency in preview, not resolved silently.
- `producer` is informational provenance; it is not a signature. No trust
  decision is made from it in v1.

Open decision: the v1 diagnostic package already emits `kind`/`version` at top
level with a strict key allowlist. Either (a) grow its `PACKAGE_KEYS` to accept
the shared envelope fields as optional, or (b) bump it to `version: 2` once
envelope fields are added. Prefer (a) — optional fields keep today's files
valid.

## 4. Import pipeline: inspect → plan → commit

Two commands replace `import_rules_zip`'s write-through path:

```
preview_rules_import(path) -> ImportPreview        // phases A+B, zero writes
apply_rules_import(path, decisions) -> ImportResult // re-run A+B, then phase C
```

`apply` re-validates the artifact rather than trusting a serialized plan — the
artifact cannot be swapped for something unchecked between preview and apply,
and no staging-token lifecycle is needed.

### Phase A — inspect (read-only)

Enumerate archive entries under hard limits before reading bodies:

- max entry count, max per-entry and total decompressed bytes, max path depth
  and name length (rejects zip bombs and pathological trees)
- `enclosed_name()` rejects traversal; skip `__MACOSX`/dotfiles as today
- accept only `*.yaml`/`*.yml` rule files, `groups.yaml`, `manifest.json`;
  everything else is counted as skipped with a reason
- parse each rule file as `RuleFile` **in memory**; parse `groups.yaml` as
  `GroupsFile`; parse manifest if present

Output is an `ImportPlan` in memory: rules, groups, per-entry errors.

### Phase B — plan & conflicts

Diff the plan against `load_all()` + `load_groups()`:

- **id conflicts**: a rule id already on disk → `overwrite` candidate,
  requires explicit accept in the review UI (restore semantics; there is no
  implicit replace)
- **duplicate ids inside the archive** → hard error, listed in preview
- **name conflicts** → propose `name (n)` rename as the frontend merge path
  does today; shown in preview
- **groups**: incoming groups merge by name into existing groups (§5); rules
  referencing them are remapped
- **unsupported content**: unknown action/match types, or rules that fail
  model validation → per-item `skipped` with reason, not whole-import failure
- **resource requirements**: file-mode Map Local rules whose `localPath` is
  not satisfied by a declared package resource → flagged "manual fix needed"

`ImportPreview` = plan + conflicts + counts + `requires` from the manifest.
The review UI renders exactly this; commit is a separate user action.

### Phase C — commit with rollback

Ordered writes, all going through the atomic primitives:

1. Snapshot the bytes of every file that will be replaced or removed (rule
   files are small; in-memory is fine — no staging directory needed).
2. Write rule files via `save()` (already atomic per file), in plan order.
3. Write merged `groups.yaml` last, via an atomic `save_groups` (tempfile +
   fsync + rename — same pattern as `save()`).
4. On any failure: restore snapshotted files (and `groups.yaml`) in reverse
   order, collecting errors instead of failing fast. If rollback itself
   fails, report `partial: true` and emit `rules-changed` so the UI resyncs —
   identical to `commit_mock_rule_changes`' contract.
5. Refuse to delete a file whose bytes do not match what this import wrote
   (the `remove_staged_target` defense) when rolling back newly created
   files.

This reuses the machinery proven in `commit_mock_rule_changes`
(engine.rs): ordered atomic saves + snapshot restore + partial flag. That
function stays plugin-domain; the import version lives in `rules::storage`
and shares the same shape rather than being literally shared.

## 5. `groups.yaml` merge semantics

- Existing groups are never deleted or renamed by an import.
- Incoming groups match existing ones **by name**. A name hit maps incoming
  `group.id` → existing `group.id`; rules in that group join it.
- A new group name appends with `id = name` (the convention the frontend merge
  path already uses) and `enabled = true`, `priority = max + 1`.
- If the incoming group's `enabled` is `false`, preserve it — a bundle may
  deliberately ship a disabled group.
- Archive without `groups.yaml` → rules land in their directory-derived group
  names; those groups are created if absent (current behaviour, made
  explicit).
- Malformed `groups.yaml` entry → import fails at inspect, before any write.

## 6. Semantics split — keep both, surface explicitly

Two import semantics exist today and both are legitimate:

- **Merge** (JSON bundle): assign new ids, dedup names — "add these rules to
  what I have". Frontend-owned; unchanged.
- **Restore** (ZIP/YAML bundle): preserve ids and layout — "bring back what I
  exported". Backend-owned; this design makes its overwrites explicit through
  preview instead of implicit.

The preview UI labels which semantics apply ("Add N rules" vs "Restore N
rules, M over existing"). Conflating them is how implicit overwrites happen.

## 7. Changes by file

- `src-tauri/src/rules/storage.rs`: `inspect_zip`/`inspect_bundle` (phase A,
  pure), `plan_import` (phase B, pure — testable without fs), `commit_import`
  (phase C), atomic `save_groups`, `import_zip` delegates to the pipeline.
- `src-tauri/src/rules/commands.rs` + `lib.rs`: `preview_rules_import`,
  `apply_rules_import`; keep `import_rules_zip` as an alias calling
  apply-with-default-decisions for one release, or switch the frontend and
  drop it — decide at review.
- `src/components/rules/ImportRuleModal.tsx`: preview → accept → apply flow;
  ZIP path goes through it too.
- `src/lib/rules/importSource.ts`: unchanged seam — `legacy-zip` route now
  opens the preview step instead of committing directly.
- New i18n keys for the review UI in `zh.json`/`en.json`.

## 8. Acceptance mapping

| Plan acceptance | Covered by |
| --- | --- |
| Old ZIP/JSON fixtures round-trip with groups intact | fixture test: export → wipe → reimport → byte-compare load |
| Traversal, symlinks, dup ids, bomb, malformed content leave data unchanged | phase-A negative tests + on-disk byte snapshot comparison |
| Injected write failure preserves pre-existing rules/groups | `commit_import` with a failing `save_fn`, mirroring `commit_mock_rule_changes` tests |
| New group merges into existing `groups.yaml` | merge unit tests + a "bundle adds group to existing groups.yaml" fixture |
| UI reports precisely what applied | `ImportResult` carries per-item applied/skipped/failed + `partial` flag |

## 9. Open questions for review

1. Keep `import_rules_zip` as a compat alias or migrate the frontend and
   remove it? The plan leans "no silent partial import" — the old command's
   contract is exactly that, so removal after frontend migration is cleaner.
2. Should `apply_rules_import` re-load the store before planning (detect
   drift between preview and apply) or accept that the re-run plan *is*
   computed fresh anyway? Recommend the latter — it is already the case.
3. File-mode Map Local payloads shipped inside a template package: land them
   under `rules/` (engine-visible) or a dedicated `resources/` dir the rule
   references by relative path? Needs an engine-side answer on how
   `localPath` resolves.
