# RelayCraft 🛰️

<p align="center">
  <strong>AI-Native Web Traffic Debugging Tool</strong>
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

**RelayCraft** is a powerful, AI-native network debugging tool designed for modern development. Built with **Tauri**, **React**, and **Rust**, it bridges the gap between professional-grade proxy engines and modern developer experience with deep AI integration.

> 🌟 **Powerful Features for Modern Development**: Traffic Monitor + Rules Engine + AI Assistant + Breakpoints + Request Composer + Python Scripting + Extensibility.

## ✨ Why RelayCraft?

RelayCraft isn't just another proxy tool. It's an **AI-native workflow** for the modern web.

- **🤖 AI-Native Everything**: Create complex rewrite rules using natural language, analyze requests intelligently, and get context-aware suggestions.
- **⚡ Performance First**: Near-zero overhead proxying thanks to the Rust core and a high-performance **mitmproxy**-based sidecar.
- **🛡️ Security & Privacy**: Your data, only yours. Fully Offline, Zero Accounts, Local Storage, Local AI Support, Open Source, and No Telemetry.
- **🐍 Python Powered**: Write custom scripts to manipulate traffic with the full power of the Python ecosystem.
- **🎨 Modern UI/UX**: A premium, dark-mode-first interface that says goodbye to outdated tool aesthetics.

## 🚀 Key Features

### 📊 Traffic Monitor
- **Real-time Capture**: Inspect HTTP, HTTPS, and WebSocket traffic with zero latency.
- **Rich Analysis**: JSON syntax highlighting, image preview, and detailed timing breakdowns.
- **Smart Filtering**: Filter by method, domain, status, or content type with powerful query syntax.
- **Export Options**: One-click export to **cURL**, **HAR**, or **Relay Session** (.relay).

### ⚙️ Rules Engine
Say goodbye to complex configurations. Manage traffic behavior with a visual rule builder with 6 powerful rule types:

| Action | Description |
| :--- | :--- |
| **Map Local** | Redirect requests to local files or custom content. |
| **Map Remote** | Forward traffic to different URLs or environments. |
| **Rewrite Header** | Modify request or response headers dynamically. |
| **Rewrite Body** | Change request/response content (JSON/Regex/Text). |
| **Throttling** | Simulate slow network conditions (3G, Edge, etc.). |
| **Block Request** | Intercept and block matching requests instantly. |

### 🧠 AI Assistant
AI is everywhere — from request analysis to rule/script creation, from smart search to intelligent regex. Global **Ctrl(⌘) + K** command center makes it the tool that understands you best.
- **Natural Language Creation**: Create complex rewrite rules or Python scripts using plain English.
- **Intelligent Analysis**: One-click diagnostics for failed requests to understand the root cause.
- **Smart Search**: Find specific requests in the traffic list using natural language queries.

### 🛠️ Developer Tools
- **Breakpoints**: Real-time pause, edit, and resume requests/responses.
- **Request Composer**: Built-in API client tailored for debugging (think Postman, but integrated).
- **Script Editor**: Built-in **CodeMirror** editor with syntax highlighting and Python support. Write and run scripts instantly with independent logs.

## 🛠️ Getting Started

### Prerequisites
- **Node.js** (v18+) & pnpm
- **Rust** (stable toolchain)
- **Python** (v3.10+)

### Setup & Run
```bash
# 1. Clone the repository
git clone https://github.com/relaycraft/relaycraft.git
cd relaycraft

# 2. Set up the Python Engine
# Follow the instructions in [engine-core/README.md](engine-core/README.md)
# to build and place the engine binary/bundle in the required directory.

# 3. Install frontend dependencies
pnpm install

# 4. Start development mode
pnpm tauri dev
```

## 📦 Downloads
Pre-built binaries for macOS, Windows, and Linux are available on the [Releases Page](https://github.com/relaycraft/relaycraft/releases).

## 📖 Community & Support

- [**Contributing Guide**](CONTRIBUTING.md) - Learn how to help us build the future of network debugging.
- [**Commercial Use**](COMMERCIAL.md) - Information about sponsorship and corporate licensing.
- [**Plugin Registry**](https://github.com/relaycraft/plugins) - Explore community-built plugins.

## 📄 License

RelayCraft is open-sourced under the **AGPLv3** license. See the [LICENSE](LICENSE) file for details.

---

<p align="center">
  Crafted with ❤️ by the <a href="https://github.com/relaycraft">RelayCraft Team</a>.
</p>
