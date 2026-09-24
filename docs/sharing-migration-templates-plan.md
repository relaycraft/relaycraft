# 1.6 Sharing, Migration & Templates: implementation plan

Status: staged delivery and remaining gates (2026-10). This document describes
RelayCraft product work, not RelayCore's engine roadmap. An item is not shipped
merely because its API or data type exists. Third-party rule converters are
deferred; the near-term migration work is an import-source processing seam.

## Outcome and scope

Help a user bring an existing HTTP debugging setup into RelayCraft, reproduce a
failure without sharing secrets, and reuse rules without depending on the
mitmproxy implementation. Ship local files and explicit review before any
online publishing or automatic execution. Do not create a second routing layer
for the Mock plugin.

There are three different artifacts; do not silently treat them as equivalent:

1. A **migration input** is a third-party file (HAR or a specific tool's rule
   export). It is read-only until a user approves a conversion report.
2. A **rule template** is a versioned, reviewed RelayCraft artifact. It carries
   capabilities, provenance, and external resource requirements. Installing it
   is not the same as enabling its rules.
3. A **diagnostic package** contains selected, sanitized observations and
   reproduction context. It must not contain runnable scripts or live secrets.

## Existing seams and known gaps

- The UI currently exports rules as ZIP; `RuleStorage::import_zip` writes YAML
  entries into the live rules directory and can overwrite existing files. It
  needs a safe import design before templates are distributed as ZIP files.
- Frontend JSON rule bundles and backend YAML/ZIP rule bundles are separate
  formats. JSON bundle export now preserves `ruleGroups` while retaining
  compatibility with legacy per-rule `groupId`; this does not turn either
  internal representation into a stable public template format.
- Session HAR import/export exists but is backed by `/_relay/*` in the Python
  engine. Normal HAR export is not a sanitized share package.
- Plugin `rules.createMock` supplies a host-visible API; API Workbench uses it.
  The host now exposes owner-checked `rules.disableMock` for plugins, and the
  official plugin offers that action on supported hosts. Neither command
  creates an independent Mock listener. `capabilities.logic.entry` is
  reserved, not an engine-side plugin execution surface today.
- Current scripts are mitmproxy Python. RelayCore scripts use Deno/V8.
  RelayCore's reverse + forward multi-listener, full HAR fidelity and
  script/rule behavior must be proven on the wire before promising parity.

## Delivery order and acceptance gates

### 1. Safe exchange foundation

Define a **host-owned, versioned package manifest** for rule templates and
diagnostic packages. It declares artifact kind/version, producer, required
capabilities, resource references, and compatibility. Existing JSON/YAML/ZIP
imports remain legacy inputs; a converter produces a reviewed candidate, not
an in-place rewrite. Do not freeze RelayCore's temporary internal Rule JSON.

Before distributing rules in archives, separate import into:

1. Read and validate all entries, limits, paths, actual decompressed bytes and
   semantic content without modifying live rules.
2. Present ID/name/group conflicts and unsupported actions. No implicit
   overwrite, symlink traversal, or successful partial import.
3. Commit the accepted result through a staging/rollback design that works on
   macOS, Windows and Linux. Preserve existing rules and groups, including
   when merging a new group into an existing `groups.yaml`. Do not ship an
   importer that rejects this normal migration scenario merely to avoid a
   difficult write.

Acceptance: old ZIP and JSON fixtures round-trip with group membership intact;
path traversal, symlinks, duplicate IDs, decompression abuse and malformed
content leave existing data unchanged; injecting a write failure preserves
pre-existing rules/groups; UI reports precisely what was and was not applied.
The staging and group-file replacement strategy requires a separate design
review before implementation.

### 2. Import-source processing seam (third-party conversion deferred)

Retain existing RelayCraft JSON/ZIP and HAR entry points, but route input
recognition through a source-specific preparation step before review and
commit. Do not change existing imports just to display an unsupported
third-party preset. HAR is traffic interchange, not rule migration.

After collecting real, redistributable or sanitized export fixtures for one
source tool, add its adapter at that step. The adapter returns a read-only
per-item result: exact mapping, manual adjustment, or unsupported, including
reasons. Reject invalid files without changing state. Imported rules are
disabled until reviewed and enabled. Never convert a file-serving Map Local
action into a response-body rewrite or assume third-party scripts are portable.

Acceptance for a future adapter: fixtures cover matching, ordering,
stop-on-match, mock, Map Local/Remote, unsupported predicates, conflicts and
repeat imports. Wire tests check behavior against the source fixture's
documented intent, not only successful deserialization. Without fixtures,
do not claim support for a third-party format.

### 3. Sanitized diagnostic package

First slice delivered: a single selected HTTP flow, local JSON file, method,
status and scheme only, plus an optional user-authored note. Fetch detail on
demand through the existing flow-service adapter; fail closed when it cannot
be fetched. Preview exact output before saving and reopen it in a **read-only**
viewer. The note is copied verbatim and explicitly requires human review.
This metadata-only package is not a replacement for a full HAR.

This first slice omits host, URL path/query, headers, cookies, bodies, files,
WebSocket/SSE messages, device/user identifiers and engine-specific metadata
altogether. A future richer package must sanitize those fields separately
and default to excluding unknown content; do not copy them from a raw HAR.
Do not upload packages or call an external service.

Acceptance for richer packages: synthetic secrets in every supported location
must be absent from final bytes, including HAR extension fields and nested
content. Tests must cover case variants, duplicates, encoding and malformed
data. Bound reads and output to prevent large sessions exhausting memory.
RelayCore's persistence redaction cannot substitute for export review.

### 4. Template reuse and Mock workflow

First slice delivered: two built-in rule drafts (exact-URL block and manual
JSON Mock), opened in the existing editor, not installed from ZIP; each
remains disabled after saving. Distributable file templates still require the
safe importer, dependency checks, capability review and conflict preview.
Keep Python and RelayCore JS script catalogs separate, labeled by engine and
execution permissions; defer executable installation until trust, review
and error reporting exist.

Extend the existing API Workbench's Mock workflow rather than create another
route CRUD system. `rules.createMock` creates a Map Local rule; owner-checked
`rules.disableMock` can stop it without modifying another plugin's rule.
The host retains ownership/provenance and should eventually explain which
entry/rule produced a response.
Call it a Mock **rule/workflow** in 1.6. An independently accessible Mock
Server requires RelayCore reverse + forward listener coexistence, lifecycle
and wire tests as a separate gate; do not use a Python-only listener shortcut.

Acceptance: a plugin-created mock can be updated/disabled without touching
other owners' rules, and its response is observed on the wire on each
supported engine. Official plugins remain independently packaged and use
public bridge contracts rather than monorepo-private imports.

## Commit and release discipline

Make one reviewed, tested commit per independently usable slice: exchange
compatibility, safe import, import-source seam, richer local diagnostic
packages, distributable templates and Mock workflow. Keep `src-tauri` Rust tests
and frontend tests green; run `cargo fmt`, `cargo test`, `pnpm lint`, behavior
tests, and `pnpm check:i18n` when translations change. Add cross-engine
contract fixtures at the adapter boundary, with live-wire assertions for
rules and Mock responses. Do not mark unsupported RelayCore behaviors stable.

Stop a slice rather than merging a compatibility regression, destructive
import path or privacy claim without a fixture-backed test. The near-term
scope is an import-source seam (not a source-tool converter), metadata-first
local diagnostic packages, curated **rule** drafts and a Mock rule workflow.
Third-party rule conversion, cross-engine script translation, cloud sharing
and an independent Mock listener are not 1.6 release promises.
