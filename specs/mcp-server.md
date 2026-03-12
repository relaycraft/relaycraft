# Spec: MCP Server — 流量数据开放能力

> 状态：`draft`
> 优先级：`P1-high`
> 创建日期：2026-03-09
> 关联 Issue：待创建

---

## 目标 (Goals)

- [ ] RelayCraft 启动时在本地端口同步启动一个 MCP Server，对外暴露流量数据查询能力
- [ ] MVP 阶段提供 4 个核心 Tool，覆盖"查列表 → 看详情"的完整链路
- [ ] 接入 Claude Desktop、Cursor 等主流 MCP 客户端，零配置成本
- [ ] 设置界面提供开关、端口配置、一键复制接入配置

---

## 背景 (Context)

RelayCraft 捕获的实时 HTTP 流量是开发调试场景中密度最高的上下文信息。当开发者同时使用 AI 辅助开发工具（Claude Desktop、Cursor 等）时，AI 无法直接"看到"网络请求，只能依赖开发者手动粘贴截图或文本，效率很低。

MCP（Model Context Protocol）是目前主流 AI 工具接入本地数据的标准协议。通过在 RelayCraft 内嵌 MCP Server，可以让 AI 直接读取：

- 当前正在抓包的请求列表
- 某个请求的完整 headers + body
- 历史调试会话数据

这是一个**差异化竞争点**：目前市面上没有任何 HTTP 调试工具提供 MCP 接口。

### 现有基础

Python 引擎已有完整的流量 HTTP API，MCP Server 可以直接复用：

- `/_relay/poll?session_id=X&since=T` — 查询流量索引列表
- `/_relay/detail?id=X` — 获取单条请求完整数据
- `/_relay/sessions` — 获取所有历史会话列表

### 相关模块

- `src/components/settings/` — 设置界面（新增 MCP 配置面板）
- `src-tauri/src/mcp/` — 新增 Rust MCP Server 模块
- `src-tauri/src/config.rs` — AppConfig 新增 MCP 配置项
- `src-tauri/src/lib.rs` — 启动时 spawn MCP Server
- `engine-core/addons/core/monitor.py` — 数据来源（只读，无需修改）

---

## 架构设计 (Architecture)

### 整体数据流

```
┌─────────────────────────────────────────────┐
│              RelayCraft (Tauri)             │
│                                             │
│  ┌─────────────┐      ┌──────────────────┐ │
│  │ Python      │      │  Rust MCP Server │ │
│  │ Engine      │◄─────│  (axum, :7090)   │ │
│  │ (:9090)     │ HTTP │                  │ │
│  └─────────────┘      └────────┬─────────┘ │
│                                │            │
└────────────────────────────────┼────────────┘
                                 │ MCP / HTTP+SSE
               ┌─────────────────┼──────────────┐
               │                 │              │
       ┌───────▼──────┐  ┌───────▼──────┐  ┌───▼──────────┐
       │Claude Desktop│  │    Cursor    │  │  其他 MCP    │
       │              │  │              │  │  客户端      │
       └──────────────┘  └──────────────┘  └──────────────┘
```

### 设计原则

1. **只读**：MVP 阶段 MCP Server 不写入任何数据，只提供查询
2. **无状态代理**：MCP Server 本身不维护流量缓存，直接转发到 Python 引擎
3. **Session 感知**：以 Session 而非时间戳作为数据边界，AI 上下文更清晰
4. **松耦合**：MCP Server 和主应用通过 HTTP 解耦，可独立重启

### MCP 传输协议选型

使用 **Streamable HTTP**（MCP 1.0 标准传输层）：

- 客户端 POST `http://localhost:7090/mcp` 发起 JSON-RPC 请求
- 服务端以普通 JSON 响应（无需 SSE，MVP 阶段无推送需求）
- 支持 CORS，允许 Web 端 MCP 客户端接入

---

## MVP Tool 设计

### Tool 1: `list_sessions`

列出所有历史调试会话，让 AI 了解有哪些可查的数据范围。

**输入参数**

无

**输出**

```json
{
  "sessions": [
    {
      "id": "sess_abc123",
      "name": "2026-03-09 下午调试",
      "flowCount": 342,
      "startedAt": "2026-03-09T14:23:00Z",
      "durationMs": 3600000,
      "isActive": true
    }
  ]
}
```

**说明**：`isActive: true` 标识当前正在录制的 session，AI 优先引导用户查询活跃 session。

---

### Tool 2: `list_flows`

查询某个 Session 内的流量列表，支持多维过滤。

