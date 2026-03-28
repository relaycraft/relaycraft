# Spec: API Manager Plugin — 接口管理插件

> **状态**：宿主侧扩展已完成，插件本体待开发；Phase 2 / 3 为远期规划
> **优先级**：P1
> **背景**：以插件形式提供轻量级接口管理能力，满足用户在调试流程中主动发起请求、管理接口集合的基本需求。

---

## 目标 (Goals)

在 RelayCraft 中以插件形式提供轻量级接口管理能力：

- 管理接口集合（Collection → Folder → Request）
- 配置多环境变量并在请求中使用 `{{variable}}` 语法，支持内置动态变量（`{{$timestamp}}`、`{{$randomUUID}}`）
- Post-request 声明式提取：将响应字段自动写入环境变量（token 注入等工作流）
- 对接 Swagger/OpenAPI 批量导入接口
- 发送请求并查看响应（通过本地代理，流量同步出现在 Traffic 面板）
- 从 Traffic 流量一键存入集合（RelayCraft 独有融合点）
- 一键为接口创建 Map Local Mock 规则（`rules.createMock`）

---

## 背景 (Context)

**为什么做**：调试工作流中"主动发起请求"与"被动捕获流量"之间存在断层，该插件补齐主动侧，形成完整闭环：

```
发起请求（插件）→ 流量被捕获（Traffic）→ 规则调试 → 再次触发验证
```

**相关现有模块**：

| 模块 | 路径 | 用途 |
|:---|:---|:---|
| 插件系统 | `src/plugins/`, `src-tauri/src/plugins/` | 插件加载/API/Bridge |
| Plugin API | `src/plugins/api.ts` | 当前暴露给插件的能力 |
| 规则命令 | `src-tauri/src/rules/commands.rs` | `save_rule`, `load_all_rules` 等 |
| 规则类型 | `src/types/rules.ts` | `Rule`, `MapLocalAction` 等完整类型 |
| Composer | `src/stores/composerStore.ts`, `src/components/composer/` | 请求发送（`replay_request` command）|
| Traffic Store | `src/stores/trafficStore.ts` | 流量列表，右键菜单注入点 |
| Plugin Bridge | `src-tauri/src/plugins/bridge.rs` | 插件调用后端命令的安全通道 |

---

## 分两部分交付

本 Spec 分为两个独立任务：

- **任务 A**：RelayCraft 宿主侧补齐（**已完成**）
- **任务 B**：API Manager 插件本体开发（依赖任务 A）

---

## 任务 A：RelayCraft 宿主侧补齐（已完成）

| 能力 | 权限 | 实现位置 | 说明 |
|---|---|---|---|
| `http.send` | `network:outbound` | `bridge.rs` → `replay_request_inner` | 通过本地代理发出，绕过 CORS/CSP，流量可被捕获 |
| `storage.*` | 无需 | `plugins/storage.rs`（不暴露为 Tauri command） | 每插件独占目录，key 严格校验 `[a-zA-Z0-9_-]` ≤128字符 |
| `rules.createMock` | `rules:write` | `bridge.rs` → `RuleStorage::save()` | 创建 map_local 规则，`source="plugin:<id>"`，emit `rules-changed` |
| `ui.registerContextMenuItem` | 无需 | `pluginContextMenuStore.ts` | 支持 `when(flow)` 谓词，返回 unregister 函数 |
| `events.on` | 无需 | `api.ts` | 封装 Tauri listen，含竞态保护 |

---

### 任务 A 验收标准

