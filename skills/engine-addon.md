# Skill: mitmproxy Addon / 引擎扩展

> 版本：1.0
> 最后更新：2026-02-26
> 适用范围：`engine`

## 适用场景 (When to Use)

- 扩展引擎核心功能（新的 mitmproxy Hook 处理）
- 修改流量处理逻辑
- 开发用户脚本模板
- 调试引擎行为

## 前置条件 (Prerequisites)

- 了解 mitmproxy 12 的 Addon 机制和 Hook 系统
- Python 3.10+ 环境
- `pip install -r engine-core/requirements.txt`

## 步骤 (Steps)

### Step 1: 了解引擎架构

```
engine-core/
├── addons/
│   ├── entry.py          # mitmproxy 入口，加载顺序定义
│   ├── anchor.py         # 流量锚点（最后执行，捕获最终状态）
│   ├── injector.py       # 用户脚本注入
│   └── core/
│       ├── main.py       # CoreAddon 主入口
│       ├── rules/        # 规则引擎
│       │   ├── engine.py   # RuleEngine 管线
│       │   ├── loader.py   # 规则加载与索引
│       │   ├── matcher.py  # URL/Header/Query 匹配
│       │   └── actions.py  # 规则动作执行
│       ├── monitor.py    # TrafficMonitor 流量捕获
│       ├── debug.py      # DebugManager 断点调试
│       ├── proxy.py      # ProxyManager
│       └── utils.py      # 日志和工具函数
```

### Step 2: 了解 Hook 执行顺序

```
request:
  1. CoreAddon.request()
     → 内部请求判断
     → 活跃状态检查
     → 规则引擎 (RuleEngine.handle_request)
     → 断点调试 (DebugManager.should_intercept)
  2. 用户脚本 (injector 加载的 addons)
  3. anchor.py.request() — 最终捕获

response:
  1. CoreAddon.response()
     → 规则引擎 (RuleEngine.handle_response)
     → 断点调试
     → 流量捕获 (TrafficMonitor.handle_response)
  2. 用户脚本
  3. anchor.py.response() — 差异检测与最终状态同步
```

### Step 3: 编写代码

遵循 CoreAddon 的模式。

## 代码模板 (Code Template)

### 扩展 CoreAddon 功能

```python
# 在 CoreAddon 中添加新的处理逻辑

class CoreAddon:
    async def request(self, flow: http.HTTPFlow) -> None:
        # 1. 内部请求判断
        if self.is_internal_request(flow):
            # 处理内部 API
            return

        # 2. 活跃状态检查
        if not is_traffic_active():
            flow.kill()
            return

        try:
            # 3. 规则引擎
            self.rule_engine.handle_request(flow)

            # 4. 你的新逻辑 ← 在这里添加
            self.my_new_handler(flow)

            # 5. 断点调试
            matched_rule = self.debug_mgr.should_intercept(flow)
            if matched_rule:
                await self.debug_mgr.wait_for_resume(flow, "request", rule=matched_rule)
        except Exception as e:
            self.logger.error(f"Critical error: {e}")
```

### 用户脚本模板

```python
"""
Addon Script for RelayCraft
See https://docs.mitmproxy.org/stable/addons-examples/ for more.
"""
from mitmproxy import http, ctx

class Addon:
    def request(self, flow: http.HTTPFlow):
        """在请求发送到服务器前拦截"""
        # 修改请求头
        flow.request.headers["X-Custom-Header"] = "value"

        # 修改请求 URL（转发/远程映射）
        if "api.example.com" in flow.request.url:
            flow.request.url = flow.request.url.replace(
                "api.example.com", "mock.example.com"
            )

    def response(self, flow: http.HTTPFlow):
        """在响应返回到客户端前拦截"""
        # 修改响应头
        flow.response.headers["Access-Control-Allow-Origin"] = "*"

        # 修改响应体
        if flow.request.url.endswith("/api/data"):
            import json
            data = json.loads(flow.response.content)
            data["injected"] = True
            flow.response.content = json.dumps(data).encode()

        # 日志
        ctx.log.info(f"Processed: {flow.request.url}")

addons = [Addon()]
```

### 内部 HTTP API 端点

```python
# 在 TrafficMonitor 中添加新的内部 API

async def handle_request(self, flow: http.HTTPFlow):
    path = flow.request.path or ""

    if path == "/_relay/my_new_endpoint":
        await self._handle_my_endpoint(flow)
        return

async def _handle_my_endpoint(self, flow: http.HTTPFlow):
    """处理自定义内部 API"""
    from mitmproxy.http import Response
    import json

    if flow.request.method == "GET":
        data = {"status": "ok"}
        flow.response = Response.make(
            200,
            json.dumps(data).encode(),
            {"Content-Type": "application/json"}
        )
    elif flow.request.method == "POST":
        body = json.loads(flow.request.content.decode())
        # 处理请求体
        flow.response = Response.make(200, b'{"success": true}')
```

## 检查清单 (Checklist)

- [ ] 所有 Hook 方法有顶层 `try/except`，避免异常传播中断代理
- [ ] 内部请求（`is_internal_request`）在最前面判断并 return
- [ ] 异步 Hook 使用 `async def`，同步操作不要误用 `await`
- [ ] 日志使用 `self.logger`（RelayCraftLogger），不要直接 `print()`
- [ ] 流量数据修改后标记 `flow.metadata["_relaycraft_dirty"] = True`
- [ ] 测试在 `engine-core/addons/tests/` 下添加
- [ ] 遵循 PEP 8 代码风格

## 常见陷阱 (Pitfalls)

1. **未捕获异常导致代理崩溃**：mitmproxy Hook 中的未捕获异常会导致该连接中断，严重时影响整个代理。必须 try/except。
2. **阻塞异步事件循环**：在 `async def` Hook 中使用 `time.sleep()` 或同步 IO 会阻塞整个事件循环。使用 `asyncio.sleep()` 或异步 IO。
3. **修改 flow 后未标记 dirty**：如果在 CoreAddon 之后（如用户脚本中）修改了 flow，需要设置 `flow.metadata["_relaycraft_dirty"] = True`，否则 anchor.py 不会同步最新状态。
4. **内部请求泄漏**：处理内部 API 请求后必须 `return`，否则会进入正常流量处理管线。

## 参考 (References)

- `engine-core/addons/core/main.py` — CoreAddon 完整实现
- `engine-core/addons/core/rules/engine.py` — 规则引擎管线
- `engine-core/addons/core/monitor.py` — 流量监控与内部 API
- `engine-core/addons/core/debug.py` — 断点调试
- [mitmproxy 官方文档](https://docs.mitmproxy.org/stable/addons-examples/)