**输入参数**

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `session_id` | string | 否 | 不传时默认当前活跃 session |
| `limit` | number | 否 | 返回条数，默认 50，最大 200 |
| `method` | string | 否 | 过滤 HTTP 方法，如 `GET`、`POST` |
| `status` | number \| string | 否 | 过滤状态码，支持范围如 `4xx`、`5xx` |
| `domain` | string | 否 | 过滤域名，支持子字符串匹配 |
| `has_error` | boolean | 否 | 只返回有错误的请求 |
| `content_type` | string | 否 | 过滤响应 Content-Type，如 `json`、`html` |

**输出**

```json
{
  "session_id": "sess_abc123",
  "total": 342,
  "returned": 50,
  "flows": [
    {
      "id": "flow_xyz",
      "method": "POST",
      "url": "https://api.example.com/v1/users",
      "host": "api.example.com",
      "path": "/v1/users",
      "status": 422,
      "contentType": "application/json",
      "startedAt": "2026-03-09T14:25:33Z",
      "durationMs": 142,
      "sizeBytes": 1024,
      "hasError": true,
      "hasRequestBody": true,
      "hasResponseBody": true
    }
  ]
}
```

**设计要点**：返回的是轻量索引（FlowIndex），不含 headers/body，避免单次响应过大。AI 需要看详情时再调用 `get_flow`。

---

### Tool 3: `get_flow`

获取单条请求的完整数据，包含完整 headers 和 body。

**输入参数**

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `id` | string | 是 | Flow ID，从 `list_flows` 结果中获取 |

**输出**

```json
{
  "id": "flow_xyz",
  "startedAt": "2026-03-09T14:25:33Z",
  "durationMs": 142,
  "request": {
    "method": "POST",
    "url": "https://api.example.com/v1/users",
    "httpVersion": "HTTP/1.1",
    "headers": [
      { "name": "Content-Type", "value": "application/json" },
      { "name": "Authorization", "value": "Bearer eyJ..." }
    ],
    "queryString": [],
    "body": "{\"name\": \"Alice\", \"email\": \"alice@example.com\"}"
  },
  "response": {
    "status": 422,
    "statusText": "Unprocessable Entity",
    "headers": [
      { "name": "Content-Type", "value": "application/json" }
    ],
    "body": "{\"error\": \"email_already_exists\", \"message\": \"该邮箱已被注册\"}",
    "sizeBytes": 1024
  },
  "timings": {
    "dns": 0,
    "connect": 12,
    "ssl": 23,
    "wait": 98,
    "receive": 9
  }
}
```

**设计要点**：
- body 超过 100KB 时截断，附加 `"bodyTruncated": true` 标识
- Binary body（图片、文件等）返回 `"bodyEncoding": "base64"`
- Authorization header 等敏感字段**不做脱敏**（本地工具，用户自主决策）

---

### Tool 4: `search_flows`

关键词全文搜索，在 URL、响应体内容中匹配。

**输入参数**

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `query` | string | 是 | 搜索关键词 |
| `session_id` | string | 否 | 不传时默认当前活跃 session |
| `limit` | number | 否 | 默认 20，最大 50 |
| `search_in` | string[] | 否 | 搜索范围，可选 `url`、`request_body`、`response_body`，默认全部 |

**输出**：同 `list_flows` 格式，附加匹配位置高亮字段

**说明**：MVP 阶段只做 URL 匹配，response_body 搜索因性能原因放到后续迭代。

---

## 数据模型 (Data Model)

### AppConfig 新增字段

```rust
#[derive(Serialize, Deserialize)]
pub struct McpConfig {
    pub enabled: bool,       // 是否启动 MCP Server，默认 false
    pub port: u16,           // 监听端口，默认 7090
}

// 集成到 AppConfig
pub struct AppConfig {
    // ... 现有字段
    pub mcp: McpConfig,
}
```

### MCP Server 内部状态

```rust
pub struct McpServerState {
    pub engine_port: Arc<Mutex<u16>>,  // Python 引擎当前端口，动态同步
}
```

### TypeScript 类型（设置 UI）

```typescript
interface McpConfig {
  enabled: boolean;
  port: number;
}

interface McpStatus {
  running: boolean;
  port: number;
  connectedClients: number;  // 当前连接的 MCP 客户端数
}
```

---

## 接口契约 (Interface Contract)

### Tauri Commands

```
get_mcp_config() -> Result<McpConfig, String>
save_mcp_config(config: McpConfig) -> Result<(), String>
get_mcp_status() -> Result<McpStatus, String>
restart_mcp_server() -> Result<(), String>
```

