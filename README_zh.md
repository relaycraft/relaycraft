# RelayCraft 🛰️

<p align="center">
  <strong>下一代 AI 原生网络抓包与调试工具。</strong>
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

**RelayCraft** 是一款专为追求极致体验的开发者打造的现代化网络调试工具。基于 **Tauri**、**React** 和 **Rust** 构建，它在提供专业级代理引擎能力的同时，通过深度集成的 AI 能力革新了传统的调试工作流。

> 🌟 **前端与移动端开发者的神器**：在任何设备上轻松拦截、分析和重写 HTTP/HTTPS 流量。

## ✨ 为什么选择 RelayCraft？

RelayCraft 不仅仅是一个抓包工具，它是面向未来的 **AI 原生工作流**。

- **🤖 全方位 AI 赋能**：使用自然语言创建复杂的重写规则，智能分析请求错误，获取上下文相关的优化建议。
- **⚡ 极致性能**：得益于 Rust 核心和高性能的 **mitmproxy** 核心，代理开销几乎为零。
- **🐍 Python 脚本驱动**：利用 Python 生态系统的强大能力编写自定义脚本，灵活操控流量。
- **📦 插件生态系统**：通过灵活的插件架构扩展 UI 和后端逻辑，打造你的专属工具。
- **🛡️ 隐私优先**：默认完全离线运行。你的流量数据永远不会离开你的设备。支持通过 Ollama 连接本地大模型。
- **🎨 现代 UI/UX**：精心设计的深色模式界面，告别传统工具陈旧且复杂的交互体验。

## 🚀 核心功能

### 📊 流量监控
- **实时捕获**：零延迟检查 HTTP, HTTPS 和 WebSocket 流量。
- **深度分析**：支持 JSON 语法高亮、图片预览、详细的耗时分解。
- **智能筛选**：通过方法、域名、状态码或内容类型进行过滤，支持强大的查询语法。
- **便捷导出**：一键导出为 **cURL**, **HAR**，或复制为 fetch/axios 代码。

### ⚙️ 规则引擎
告别复杂的配置文件，通过可视化的规则构建器轻松管理流量行为。

| 动作 | 描述 |
| :--- | :--- |
| **本地映射 (Map Local)** | 将请求重定向到本地文件，便于离线开发与调试。 |
| **远程映射 (Map Remote)** | 将流量转发到不同环境（例如：生产环境 -> 开发环境）。 |
| **模拟响应 (Mock Response)** | 即时返回自定义的 JSON/XML/Text 响应数据。 |
| **重写 (Rewrite)** | 动态修改请求头、查询参数或响应体内容。 |
| **弱网模拟 (Throttling)** | 模拟慢速网络条件（如 3G、Edge、离线模式）。 |

### 🧠 AI 助手
- **命令中心**：按 `Ctrl+K` 唤醒 AI。告诉它“拦截所有分析脚本”或“模拟用户 API 返回 404”。
- **智能诊断**：选中一个失败的请求，通过 AI 询问“为什么这个请求失败了？”，获取详细的诊断报告。
- **脚本生成**：用自然语言描述你的逻辑，AI 将为你自动编写 Python 拦截脚本。

### 🛠️ 开发者工具
- **断点调试**：实时暂停、编辑并恢复请求/响应。
- **请求构造器**：内置专为调试设计的 API 客户端（类似 Postman，但深度集成）。
- **脚本编辑器**：内置 Monaco 编辑器，支持 TypeScript 提示，用于编写高级插件。

## 🛠️ 快速开始

### 环境依赖
- **Node.js** (v18+) & pnpm
- **Rust** (stable toolchain)
- **Python** (v3.10+)

### 安装与运行
```bash
# 克隆仓库
git clone https://github.com/relaycraft/relaycraft.git
cd relaycraft

# 安装依赖
pnpm install

# 启动开发模式
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
