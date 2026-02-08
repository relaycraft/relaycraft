# Contributing to RelayCraft

<p align="center">
  <a href="./CONTRIBUTING.md">English</a> | <a href="./CONTRIBUTING_zh.md">简体中文</a>
</p>

Thank you for your interest in contributing to RelayCraft! As an open-source project, we welcome contributions from everyone.

## Development Environment Setup

RelayCraft is a cross-platform application built with a modern multi-language stack.

### Prerequisites

| Component | Minimum Version | Notes |
| :--- | :--- | :--- |
| **Node.js** | v18.0.0+ | Use `pnpm` as package manager |
| **pnpm** | v8.0.0+ | `npm i -g pnpm` |
| **Rust** | Stable | Latest stable toolchain via `rustup` |
| **Python** | v3.10+ | Used for the mitmproxy sidecar |

**OS-Specific Requirements:**
- **Windows**: [Build Tools for Visual Studio 2022](https://visualstudio.microsoft.com/downloads/) (C++ support).
- **macOS**: Xcode Command Line Tools (`xcode-select --install`).
- **Linux**: `libwebkit2gtk-4.1-dev`, `build-essential`, `curl`, `wget`, `file`, `libssl-dev`, `libgtk-3-dev`, `libayatana-appindicator3-dev`, `librsvg2-dev`.

### Local Setup Steps

1. **Clone the Repository**
   ```bash
   git clone https://github.com/relaycraft/relaycraft.git
   cd relaycraft
   ```

2. **Install Frontend Dependencies**
   ```bash
   pnpm install
   ```

3. **Install Engine Dependencies (Python)**
   The core proxy engine runs as a Python sidecar.
   ```bash
   cd engine-core
   pip install -r requirements.txt
   cd ..
   ```

4. **Run in Development Mode**
   This command starts both the Tauri backend and the Vite frontend dev server.
   ```bash
   pnpm tauri dev
   ```

---

## Project Architecture

- **`src/`**: Frontend React application (TypeScript, Vite, Tailwind CSS).
    - `components/`: UI components.
    - `stores/`: Global state management via Zustand.
    - `locales/`: i18n translation files.
- **`src-tauri/`**: Backend Rust logic.
    - `src/`: Core application logic, system commands, and proxy process management.
    - `capabilities/`: Permission configurations for Tauri v2.
- **`engine-core/`**: Python scripts for building the mitmproxy-based sidecar engine.
- **`src-tauri/resources/addons/`**: Core proxy logic and rule engine (Python) that gets bundled with the app.

---

## Coding Guidelines

### Code Style
- **Frontend**: 4-space indentation. We use Prettier and ESLint (auto-fix on save recommended).
- **Rust**: 4-space indentation. Run `cargo fmt` before committing.
- **Python**: 4-space indentation. Follow PEP 8 guidelines.

### Commit Messages
We follow [Conventional Commits](https://www.conventionalcommits.org/):
- `feat:` for new features
- `fix:` for bug fixes
- `docs:` for documentation changes
- `refactor:` for code changes that neither fix a bug nor add a feature
- `chore:` for updating build tasks, package manager configs, etc.

---

## Pull Request Process

1. Fork the repository and create your branch from `main`.
2. If you've added code that should be tested, add tests.
3. If you've changed APIs, update the documentation.
4. Ensure the test suite passes.
5. Submit a Pull Request with a clear description of the changes and link any related issues.

## Reporting Issues
- Use the GitHub Issue tracker to report bugs or suggest features.
- Provide as much detail as possible, including steps to reproduce for bugs.

## License
By contributing to RelayCraft, you agree that your contributions will be licensed under the project's [AGPLv3 License](LICENSE).