### MCP Server HTTP 端点

```
POST /mcp
Content-Type: application/json

请求体（JSON-RPC 2.0）:
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "initialize" | "tools/list" | "tools/call",
  "params": { ... }
}
```

方法说明：

| JSON-RPC Method | 说明 |
|---|---|
| `initialize` | 握手，返回 server info 和 capabilities |
| `tools/list` | 返回所有可用 Tool 的 schema |
| `tools/call` | 调用具体 Tool，params 包含 `name` 和 `arguments` |

### Python Engine API（只读调用，无修改）

```
GET /_relay/sessions
GET /_relay/poll?session_id={id}&since=0
GET /_relay/detail?id={flow_id}
```

---

## UI 设计 (Interface Design)

### 入口位置

设置页 → 新增 **MCP Server** 分区（位于现有 "代理设置" 之后）

### 面板布局

```
┌─────────────────────────────────────────────────────┐
│  MCP Server                                         │
│                                                     │
│  允许 AI 工具（Claude Desktop、Cursor 等）读取流量数据   │
│                                                     │
│  启用 MCP Server          ┌─────────────────────┐   │
│  ●──────────────────── ON │ ● 运行中 · 端口 7090 │   │
│                            └─────────────────────┘   │
│                                                     │
│  监听端口                                            │
│  ┌───────────────┐                                  │
│  │  7090         │                                  │
│  └───────────────┘                                  │
│                                                     │
│  接入配置                                            │
│  ┌─────────────────────────────────────────────┐    │
│  │ {                                           │    │
│  │   "mcpServers": {                           │    │
│  │     "relaycraft": {                         │    │
│  │       "type": "http",                       │    │
│  │       "url": "http://localhost:7090/mcp"    │    │
│  │     }                                       │    │
│  │   }                                         │    │
│  │ }                                           │    │
│  └─────────────────────────────────────────────┘    │
│                          [ 复制配置 ]  [ 打开文档 ]   │
│                                                     │
└─────────────────────────────────────────────────────┘
```

### 交互细节

- **启用开关**：关闭时 MCP Server 停止监听，端口释放
- **端口修改**：失焦后自动检测端口占用，冲突时显示红色提示
- **状态指示器**：
  - `● 运行中` — 绿色圆点
  - `○ 已停止` — 灰色圆点
  - `⚠ 端口占用` — 黄色警告
- **复制配置按钮**：点击后按钮文字变为"已复制 ✓"，2 秒后恢复
- **打开文档**：跳转到 RelayCraft 官网 MCP 接入指南（待创建）

---

## 引用技能 (Required Skills)

- MUST USE `skills/tauri-command.md` — Tauri 命令实现（get/save config）
- MUST USE `skills/react-component.md` — 设置面板组件
- MUST USE `skills/i18n-workflow.md` — 国际化（英文 + 中文）
- SHOULD USE `skills/error-handling.md` — 端口占用等错误处理

---

## 实现计划 (Implementation Plan)

### Phase 1：Rust MCP Server 骨架（后端）

1. `src-tauri/Cargo.toml` 新增 `axum`、`tower-http`
2. 新建 `src-tauri/src/mcp/` 模块：
   - `mod.rs` — `start_server(engine_port, mcp_port)` 入口
   - `router.rs` — axum router，挂载 `POST /mcp` 端点
   - `protocol.rs` — JSON-RPC 2.0 请求/响应结构体
   - `tools.rs` — 4 个 Tool 的业务逻辑（调用 `/_relay/*`）
3. `AppConfig` 新增 `mcp: McpConfig` 字段，默认 `enabled: false`
4. `lib.rs` 启动时根据配置条件 spawn MCP Server

### Phase 2：Tool 实现

1. `list_sessions` — 调用 `/_relay/sessions`，格式转换
2. `list_flows` — 调用 `/_relay/poll?session_id=X&since=0`，实现过滤逻辑
3. `get_flow` — 调用 `/_relay/detail?id=X`，body 截断处理
4. `search_flows` — 调用 `/_relay/poll` + URL 关键词过滤

### Phase 3：Tauri Commands + 设置 UI

1. 实现 `get_mcp_config`、`save_mcp_config`、`get_mcp_status`、`restart_mcp_server`
2. 新建 `src/components/settings/McpServerSection.tsx`
3. 集成到现有设置页面布局
4. 更新 i18n 文件（zh.json + en.json）

### Phase 4：端到端测试 + 接入文档

