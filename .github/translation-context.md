# Release 翻译参考（给 LLM，非用户文档）

维护者可在发版前更新本文件，帮助 Release 中译统一产品名、功能名与语气。

## 产品

- **RelayCraft**：跨平台网络流量调试工具；对标 Charles / Fiddler；强调 AI 原生、本地优先、零遥测。
- 官网文案常用：**AI-Native Web Traffic Debugging Tool** → 可译为「AI 原生的 Web 流量调试工具」等，与下列术语保持一致即可。

## 技术与栈（译名或保留英文）

- **Tauri**、**React**、**Rust**、**mitmproxy**、**Vite**、**Zustand** — 一般保留英文。
- **MCP** / **Model Context Protocol** — 可写「MCP（模型上下文协议）」首次出现时，或保留 MCP。
- **Plugin / 插件**、**Theme / 主题**、**Rule / 规则**、**Session / 会话**、**Flow / 流量条目**（按界面语境选择）。

## 功能模块（与 UI / 文档对齐）

- **Traffic Monitor** — 流量监控
- **Rules Engine** — 规则引擎
- **AI Assistant** — AI 助手
- **Breakpoints** — 断点调试
- **Request Composer** — 请求构造器
- **Scripting**（mitmproxy / Python）— 脚本
- **SSL / CA / Certificate** — 证书、安装并信任证书等

## 规则类型（若 Release 提及）

- map_local / map_remote / rewrite_header / rewrite_body / throttle / block_request — 已有中文界面译法时请与 `src/locales/zh.json` 一致。

## 语气

- 面向开发者：简洁、专业；不夸大营销；安全与隐私相关表述需准确（本地存储、无遥测等）。
