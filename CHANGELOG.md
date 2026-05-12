# Changelog

## [1.1.2](https://github-relaycraft/relaycraft/relaycraft/compare/v1.1.1...v1.1.2) (2026-05-13)


### Bug Fixes

* **notifications:** show plugin manifest names in the notification center and tighten panel density ([83d3847](https://github.com/relaycraft/relaycraft/commit/83d3847))
* **settings:** isolate the in-app updater dialog, dedupe release-note noise, and block dismiss during install ([8033be6](https://github.com/relaycraft/relaycraft/commit/8033be6))


### Chores

* relicense from AGPLv3 to GPLv3 ([2c6706d](https://github.com/relaycraft/relaycraft/commit/2c6706d))
* **release:** include package.json and tauri.conf.json in bump-extra-files ([7273aa6](https://github.com/relaycraft/relaycraft/commit/7273aa6))

## [1.1.1](https://github-relaycraft/relaycraft/relaycraft/compare/v1.1.0...v1.1.1) (2026-05-03)


### Bug Fixes

* avoid false restart prompts after app relaunch ([ed1755f](https://github-relaycraft/relaycraft/relaycraft/commit/ed1755f3018b1929c6f73c1361941f0b7e7fd921))
* **engine:** align response status/content-type handling with UI model ([42a9abf](https://github-relaycraft/relaycraft/relaycraft/commit/42a9abf66ee3058cff3d80c66b81d7abf9185d2d))
* **engine:** serialize flowdb maintenance writes to prevent sqlite locks ([3d0d7e7](https://github-relaycraft/relaycraft/relaycraft/commit/3d0d7e7bb5d94c4a2e1ab56d8debc6a3341c3495))
* **test:** repair mock paths and localStorage after module refactoring ([4ecd38e](https://github-relaycraft/relaycraft/relaycraft/commit/4ecd38e57ef6bec3c35de8726a31012e8195de85))


### Features

* enforce commit message quality gates and AI commit workflow ([209f98d](https://github-relaycraft/relaycraft/relaycraft/commit/209f98d493da8c0885a270c7e521f556fdd4881d))

All notable changes to this project will be documented in this file. See [release-it](https://github.com/release-it/release-it) for commit guidelines.

## [1.1.0](https://github.com/relaycraft/relaycraft/compare/v1.0.2...v1.1.0) (2026-04-19)


### Features

* complete tool-calling pipeline and stabilize assistant generation ([2615b8b](https://github.com/relaycraft/relaycraft/commit/2615b8ba14f8e7648c2445378b49b69f7fb7e14c))
* complete websocket edit and resend capability ([390ded7](https://github.com/relaycraft/relaycraft/commit/390ded7a6e653bc98aa9fb80ff14b4d8a6abac3d))
* consolidate command center and AI platform upgrades with safer execution routing ([ec08a3c](https://github.com/relaycraft/relaycraft/commit/ec08a3ca0480cba900a2803379ab3c471a7f7e5d))
* implement robust SSE event display and history replay capabilities ([e37b1a6](https://github.com/relaycraft/relaycraft/commit/e37b1a67ce659bc1e465dd12eda97eae6372db45))
* optimize ai provider architecture and switching behavior ([f389c74](https://github.com/relaycraft/relaycraft/commit/f389c747aedbe10015ba96098e702ba56fbaf9f5))


### Bug Fixes

* enforce storage permission checks with temporary storage allowlist ([52e1319](https://github.com/relaycraft/relaycraft/commit/52e1319ece4f39607b7f196a51178193dd7b815c))
* make command center answers safer with full traffic stats and conservative context carry ([17a00a1](https://github.com/relaycraft/relaycraft/commit/17a00a17f83bf2a30544d65d691d4c33ac074946))
* prevent duplicate ai context injection and harden ai usage fallback ([6499f3d](https://github.com/relaycraft/relaycraft/commit/6499f3d191c7992d9d1ef3f9474b8d8d4a90ca06))
* reduce GPU and compositing cost in the desktop shell ([40d9921](https://github.com/relaycraft/relaycraft/commit/40d992177db8ec73b7b134c28e3f023e09c9b855)), closes [#41](https://github.com/relaycraft/relaycraft/issues/41)

### [1.0.2](https://github.com/relaycraft/relaycraft/compare/v1.0.1...v1.0.2) (2026-04-14)


### Bug Fixes

* render telemetry URLs reliably in traffic views ([437270f](https://github.com/relaycraft/relaycraft/commit/437270f3483fd993ca42b53d379e953eb07e2349))


### Performance Improvements

* faster tab switches via mounted panels and selective store reads ([4319c0a](https://github.com/relaycraft/relaycraft/commit/4319c0a8032f1db5cc57ec0bf75b8134a99c004d))
* smoother traffic list scroll with fixed Virtuoso row height ([6844075](https://github.com/relaycraft/relaycraft/commit/6844075a0d4e30720c70780f9f6846ffeec5e8fb))

### [1.0.1](https://github.com/relaycraft/relaycraft/compare/v1.0.0...v1.0.1) (2026-04-06)


### Bug Fixes

* map Windows updater targets to specific -msi and -nsis keys to prevent cross-installation ([705c4ab](https://github.com/relaycraft/relaycraft/commit/705c4ab731a89305352323f546afbe940b3182dd))
* resolve broken theme preview images by allowing RelayCraft raw GitHub source in CSP ([047acad](https://github.com/relaycraft/relaycraft/commit/047acada84ee14c6b7a276af34379790d3b213c0))

## [1.0.0](https://github.com/relaycraft/relaycraft/compare/v1.0.0-rc.17...v1.0.0) (2026-04-05)


### Features

* add proxy engine crash notification and localization support ([8a06fa6](https://github.com/relaycraft/relaycraft/commit/8a06fa64f6382fe19d94c2da1a5df79e6d20402a))
* add translation workflow and scripts for Chinese release notes ([21a6b65](https://github.com/relaycraft/relaycraft/commit/21a6b652543cb6a703a4e1761256407ff92bdb23))

## [1.0.0-rc.17](https://github.com/relaycraft/relaycraft/compare/v1.0.0-rc.16...v1.0.0-rc.17) (2026-04-02)


### Features

* enhance plugin/theme installation feedback and UI navigation ([ee42480](https://github.com/relaycraft/relaycraft/commit/ee42480e68f2321e4fc683ed3d1c6bf8c79fc76b))
* finalize plugin api v1 capabilities ([aabba79](https://github.com/relaycraft/relaycraft/commit/aabba79f264c54fb10cad64128a39cfce71dcc74))

## [1.0.0-rc.16](https://github.com/relaycraft/relaycraft/compare/v1.0.0-rc.15...v1.0.0-rc.16) (2026-04-01)


### Bug Fixes

* avoid updater file lock failures on windows ([bd8212b](https://github.com/relaycraft/relaycraft/commit/bd8212bca88a4142fe1ae000a3d34e2748632577))
* improve plugin/theme install UX and i18n ([d000258](https://github.com/relaycraft/relaycraft/commit/d0002580a249dc288c229856c7ea1847c1f39dfc))
* polish install flow and audit logs ([2ed56b0](https://github.com/relaycraft/relaycraft/commit/2ed56b07bb325476eec9f272f2e237f1c910619d))

## [1.0.0-rc.15](https://github.com/relaycraft/relaycraft/compare/v1.0.0-rc.14...v1.0.0-rc.15) (2026-03-31)


### Features

* enhance rule management with conflict resolution and priority handling ([3b6f2ae](https://github.com/relaycraft/relaycraft/commit/3b6f2aeeab66c4908c6f215e70ca068babcf5947))

## [1.0.0-rc.14](https://github.com/relaycraft/relaycraft/compare/v1.0.0-rc.13...v1.0.0-rc.14) (2026-03-30)


### Features

* add proxy status retrieval and enhance plugin creator metadata in UI ([29c24ce](https://github.com/relaycraft/relaycraft/commit/29c24cef9bb4f14dc5050f6c7c74efb946f740d8))
* enhance plugin development documentation with shared components, icons, and CSS isolation guidelines ([3341102](https://github.com/relaycraft/relaycraft/commit/3341102a5ea84e8fddc07568d2352367182b22b7))
* implement plugin context menu and storage functionality with HTTP request support ([0db377a](https://github.com/relaycraft/relaycraft/commit/0db377a9c15b4767ba88cba021561e78883fa427))


### Bug Fixes

* normalize floating element opacity and script logging under vibrancy ([69c4f78](https://github.com/relaycraft/relaycraft/commit/69c4f7812cbb7be5fa8a82f51f9f8d9aa6bd887b))

## [1.0.0-rc.13](https://github.com/relaycraft/relaycraft/compare/v1.0.0-rc.12...v1.0.0-rc.13) (2026-03-26)


### Features

* enhance search_flows and replay_request tools with additional parameters and improved functionality ([5f6fd77](https://github.com/relaycraft/relaycraft/commit/5f6fd77f785ecd86199f1e9ef17310201d2a6d76))
* enhance WebSocket handling with new hooks and improved frame storage ([04ec5b6](https://github.com/relaycraft/relaycraft/commit/04ec5b61f7f5558dd19ed1305d6033ec2eb893c9))
* implement vibrancy-aware CSS overrides and adjust color variables for improved visual clarity ([b21405a](https://github.com/relaycraft/relaycraft/commit/b21405a4b8c0007fb511f1ba6eac105394b37d38))

## [1.0.0-rc.12](https://github.com/relaycraft/relaycraft/compare/v1.0.0-rc.11...v1.0.0-rc.12) (2026-03-24)


### Features

* enhance splash screen design with new animations and improved theme variables ([eaa0826](https://github.com/relaycraft/relaycraft/commit/eaa08265ad33d2488108515793fc58a77c35b55e))
* implement deep search functionality for flow bodies and headers ([dcca5bd](https://github.com/relaycraft/relaycraft/commit/dcca5bd81b1fc10c99f03a51b0e84a30c05b176f))


### Bug Fixes

* prevent Windows auto-update file write failures by stopping proxy before install ([8ff6bda](https://github.com/relaycraft/relaycraft/commit/8ff6bda0878160bb9556a511d60a4b13f484f070))
* reduce window vibrancy flicker by debouncing update calls ([baa25bc](https://github.com/relaycraft/relaycraft/commit/baa25bc2f7a444f3af986e0602b38e42c056753b))
* trim whitespace from upstream proxy URL checks [#23](https://github.com/relaycraft/relaycraft/issues/23) ([c9ea052](https://github.com/relaycraft/relaycraft/commit/c9ea052fd94ee1aaf173ec7b9abe2ae336b414bb))

## [1.0.0-rc.11](https://github.com/relaycraft/relaycraft/compare/v1.0.0-rc.10...v1.0.0-rc.11) (2026-03-18)


### Features

* enhance MCP Server with token management and rule metadata tracking ([9fac284](https://github.com/relaycraft/relaycraft/commit/9fac284fff2fb96f74506d23b9128592ec7bb474))

## [1.0.0-rc.10](https://github.com/relaycraft/relaycraft/compare/v1.0.0-rc.9...v1.0.0-rc.10) (2026-03-12)


### Bug Fixes

* fix plugin JS execution blocked by production CSP ([4135ab0](https://github.com/relaycraft/relaycraft/commit/4135ab084e0a5e9af3c50a966a11ec6a8185d998))

## [1.0.0-rc.9](https://github.com/relaycraft/relaycraft/compare/v1.0.0-rc.8...v1.0.0-rc.9) (2026-03-12)


### Features

* add MCP Server to expose traffic data to external tools ([8f46f55](https://github.com/relaycraft/relaycraft/commit/8f46f5512141f0e777e7bf33df25dc13590ea702))


### Bug Fixes

* correct flow timing calculation for receive and connection reuse ([0dfe6fb](https://github.com/relaycraft/relaycraft/commit/0dfe6fb18c759fd54ff6db0911ba78c2262bf4db))
* implement Linux-specific memory usage tracking with RssAnon ([f4f3a69](https://github.com/relaycraft/relaycraft/commit/f4f3a699f251847483c05de11c7e0e1576d5794f))
* patch path traversal, zip-bomb, and selectFlow race condition ([9f26459](https://github.com/relaycraft/relaycraft/commit/9f2645984d2c652cbb8c29ccf28ef17345d3d23e))

## [1.0.0-rc.8](https://github.com/relaycraft/relaycraft/compare/v1.0.0-rc.7...v1.0.0-rc.8) (2026-03-06)


### Features

* enhance Linux UI/UX and packaging, refactor styles, and fix logger ([e804e02](https://github.com/relaycraft/relaycraft/commit/e804e0259a2137ed71b8d39f76aef62f1d341894))


### Bug Fixes

* remove obsolete commands and correct navigation targets ([4bbb8e7](https://github.com/relaycraft/relaycraft/commit/4bbb8e768aa1a119b948c74eb2cc09372a90e68b))


### Performance Improvements

* optimize flow processing and error handling ([bd6132d](https://github.com/relaycraft/relaycraft/commit/bd6132da4d43a79bc04ef41a71810565f41b4aa7))

## [1.0.0-rc.7](https://github.com/relaycraft/relaycraft/compare/v1.0.0-rc.6...v1.0.0-rc.7) (2026-03-05)


### Features

* enforce strict CSP and formalize internal TLS bypass ([31267d8](https://github.com/relaycraft/relaycraft/commit/31267d843b41a6fe64246766f29883310292dc53))

## [1.0.0-rc.6](https://github.com/relaycraft/relaycraft/compare/v1.0.0-rc.5...v1.0.0-rc.6) (2026-03-04)


### Features

* improve robustness for rule import and config initialization ([c9d0b87](https://github.com/relaycraft/relaycraft/commit/c9d0b873577d2821c5e96d907743f80308cb8dc1))
* truncate large responses to prevent UI freezing ([ed41ac1](https://github.com/relaycraft/relaycraft/commit/ed41ac11124f6e66c6cdd304764e9e467f190d4b))

## [1.0.0-rc.5](https://github.com/relaycraft/relaycraft/compare/v1.0.0-rc.4...v1.0.0-rc.5) (2026-03-03)


### Performance Improvements

* optimize large .relay and .har file imports using ijson streaming and async background threads ([50ca4e8](https://github.com/relaycraft/relaycraft/commit/50ca4e849ba77456f0eb598cbfb3ae418ba2d788))

## [1.0.0-rc.4](https://github.com/relaycraft/relaycraft/compare/v1.0.0-rc.3...v1.0.0-rc.4) (2026-03-01)


### Features

* add image preview support in request composer ([bd2f01d](https://github.com/relaycraft/relaycraft/commit/bd2f01d3dceacbf9f126f9215adbb7c9d42ebb97))
* enhance vibrancy effect and fix rendering issues ([ddeb2d8](https://github.com/relaycraft/relaycraft/commit/ddeb2d87b5737acb455842cb8223f5a50fba9ae7))

## [1.0.0-rc.3](https://github.com/relaycraft/relaycraft/compare/v1.0.0-rc.2...v1.0.0-rc.3) (2026-02-27)


### Features

* implement cross-platform vibrancy support and refactor window logic ([406504e](https://github.com/relaycraft/relaycraft/commit/406504ef0e0f900397f8d172cada5873dcfe505f)), closes [#17](https://github.com/relaycraft/relaycraft/issues/17)

## [1.0.0-rc.2](https://github.com/relaycraft/relaycraft/compare/v1.0.0-rc.1...v1.0.0-rc.2) (2026-02-26)


### Bug Fixes

* bypass internal relay traffic overhead and standardize issue intake ([44b4368](https://github.com/relaycraft/relaycraft/commit/44b4368f56e53a5e8cb18ec74221aa698c7050da))
* harden import flow and engine script runtime ([3126a80](https://github.com/relaycraft/relaycraft/commit/3126a8064de292866d5b9b5cd4e9a93d1081f4b2))

## [1.0.0-rc.1](https://github.com/relaycraft/relaycraft/compare/v1.0.0-rc1...v1.0.0-rc.1) (2026-02-25)

> [!IMPORTANT]
> **🎉 版本格式升级：需手动更新**
> 由于本版本开始采用标准 SemVer 格式 (`v1.0.0-rc.1`)，目前处在 `v1.0.0-rc1` (不带点)的用户**无法**通过应用内自动更新。请前往 [GitHub Releases](https://github.com/relaycraft/relaycraft/releases) 页面手动下载最新安装包进行覆盖安装。

### Features

* display build date, optimize script hit icon and upstream status ([51cf8a4](https://github.com/relaycraft/relaycraft/commit/51cf8a4f69e9e0ad90be81ae10a469e41b08cd30))
* improve audit logging and system stability ([7f92520](https://github.com/relaycraft/relaycraft/commit/7f92520e67273443e64df8a57444853c221bf087))
* restructure settings UI and overhaul license management ([99599b0](https://github.com/relaycraft/relaycraft/commit/99599b0ea56227bf8cc4a74873b38985e145f8d3))


### Bug Fixes

* improve script logging and suppress windows asyncio errors ([fcfea1c](https://github.com/relaycraft/relaycraft/commit/fcfea1ce39149986181f7f3db8aa2b2756546d69))


### Performance Improvements

* optimize database persistence and add notification system ([c2a879b](https://github.com/relaycraft/relaycraft/commit/c2a879b56cd86e1f86b510a2fe0b486227f63bfc))

## 1.0.0-rc1 (2026-02-24)

### Features
* Initial Release Candidate for RelayCraft