- [ ] `RelayCraft.api.http.send()` 可被声明 `network:outbound` 权限的插件调用，成功发起 HTTP 请求并返回响应
- [ ] `RelayCraft.api.storage` 五个操作（`get/set/delete/list/clear`）均可用；key 非法字符被拒绝；不暴露为公共 Tauri command
- [ ] `RelayCraft.api.rules.createMock()` 可被声明 `rules:write` 权限的插件调用，Rules 页面出现对应 Map Local 规则；`method` 参数可选，不传则匹配所有方法
- [ ] `RelayCraft.api.ui.registerContextMenuItem()` 注册后菜单项出现在 Traffic 右键菜单；unregister 后消失
- [ ] `RelayCraft.api.events.on()` 可成功订阅 Tauri 事件；返回的 unlisten 函数调用后停止接收，提前调用不产生监听泄漏
- [ ] 无安全漏洞：storage key 经过严格校验，不允许路径穿越；`plugin_id` 由 bridge 注入不可伪造

---

## 任务 B：API Manager 插件本体

### 插件基本信息

```
插件目录名：api-manager
插件 ID：com.relaycraft.api-manager
```

**`manifest.json`**：

```json
{
  "id": "com.relaycraft.api-manager",
  "name": "API Manager",
  "version": "1.0.0",
  "description": "Lightweight API collection manager with environment variables and Swagger import.",
  "author": "RelayCraft Team",
  "icon": "BookOpen",
  "capabilities": {
    "ui": {
      "entry": "dist/index.js"
    },
    "i18n": {
      "locales": {
        "zh": "locales/zh.json",
        "en": "locales/en.json"
      },
      "namespace": "api_manager"
    }
  },
  "permissions": [
    "network:outbound",
    "rules:write"
  ],
  "engines": {
    "relaycraft": ">=1.0.0-rc.11"
  }
}
```

---

### 数据模型

```typescript
interface PostExtractRule {
  variable: string;           // 写入哪个环境变量
  from: "body" | "header" | "status";
  path?: string;              // from=body 时用，如 "$.data.token"
  header?: string;            // from=header 时用，如 "Authorization"
}

interface ApiRequest {
  id: string;
  name: string;
  method: "GET" | "POST" | "PUT" | "DELETE" | "PATCH" | "HEAD" | "OPTIONS";
  url: string;              // 支持 {{variable}} 和内置动态变量
  headers: Array<{ key: string; value: string; enabled: boolean }>;
  body: string | null;
  bodyType: "none" | "raw" | "form";
  description?: string;
  postExtract?: PostExtractRule[];  // 响应后自动提取字段写入环境变量
  createdAt: number;
  updatedAt: number;
}

interface ApiFolder {
  id: string;
  name: string;
  requests: ApiRequest[];
}

interface ApiCollection {
  id: string;
  name: string;
  description?: string;
  folders: ApiFolder[];
  requests: ApiRequest[];  // 根层级请求（不在任何 folder 中）
  createdAt: number;
  updatedAt: number;
}

interface Environment {
  id: string;
  name: string;             // "Development", "Staging", "Production"
  variables: Record<string, string>;
  isActive: boolean;
}

interface CollectionMeta {
  id: string;
  name: string;
  description?: string;
  requestCount: number;
  updatedAt: number;
}
```

---

### 存储策略

| storage key | 内容 | 读写时机 |
|---|---|---|
| `environments` | `Environment[]` | 启动时全量读；切换/编辑时全量写 |
| `collections_index` | `CollectionMeta[]` | 启动时读（渲染侧边栏列表）；新建/删除/重命名时写 |
| `collection_{uuid}` | `ApiCollection`（单个） | 打开某集合时读；修改该集合内容时写；删除时 delete |

侧边栏只加载索引（通常 < 5 KB），打开具体集合才加载完整数据。`collections_index` 缺失时通过 `list("collection_")` 自动重建，数据不会丢失。

**插件内 Storage 服务层**（`src/storage.js`，对外屏蔽 key 拼接细节）：

