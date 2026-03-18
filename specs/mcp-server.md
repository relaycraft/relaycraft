# Spec: MCP Server — AI 流量管理中枢

> 状态：`Phase 2 已完成，Phase 3 规划中`
> 优先级：`P1-high`
> 创建日期：2026-03-09
> 最后更新：2026-03-13
> 关联 Issue：待创建

---

## 战略定位 (Strategic Vision)

所有 AI 编程工具（Claude、Cursor、Copilot）有一个共同的根本盲区：**运行时失明**。AI 能写代码、审查代码，但代码运行之后它就看不见了——API 返回了什么、请求为什么失败、延迟出在哪里，只能靠开发者截图转述。

RelayCraft 站在这个盲区的入口。MCP Server 让 AI 能直接读取和干预 HTTP 流量，是 RelayCraft 从"开发者手动使用的调试工具"变成"AI 工作流里的主动组件"的关键一步。

### 能力进化路径

```
Phase 1 (已完成，rc.9)  —  观察者
  AI 通过 MCP 读取流量数据，辅助分析

Phase 2 (已完成，rc.10)  —  干预者
  AI 直接创建/管理规则、重放请求，完成"看→干预→验证"完整闭环

Phase 3 (1.0 之后)  —  编排者
  AI 主导多步调试工作流，RelayCraft 作为执行引擎
```

### 市场现状

主流 HTTP 调试工具均已陆续推出 MCP Server，方向已被市场验证。RelayCraft 的差异化在于：

1. **完整规则管理闭环**：create / list / toggle / delete 全链路，而非仅支持创建
2. **规则引擎更丰富**：6 种规则类型，rewrite_body 支持 4 种子模式（set / replace / regex_replace / status_code）
3. **Session 语义**：以 Session 作为数据边界，AI 上下文更清晰，支持历史 Session 对比
4. **三平台一致体验 + 开源**
5. **中文市场本土化**：双语界面 + 国内 AI 服务商集成

---

## 已实现功能

### Phase 1（rc.9，只读）

- [x] 应用启动时在 `:7090` 启动 MCP Server
- [x] 4 个只读 Tool：`list_sessions`、`list_flows`、`get_flow`、`search_flows`
- [x] 设置界面：开关 + 端口配置 + 一键复制接入 JSON

### Phase 2（rc.10，读写 + 规则管理）

- [x] Token 认证：`mcp-token` 文件持久化，写操作需 `Authorization: Bearer <token>`
- [x] `get_session_stats`：全局统计摘要，AI 建立认知的起点
- [x] `create_rule`：支持全部 6 种规则类型，简化参数，AI 友好
- [x] `replay_request`：通过代理端口重放，结果可见于流量列表
- [x] `list_rules`：列出所有规则（id、名称、类型、url_pattern、启用状态、来源）
- [x] `delete_rule`：删除指定规则，返回被删规则的名称和来源
- [x] `toggle_rule`：启用/禁用规则，无需删除
- [x] Rule 来源标记：`source: "user" | "ai_assistant" | "ai_mcp"`，UI 显示徽标
- [x] 规则变更事件：`create_rule`/`delete_rule`/`toggle_rule` 操作后发出 `rules-changed` 事件，前端即时刷新

---

## 架构设计 (Architecture)

### 整体数据流

```
┌──────────────────────────────────────────────────────┐
│                  RelayCraft (Tauri)                  │
│                                                      │
│  ┌──────────────┐  内部 HTTP  ┌──────────────────┐   │
│  │ Python Engine│◄────────────│  Rust MCP Server │   │
│  │   (:9090)    │             │    (axum :7090)  │   │
│  └──────────────┘             └────────┬─────────┘   │
│                                        │             │
│  ┌──────────────┐  直接调用             │             │
│  │  Rules Store │◄──── create/delete/  │             │
│  │  (YAML 文件) │      toggle_rule      │             │
│  └──────────────┘                      │             │
└────────────────────────────────────────┼─────────────┘
                                         │ MCP / HTTP JSON-RPC
               ┌─────────────────────────┼──────────────┐
        ┌──────▼──────┐    ┌─────────────▼──┐   ┌───▼────────┐
        │Claude Desktop│   │    Cursor      │   │  其他工具  │
        └─────────────┘    └────────────────┘   └────────────┘
```

