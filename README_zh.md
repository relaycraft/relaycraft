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

**RelayCraft** 是一款专为现代化开发设计的 AI 原生网络流量调试工具。基于 **Tauri**、**React** 和 **Rust** 构建，它在提供专业级代理引擎能力的同时，通过深度集成的 AI 能力革新了传统的调试工作流。

> 🌟 **面向现代开发的强大核心功能**：流量监控 + 规则引擎 + AI 助手 + 断点调试 + 请求构造器 + 脚本支持 + 扩展能力。

## ✨ 为什么选择 RelayCraft？

RelayCraft 不仅仅是一个抓包工具，它是面向未来的 **AI 原生工作流**。

- **🤖 全方位 AI 赋能**：使用自然语言创建复杂的重写规则，智能分析请求错误，获取上下文相关的优化建议。
- **⚡ 极致性能**：得益于 Rust 核心和高性能的 **mitmproxy** 核心，代理开销几乎为零。
- **🛡️ 安全与隐私**：你的数据，只属于你。完全离线运行、零账号体系、本地化存储、本地 AI 支持、开源可审计、无遥测追踪。
- **🐍 Python 脚本驱动**：利用 Python 生态系统的强大能力编写自定义脚本，灵活操控流量。
- **🎨 现代 UI/UX**：精心设计的深色模式界面，告别传统工具陈旧且复杂的交互体验。

## 🚀 核心功能

### 📊 流量监控
- **实时捕获**：零延迟检查 HTTP, HTTPS 和 WebSocket 流量。
- **深度分析**：支持 JSON 语法高亮、图片预览、详细的耗时分解。
- **智能筛选**：通过方法、域名、状态码或内容类型进行过滤，支持强大的查询语法。
- **便捷导出**：一键导出为 **cURL**, **HAR** 或 **Relay 会话** (.relay)。

### ⚙️ 规则引擎
告别复杂的配置文件，通过可视化的规则构建器轻松管理流量行为，支持 6 种强大的规则类型：

| 动作 | 描述 |
| :--- | :--- |
| **本地映射 (Map Local)** | 将请求重定向到本地文件或自定义内容。 |
| **远程映射 (Map Remote)** | 将流量转发到不同的 URL 或环境。 |
| **重写 Header (Rewrite Header)** | 动态修改请求或响应的 Header 信息。 |
| **重写 Body (Rewrite Body)** | 修改请求或响应体内容 (支持 JSON/正则/文本)。 |
| **弱网模拟 (Throttling)** | 模拟慢速网络条件 (如 3G、Edge 等)。 |
| **拦截请求 (Block Request)** | 即时拦截并阻止匹配的请求。 |

### 🧠 AI 助手
AI 全局感知，从请求分析到规则（脚本）创建，从智能搜索到智能正则，AI 无处不在，更有全局 **Ctrl(⌘) + K** 命令中心，做最懂你的工具。
- **自然语言创建**：使用自然语言描述即可快速创建复杂的重写规则或 Python 脚本。
- **智能诊断**：针对失败请求提供一键智能分析与诊断，快速定位问题根因。
- **自然语言搜索**：在请求列表中直接使用自然语言快速搜索目标请求。

### 🛠️ 开发者工具
- **断点调试**：实时暂停、编辑并恢复请求/响应，完美支持边缘场景模拟。
- **请求构造器**：内置专为调试设计的 API 客户端（类似 Postman，但深度集成）。
- **脚本编辑器**：内置 **CodeMirror** 编辑器，支持语法高亮与 Python 语法提示。支持脚本独立日志打印，即写即用。

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
# 请参考 [engine-core/README.zh-CN.md](engine-core/README.zh-CN.md) 
# 中的指南来构建并将引擎二进制/包放置在指定目录中。

# 3. 安装前端依赖
pnpm install

# 4. 启动开发模式
pnpm tauri dev
```

## 📦 下载
macOS, Windows 和 Linux 的预构建二进制文件可在 [Releases 页面](https://github.com/relaycraft/relaycraft/releases) 下载。

## 📖 社区与支持

- [**贡献指南**](CONTRIBUTING.md) - 了解如何帮助我们构建网络调试的未来。
- [**商业使用**](COMMERCIAL.md) - 关于赞助和企业许可的信息。
- [**插件仓库**](https://github.com/relaycraft/plugins) - 探索社区构建的插件。

## 📄 许可证

RelayCraft 根据 **AGPLv3** 许可证开源。详情请参阅 [LICENSE](LICENSE) 文件。

---

<p align="center">
  Crafted with ❤️ by the <a href="https://github.com/relaycraft">RelayCraft Team</a>.
</p>