```javascript
const store = RelayCraft.api.storage;

class ApiManagerStorage {
  async getEnvironments() {
    const raw = await store.get("environments");
    return raw ? JSON.parse(raw) : [];
  }
  async saveEnvironments(envs) {
    await store.set("environments", JSON.stringify(envs));
  }

  async loadIndex() {
    const cached = await store.get("collections_index");
    if (cached !== null) return JSON.parse(cached);
    return this._rebuildIndex();
  }

  async _rebuildIndex() {
    const keys = await store.list("collection_");
    const metas = (await Promise.all(
      keys.map(async (key) => {
        const raw = await store.get(key);
        if (!raw) return null;
        const col = JSON.parse(raw);
        return _toMeta(col);
      })
    )).filter(Boolean);
    await store.set("collections_index", JSON.stringify(metas));
    return metas;
  }

  async getCollection(id) {
    const raw = await store.get(`collection_${id}`);
    return raw ? JSON.parse(raw) : null;
  }

  async saveCollection(collection) {
    await store.set(`collection_${collection.id}`, JSON.stringify(collection));
    const index = await this.loadIndex();
    const idx = index.findIndex(m => m.id === collection.id);
    const meta = _toMeta(collection);
    if (idx >= 0) index[idx] = meta; else index.push(meta);
    await store.set("collections_index", JSON.stringify(index));
  }

  async deleteCollection(id) {
    await store.delete(`collection_${id}`);
    const index = await this.loadIndex();
    await store.set("collections_index", JSON.stringify(index.filter(m => m.id !== id)));
  }
}

function _toMeta(col) {
  return {
    id: col.id, name: col.name, description: col.description,
    requestCount: col.requests.length + col.folders.reduce((n, f) => n + f.requests.length, 0),
    updatedAt: col.updatedAt,
  };
}
```

---

### 页面结构

```
图标：BookOpen (lucide-react)
路由：/plugin/api-manager
Order：10
```

```
┌────────────────────────────────────────────────────────┐
│  [环境选择器 ▼]                        [+ New Collection]│
├──────────────┬─────────────────────────────────────────┤
│              │  METHOD ▼  URL输入框              [Send] │
│  Collection  ├─────────────────────────────────────────┤
│  树形导航    │  Tabs: Headers | Body | Extract          │
│              ├─────────────────────────────────────────┤
│  ▶ 我的API   │  Response 区域                           │
│    ▶ 用户模块│  Status: 200  Time: 142ms                │
│      GET /me │  Body / Headers        [创建 Mock 规则]  │
└──────────────┴─────────────────────────────────────────┘
```

---

### 核心功能实现要点

#### 1. 环境变量替换

支持用户定义变量和内置动态变量（以 `$` 开头）：

```javascript
const BUILTIN_VARIABLES = {
  $timestamp:    () => String(Date.now()),
  $isoTimestamp: () => new Date().toISOString(),
  $randomUUID:   () => crypto.randomUUID(),
};

function resolveVariables(text, variables) {
  return text.replace(/\{\{(\w+)\}\}/g, (match, key) => {
    if (key in BUILTIN_VARIABLES) return BUILTIN_VARIABLES[key]();
    return variables[key] ?? match;  // 未定义变量保留原文
  });
}
```

| 变量 | 值 | 典型用途 |
|---|---|---|
| `{{$timestamp}}` | Unix 毫秒时间戳 | 防重放签名、日志追踪 |
| `{{$isoTimestamp}}` | ISO 8601 字符串 | 请求体时间字段 |
| `{{$randomUUID}}` | 随机 UUID v4 | 幂等请求 ID |

#### 2. Swagger / OpenAPI 导入

Phase 1 仅支持 JSON 格式（YAML 需额外解析库，留后续评估）。

远程 URL 获取使用 `RelayCraft.api.http.send()` 而非 `fetch`（绕过 WebView 的 CORS/CSP 限制，流量同时被代理捕获）：

```javascript
async function fetchRemoteSwagger(url) {
  const res = await RelayCraft.api.http.send({ method: "GET", url });
  return JSON.parse(res.body);
}
```

#### 3. 从流量保存（Save to Collection）

```javascript
const unlisten = RelayCraft.api.events.on("plugin:save-to-collection", (payload) => {
  setIncomingFlow(payload);
  setShowSaveModal(true);
});
```

#### 4. 请求发送