### 设计原则

1. **无状态代理**：MCP Server 不缓存流量数据，直接转发到 Python 引擎 API
2. **Session 感知**：以 Session 而非时间戳作为数据边界，`session_id` 均可省略以使用当前活跃 Session
3. **写操作不过引擎**：`create/delete/toggle rule` 直接操作 RuleStorage，不经过 Python 引擎
4. **崩溃隔离**：MCP Server 是独立 tokio task，崩溃不影响主应用和代理引擎

### 传输协议

**Streamable HTTP**（MCP 1.0 标准）：客户端 `POST http://localhost:7090/mcp`，JSON-RPC 2.0，支持 CORS。

---

## Tool 完整规格

### 当前 10 个 Tool 一览

| Tool | 类型 | 认证 | 说明 |
|---|---|---|---|
| `list_sessions` | 读 | 无 | 列出所有历史 Session |
| `list_flows` | 读 | 无 | 查询 Session 内流量列表，多维过滤 |
| `get_flow` | 读 | 无 | 获取单条请求的完整 headers + body |
| `search_flows` | 读 | 无 | 关键词搜索流量 URL |
| `get_session_stats` | 读 | 无 | Session 聚合统计（错误率、域名分布等） |
| `list_rules` | 读 | 无 | 列出所有规则摘要（id/名称/类型/状态/来源） |
| `create_rule` | 写 | Token | 创建代理规则，立即生效 |
| `delete_rule` | 写 | Token | 按 ID 删除规则 |
| `toggle_rule` | 写 | Token | 启用或禁用规则 |
| `replay_request` | 写 | Token | 通过代理端口重放请求 |

---

### 只读 Tool

#### `list_sessions`

列出所有历史调试会话。无输入参数。

```json
{ "sessions": [
  { "id": "sess_abc", "name": "2026-03-12 下午调试", "flowCount": 342,
    "startedAt": "2026-03-12T14:23:00Z", "isActive": true }
]}
```

---

#### `list_flows`

查询 Session 内流量列表，支持多维过滤。

| 参数 | 类型 | 说明 |
|---|---|---|
| `session_id` | string? | 不传时默认当前活跃 Session |
| `limit` | number? | 默认 50，最大 200 |
| `method` | string? | 如 `GET`、`POST` |
| `status` | string? | 范围如 `4xx`、`5xx`，或精确值 `404` |
| `domain` | string? | 子字符串匹配 |
| `has_error` | boolean? | 只返回有错误的请求 |
| `content_type` | string? | 如 `json`、`html` |

返回轻量 FlowIndex（不含 body），需要完整数据时调用 `get_flow`。

---

#### `get_flow`

获取单条请求的完整 headers + body。

| 参数 | 类型 | 说明 |
|---|---|---|
| `id` | string | Flow ID |

body 超过 100KB 时截断，附加 `"bodyTruncated": true`。

---

#### `search_flows`

关键词搜索流量 URL。

| 参数 | 类型 | 说明 |
|---|---|---|
| `query` | string | 搜索关键词 |
| `session_id` | string? | 不传时默认活跃 Session |
| `limit` | number? | 默认 20，最大 50 |

---

#### `get_session_stats`

获取当前 Session 的统计摘要，帮助 AI 快速建立全局认知。

```json
{
  "totalFlows": 342,
  "errorRate": 0.08,
  "topDomains": [
    { "domain": "api.example.com", "count": 156, "errorCount": 12, "avgDurationMs": 234 }
  ],
  "statusDistribution": { "2xx": 290, "4xx": 38, "5xx": 14 },
  "slowestFlows": [{ "id": "flow_abc", "url": "...", "durationMs": 3200 }]
}
```

