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
7. **Commit message quality**:
   - If commitlint length checks fail, rewrite into a shorter message; do not solve by forced line breaks.
   - Keep subject concise and meaningful; include a body only when it adds real context.
   - Do not add trailing reference blocks (for example `Refs:`) unless explicitly requested by the user.

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

## 7) Learned User Preferences

- Prefer Chinese replies unless the user explicitly asks for English.
- Commit/PR text must not mention internal planning artifacts (`.ai/`, phase labels, internal version-window names); describe user-facing outcomes only.
- Prefer root-cause diagnosis over arbitrary caps or band-aids when fixing performance or long-running lag.
- Prefer minimal UI scope: fix the specific surface; do not globally restyle shared modals/components unless asked.
- Prefer simpler, industry-common first scopes for protocol features over over-engineered v1 designs.

## 8) Learned Workspace Facts

- Product site: https://relaycraft.dev; main repo: https://github.com/relaycraft/relaycraft; plugins repo: https://github.com/relaycraft/relaycraft-plugins (not `relaycraft/plugins`).
- MCP Server is a core product capability for AI-assisted HTTP traffic debugging, not a side experiment.
- Proxy engine is mitmproxy-based; engine evolution should treat mitmproxy forward/reverse (multi-mode) patterns as the industry reference.
- Gateway / reverse-proxy: compose local rules and env, then expose that environment via reverse entry; traffic-path explainability (how Map Local/Remote, upstream proxy, and gateway interact) is a durable UX principle—not a one-off page.
- Published official plugins are independent repos; do not rely on local monorepo path coupling for shared styles or assets—use explicit host/public contracts.
- Windows updater: NSIS/EXE is always published; MSI may be absent on prerelease—do not cross-assign installer channels.
- Do not reintroduce bundle id `com.beta.relaycraft`; treat current bundle id / app data paths as source of truth when touching identity or installers.
- Long-running stability matters: upgrade paths, unbounded session/DB growth, and surfacing engine/script errors in UI without requiring log diving.
