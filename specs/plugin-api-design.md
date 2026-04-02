# Spec: Plugin API Design (1.0-pre)

> 状态：`approved`
> 优先级：`P0-critical`
> 创建日期：2026-04-03
> 关联 Issue：N/A

## 目标 (Goals)

- [x] 统一 RelayCraft 插件 API 的命名空间规划，避免后续能力扩展时出现命名漂移和破坏性变更
- [x] 以当前已实现能力为基线，定义 1.x 可持续演进的稳定契约
- [x] 在不侵入主架构前提下，为插件生态提供可预期的能力边界和权限模型

## 非目标 (Non-Goals)

- 本文档不直接实现新 API，只定义规范与分期
- 本文档不调整现有引擎抓包主流程，不引入第二套流量处理真源
- 本文档不在 1.0-pre 引入跨插件事件总线

## 背景 (Context)

当前插件 API 实际实现入口位于：

- `src/types/plugin.ts`（类型契约）
- `src/plugins/api.ts`（前端注入对象）
- `src-tauri/src/plugins/bridge.rs`（权限网关 + 后端桥接）

插件仓库文档位于：

- `relaycraft-plugins/CONTRIBUTING.md`
- `relaycraft-plugins/CONTRIBUTING.zh-CN.md`

现状问题：

1. 文档与实现存在轻微偏差（例如文档出现 `settings.save`，实际未暴露）。
2. 插件生态进入 1.0-pre 收口阶段，需要明确“最终可依赖能力”边界，避免插件开发者反复适配。
3. 1.0-pre 阶段需要在“能力上限”和“架构稳定”之间取得平衡。

## 设计原则 (Design Principles)

1. **代码即真源**：运行时可调用能力以 `src/types/plugin.ts` + `src/plugins/api.ts` 为准，文档必须跟随代码演进。
2. **命名稳定优先**：一旦进入稳定命名空间，语义不可随意改变；新增能力优先追加方法，不改已有签名。
3. **最小权限原则**：每个受限能力必须有对应 `permissions`，并在 bridge 层统一校验。
4. **层次清晰**：前端 UI 扩展、宿主能力、引擎流量能力分别归属不同 namespace，不混用。
5. **渐进开放**：高吞吐能力先提供“拉取/查询”版本，再评估“实时订阅”版本。

## API 版本与命名空间策略 (Versioning & Namespaces)

### 1. 版本策略

- 对外统一认定当前为 **Plugin API v1**（即现有 `RelayCraft.api.*`）。
- 1.x 内遵循“**只增不改**”：
  - 可新增方法/字段（向后兼容）。
  - 不删除或重命名已有稳定字段。
  - 不改变既有字段语义。
- 若发生破坏性变更，必须进入 `v2` 命名空间，不在 `v1` 内直接替换。

### 2. 命名空间总览

稳定（已有）：

- `i18n`
- `theme`
- `ui`
- `ai`
- `stats`
- `proxy`
- `settings`
- `log`
- `http`
- `storage`
- `events`
- `rules`

稳定（1.0-pre 已确定）：

- `traffic`
- `host`

明确不在 1.0-pre 提供：

- `bus` / `events.crossPlugin.*`（跨插件通信总线）

## 命名规范 (Naming Conventions)

### 方法命名

- 命名风格：`camelCase`
- 语义约定：
  - 查询列表：`listXxx` / `searchXxx`
  - 查询单体：`getXxx`
  - 执行动作：`createXxx` / `updateXxx` / `deleteXxx` / `replayXxx`
  - 订阅事件：`subscribeXxx`（返回 `unsubscribe`）

### 参数与返回

- TypeScript 侧使用 `camelCase` 字段。
- Rust bridge 内可做 `serde(rename_all = "camelCase")` 适配。
- 返回对象字段保持稳定，新增字段只能追加，且应提供默认值语义。

### 错误模型

- 保持当前 `Result<T, String>` 风格（bridge 对外字符串错误）。
- 错误文案建议统一前缀：`Security Violation: ...`、`Invalid Args: ...`、`Host Error: ...`。

## 当前能力基线 (Baseline in 1.0-pre)

以下能力已在主仓库实现，可视为 v1 基线：

- `api.i18n.{t,language,onLanguageChange,registerLocale}`
- `api.theme.{register,set}`
- `api.ui.{registerPage,registerSlot,toast,registerContextMenuItem,components}`
- `api.ai.{chat,isEnabled}`
- `api.stats.getProcessStats`
- `api.proxy.getStatus`
- `api.settings.get`
- `api.log.{info,warn,error}`
- `api.http.send`
- `api.storage.{get,set,delete,list,clear}`
- `api.events.on`
- `api.rules.{createMock,list,get}`
- `api.traffic.{listFlows,getFlow}`
- `api.host.getRuntime`