---

#### `list_rules`

列出所有规则的摘要信息，通常在 `delete_rule` 或 `toggle_rule` 前调用以获取 rule_id。

```json
[
  { "id": "uuid-xxx", "name": "Mock user API", "type": "map_local",
    "url_pattern": "api.example.com/user", "enabled": true, "source": "ai_mcp", "group": "Default" }
]
```

---

### 写操作 Tool（需 Bearer Token）

#### `create_rule`

创建代理规则，**直接执行**，立即生效，前端规则列表即时刷新。

支持 6 种规则类型，使用简化参数，无需了解内部规则格式。

**map_local** — 返回 Mock 响应：
```json
{ "type": "map_local", "name": "Mock user API", "url_pattern": "api.example.com/user",
  "mock_body": "{\"id\":1}", "mock_status": 200, "mock_content_type": "application/json" }
```

**map_remote** — 重定向到另一个服务器：
```json
{ "type": "map_remote", "name": "Redirect to dev", "url_pattern": "api.example.com",
  "target_url": "http://localhost:3000" }
```

**rewrite_body** — 修改响应体（4 种子模式）：

| `rewrite_mode` | 说明 | 必填参数 |
|---|---|---|
| `set`（默认） | 替换整个 body | `rewrite_content` |
| `replace` | 文本查找替换 | `rewrite_pattern` + `rewrite_replacement` |
| `regex_replace` | 正则查找替换 | `rewrite_pattern` + `rewrite_replacement` |
| `status_code` | 仅修改状态码 | `rewrite_status` |

```json
// 文本替换示例
{ "type": "rewrite_body", "name": "Switch env flag", "url_pattern": "api.example.com/config",
  "rewrite_mode": "replace", "rewrite_pattern": "\"env\":\"production\"",
  "rewrite_replacement": "\"env\":\"staging\"" }
```

**rewrite_header** — 增删改请求/响应 Header：
```json
{ "type": "rewrite_header", "name": "Add debug header", "url_pattern": "api.example.com",
  "header_phase": "request", "header_operation": "set", "header_name": "X-Debug", "header_value": "true" }
```

**throttle** — 模拟网络限速/延迟：
```json
{ "type": "throttle", "name": "Slow network", "url_pattern": "api.example.com",
  "bandwidth_kbps": 100, "delay_ms": 500 }
```

**block_request** — 屏蔽请求：
```json
{ "type": "block_request", "name": "Block analytics", "url_pattern": "analytics.example.com" }
```

所有规则通用参数：
- `method`（可选）：HTTP 方法过滤，如 `POST`
- `intent`（可选）：创建意图说明，显示在规则列表 tooltip

---

#### `delete_rule`

按 ID 删除规则，返回被删规则的名称和来源确认。

```json
// 输入
{ "rule_id": "uuid-xxx" }
// 输出
"Deleted rule 'Mock user API' (id: uuid-xxx, source: ai_mcp)."
```

---

#### `toggle_rule`

启用或禁用规则，无需删除重建。常用于对比有无规则时的行为差异。

```json
// 输入
{ "rule_id": "uuid-xxx", "enabled": false }
// 输出
"Rule 'Mock user API' is now disabled."
```

---

#### `replay_request`

通过 RelayCraft 代理端口重放历史请求，结果出现在流量列表中，可立刻用 `get_flow` 读取。

```json
// 输入
{ "flow_id": "原始请求 ID",
  "modifications": {
    "headers": { "Authorization": "Bearer new_token" },
    "body": "{\"user_id\": \"test_uuid\"}"
  }}
// 输出
{ "new_flow_id": "replay 产生的新 flow ID", "status": 200, "durationMs": 142 }
```

**核心价值**：AI 自己发出的 HTTP 请求 RelayCraft 看不见；通过此 Tool 重放的请求走代理端口，被捕获进流量列表，AI 可立刻读取响应，形成完整的"发送→捕获→分析"闭环。

---

## 标准调试工作流

