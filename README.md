# RelayCraft 🛰️

<p align="center">
  <strong>The Next-Generation, AI-Native Web Traffic Inspector.</strong>
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

**RelayCraft** is a powerful, modern network debugging tool designed for developers who demand both power and elegance. Built with **Tauri**, **React**, and **Rust**, it bridges the gap between professional-grade proxy engines and modern developer experience with deep AI integration.

> 🌟 **Perfect for Frontend & Mobile Developers**: Intercept, analyze, and rewrite HTTP/HTTPS traffic on any device with ease.

## ✨ Why RelayCraft?

RelayCraft isn't just another proxy tool. It's an **AI-native workflow** for the modern web.

- **🤖 AI-Native Everything**: Create complex rewrite rules using natural language, analyze requests intelligently, and get context-aware suggestions.
- **⚡ Performance First**: Near-zero overhead proxying thanks to the Rust core and a high-performance **mitmproxy**-based sidecar.
- **🐍 Python Powered**: Write custom scripts to manipulate traffic with the full power of the Python ecosystem.
- **📦 Plugin Ecosystem**: Extend the UI and backend logic with a flexible plugin architecture.
- **🛡️ Privacy Centric**: Fully offline by default. Your traffic data never leaves your device. Support for local LLMs via Ollama.
- **🎨 Modern UI/UX**: A premium, dark-mode-first interface that says goodbye to outdated tool aesthetics.

## 🚀 Key Features

### 📊 Traffic Monitor
- **Real-time Capture**: Inspect HTTP, HTTPS, and WebSocket traffic with zero latency.
- **Rich Analysis**: JSON syntax highlighting, image preview, and detailed timing breakdowns.
- **Smart Filtering**: Filter by method, domain, status, or content type with powerful query syntax.
- **Export Options**: One-click export to **cURL**, **HAR**, or copy as fetch/axios code.

### ⚙️ Rules Engine
Say goodbye to complex configurations. Manage traffic behavior with a visual rule builder.

| Action | Description |
| :--- | :--- |
| **Map Local** | Redirect requests to local files for offline development. |
| **Map Remote** | Forward traffic to different environments (e.g., Prod -> Dev). |
| **Mock Response** | Return custom JSON/XML/Text responses instantly. |
| **Rewrite** | Modify headers, query params, or body content dynamically. |
| **Throttling** | Simulate slow network conditions (3G, Edge, Offline). |

### 🧠 AI Assistant
- **Command Center**: Press `Ctrl+K` to summon AI. Ask it to "Block all analytics scripts" or "Mock 404 for user API".
- **Intelligent Analysis**: Select a failed request and ask AI "Why did this fail?" for a detailed diagnostic report.
- **Script Generation**: Describe your logic in plain English, and let AI write the Python interceptor script for you.

### 🛠️ Developer Tools
- **Breakpoints**: Pause, edit, and resume requests/responses in real-time.
- **Request Composer**: Built-in API client tailored for debugging (think Postman, but integrated).
- **Script Editor**: A full-featured Monaco editor with TypeScript support for writing advanced plugins.

## 🛠️ Getting Started

### Prerequisites
- **Node.js** (v18+) & pnpm
- **Rust** (stable toolchain)
- **Python** (v3.10+)

### Setup & Run
```bash
# Clone the repository
git clone https://github.com/relaycraft/relaycraft.git
cd relaycraft

# Install dependencies
pnpm install

# Start development mode
pnpm tauri dev
```

## � Downloads
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