```javascript
async function sendRequest(request, activeEnv) {
  const variables = activeEnv?.variables ?? {};
  const resolvedUrl = resolveVariables(request.url, variables);
  const resolvedHeaders = {};
  request.headers
    .filter(h => h.enabled && h.key)
    .forEach(h => {
      resolvedHeaders[resolveVariables(h.key, variables)] =
        resolveVariables(h.value, variables);
    });
  return RelayCraft.api.http.send({
    method: request.method,
    url: resolvedUrl,
    headers: resolvedHeaders,
    body: request.body || null,
  });
}
```

#### 5. Post-Request 提取（自动注入 token）

请求完成后，按 `postExtract` 规则将 response 数据写回环境变量，下次请求通过 `{{variable}}` 自动注入。

```javascript
async function runPostExtract(request, response, activeEnv, allEnvironments) {
  if (!request.postExtract?.length) return;
  let parsedBody = null;
  try { parsedBody = JSON.parse(response.body); } catch (_) {}

  let dirty = false;
  for (const rule of request.postExtract) {
    let value = null;
    if (rule.from === "status") value = String(response.status);
    else if (rule.from === "header" && rule.header)
      value = response.headers[rule.header.toLowerCase()] ?? null;
    else if (rule.from === "body" && parsedBody && rule.path) {
      value = rule.path.replace(/^\$\./, "").split(/[\.\[\]]+/).filter(Boolean)
        .reduce((obj, key) => obj?.[key], parsedBody) ?? null;
    }
    if (value !== null) { activeEnv.variables[rule.variable] = String(value); dirty = true; }
  }
  if (dirty) await storage.saveEnvironments(allEnvironments);
}
```

**UI**：请求编辑区加 "Extract" tab，每行配置：变量名 / 来源（Body/Header/Status）/ 路径或 header 名。

> **完全插件内部实现**，不依赖宿主任何新能力。`http.send` + `storage` 已足够。

#### 6. 创建 Mock 规则

```javascript
async function createMockRule(request, lastResponse) {
  await RelayCraft.api.rules.createMock({
    name: `Mock: ${request.name}`,
    urlPattern: request.url.replace(/\{\{[^}]+\}\}/g, "*"),
    method: request.method,
    responseBody: lastResponse.body,
    statusCode: lastResponse.status,
    contentType: lastResponse.headers["content-type"] ?? "application/json",
  });
  RelayCraft.api.ui.toast("Mock 规则已创建，可在 Rules 页面查看", "success");
}
```

---

### 插件 i18n 键（双语）

**`locales/zh.json`**（关键键列表）：

```json
{
  "title": "接口管理",
  "new_collection": "新建集合",
  "new_folder": "新建分组",
  "new_request": "新建接口",
  "import_swagger": "导入 Swagger",
  "import_swagger_url": "从 URL 导入",
  "import_swagger_paste": "粘贴 JSON",
  "environment": "环境",
  "no_environment": "无环境",
  "send": "发送",
  "save_to_collection": "选择集合",
  "save_to_collection_title": "保存到集合",
  "create_mock": "创建 Mock 规则",
  "response_empty": "发送请求后查看响应",
  "collection_empty": "暂无集合，新建一个开始吧",
  "import_success": "已导入 {{count}} 个接口",
  "import_error": "导入失败",
  "variable_hint": "使用 {{变量名}} 引用环境变量"
}
```

**`locales/en.json`**（同结构，英文值）

---

### 任务 B 验收标准