AI 接入 RelayCraft MCP 后的典型调试流程：

```
1. get_session_stats          ← 快速建立全局认知
2. list_flows (has_error=true) ← 定位有问题的请求
3. get_flow(id)               ← 读取完整请求/响应细节
4. create_rule                ← 创建规则干预（mock / rewrite / redirect）
5. replay_request             ← 重放请求，验证规则效果
6. get_flow(new_flow_id)      ← 读取修改后的响应
7. toggle_rule(false)         ← 临时关掉规则，对比原始行为
8. delete_rule                ← 清理错误的规则，重新创建
```

---

## 安全模型 (Security Model)

### Token 认证

应用启动时生成 Token，存储于 `~/.config/relaycraft/mcp-token`（权限 0600），格式 `rc_<uuid>`。Token **几乎永不变更**——仅在用户手动删除 `mcp-token` 文件时重新生成。设置界面提供一键复制含 Token 的完整接入配置 JSON。

只读操作（read tools）：无需 Token，localhost-only 绑定足够。
写操作（write tools）：必须携带 `Authorization: Bearer <token>` Header，缺失返回 401。

### 写操作风险分级

| 操作 | 风险 | 当前行为 |
|---|---|---|
| `replay_request` | 低（无持久化） | 直接执行 |
| `create_rule` / `toggle_rule` | 中（持久化，可逆） | 直接执行，规则标记 `ai_mcp` 来源 |
| `delete_rule` | 中（可通过重建恢复） | 直接执行，响应中返回被删规则名和来源 |

### 不可越界原则

无论用户如何配置，以下操作永远不通过 MCP 执行：
- 修改代理端口或系统代理配置
- 删除历史流量或 Session 数据
- 访问 RelayCraft 数据目录以外的文件系统

---

## 数据模型 (Data Model)

### Rule 来源标记

```typescript
interface RuleMetadata {
  source?: "user" | "ai_assistant" | "ai_mcp";
  // "user"         — 在 RelayCraft UI 中手动创建
  // "ai_assistant" — 由 RelayCraft 内置 AI 助手创建
  // "ai_mcp"       — 由外部 MCP 工具创建（Claude Desktop、Cursor 等）
  aiIntent?: string;  // AI 描述的创建意图，显示在规则列表 tooltip
}
```

UI 中：`source !== "user"` 的规则左侧显示 ✦ 徽标，tooltip 显示来源类型和 `aiIntent`。

### MCP Config

```rust
pub struct McpConfig {
    pub enabled: bool,  // 默认 false
    pub port: u16,      // 默认 7090
}
```

---

## UI 设计 (Interface Design)

### 设置页（已实现）

设置 → 外部集成 → MCP 服务器

- 开关（默认关闭）+ 端口输入
- 状态徽标（运行中 / 已停止）
- 一键复制接入配置 JSON（含 Token）
- 隐私安全提示（警告色样式）

### 规则来源标识（已实现）

规则列表中 AI 创建的规则：
- 左侧显示 ✦（Sparkles）图标
- 悬停 tooltip 显示来源：`MCP 外部工具创建` / `RelayCraft AI 助手创建` + `aiIntent`

### Phase 3 规划：AI 操作审批面板

```
┌──────────────────────────────────────────────────────────┐
│  AI 提案  (2 条待审批)           [全部批准]  [全部拒绝]  │
├──────────────────────────────────────────────────────────┤
│  ✦ 创建规则：Rewrite Body                                 │
│    Match: api.example.com/orders   意图：复现 422 报错   │
│                             [查看详情]  [拒绝]  [批准] ✓ │
└──────────────────────────────────────────────────────────┘
```

入口：状态栏徽标 `AI 提案 (2)`，不打断当前工作流。

---

## Phase 3 规划 (Future Roadmap)

Phase 2 完成了"AI 可以干什么"，Phase 3 目标是"AI 可以主导什么"。

### 会话级操作管理

AI 在一次调试对话中可能创建多条规则，现在只能逐条管理。

