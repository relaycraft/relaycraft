# Changelog

All notable changes to this project will be documented in this file. See [standard-version](https://github.com/conventional-changelog/standard-version) for commit guidelines.

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

## [1.0.0-rc.7](https://github-relaycraft/relaycraft/relaycraft/compare/v1.0.0-rc.6...v1.0.0-rc.7) (2026-03-05)


### Features

* enforce strict CSP and formalize internal TLS bypass ([31267d8](https://github-relaycraft/relaycraft/relaycraft/commit/31267d843b41a6fe64246766f29883310292dc53))

## [1.0.0-rc.6](https://github-relaycraft/relaycraft/relaycraft/compare/v1.0.0-rc.5...v1.0.0-rc.6) (2026-03-04)


### Features

* improve robustness for rule import and config initialization ([c9d0b87](https://github-relaycraft/relaycraft/relaycraft/commit/c9d0b873577d2821c5e96d907743f80308cb8dc1))
* truncate large responses to prevent UI freezing ([ed41ac1](https://github-relaycraft/relaycraft/relaycraft/commit/ed41ac11124f6e66c6cdd304764e9e467f190d4b))

## [1.0.0-rc.5](https://github-relaycraft/relaycraft/relaycraft/compare/v1.0.0-rc.4...v1.0.0-rc.5) (2026-03-03)


### Performance Improvements

* optimize large .relay and .har file imports using ijson streaming and async background threads ([50ca4e8](https://github-relaycraft/relaycraft/relaycraft/commit/50ca4e849ba77456f0eb598cbfb3ae418ba2d788))

## [1.0.0-rc.4](https://github-relaycraft/relaycraft/relaycraft/compare/v1.0.0-rc.3...v1.0.0-rc.4) (2026-03-01)


### Features

* add image preview support in request composer ([bd2f01d](https://github-relaycraft/relaycraft/relaycraft/commit/bd2f01d3dceacbf9f126f9215adbb7c9d42ebb97))
* enhance vibrancy effect and fix rendering issues ([ddeb2d8](https://github-relaycraft/relaycraft/relaycraft/commit/ddeb2d87b5737acb455842cb8223f5a50fba9ae7))

## [1.0.0-rc.3](https://github-relaycraft/relaycraft/relaycraft/compare/v1.0.0-rc.2...v1.0.0-rc.3) (2026-02-27)


### Features

* implement cross-platform vibrancy support and refactor window logic ([406504e](https://github-relaycraft/relaycraft/relaycraft/commit/406504ef0e0f900397f8d172cada5873dcfe505f)), closes [#17](https://github-relaycraft/relaycraft/relaycraft/issues/17)

## [1.0.0-rc.2](https://github-relaycraft/relaycraft/relaycraft/compare/v1.0.0-rc.1...v1.0.0-rc.2) (2026-02-26)


### Bug Fixes

* bypass internal relay traffic overhead and standardize issue intake ([44b4368](https://github-relaycraft/relaycraft/relaycraft/commit/44b4368f56e53a5e8cb18ec74221aa698c7050da))
* harden import flow and engine script runtime ([3126a80](https://github-relaycraft/relaycraft/relaycraft/commit/3126a8064de292866d5b9b5cd4e9a93d1081f4b2))

## [1.0.0-rc.1](https://github-relaycraft/relaycraft/relaycraft/compare/v1.0.0-rc1...v1.0.0-rc.1) (2026-02-25)

> [!IMPORTANT]
> **🎉 版本格式升级：需手动更新**
> 由于本版本开始采用标准 SemVer 格式 (`v1.0.0-rc.1`)，目前处在 `v1.0.0-rc1` (不带点)的用户**无法**通过应用内自动更新。请前往 [GitHub Releases](https://github.com/relaycraft/relaycraft/releases) 页面手动下载最新安装包进行覆盖安装。

### Features

* display build date, optimize script hit icon and upstream status ([51cf8a4](https://github-relaycraft/relaycraft/relaycraft/commit/51cf8a4f69e9e0ad90be81ae10a469e41b08cd30))
* improve audit logging and system stability ([7f92520](https://github-relaycraft/relaycraft/relaycraft/commit/7f92520e67273443e64df8a57444853c221bf087))
* restructure settings UI and overhaul license management ([99599b0](https://github-relaycraft/relaycraft/relaycraft/commit/99599b0ea56227bf8cc4a74873b38985e145f8d3))


### Bug Fixes

* improve script logging and suppress windows asyncio errors ([fcfea1c](https://github-relaycraft/relaycraft/relaycraft/commit/fcfea1ce39149986181f7f3db8aa2b2756546d69))


### Performance Improvements

* optimize database persistence and add notification system ([c2a879b](https://github-relaycraft/relaycraft/relaycraft/commit/c2a879b56cd86e1f86b510a2fe0b486227f63bfc))

## 1.0.0-rc1 (2026-02-24)

### Features
* Initial Release Candidate for RelayCraft
