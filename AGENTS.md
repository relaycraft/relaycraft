# AGENTS.md — RelayCraft AI 协作宪法

> **本文件是 AI Agent 参与 RelayCraft 项目开发时的最高指导原则。**
> 所有 AI 生成的代码、设计决策和工作流程必须符合本文件规定。
> 本文件兼容所有支持 AGENTS.md 的 AI Agent / IDE（Cursor, Kilo Code, Trae, Copilot 等）。

---

## 快速导航（AI Agent 请先读这里）

本项目采用 **AGENTS.md + specs/ + skills/** 三层知识架构：

- **AGENTS.md**（本文件）— 宪法：项目原则、架构约束、技术规范。不需要每次全文阅读，按需引用相关章节。
- **specs/** — 法律：具体任务的交付契约。开始功能任务前先检查是否有对应 spec。
- **skills/** — 工具箱：可复用的代码模板和标准操作程序。执行编码任务时优先加载对应 skill。

### 按需加载指引

| 任务类型 | 读取内容 |
|:---|:---|
| 简单修改（CSS、文案、小 bug） | 无需额外读取 |
| 新增/修改前端组件 | `skills/react-component.md` |
| 新增/修改 Zustand Store | `skills/zustand-store.md` |
| 新增 Tauri Command（前后端联调） | `skills/tauri-command.md` |
| 新增/修改规则类型（全栈） | `skills/rule-type.md` |
| 修改引擎核心 / mitmproxy 脚本 | `skills/engine-addon.md` |
| 涉及 i18n 文本 | `skills/i18n-workflow.md` |
| 涉及错误处理 | `skills/error-handling.md` |
| 架构级变更、不确定规范 | 本文件相关章节 |
| 开始一个大功能 | 对应 `specs/*.md` + 引用的 skills |

### 6 条核心速记

1. **i18n 必须**：所有用户可见文本使用 `t()` 函数，`zh.json` 和 `en.json` 同步更新
2. **Zustand 选择器**：组件中 `useStore((s) => s.field)`，禁止全量订阅
3. **Tailwind + cn()**：样式用 Tailwind utilities，合并用 `cn()`，颜色用主题变量
4. **Tauri Command 注册**：新命令必须在 `src-tauri/src/lib.rs` 的 `invoke_handler` 中注册
5. **Python Hook 安全**：引擎 Hook 必须有顶层 try/except，异常不能传播
6. **Conventional Commits**：`feat:` / `fix:` / `refactor:` / `chore:` / `docs:` / `perf:`

### 维护义务

当代码变更影响到项目通用模式时，**必须同步更新对应文档**：
- 新增/修改了通用模式 → 更新 `skills/*.md`
- 新增/修改了架构约束 → 更新本文件相关章节
- 完成了 spec 任务 → 更新 spec 状态
- 发现文档与代码不一致 → 立即修正文档

---

## 一、项目概览

**RelayCraft** 是一款 AI 原生的跨平台网络流量调试工具，定位对标 Charles / Fiddler，核心差异是深度集成 AI 能力。

| 维度 | 详情 |
|:---|:---|
| **愿景** | 面向现代开发的 AI 原生流量调试工具 |
| **许可证** | AGPLv3 |
| **版本** | 由 standard-version 管理 |
| **目标平台** | macOS, Windows, Linux |
| **核心功能** | 流量监控 · 规则引擎 · AI 助手 · 断点调试 · 请求构造器 · 脚本系统 · 插件扩展 |

---

## 二、技术栈与架构

### 2.1 三层架构

```
┌─────────────────────────────────────────────────┐
│  Frontend (React 19 + TypeScript + Vite 7)      │  ← UI 层
│  Zustand · Tailwind CSS 4 · Framer Motion       │
│  CodeMirror 6 · i18next · react-virtuoso         │
├─────────────────────────────────────────────────┤
│  Backend (Tauri 2 + Rust)                        │  ← 系统层
│  Serde · Reqwest · Tokio · rcgen                 │
│  代理进程管理 · 证书 · 配置 · AI 桥接 · 插件系统 │
├─────────────────────────────────────────────────┤
│  Engine Core (Python 3.10+ / mitmproxy 12)       │  ← 代理引擎
│  规则引擎 · 流量捕获 · 断点调试 · 脚本执行       │
│  作为 Sidecar 进程运行，通过 HTTP API 与 Rust 通信│
└─────────────────────────────────────────────────┘
```

### 2.2 目录结构

```
relaycraft/
├── src/                     # 前端 React 应用
│   ├── components/          # UI 组件 (按功能模块组织)
│   │   ├── common/          # 可复用基础组件 (Button, Modal, Select...)
│   │   ├── traffic/         # 流量监控相关
│   │   ├── rules/           # 规则引擎 UI
│   │   ├── ai/              # AI 助手 UI
│   │   ├── composer/        # 请求构造器
│   │   ├── scripts/         # 脚本编辑器
│   │   ├── settings/        # 设置面板
│   │   ├── plugins/         # 插件页面容器
│   │   ├── layout/          # 布局组件 (TitleBar, Sidebar, StatusBar)
│   │   ├── notifications/   # 通知系统
│   │   └── session/         # 会话管理
│   ├── stores/              # Zustand 状态管理
│   ├── hooks/               # 自定义 React Hooks
│   ├── lib/                 # 工具库与核心逻辑
│   │   └── ai/              # AI 集成层 (providers, dispatcher, prompts)
│   ├── types/               # TypeScript 类型定义
│   ├── plugins/             # 插件 API 与加载器
│   ├── locales/             # i18n 翻译文件 (zh.json, en.json)
│   └── assets/              # 静态资源
├── src-tauri/               # Tauri/Rust 后端
│   ├── src/
│   │   ├── lib.rs           # 应用主入口 (Tauri Builder, 插件注册, 命令注册)
│   │   ├── main.rs          # 二进制入口
│   │   ├── config.rs        # 应用配置 (AppConfig)
│   │   ├── proxy/           # 代理引擎管理 (mitmproxy sidecar)
│   │   ├── ai/              # AI 后端 (client, crypto, commands)
│   │   ├── plugins/         # 插件系统 (commands, bridge, market, config)
│   │   ├── rules/           # 规则持久化 (YAML 文件)
│   │   ├── scripts/         # 脚本管理 (storage, commands)
│   │   ├── session/         # 会话 (HAR 导入导出)
│   │   ├── traffic/         # 流量回放
│   │   ├── certificate/     # SSL 证书生成与管理
│   │   ├── common/          # 通用工具
│   │   └── logging/         # 日志系统
│   ├── capabilities/        # Tauri v2 权限声明
│   └── Cargo.toml
├── engine-core/             # Python 代理引擎
│   ├── addons/
│   │   ├── core/
│   │   │   ├── main.py      # CoreAddon 主入口
│   │   │   ├── rules/       # 规则引擎 (engine, loader, matcher, actions)
│   │   │   ├── monitor.py   # TrafficMonitor 流量捕获
│   │   │   ├── debug.py     # DebugManager 断点调试
│   │   │   └── proxy.py     # ProxyManager
│   │   ├── injector.py      # 用户脚本注入
│   │   └── tests/           # Python 测试
│   ├── requirements.txt
│   └── build.py             # PyInstaller 构建脚本
├── packages/                # 子包 (monorepo 预留)
├── scripts/                 # 构建/发布辅助脚本
├── public/                  # 静态文件 (splash, noise)
├── specs/                   # 功能规约 (任务契约) ← 需要建设
└── skills/                  # AI 技能包 (SOP)    ← 需要建设
```

---

## 三、不可违反的原则 (Constitutional Rules)

### 3.1 安全与隐私

1. **零遥测**：禁止添加任何形式的用户行为追踪、数据上报或匿名统计。
2. **本地优先**：所有用户数据（配置、会话、规则、脚本）必须存储在本地文件系统。
3. **API Key 安全**：AI API Key 必须通过 `ai::crypto` 模块加密存储，禁止明文写入配置文件（`save_config` 时 `api_key` 字段置空）。
4. **插件权限隔离**：插件必须声明 `permissions` 才能访问受限 API（`proxy:read`, `fs:read_logs`, `network:outbound` 等）。

### 3.2 架构约束

5. **三层分离**：前端（React）、系统层（Rust）、引擎层（Python）职责严格分离，层间仅通过 Tauri Commands 或 HTTP API 通信。
6. **Rust 不直接处理流量**：所有流量拦截、修改、分析由 Python 引擎（mitmproxy）负责，Rust 层仅负责进程管理和前端桥接。
7. **前端不直接访问文件系统**：所有文件操作必须通过 Tauri Commands（`@tauri-apps/api` 或 `invoke`）完成。
8. **Zustand 单向数据流**：状态变更必须通过 Store actions，禁止组件直接修改 Store 内部状态。

### 3.3 代码质量

9. **TypeScript 严格模式**：`tsconfig.json` 已启用 `strict: true`，禁止关闭。允许 `noExplicitAny: off`，但应尽量提供类型。
10. **Biome 强制检查**：所有 `*.ts/*.tsx` 文件在 commit 前自动经过 `biome check --write`（lint-staged），不得绕过。
11. **Conventional Commits**：提交信息必须遵循 `feat:`, `fix:`, `docs:`, `refactor:`, `chore:`, `perf:` 前缀，必须使用简洁英文。
12. **Rust 代码格式化**：提交前必须运行 `cargo fmt`，测试通过 `cargo test`。
13. **Python PEP 8**：引擎核心代码遵循 PEP 8，使用 4 空格缩进。

### 3.4 国际化

14. **所有面向用户的文本必须经过 i18n**：使用 `useTranslation()` 的 `t()` 函数，禁止硬编码中文或英文字符串到组件中。
15. **翻译键规范**：使用点分路径 `module.sub.key` 格式，如 `rules.new`, `common.save`, `traffic.filter_placeholder`。
16. **至少支持中文和英文**：`src/locales/zh.json` 和 `src/locales/en.json` 必须同步更新。

### 3.5 跨平台兼容

17. **三平台验证**：涉及文件路径、进程管理、系统 API 的代码必须考虑 macOS / Windows / Linux 三平台行为差异。
18. **条件编译**：Rust 中使用 `#[cfg(target_os = "...")]` 处理平台差异，禁止运行时字符串判断。

---

## 四、技术规范 (编码契约)

### 4.1 前端 (React + TypeScript)

#### 组件模式

- **函数组件 + Hooks**：所有组件使用函数组件，禁止 class 组件。
- **CVA 变体模式**：基础 UI 组件使用 `class-variance-authority` 定义变体（参考 `Button.tsx`）。
- **cn() 工具**：样式合并统一使用 `src/lib/utils.ts` 中的 `cn()` 函数（`clsx` + `tailwind-merge`）。
- **Framer Motion 动画**：交互动画使用 `framer-motion`，保持 `spring` 缓动统一风格。
- **Lucide 图标**：图标库统一使用 `lucide-react`，禁止引入其他图标库。
- **forwardRef 模式**：基础组件（Button, Input 等）使用 `React.forwardRef` 暴露 ref。
- **组件文件组织**：每个组件一个文件，文件名使用 PascalCase，与导出组件同名。

#### 状态管理

- **Zustand**：全局状态管理使用 `zustand`，store 文件统一放在 `src/stores/`。
- **Store 命名**：`use[Domain]Store`（如 `useTrafficStore`, `useRuleStore`, `useUIStore`）。
- **选择器模式**：组件中使用选择器订阅 Store 以优化重渲染：`useXxxStore((state) => state.xxx)`。
- **Store 间通信**：Store 间允许通过 `useXxxStore.getState()` 直接调用其他 Store 的 action。
- **异步操作**：Store 的 async action 内部处理错误，使用 `try/catch` + `notify` 或 `console.error`。

#### 样式

- **Tailwind CSS 4**：所有样式通过 Tailwind utility classes 实现，禁止内联 style 对象（动画除外）。
- **CSS 变量主题**：颜色系统使用 HSL CSS 变量（`hsl(var(--primary))`），支持主题定制。
- **响应式密度**：通过 `data-density` 属性支持 `comfortable` / `compact` 显示密度。
- **暗色主题**：使用 `darkMode: ["class"]`，通过 CSS 类切换暗色模式。

#### Tauri 通信

- **invoke 调用**：前端调用 Rust 命令统一使用 `import { invoke } from "@tauri-apps/api/core"`。
- **HTTP 请求**：需要绕过系统代理的请求使用 `@tauri-apps/plugin-http` 的 `fetch`（非原生 fetch）。
- **事件系统**：Tauri 事件使用 `@tauri-apps/api/event` 的 `emit` / `listen`。

### 4.2 后端 (Rust / Tauri)

#### 模块组织

- **功能模块化**：每个功能域一个目录（`ai/`, `plugins/`, `rules/` 等），包含 `mod.rs` + `commands.rs`。
- **Tauri Commands**：使用 `#[tauri::command]` 宏注册命令，在 `lib.rs` 的 `invoke_handler` 中统一声明。
- **错误处理**：命令返回 `Result<T, String>`，内部错误使用 `anyhow` 或 `thiserror`，对外通过 `.map_err(|e| e.to_string())` 转换。
- **状态管理**：使用 `tauri::manage()` 注册全局状态，命令通过 `State<T>` 注入。

#### 配置系统

- **AppConfig**：核心配置结构体 `src-tauri/src/config.rs`，使用 `serde` 序列化为 JSON。
- **目录约定**：
  - 配置：`{app_root}/config/config.json`
  - 数据：`{app_root}/data/`
  - 日志：`{app_root}/logs/`
  - 主题：`{app_root}/data/themes/`
- **平台目录**：macOS `~/Library/Application Support/relaycraft`，Windows `%APPDATA%/relaycraft`，Linux `~/.config/relaycraft`。
- **serde default**：所有配置字段使用 `#[serde(default)]` 或自定义 default 函数，确保向后兼容。

#### 日志

- **`log` crate**：使用标准 `log` 宏（`log::info!`, `log::error!`）。
- **审计日志**：配置变更等敏感操作通过 `logging::write_domain_log("audit", ...)` 记录。

### 4.3 引擎核心 (Python / mitmproxy)

#### 架构

- **CoreAddon**：主入口 `engine-core/addons/core/main.py`，实现 mitmproxy 的 `request`, `response`, `error` 等 Hooks。
- **规则引擎管线**：`RuleEngine` → `RuleLoader`（加载/索引） → `RuleMatcher`（匹配） → `ActionExecutor`（执行），按 `priority` 排序确定性执行。
- **流量处理流程**：内部请求判断 → 活跃状态检查 → 规则引擎 → 断点调试 → 流量捕获。

#### 规则系统

- **6 种规则类型**：`map_local`, `map_remote`, `rewrite_header`, `rewrite_body`, `throttle`, `block_request`。
- **匹配原子**：`url`, `host`, `path`, `method`, `header`, `query`, `port`, `ip`，支持 `contains`, `exact`, `regex`, `wildcard` 匹配。
- **规则持久化**：Rust 端以 YAML 文件存储在 `data/rules/` 目录，Python 端通过文件系统 watch 加载。
- **执行管线顺序**（request 阶段）：`throttle` → `block_request` → `map_local/map_remote` → `rewrite_header` → `rewrite_body`。

#### 脚本系统

- **Addon 类模板**：用户脚本必须使用 mitmproxy Addon 类结构，包含 `addons = [Addon()]` 导出。
- **脚本注入**：`injector.py` 负责在引擎启动时加载用户脚本，脚本在 CoreAddon 之后执行。

### 4.4 插件系统

- **Manifest**：每个插件包含 `manifest.json`（类型 `PluginManifest`），声明 `capabilities` 和 `permissions`。
- **双域能力**：
  - `capabilities.ui`：前端 UI 扩展（React 组件通过 `<script>` 注入）。
  - `capabilities.logic`：后端流量处理扩展（Python 脚本）。
- **Plugin API**：插件通过 `RelayCraft.api` 对象访问宿主功能（`ui`, `ai`, `stats`, `invoke`, `settings`, `log`）。
- **生命周期**：`initPlugins()` → `loadPluginUI()` → 运行时 → `unloadPluginUI()`。

---

## 五、工作流规范

### 5.1 开发环境

```bash
# 前置要求
Node.js >= 18, pnpm >= 8, Rust stable, Python >= 3.10

# 启动开发
pnpm install                  # 安装前端依赖
cd engine-core && pip install -r requirements.txt && cd ..  # Python 依赖
pnpm tauri dev                # 启动 (同时启动 Vite + Tauri + Engine)

# 常用命令
pnpm test                     # 前端测试 (Vitest + jsdom)
pnpm lint                     # Biome 检查
pnpm format                   # Biome 格式化
pnpm check:i18n               # 检查 i18n 键一致性
cargo test                    # Rust 后端测试 (在 src-tauri/ 下)
cargo fmt                     # Rust 格式化
```

### 5.2 版本发布

- **standard-version**：`pnpm release` 自动 bump 版本号，同步更新 `package.json`, `tauri.conf.json`, `Cargo.toml`, `Cargo.lock`, `splash.html`。
- **CHANGELOG**：自动生成，仅展示 `feat`, `fix`, `perf` 类型。
- **CI/CD**：GitHub Actions 在 `v*` tag 推送时触发多平台构建（macOS universal, Linux x86_64, Windows x86_64）。

### 5.3 Git 工作流

- **pre-commit hook**：`lint-staged` 对 `*.ts/*.tsx` 文件执行 `biome check --write`。
- **分支策略**：从 `main` 创建功能分支，PR 合并回 `main`。
- **PR 模板**：`.github/PULL_REQUEST_TEMPLATE.md`。

---

## 六、AI Agent 角色定义

在 RelayCraft 项目中，AI Agent 可能扮演以下角色：

### 架构师 (Architect)
- **职责**：系统设计、技术选型、模块划分
- **输入**：AGENTS.md + 需求描述
- **输出**：`specs/` 任务规约
- **约束**：所有设计决策必须符合本文件 §三 的原则

### 开发者 (Developer)
- **职责**：功能实现、Bug 修复、代码编写
- **输入**：`specs/` 任务规约 + `skills/` 技能包
- **输出**：代码变更 + 测试
- **约束**：必须遵循 §四 的技术规范，优先查阅并引用 `skills/` 中的模板

### 审查员 (Reviewer)
- **职责**：代码审查、质量把关
- **输入**：代码变更 + `specs/` + `skills/`
- **检查项**：类型安全 · i18n 覆盖 · 跨平台兼容 · 安全规范 · 测试覆盖 · 代码风格

---

## 七、Spec 规约 (specs/) 编写规范

`specs/` 目录存放具体任务的契约文件，每个 Spec 定义**一个功能单元的完整交付契约**。

### Spec 模板

```markdown
# Spec: [功能名称]

## 目标 (Goals)
- 简洁描述该功能要实现什么

## 背景 (Context)
- 为什么需要这个功能
- 相关的现有模块

## 数据模型 (Data Model)
- 涉及的类型定义 (TypeScript / Rust / Python)

## 接口契约 (Interface Contract)
- 前端 Store 变更
- Tauri Commands 定义
- Python API 接口

## 引用技能 (Required Skills)
- MUST USE `skills/xxx.md`

## 验收标准 (Acceptance Criteria)
- [ ] 具体的可验证条件
- [ ] 测试要求
- [ ] i18n 覆盖

## 约束 (Constraints)
- 引用 AGENTS.md 中的适用原则
```

---

## 八、Skills 技能包 (skills/) 索引

`skills/` 目录存放可复用的执行模块——跨任务的标准操作程序和代码模板。

### 推荐构建的技能包

| 类别 | 技能文件 | 描述 |
|:---|:---|:---|
| **前端组件** | `skills/react-component.md` | React 函数组件标准写法、CVA 变体、forwardRef 模式 |
| **状态管理** | `skills/zustand-store.md` | Zustand Store 创建模板、selector 模式、跨 Store 通信 |
| **Tauri 通信** | `skills/tauri-command.md` | Tauri Command 端到端实现（Rust 定义 → 前端调用 → 类型安全） |
| **规则引擎** | `skills/rule-type.md` | 新增规则类型的端到端流程（类型 → UI → Rust → Python） |
| **i18n** | `skills/i18n-workflow.md` | 添加新翻译键的标准流程和检查清单 |
| **Python 引擎** | `skills/engine-addon.md` | mitmproxy Addon 编写模式、CoreAddon Hook 扩展 |
| **插件开发** | `skills/plugin-development.md` | 插件 Manifest 编写、UI/Logic 能力实现、API 使用 |
| **测试** | `skills/testing-patterns.md` | Vitest 前端测试 + Rust cargo test + Python pytest 模板 |
| **错误处理** | `skills/error-handling.md` | 三层统一的错误处理模式（前端 notify + Rust Result + Python try/except） |
| **AI 集成** | `skills/ai-integration.md` | AI Provider 模式、Prompt 工程、流式响应处理 |

### 技能包编写规范

每个技能文件应包含：

```markdown
# Skill: [技能名称]

## 适用场景 (When to Use)
## 前置条件 (Prerequisites)
## 步骤 (Steps)
## 代码模板 (Code Template)
## 检查清单 (Checklist)
## 验证命令 (Verification)
## 常见陷阱 (Pitfalls)
```

---

## 九、AI 协作协议

### 9.1 上下文加载优先级

AI Agent 在开始任务前，应按以下优先级加载上下文：

1. **AGENTS.md**（本文件）→ 确立原则边界
2. **相关 `specs/`** → 理解当前任务契约
3. **相关 `skills/`** → 获取执行模板
4. **相关源码** → 理解现有实现

### 9.2 任务执行流程

```
┌──────────────┐    ┌───────────────┐    ┌───────────────┐
│ 1. 读取       │    │ 2. 规划       │    │ 3. 执行       │
│ AGENTS.md     │ →  │ 生成/读取     │ →  │ 加载 skills/  │
│ (确立原则)    │    │ specs/        │    │ 编写代码      │
│               │    │ (定义契约)    │    │ (遵循模板)    │
└──────────────┘    └───────────────┘    └───────────────┘
        ↓                                        ↓
┌──────────────┐                        ┌───────────────┐
│ 4. 验证       │ ←────────────────────  │ 自查          │
│ 运行测试      │                        │ checklist     │
│ lint 检查     │                        │ i18n 覆盖     │
│ 类型检查      │                        │ 跨平台兼容    │
└──────────────┘                        └───────────────┘
```

### 9.3 变更自查清单 (Change Checklist)

每次提交代码前，AI Agent 必须完成以下自查：

- [ ] **类型安全**：新增/修改的函数和组件是否有完整的 TypeScript 类型？
- [ ] **i18n**：是否有硬编码的用户可见文本？是否同步更新了 `zh.json` 和 `en.json`？
- [ ] **跨平台**：涉及文件路径或系统 API 的代码是否考虑了三平台差异？
- [ ] **安全**：是否涉及敏感数据？是否遵循了 §3.1 的安全原则？
- [ ] **测试**：是否添加或更新了相关测试？
- [ ] **代码风格**：是否通过了 `pnpm lint` / `cargo fmt` / PEP 8 检查？
- [ ] **commit 信息**：是否遵循 Conventional Commits 格式？

---

## 十、附录

### A. 关键文件速查

| 用途 | 文件路径 |
|:---|:---|
| 前端入口 | `src/App.tsx` |
| Tauri 主入口 | `src-tauri/src/lib.rs` |
| 应用配置结构 | `src-tauri/src/config.rs` → `AppConfig` |
| AI 配置 | `src-tauri/src/ai/config.rs` → `AIConfig` |
| 规则类型定义 | `src/types/rules.ts` |
| 插件类型定义 | `src/types/plugin.ts` |
| 引擎主入口 | `engine-core/addons/core/main.py` → `CoreAddon` |
| 规则引擎 | `engine-core/addons/core/rules/engine.py` → `RuleEngine` |
| AI 调度器 | `src/lib/ai/dispatcher.ts` |
| UI Store | `src/stores/uiStore.ts` |
| 流量 Store | `src/stores/trafficStore.ts` |
| Biome 配置 | `biome.json` |
| Tailwind 配置 | `tailwind.config.js` |
| CI 构建 | `.github/workflows/build.yml` |
| 版本配置 | `.versionrc.json` |

### B. 命名约定

| 层 | 约定 | 示例 |
|:---|:---|:---|
| React 组件 | PascalCase | `TrafficListItem.tsx` |
| Hooks | camelCase, `use` 前缀 | `useAppInit.ts` |
| Store | camelCase, `use` 前缀 + `Store` 后缀 | `useTrafficStore.ts` |
| TypeScript 类型 | PascalCase | `FlowIndex`, `RuleAction` |
| Rust 模块 | snake_case | `har_model.rs` |
| Rust 结构体 | PascalCase | `AppConfig`, `ProxyState` |
| Tauri 命令 | snake_case | `save_config`, `load_all_rules` |
| Python 类 | PascalCase | `CoreAddon`, `RuleEngine` |
| Python 函数/变量 | snake_case | `handle_request`, `is_traffic_active` |
| i18n 键 | 点分 snake_case | `rules.new`, `common.save` |
| CSS 变量 | kebab-case | `--primary`, `--border` |

### C. 依赖版本锁定 (关键)

| 依赖 | 版本 | 备注 |
|:---|:---|:---|
| React | ^19.1.0 | React 19 新特性可用 |
| Tauri | 2.10.0 | Tauri v2，非 v1 |
| Zustand | ^5.0.10 | v5 API |
| mitmproxy | 12.2.1 | 引擎核心，精确锁定 |
| Vite | ^7.0.4 | Vite 7 |
| TypeScript | ~5.8.3 | 严格模式 |
| Biome | ^2.3.14 | Linter + Formatter |
| Tailwind CSS | ^4.1.18 | v4 新配置语法 |

---

*最后更新：2026-02-26*
*维护者：RelayCraft Team*