- **AI Session 概念**：将一次 MCP 对话关联的所有写操作打包为 Session，支持一键"撤销本次 AI 操作"
- **批量清理**：`clear_ai_rules` 删除当前 AI Session 创建的所有规则
- **操作审批模式**（高级用户可配置）：AI 写操作先入队，用户在审批面板一键批准，而非立即执行

### 更完整的规则能力暴露

当前 `create_rule` 使用简化参数以降低 AI 出错率，未暴露的能力：

- **高级匹配条件**：regex URL、Host 匹配、Header/Query 参数条件匹配、响应状态码匹配
- **rewrite_body JSON 模式**：通过 JSONPath 修改响应中的特定字段（`$.user.id`）
- **rewrite_header 多操作**：一条规则同时增删多个 Header
- **update_rule**：修改现有规则，而非只能删除重建

### 流量控制扩展

- `create_session` / `activate_session`：通过 MCP 切换流量录制 Session
- `toggle_capture`：控制抓包开关（批量测试时静默）
- `export_flow_curl`：将 flow 导出为 cURL 命令，方便 AI 直接在终端执行

### 实时感知（SSE 推送）

当前 AI 需要主动 poll 才能感知新流量。SSE 支持后 AI 可订阅事件流：

```
GET /mcp/events
← data: {"type": "flow.error", "flow_id": "xxx", "status": 500}
← data: {"type": "flow.slow", "flow_id": "xxx", "durationMs": 5000}
```

AI 可以在后台"守望"流量，5xx 出现时主动介入分析，从被动工具变为主动助手。

### MCP Resources

```
traffic://current-session    当前 Session 的流量摘要（随时间更新）
rules://active               当前启用的规则列表
```

---

## 设计决策 (Design Decisions)

| 决策点 | 选择 | 原因 |
|:---|:---|:---|
| 传输协议 | Streamable HTTP | 支持多客户端并发；stdio 不适合桌面应用 |
| 数据边界 | Session（非时间戳） | AI 上下文语义更清晰；支持历史 Session 对比 |
| MCP SDK | 手写 JSON-RPC | rmcp 尚不稳定；协议简单，自行实现可控性更高 |
| 默认状态 | 默认关闭 | 避免用户不知情下暴露流量数据 |
| 读操作 body 脱敏 | 原样返回 | 本地工具，用户自主决策；AI 分析可能需要完整 Token |
| Token 变更时机 | 手动删除文件才变更 | 1.0 简化实现；Token 轮转 UI 留 1.0 后迭代 |
| 写操作执行时机（Phase 2） | 直接执行 | Proxyman 验证了此方案可接受；审批队列留 Phase 3 |
| delete_rule 权限 | 不限制来源 | Token 即信任边界；响应中回传来源供 AI 自行决策是否告知用户 |
| create_rule 参数风格 | 简化参数 + 示例驱动 | 降低 AI 调用出错率；内部自动转换为完整规则结构 |
| session_id 必填性 | 全部可省略 | 省略时使用当前活跃 Session，减少 AI 调用步骤 |

---

## 开放问题 (Open Questions)

**Q1：`replay_request` 频率限制？**
AI 可能连续重放几十次，可能对被测服务造成压力。是否需要频率限制或用户预授权？目前无限制，待观察实际使用情况。

**Q2：AI Session 和流量 Session 的关系？**
AI Session（MCP 对话上下文）和 RelayCraft Session（流量录制边界）是否应该绑定？绑定后 AI 可以精准感知"本次对话中产生的所有流量"，是 Phase 3 审批系统的前置能力。

**Q3：写操作是否加可选审批模式？**
高级用户可配置"来自 Claude 的 Map Local 规则自动批准"，默认审批。Phase 3 规划，不影响当前直接执行模式。

**Q4：实时 SSE 的客户端支持现状？**
Claude Desktop、Cursor 等客户端对 SSE event stream 的支持程度不一，需等待 MCP 生态成熟后再实现。
