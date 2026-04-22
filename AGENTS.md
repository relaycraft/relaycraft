# AGENTS.md — RelayCraft AI Contract

This file defines repository-level constraints for all AI coding tools.

## 1) Instruction Priority

1. User request in current conversation
2. This `AGENTS.md`
3. Repository source code and tests
4. Other docs (`skills/`, `CONTRIBUTING`, local notes)

If instructions conflict, follow the higher-priority item and explain the conflict briefly.

## 2) Core Engineering Rules

1. **i18n required**: all user-facing text must use `t()`; update `zh.json` and `en.json` together.
2. **Zustand selector only**: use selector subscriptions, avoid full-store subscriptions.
3. **UI style**: Tailwind utilities + `cn()` first; avoid unnecessary custom CSS.
4. **Tauri command registration**: every new command must be added to `src-tauri/src/lib.rs` `invoke_handler`.
5. **Python hook safety**: top-level `try/except`; exceptions must not escape hook boundary.
6. **Commit types**: only `feat`, `fix`, `refactor`, `style`, `chore`, `docs`, `perf`.

## 3) Architectural Boundaries

- `src/`: React + TypeScript frontend
- `src-tauri/`: Rust/Tauri backend
- `engine-core/`: Python engine
- Flow interception/modification logic belongs to engine layer, not duplicated in host UI/backend.
- Flow persistence submodules under `engine-core/addons/core` must use
  `addons.core.flowdb.*` import paths.

## 4) Execution Contract for AI Agents

- Read relevant code before editing.
- Prefer smallest complete change that satisfies the request.
- Reuse existing patterns before introducing new abstractions.
- Do not make unrelated refactors in the same change.
- When uncertainty affects behavior, ask once with concrete options.

## 5) Validation Baseline

- Frontend: `pnpm lint` (and `pnpm test` when behavior changes)
- Rust: `cargo fmt` and `cargo test` in `src-tauri/` when Rust code changes
- i18n: `pnpm check:i18n` when text/translation keys change

If full validation is not run, explicitly report what was skipped.

## 6) Cross-Tool Compatibility

- Keep guidance tool-agnostic: no dependency on a single IDE or assistant runtime.
- Do not require `.cursor/` or `.ai/` content for repository correctness.
- Local private workspace files (`.ai/`, `.cursor/`) must remain out of git.
- Document durable, repository-wide rules here; keep ephemeral notes local.