- [ ] 插件可成功安装并在侧边栏显示"API Manager"图标
- [ ] 可新建 Collection / Folder / Request，刷新应用后数据持久化；`collections_index` 与各 `collection_{id}` 文件内容一致
- [ ] 删除集合后，对应 `collection_{id}` 文件和索引条目均被清除
- [ ] 环境变量定义并切换后，`{{BASE_URL}}` 在 URL 中被正确替换；`{{$timestamp}}`、`{{$randomUUID}}` 每次发送产生新值
- [ ] 配置 `postExtract` 规则后，登录接口返回的 token 自动写入指定环境变量，后续请求的 `{{authToken}}` 被正确替换
- [ ] 粘贴 OpenAPI 3.x JSON，可批量解析并导入接口到选定 Collection
- [ ] 输入远程 Swagger URL，可拉取并解析导入
- [ ] 发送 GET/POST 请求，正确显示状态码、响应 Body
- [ ] Traffic 右键菜单点击"保存到接口集合"，弹窗选择 Collection 后请求被保存
- [ ] 请求发送成功后出现"创建 Mock 规则"按钮，点击后 Rules 页面出现对应 Map Local 规则
- [ ] i18n：插件 UI 中中英文均可正常显示，无硬编码文本

---

## 引用技能 (Required Skills)

开发前**必须**阅读以下文件：

- `AGENTS.md` §3（Constitutional Rules）、§4.1（前端规范）、§4.4（插件系统）
- `skills/tauri-command.md` — 用于 A1/A2 新增 Tauri Command
- `skills/plugin-development.md` — 用于任务 B 插件开发
- `skills/i18n-workflow.md` — 用于所有 i18n 变更

---

## 约束 (Constraints)

- **AGENTS.md §3.1-2**：零遥测、本地优先、前端不直接访问文件系统
- **AGENTS.md §3.3**：所有 `.ts/.tsx` 经过 Biome check，TypeScript strict 模式
- **AGENTS.md §3.4**：插件内所有用户可见文本走 `RelayCraft.api.i18n.t()`，不硬编码
- **安全**：storage `key` 经过严格校验（ASCII `[A-Za-z0-9_-]`，非法字符直接 reject），`plugin_id` 由 bridge 注入不可伪造
- **不引入新 npm 依赖**（宿主侧）；插件产物为单文件 `dist/index.js`（自行打包）
- **UI 风格**：使用 `SharedComponents`（Button/Input/Select/Tabs/Textarea），颜色用主题变量，样式用 Tailwind utilities

---

## 开发顺序建议

```
A1 (http.send)           → 已完成
A2 (storage)             → 已完成
A3 (rules.createMock)    → 已完成
A4 + A5 (events)         → 已完成
Task B (插件本体)         → 待开发
```

---

## Phase 2（待定）：Pre/Post 请求脚本沙箱

**推迟原因**：当前流量处理层用 Python，插件层用 JavaScript，现在再加 JS 用户脚本沙箱会引入第三种脚本上下文，对用户的说明成本高。relay-core 内置 Deno（JS/TS）落地后 Python 脚本退出，脚本能力统一到 JS/TS，届时实现方案也更优（直接借助 Deno 隔离机制，无需 iframe workaround）。**在此之前实现等于做一个将来要替换的中间状态。**

**触发条件**：有用户反馈需要动态签名生成（HMAC、MD5 等）时再排期。

**技术方案（relay-core 落地后参考）**：sandboxed iframe（`sandbox="allow-scripts"`，null origin）+ postMessage 通信。`rc` 对象提供 `request`、`response`、`env` 访问，不暴露宿主 API。`crypto.subtle` 原生可用（HMAC/SHA256/RSA）；MD5 以 ~400B 纯 JS 内联提供。

---

## Phase 3（远期）：API Manager 插件 MCP 集成

现有 MCP server 覆盖流量分析和规则创建（被动侧）；插件侧 MCP 补齐主动侧（集合查询、带环境变量发请求），形成完整 AI 调试闭环。

**方案**：插件在 manifest 声明 `capabilities.mcp.tools`，宿主加载时动态注册到 MCP server；tool call 通过 Tauri event（correlation_id）下发到插件 JS，插件回调 `plugin_call("mcp_tool_response", ...)` 完成闭环。

**宿主需补齐**：MCP server 改动态 tool 列表 + Rust event-response 机制（`HashMap<correlation_id, oneshot::Sender>`）+ manifest schema 扩展。

**固有限制**：WebView 未打开时 tool 调用超时。
