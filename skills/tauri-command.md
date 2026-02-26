# Skill: Tauri Command 端到端实现

> 版本：1.0
> 最后更新：2026-02-26
> 适用范围：`fullstack`

## 适用场景 (When to Use)

- 前端需要调用一个新的系统/后端功能
- 需要在 Rust 层新增 API
- 任何涉及文件系统、系统调用、进程管理的操作

## 前置条件 (Prerequisites)

- 了解 Tauri v2 的 Command 机制
- 了解 Rust 的 `serde` 序列化
- 依赖技能：`skills/zustand-store.md`（如果涉及 Store 调用）

## 步骤 (Steps)

### Step 1: 在 Rust 端定义 Command

在对应模块的 `commands.rs` 中添加命令。

### Step 2: 在 `lib.rs` 注册命令

在 `invoke_handler` 宏中添加命令路径。

### Step 3: 在前端调用

通过 `invoke` 函数调用，确保参数名使用 camelCase（Tauri 自动转换）。

### Step 4: 添加类型安全

在前端定义返回类型。

## 代码模板 (Code Template)

### Rust 端：命令定义

```rust
// src-tauri/src/my_module/commands.rs

use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct MyResponse {
    pub id: String,
    pub name: String,
    pub count: u32,
}

/// 简单查询命令
#[tauri::command]
pub fn get_my_data(id: String) -> Result<MyResponse, String> {
    // 实现逻辑
    Ok(MyResponse {
        id,
        name: "example".to_string(),
        count: 42,
    })
}

/// 带状态的命令
#[tauri::command]
pub fn update_my_data(
    state: tauri::State<'_, MyState>,
    id: String,
    name: String,
) -> Result<(), String> {
    let mut data = state.data.lock().map_err(|e| e.to_string())?;
    // 修改状态
    Ok(())
}

/// 异步命令
#[tauri::command]
pub async fn fetch_remote_data(url: String) -> Result<String, String> {
    let response = reqwest::get(&url)
        .await
        .map_err(|e| format!("Request failed: {}", e))?;
    let body = response
        .text()
        .await
        .map_err(|e| format!("Failed to read body: {}", e))?;
    Ok(body)
}
```

### Rust 端：注册命令

```rust
// src-tauri/src/lib.rs — 在 invoke_handler 宏中添加

.invoke_handler(tauri::generate_handler![
    // ... 现有命令 ...
    my_module::commands::get_my_data,
    my_module::commands::update_my_data,
    my_module::commands::fetch_remote_data,
])
```

### 前端：调用命令

```typescript
import { invoke } from "@tauri-apps/api/core";

// 定义返回类型（与 Rust 的 Serialize 结构体对应）
interface MyResponse {
  id: string;
  name: string;
  count: number;
}

// 调用命令（参数名 camelCase，Tauri 自动转 snake_case）
const data = await invoke<MyResponse>("get_my_data", { id: "123" });

// 无返回值的命令
await invoke("update_my_data", { id: "123", name: "new name" });

// 错误处理
try {
  const result = await invoke<string>("fetch_remote_data", { url: "https://..." });
} catch (error) {
  console.error("Command failed:", error); // error 是 Rust 的 Err(String)
}
```

## 检查清单 (Checklist)

- [ ] Rust 命令函数添加 `#[tauri::command]` 宏
- [ ] 返回类型为 `Result<T, String>`
- [ ] 输入/输出结构体添加 `Serialize, Deserialize` derive
- [ ] 命令在 `lib.rs` 的 `invoke_handler` 中注册
- [ ] 前端 `invoke` 参数名使用 camelCase（Tauri 自动转换为 Rust 的 snake_case）
- [ ] 前端定义了与 Rust 结构体对应的 TypeScript 接口
- [ ] 错误情况正确处理（Rust 端 `.map_err()`，前端 try/catch）
- [ ] 如果命令需要 Tauri State，使用 `state: tauri::State<'_, T>` 参数

## 常见陷阱 (Pitfalls)

1. **参数命名不匹配**：前端 `invoke("cmd", { myParam: 1 })` 对应 Rust 的 `fn cmd(my_param: i32)`。Tauri 自动 camelCase → snake_case 转换，但**前端必须用 camelCase**。
2. **忘记注册命令**：新增命令后必须在 `lib.rs` 的 `generate_handler!` 中注册，否则前端调用会报 "unknown command" 错误。
3. **序列化类型不匹配**：Rust 的 `u32` 对应 JS 的 `number`，`Vec<String>` 对应 `string[]`。注意 Rust 的 `Option<T>` 序列化为 `null`（非 `undefined`）。
4. **异步命令**：涉及网络请求或文件 IO 的命令应使用 `async`，否则会阻塞 Tauri 主线程。
5. **大数据传输**：避免通过 invoke 传输超大 payload（>10MB），考虑使用文件系统中转。

## 参考 (References)

- `src-tauri/src/config.rs` — `save_config` / `load_config` 命令实现
- `src-tauri/src/rules/commands.rs` — CRUD 命令模式
- `src-tauri/src/ai/commands.rs` — 异步命令 + State 注入
- `src-tauri/src/plugins/commands.rs` — 复杂命令系统
