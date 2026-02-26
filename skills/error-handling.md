# Skill: 三层统一错误处理

> 版本：1.0
> 最后更新：2026-02-26
> 适用范围：`fullstack`

## 适用场景 (When to Use)

- 新增涉及异步操作的功能
- 处理 Tauri invoke 调用的错误
- 引擎层的异常捕获
- 任何可能失败的操作

## 前置条件 (Prerequisites)

- 了解 RelayCraft 三层架构（前端 → Rust → Python）
- 了解 `notify` 工具（`src/lib/notify.ts`）

## 步骤 (Steps)

### Step 1: 确定错误发生的层

错误在哪一层产生，就在哪一层首先捕获和格式化。

### Step 2: 层间错误传播

- Python → Rust：通过 HTTP 响应状态码 + 错误信息
- Rust → 前端：通过 `Result<T, String>` 的 `Err` variant
- 前端 → 用户：通过 `notify` 或 UI 状态

### Step 3: 用户通知

根据严重程度选择通知方式。

## 代码模板 (Code Template)

### 前端：Store 中的错误处理

```typescript
import { invoke } from "@tauri-apps/api/core";
import { notify } from "../lib/notify";

// Store action
saveItem: async (data: ItemData) => {
  try {
    await invoke("save_item", { data });
    notify.success(t("items.save_success"), t("sidebar.items"));
  } catch (error) {
    console.error("Failed to save item:", error);
    notify.error(String(error), t("common.error"));
  }
},
```

### 前端：组件中的错误处理

```tsx
const handleAction = async () => {
  try {
    await someAsyncOperation();
  } catch (error) {
    console.error("Action failed:", error);
    notify.error(String(error), t("common.error"));
  }
};
```

### Rust：命令错误处理

```rust
#[tauri::command]
pub fn my_command(param: String) -> Result<MyData, String> {
    // 方式 1：使用 map_err 转换
    let content = fs::read_to_string(&path)
        .map_err(|e| format!("Failed to read file: {}", e))?;

    // 方式 2：使用 anyhow（内部逻辑）
    let result = internal_logic()
        .map_err(|e| e.to_string())?;

    Ok(result)
}

// 内部函数可以使用 anyhow::Result
fn internal_logic() -> anyhow::Result<MyData> {
    let data = parse_data()?; // 自动转换错误类型
    Ok(data)
}
```

### Python：引擎错误处理

```python
class CoreAddon:
    async def request(self, flow: http.HTTPFlow) -> None:
        try:
            self.rule_engine.handle_request(flow)
        except Exception as e:
            self.logger.error(f"Critical error in request: {e}")
            # 不要让异常传播到 mitmproxy 框架，否则会中断代理

    def safe_operation(self, flow):
        """非关键操作用独立 try/except 包裹"""
        try:
            # 操作逻辑
            pass
        except Exception as e:
            self.logger.error(f"Non-critical error: {e}")
            # 继续执行，不中断流量处理
```

### Notify 使用规范

```typescript
import { notify } from "../lib/notify";

// 成功通知（带标题）
notify.success(t("rules.save_success"), t("sidebar.rules"));

// 错误通知（带标题）
notify.error(String(error), t("common.error"));

// 仅 Toast（不进入通知中心）
notify.success(t("titlebar.running"), {
  title: t("sidebar.traffic"),
  toastOnly: true,
});
```

## 检查清单 (Checklist)

- [ ] 所有 `invoke` 调用都有 `try/catch`
- [ ] Rust 命令返回 `Result<T, String>`，所有内部错误通过 `.map_err()` 转换
- [ ] Python 引擎的关键 Hook（request, response, error）有顶层 `try/except`
- [ ] 错误消息对用户友好（非原始堆栈信息）
- [ ] 严重错误使用 `notify.error()`，非关键错误使用 `console.error`
- [ ] 引擎层错误不会导致代理中断

## 常见陷阱 (Pitfalls)

1. **未捕获的 invoke 错误**：忘记 try/catch 会导致 Unhandled Promise Rejection，用户看不到任何提示。
2. **Python 异常传播**：在 mitmproxy hook 中未捕获的异常会导致整个代理引擎不稳定，必须在每个 hook 的顶层 try/except。
3. **错误信息暴露内部细节**：避免将文件路径、堆栈信息直接显示给用户。
4. **错误吞没**：`catch (e) {}` 空 catch 块会掩盖问题，至少 `console.error`。

## 参考 (References)

- `src/lib/notify.ts` — 通知系统
- `src/stores/trafficStore.ts` — 前端错误处理模式
- `src-tauri/src/config.rs` — Rust 命令错误处理
- `engine-core/addons/core/main.py` — Python Hook 错误处理