> 文档对齐要求：`relaycraft-plugins` 仓库对外文档需以此清单为主，避免“文档有但运行时没有”的 API。

## 权限矩阵 (Permission Matrix)

| Namespace | Method | Permission | 备注 |
|:---|:---|:---|:---|
| `stats` | `getProcessStats` | `stats:read` | 已实现 |
| `proxy` | `getStatus` | `proxy:read` | 已实现 |
| `ai` | `chat` | `ai:chat` | 已实现 |
| `http` | `send` | `network:outbound` | 已实现 |
| `rules` | `createMock` | `rules:write` | 已实现 |
| `rules` | `list/get` | `rules:read` | 已实现 |
| `traffic` | `listFlows/getFlow` | `traffic:read` | 已实现 |
| `storage` | `*` | 无 | 插件隔离命名空间，已实现 |

## 1.x 能力分期 (Aligned with Current Product Decisions)

### 1.0-pre Final（当前锁定）

1. `traffic` 采用**基础分页模型**：`offset + limit`（不提供游标 poll）
2. `traffic.getFlow` 提供详情读取，按需读取 body（`includeBodies`）
3. `host.getRuntime` 提供宿主运行态读取（拉取式）
4. `rules.list/get` 提供规则读能力，与 `rules.createMock` 构成写读闭环

建议形态：

```ts
api.traffic.listFlows({ offset, limit, ...filters })
api.traffic.getFlow(flowId)
api.host.getRuntime()
api.rules.list(filter?)
api.rules.get(id)
```

### Phase B（后续可选增强）

- 增量读取能力（可选）：仅当 `offset/limit` 模式不能满足性能要求时再引入游标/订阅
  - 必须支持宿主侧过滤（host/method/path 等）以控制吞吐
  - 默认限流与背压策略必须先定义
  - 初期建议标记为 experimental，不直接承诺长期稳定语义

### Phase C（1.x 后段或 2.0 前评估）

- 跨插件事件总线（延后，不纳入 1.0-pre）

## 明确暂不提供 (Deferred / Not in Scope)

1. 跨插件通信总线当前不提供。
2. 宿主配置订阅（`host.onChanged`）当前不提供，仅提供 `host.getRuntime` 拉取版。
3. `traffic` 游标/实时订阅当前不提供（优先稳定分页读取）。

## 兼容性与废弃策略 (Compatibility & Deprecation)

1. **软废弃**：先文档标注 `@deprecated`，并提供替代 API。
2. **观测期**：至少经历一个小版本周期后，才允许在下一个主版本删除。
3. **变更公告**：主仓库 CHANGELOG 与插件仓库 CONTRIBUTING 同步更新。

## 对 `relaycraft-plugins` 文档的同步要求

需同步修订两份文档：

- `/Users/beta/Projects/relaycraft/relaycraft-plugins/CONTRIBUTING.md`
- `/Users/beta/Projects/relaycraft/relaycraft-plugins/CONTRIBUTING.zh-CN.md`

同步内容：

1. 标注当前 API 为 v1 基线（1.0-pre final），增加“代码真源”说明。
2. 删除或标记未实现 API（如 `settings.save`）为“规划中”。
3. 增加权限矩阵表，与主仓库保持一致。
4. 将 `traffic` 文案统一为 `listFlows(offset+limit)`，移除 `pollFlows/searchFlows` 的主叙事。
5. 增加 `rules.list/get` 与 `host.getRuntime` 的稳定说明。

## 验收标准 (Acceptance Criteria)

- [x] 形成一份可作为 1.x 插件 API 演进依据的规范文档（本文件）
- [x] 明确“已实现能力 / 规划能力 / 延后能力”边界
- [x] 命名规则、权限模型、兼容策略可直接用于后续评审
- [ ] `relaycraft-plugins` 文档可据此进行对齐修订

## 约束 (Constraints)

- 遵循 `AGENTS.md` §3 安全与架构约束
- 不破坏现有 `RelayCraft.api` 调用方式
- 不在宿主层复制引擎抓包主逻辑

## 后续实现建议 (Execution Notes)

1. 每新增一个受限 API，必须同步 bridge 权限校验与审计日志策略。
2. 新 API 上线时，同时更新：
   - 主仓库 `specs/` 对应实现 Spec
   - `relaycraft-plugins` 中英文贡献文档
   - 示例插件（建议使用 `api-manager` 作为首个消费方）
