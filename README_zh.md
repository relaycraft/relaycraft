# RelayCraft 🛰️

<p align="center">
  <strong>AI 原生网络流量调试工具</strong>
</p>

<p align="center">
  <img src="https://img.shields.io/github/v/release/relaycraft/relaycraft?style=for-the-badge&logo=tauri&color=blueviolet" alt="release">
  <img src="https://img.shields.io/github/stars/relaycraft/relaycraft?style=for-the-badge&logo=github&color=blue" alt="stars">
  <img src="https://img.shields.io/github/downloads/relaycraft/relaycraft/total?style=for-the-badge&logo=github&color=success" alt="downloads">
  <img src="https://img.shields.io/github/license/relaycraft/relaycraft?style=for-the-badge&color=orange" alt="license">
</p>

<p align="center">
  <a href="./README.md">English</a> | <a href="./README_zh.md">简体中文</a>
</p>

---

**RelayCraft** 是一款专为现代化开发设计的 AI 原生网络流量调试工具。基于 **Tauri**、**React** 和 **Rust** 构建，在提供专业级代理引擎能力的同时，深度融合 AI 能力与可扩展的插件体系 — 完全本地运行，无需注册账号。

> 🌟 **流量监控 · 规则引擎 · AI 助手 · MCP 服务器 · 断点调试 · 请求构造器 · 脚本支持 · 插件扩展**

## ✨ 为什么选择 RelayCraft？

- **🤖 全方位 AI 赋能**：用自然语言创建复杂的重写规则，一键诊断请求错误，用自然语言搜索流量。每个核心工作流都内置 AI 能力。
- **🔌 MCP 服务器**：通过 [Model Context Protocol](https://modelcontextprotocol.io) 将实时流量数据和规则管理开放给外部 AI 工具（Claude Desktop、Cursor 等），让 AI 助手直接参与你的调试工作流。
- **🏗️ 现代架构**：基于 Tauri 和 Rust 构建的高性能轻量核心，搭配工业级 **mitmproxy** 引擎，稳定可靠。
- **🛡️ 隐私优先**：数据完全属于你。离线运行、零账号、本地存储、支持本地 AI、开源可审计、无遥测追踪。
- **🐍 Python 脚本**：借助 mitmproxy 强大的 Python 生态编写自定义脚本，实现极高自由度的流量操控。
- **🎨 扩展与定制**：插件系统与全方位主题引擎，打造专属的现代化开发环境。

## 🚀 核心功能

### 📊 流量监控
- **多协议支持**：捕获并检查 HTTP、HTTPS 和 WebSocket 流量。
- **深度分析**：JSON 语法高亮、图片预览、时序分解。
- **智能筛选**：通过方法、域名、状态码或内容类型过滤，支持自定义查询语法。
- **便捷导出**：一键导出为 **cURL**、**HAR** 或 **Relay 会话** (.relay)。

### ⚙️ 规则引擎
通过可视化规则构建器管理流量行为，无需编写配置文件。支持 6 种规则类型：

| 动作 | 描述 |
| :--- | :--- |
| **本地映射 (Map Local)** | 返回自定义内容或重定向到本地文件。 |
| **远程映射 (Map Remote)** | 将流量转发到不同的 URL 或环境。 |
| **重写 Header** | 动态修改请求或响应的 Header。 |
| **重写 Body** | 修改请求或响应体内容（JSON / 正则 / 文本）。 |
| **弱网模拟** | 模拟慢速网络条件（3G、Edge 等）。 |
| **拦截请求** | 即时拦截并阻断匹配的请求。 |

规则会记录来源 — 手动创建、内置 AI 助手创建、还是外部 MCP 客户端创建 — 一目了然。

### 🧠 AI 助手
全局 **Ctrl(⌘) + K** 命令中心，AI 能力贯穿每个工作流：
- **自然语言建规则**：描述你的意图，AI 自动构建规则。
- **请求诊断**：一键智能分析失败请求，定位根因。
- **自然语言搜索**：用自然语言从流量列表中精准找到目标请求。
- **脚本生成**：从自然语言描述生成 Python mitmproxy 脚本。

### 🔌 MCP 服务器
RelayCraft 内置 **MCP（Model Context Protocol）服务器**，任何兼容的 AI 客户端均可连接并操作实时流量数据。

**只读工具**（无需认证，零配置即可使用）：
- `list_sessions` / `list_flows` / `get_flow` / `search_flows` / `get_session_stats` / `list_rules`

**写操作工具**（需要 Bearer Token，在设置 → 功能集成中查看）：
- `create_rule` — 用自然语言参数创建 6 种规则类型中的任意一种
- `delete_rule` / `toggle_rule` — 管理当前会话中的规则
- `replay_request` — 通过代理重放已捕获的请求

兼容 **Claude Desktop**、**Cursor**、**Windsurf** 以及所有支持 MCP HTTP Transport 的工具。

### 🛠️ 开发者工具
- **断点调试**：实时暂停、编辑并恢复请求或响应，完美支持边缘场景模拟。
- **请求构造器**：内置专为调试设计的 API 客户端（深度集成的 Postman 替代）。
- **脚本编辑器**：内置 CodeMirror 编辑器，支持 Python 语法高亮与独立脚本日志，即写即用。

## 🛠️ 快速开始

### 环境依赖
- **Node.js** (v18+) & pnpm
- **Rust** (stable toolchain)
- **Python** (v3.10+)

### 安装与运行
```bash
# 1. 克隆仓库
git clone https://github.com/relaycraft/relaycraft.git
cd relaycraft

# 2. 设置 Python 引擎
# 请参考 engine-core/README.zh-CN.md 中的说明
# 构建引擎并放置到指定目录。

# 3. 安装前端依赖
pnpm install

# 4. 启动开发模式
pnpm tauri dev
```

## 📦 下载
macOS、Windows 和 Linux 的预构建二进制文件可在 [Releases 页面](https://github.com/relaycraft/relaycraft/releases) 下载。

## 📖 社区与支持

- [**贡献指南**](CONTRIBUTING.md) — 了解如何参与项目贡献。
- [**商业使用**](COMMERCIAL.md) — 赞助与企业许可信息。
- [**插件仓库**](https://github.com/relaycraft/plugins) — 探索社区插件。

## 📄 许可证

RelayCraft 基于 **AGPLv3** 开源协议发布。详情请参阅 [LICENSE](LICENSE) 文件。

---

<p align="center">
  Crafted with ❤️ by the <a href="https://github.com/relaycraft">RelayCraft Team</a>.
</p>