1. 使用 Claude Desktop 完整验证 4 个工具的可用性
2. 编写接入指南（Claude Desktop / Cursor 配置方式）
3. 错误边界处理：引擎未启动时的友好提示

---

## 后期功能规划 (Future Roadmap)

### 近期（MVP 稳定后）

**`get_session_stats` Tool**

汇总当前 session 的统计数据，让 AI 能快速了解全局状况，再决定是否深入查看某个请求。

```json
{
  "totalRequests": 342,
  "errorRate": 0.08,
  "topDomains": [
    { "domain": "api.example.com", "count": 156, "errorCount": 12 }
  ],
  "statusDistribution": { "2xx": 290, "4xx": 38, "5xx": 14 },
  "slowestRequests": [
    { "id": "flow_abc", "url": "...", "durationMs": 3200 }
  ]
}
```

**`list_flows` 扩展**：支持 `response_body` 关键词搜索（需评估引擎侧性能）

### 中期

**`create_rule` Tool**（写操作，需额外安全设计）

AI 分析流量后，可以直接创建代理规则（如 Map Remote、Rewrite Header），无需用户手动配置。这是规则能力和 MCP 的结合点，使用场景：

> "帮我把 api.example.com 的请求都代理到本地 3000 端口"

实现前需要解决：用户确认机制（写操作不能静默执行）

**MCP Resources**（补充 Tool 能力）

除 Tool 外，暴露 MCP Resources 让 AI 可以"订阅"流量：

- `traffic://current-session` — 当前 session 的活跃流量流
- `traffic://flow/{id}` — 特定请求的详情

### 远期

**实时通知（SSE Push）**

当有新请求满足某条件时（如出现 5xx 错误），主动推送到 MCP 客户端，让 AI 能感知实时异常。

**多租户 / API Key 鉴权**

当 RelayCraft 服务化（如团队共享代理模式）后，MCP Server 需要鉴权机制，避免本地流量被未授权的进程访问。

---

## 验收标准 (Acceptance Criteria)

- [ ] RelayCraft 启动后，在设置页开启 MCP Server，端口可监听
- [ ] Claude Desktop 按文档配置后，可以调用 4 个 Tool 并返回正确数据
- [ ] `list_flows` 过滤参数（method / status / domain）均有效
- [ ] `get_flow` 返回完整 headers + body，超大 body 正确截断
- [ ] 引擎未启动时，Tool 调用返回明确的错误提示而非超时
- [ ] 关闭 MCP Server 开关后，端口立即释放
- [ ] 修改端口后重启生效，config 持久化
- [ ] 复制配置按钮生成的 JSON 可以直接粘贴到 Claude Desktop 配置文件
- [ ] i18n 覆盖（中英文设置 UI 均完整）
- [ ] 通过 `pnpm lint` + `cargo test`

---

## 约束 (Constraints)

- MCP Server **只在 localhost 监听**，不对外网开放，无需鉴权
- MVP 阶段**只读**，不提供任何写操作 Tool
- body 响应大小上限 100KB，超出截断，与现有 IPC 传输限制（5MB）一致但更保守（AI context window 友好）
- MCP Server 端口不得与代理端口（9090/9091）及常见开发端口冲突，默认 7090
- 遵循 `AGENTS.md` §三 的不可违反原则
- MCP Server 崩溃不影响主应用和代理引擎的正常运行（独立 tokio task，panic 隔离）

---

## 设计决策 (Design Decisions)

| 决策点 | 选项 A | 选项 B | 选择 | 原因 |
|:---|:---|:---|:---|:---|
| 传输协议 | stdio | Streamable HTTP | **HTTP** | 桌面应用不适合 stdio；HTTP 支持多客户端并发连接 |
| 数据边界 | 时间戳（since） | Session | **Session** | AI 上下文语义更清晰；支持历史 session 对比分析 |
| MCP SDK | `rmcp` crate | 手写 JSON-RPC | **手写** | rmcp 尚不稳定；MCP 协议简单，自行实现可控性更高 |
| 默认状态 | 默认开启 | 默认关闭 | **默认关闭** | 避免用户不知情下暴露本地流量数据；需显式开启 |
| body 脱敏 | 自动脱敏 Authorization | 原样返回 | **原样返回** | 本地工具，用户对自己的数据有完全控制权；AI 分析时可能需要看完整 token |
| 数据存储 | MCP Server 本地缓存 | 直接代理引擎 API | **直接代理** | 避免数据冗余；引擎 SQLite 已是单一数据源 |
