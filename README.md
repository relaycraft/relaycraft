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

<p align="center">
  <a href="https://relaycraft.dev">relaycraft.dev</a>
</p>

---

**RelayCraft** is a powerful, AI-native network debugging tool designed for modern development. Built with **Tauri**, **React**, and **Rust**, it pairs a professional-grade proxy engine with deep AI integration and an extensible plugin system — all running fully offline, with zero accounts required.

> 🌟 **Traffic Monitor · Rules Engine · AI Assistant · MCP Server · Breakpoints · Request Composer · Python Scripting · Plugins**

## ✨ Why RelayCraft?

- **🤖 AI-Native Throughout**: Create complex rewrite rules in natural language, diagnose failed requests with one click, and search traffic with plain English. Every core workflow has AI built in.
- **🔌 MCP Server**: Expose live traffic data and rule management to any external AI tool (Claude Desktop, Cursor, etc.) via the [Model Context Protocol](https://modelcontextprotocol.io). Let your AI agent debug alongside you.
- **🏗️ Modern Architecture**: A lightweight, robust core built with Tauri and Rust, powered by the industry-standard **mitmproxy** engine.
- **🛡️ Privacy First**: Your data stays yours. Fully offline, zero accounts, local storage, local AI support, open source, and no telemetry.
- **🐍 Python Scripting**: Manipulate traffic with the full power of the mitmproxy Python ecosystem for unlimited flexibility.
- **🎨 Extensible**: A plugin system and comprehensive theme engine to craft your own professional workspace.

## 🚀 Key Features

### 📊 Traffic Monitor
- **Multi-protocol**: Capture and inspect HTTP, HTTPS, and WebSocket traffic.
- **Deep Analysis**: JSON syntax highlighting, image previews, and timing breakdowns.
- **Smart Filtering**: Filter by method, domain, status code, or content type using a powerful query syntax.
- **Export**: One-click export to **cURL**, **HAR**, or **Relay Session** (.relay).

### ⚙️ Rules Engine
Manage traffic behavior with a visual rule builder — no config files needed. Supports 6 rule types:

| Action | Description |
| :--- | :--- |
| **Map Local** | Return custom content or redirect to a local file. |
| **Map Remote** | Forward traffic to a different URL or environment. |
| **Rewrite Header** | Modify request or response headers dynamically. |
| **Rewrite Body** | Change request/response content (JSON / Regex / Text). |
| **Throttling** | Simulate slow network conditions (3G, Edge, etc.). |
| **Block Request** | Intercept and block matching requests instantly. |

Rules track their origin — whether created manually, by the built-in AI assistant, or by an external MCP client — so you always know where a rule came from.

### 🧠 AI Assistant
Global **Ctrl(⌘) + K** command center with context-aware AI across every workflow:
- **Natural Language Rules**: Describe what you want intercepted or rewritten; AI builds the rule.
- **Request Diagnostics**: One-click analysis of failed requests to find the root cause.
- **Smart Search**: Find specific traffic using natural language queries.
- **Script Generation**: Generate Python mitmproxy scripts from plain descriptions.

### 🔌 MCP Server
RelayCraft runs a built-in **MCP (Model Context Protocol) server**, letting any compatible AI client connect and work with your live traffic data.

**Read tools** (no auth required — zero config):
- `list_sessions` / `list_flows` / `get_flow` / `search_flows` / `get_session_stats` / `list_rules`

**Write tools** (Bearer token, shown in Settings → Integrations):
- `create_rule` — create any of the 6 rule types using natural language parameters
- `delete_rule` / `toggle_rule` — manage rules in the session
- `replay_request` — replay captured traffic through the proxy

Compatible with **Claude Desktop**, **Cursor**, **Windsurf**, and any tool supporting the MCP HTTP transport.

### 🛠️ Developer Tools
- **Breakpoints**: Pause, edit, and resume requests or responses in real time.
- **Request Composer**: Built-in API client designed for debugging — think Postman, deeply integrated.
- **Script Editor**: Built-in CodeMirror editor with Python syntax support and per-script independent logs.

## 🛠️ Getting Started

### Prerequisites
- **Node.js** 20.19+ or 22.12+ ([Vite compatibility](https://vite.dev/guide/#scaffolding-your-first-vite-project); Node 21 is not supported)
- **pnpm** 9+ ([install](https://pnpm.io/installation); this repo uses lockfile v9)
- **Rust** (stable toolchain)
- **Python** (3.10+)

### Setup & Run
```bash
# 1. Clone the repository
git clone https://github.com/relaycraft/relaycraft.git
cd relaycraft

# 2. Set up the Python Engine
# Follow the instructions in engine-core/README.md
# to build and place the engine binary in the required directory.

# 3. Install frontend dependencies
pnpm install

# 4. Start development mode
pnpm tauri dev
```

## 📦 Downloads
Pre-built binaries for macOS, Windows, and Linux are available on the [Releases Page](https://github.com/relaycraft/relaycraft/releases).

## 📖 Community & Support

- [**Contributing Guide**](CONTRIBUTING.md) — Learn how to contribute to the project.
- [**Roadmap**](https://github.com/relaycraft/relaycraft/discussions/31) — Product direction and upcoming milestones (GitHub Discussion).
- [**Commercial Use**](COMMERCIAL.md) — Sponsorship and enterprise licensing information.
- [**Plugin Registry**](https://github.com/relaycraft/relaycraft-plugins) — Explore community-built plugins.

## 📄 License

RelayCraft is open-sourced under the **GNU AGPL v3 or later**. See the [LICENSE](LICENSE) file for details.

## 🙌 Contributors
<!-- ALL-CONTRIBUTORS-LIST:START - Do not remove or modify this section -->
<!-- ALL-CONTRIBUTORS-LIST:END -->

---

<p align="center">
  Crafted with ❤️ by the <a href="https://github.com/relaycraft">RelayCraft Team</a>.
</p>
