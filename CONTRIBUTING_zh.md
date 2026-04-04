# 贡献指南

<p align="center">
  <a href="./CONTRIBUTING.md">English</a> | <a href="./CONTRIBUTING_zh.md">简体中文</a>
</p>

感谢你对 RelayCraft 感兴趣！作为一个开源项目，我们欢迎所有人的贡献。

## 开发环境搭建

RelayCraft 是一个基于现代多语言技术栈构建的跨平台应用。

### 前置要求

| 组件 | 最低版本 | 备注 |
| :--- | :--- | :--- |
| **Node.js** | v18.0.0+ | 请使用 `pnpm` 作为包管理器 |
| **pnpm** | v8.0.0+ | `npm i -g pnpm` |
| **Rust** | Stable | 通过 `rustup` 安装最新稳定版 |
| **Python** | v3.10+ | 用于运行 mitmproxy sidecar 引擎 |

**操作系统特定要求:**
- **Windows**: [Build Tools for Visual Studio 2022](https://visualstudio.microsoft.com/downloads/) (需勾选 C++ 支持).
- **macOS**: Xcode Command Line Tools (`xcode-select --install`).
- **Linux**: `libwebkit2gtk-4.1-dev`, `build-essential`, `curl`, `wget`, `file`, `libssl-dev`, `libgtk-3-dev`, `libayatana-appindicator3-dev`, `librsvg2-dev`.

### 本地启动步骤

1. **克隆仓库**
   ```bash
   git clone https://github.com/relaycraft/relaycraft.git
   cd relaycraft
   ```

2. **安装前端依赖**
   ```bash
   pnpm install
   ```

3. **安装引擎依赖 (Python)**
   核心代理引擎作为一个 Python sidecar 运行。
   ```bash
   cd engine-core
   pip install -r requirements.txt
   cd ..
   ```

4. **启动开发模式**
   此命令会同时启动 Tauri 后端和 Vite 前端开发服务器。
   ```bash
   pnpm tauri dev
   ```

---

## 项目架构

- **`src/`**: 前端 React 应用 (TypeScript, Vite, Tailwind CSS).
    - `components/`: UI 组件.
    - `stores/`: 基于 Zustand 的全局状态管理.
    - `locales/`: i18n 翻译文件.
- **`src-tauri/`**: 后端 Rust 逻辑.
    - `src/`: 核心应用逻辑、系统命令和代理进程管理.
    - `capabilities/`: Tauri v2 的权限配置.
- **`engine-core/`**: 用于构建 mitmproxy sidecar 引擎的 Python 脚本.
- **`src-tauri/resources/addons/`**: 随应用打包的核心代理逻辑和规则引擎 (Python).

---

## 代码规范

### 代码风格
- **Frontend**: 4空格缩进。我们使用 Prettier 和 ESLint (建议开启保存自动修复)。
- **Rust**: 4空格缩进。提交前请运行 `cargo fmt`。
- **Python**: 4空格缩进。遵循 PEP 8 指南。

### 提交信息 (Commit Messages)
我们遵循 [Conventional Commits](https://www.conventionalcommits.org/zh-hans/) 规范:
- `feat:` 新功能
- `fix:` 修复 Bug
- `docs:` 文档变更
- `refactor:` 代码重构（既不是修复 bug 也不是添加功能）
- `chore:` 构建过程或辅助工具的变动

---

## Pull Request 流程

1. Fork 本仓库并从 `main` 分支创建你的开发分支。
2. 如果添加了代码，请确保添加了相应的测试。
3. 如果修改了 API，请更新文档。
4. 确保所有测试通过。
5. 提交 Pull Request，清晰描述变更内容并链接相关 Issue。

## 反馈问题
- 请使用 GitHub Issues 报告 Bug 或建议新功能。
- 报告 Bug 时，请提供尽可能详细的信息，包括复现步骤。

## 法律声明：贡献者约定与 AGPLv3

RelayCraft 使用 [GNU Affero 通用公共许可证第 3 版](LICENSE)（**AGPL-3.0**）发布。为保持项目许可清晰、可审计，请遵守以下约定。

### 入站许可（你对贡献内容的授权）

除非你在提交 Pull Request 或附带补丁的 Issue 中**另行书面说明**，否则你授予他人在 AGPL-3.0 下使用你贡献的代码的权限，即你的贡献与本仓库其余部分**同样以 AGPL-3.0 授权**。请勿提交你无权按该方式授权的内容（例如专有第三方代码或与 AGPL 不兼容许可下的代码）。

### 开发者来源证书（DCO）

你对每一次贡献都必须同意 **[开发者来源证书（DCO）](DCO.md)** 中的陈述。实务上请做到：

1. 你已阅读并同意 [DCO.md](DCO.md) 中的认证内容（权利来源、可追溯性、公开记录等）。
2. **每个提交**建议包含符合 Git 规范的 `Signed-off-by` 行（真实姓名与邮箱），例如：

   ```text
   Signed-off-by: 张三 <zhangsan@example.com>
   ```

   可使用 `git commit -s` 由 Git 自动添加。

若无法使用 `Signed-off-by`（例如仅通过 GitHub 网页编辑），请在 Pull Request 正文中**明确声明**你同意就该 PR 中的改动遵守 DCO 与 AGPL-3.0；维护者仍可能要求在合并前补全提交说明。

### 第三方与引用代码

- 依赖项与本项目以当前方式打包、分发时，须与 **AGPL-3.0 兼容**。
- 若引入或改写外部代码，须按原许可要求**保留版权与许可声明**，并在 PR 说明中注明来源。

### 职务作品与雇主

若贡献与你的工作相关，请在发起 Pull Request 前确认你已获授权在 **AGPL-3.0** 下提交代码并同意 **DCO**。
