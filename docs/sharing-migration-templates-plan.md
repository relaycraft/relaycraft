# 1.6 Sharing, Migration & Templates: implementation plan

Status: proposed scope and delivery gates (2026-10). This document describes
RelayCraft product work, not RelayCore's engine roadmap. An item is not shipped
merely because its API or data type exists.

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
- Plugin `rules.createMock` already supplies a stable host-visible API; the
  official API Workbench uses it. `capabilities.logic.entry` is reserved, not
  an engine-side plugin execution surface today.
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

### 2. Common-tool migration

Start with HAR as the traffic interchange route already supported by the app.
Do not confuse importing traffic with migrating proxy rules. For rules, choose
one source tool only after collecting its real, redistributable or sanitized
export fixtures and a documented mapping of its matching/action semantics.
No fixture means no claim of support for that format. Preference should be
based on actual user demand and sample availability, not a guessed parser.

Deliver a read-only preview with a per-item result: exact mapping, manual
adjustment, or unsupported, including reasons. Reject invalid files without
changing state. Imported rules are disabled until the user reviews and enables
them. Never convert a file-serving Map Local action into a response-body rewrite
or assume an arbitrary third-party script is portable.

Acceptance: fixtures cover simple matching, ordering, stop-on-match, mock,
Map Local/Remote, unsupported predicates, conflict with existing rules and
repeat imports. A round-trip test checks the resulting behavior against the
source fixture's documented intent, not only successful deserialization.

### 3. Sanitized diagnostic package

First release: explicitly selected HTTP flows, local file only, sanitized
request/response metadata and a short user-authored reproduction note. Fetch
details on demand through an adapter: neither the frontend's currently loaded
flows nor the legacy Python database is the export source of truth. A package
can be reopened in a **read-only** viewer; it does not replay requests.

Default to excluding bodies, files, binary/encoded payloads, WebSocket/SSE
messages, credentials, device/user identifiers and engine-specific metadata.
Sanitize URLs (including query strings), headers, cookies, redirects and
allowed textual fields separately. Unknown media types or parse errors fail
closed. Show the exact final contents and a residual-risk warning before
writing. Do not upload packages or call an external service.

Acceptance: synthetic secrets in each supported location are absent from the
final bytes, including HAR extension fields and nested content. Tests cover
case variants, duplicate headers, URL encoding, base64 and malformed data.
Bounded reads and output prevent large sessions from exhausting memory.
RelayCore's persistence redaction is a separate layer and cannot substitute
for export review.

### 4. Template reuse and Mock workflow

Ship curated rule templates only after the safe importer exists. Preview
required local files, missing engine capabilities and resulting rule
conflicts; install disabled, with an explicit enable step. Keep Python and
RelayCore JS script catalogs separate, labeled by engine and execution
permissions; defer executable script installation until host-level trust,
review and error reporting exist.

Extend the existing API Workbench's Mock workflow rather than create another
route CRUD system. `rules.createMock` creates a Map Local rule; the host retains
ownership/provenance and can explain which entry/rule produced the response.
Call it a Mock **rule/workflow** in 1.6. An independently accessible Mock
Server requires RelayCore reverse + forward listener coexistence, lifecycle
and wire tests as a separate gate; do not use a Python-only listener shortcut.

Acceptance: a plugin-created mock can be updated/disabled without touching
other owners' rules, and its response is observed on the wire on each
supported engine. Official plugins remain independently packaged and use
public bridge contracts rather than monorepo-private imports.

## Commit and release discipline

Make one reviewed, tested commit per independently usable slice: exchange
compatibility, safe import, first source converter, local diagnostic package,
curated templates, and Mock workflow. Keep the existing `src-tauri` Rust tests
and frontend tests green; run `cargo fmt`, `cargo test`, `pnpm lint`, behavior
tests, and `pnpm check:i18n` when translations change. Add cross-engine
contract fixtures at the adapter boundary, with live-wire assertions for
rules and Mock responses. Do not mark unsupported RelayCore behaviors stable.

Stop a slice rather than merging a compatibility regression, destructive
import path or privacy claim without a fixture-backed test. The proposed
October scope is one source-tool rule converter, local diagnostic packages,
curated **rule** templates and a Mock rule workflow. Cross-engine script
translation, cloud sharing and an independent Mock listener are not 1.6
release promises.
