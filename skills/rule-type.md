# Skill: 规则类型端到端实现

> 版本：1.0
> 最后更新：2026-02-26
> 适用范围：`fullstack`

## 适用场景 (When to Use)

- 新增一种规则类型（如新的流量操控动作）
- 修改现有规则类型的行为
- 扩展规则匹配能力

## 前置条件 (Prerequisites)

- 了解规则引擎管线架构（`RuleEngine` → `RuleLoader` → `RuleMatcher` → `ActionExecutor`）
- 依赖技能：`skills/tauri-command.md`, `skills/react-component.md`, `skills/i18n-workflow.md`

## 步骤 (Steps)

### Step 1: 定义 TypeScript 类型

在 `src/types/rules.ts` 中添加新的 Action 接口和类型守卫。

### Step 2: 更新 RuleType 联合类型

将新类型添加到 `RuleType` 和 `RuleAction` 联合类型中。

### Step 3: 实现前端 UI

在 `src/components/rules/form/actions/` 下创建对应的表单组件。

### Step 4: Rust 持久化

确保 Rust 端的规则序列化/反序列化兼容新类型（YAML 格式，serde 自动处理）。

### Step 5: Python 引擎执行

在 `engine-core/addons/core/rules/actions.py` 的 `ActionExecutor` 中添加执行逻辑。

### Step 6: 引擎管线注册

在 `engine-core/addons/core/rules/engine.py` 的 `execute_pipeline` 中添加新类型的执行位置。

### Step 7: 国际化

添加新规则类型的翻译键。

## 代码模板 (Code Template)

### TypeScript 类型定义

```typescript
// src/types/rules.ts

// 1. 添加到 RuleType 联合
export type RuleType =
  | "map_local"
  | "map_remote"
  // ...
  | "my_new_type"; // ← 新增

// 2. 定义 Action 接口
export interface MyNewTypeAction {
  type: "my_new_type";
  param1: string;
  param2?: number;
}

// 3. 添加到 RuleAction 联合
export type RuleAction =
  | MapLocalAction
  // ...
  | MyNewTypeAction; // ← 新增

// 4. 类型守卫
export function isMyNewTypeAction(action: RuleAction): action is MyNewTypeAction {
  return action.type === "my_new_type";
}
```

### Python 执行器

```python
# engine-core/addons/core/rules/actions.py

class ActionExecutor:
    def apply_my_new_type(self, flow: http.HTTPFlow, action: dict, url_match=None):
        """Execute my_new_type action"""
        try:
            param1 = action.get("param1", "")
            param2 = action.get("param2", 0)
            # 实现逻辑
            self.logger.info(f"Pipeline: [MY_NEW_TYPE] Applied to {flow.request.url}")
        except Exception as e:
            self.logger.error(f"[MY_NEW_TYPE] Error: {e}")
```

### 管线注册

```python
# engine-core/addons/core/rules/engine.py — execute_pipeline 方法中

# 在适当的位置添加（注意执行顺序）
if phase == "request":
    # ... 现有类型 ...
    for a in [act for act in all_actions if act.get("type") == "my_new_type"]:
        self.executor.apply_my_new_type(flow, a, a.get("_url_match_transient"))
```

## 检查清单 (Checklist)

- [ ] TypeScript 类型：添加 Action 接口 + 联合类型 + 类型守卫
- [ ] 前端 UI：规则表单组件支持新类型配置
- [ ] Rust 持久化：YAML 序列化兼容（通常 serde 自动处理）
- [ ] Python 执行：`ActionExecutor` 中添加执行方法
- [ ] 管线注册：在 `execute_pipeline` 中定义执行顺序
- [ ] i18n：添加新类型名称和描述的翻译
- [ ] 测试：`engine-core/addons/tests/test_actions.py` 中添加测试用例
- [ ] 主题色：在 `src/lib/utils.ts` 的 `getRuleTypeDotClass` 中添加颜色映射

## 常见陷阱 (Pitfalls)

1. **管线顺序错误**：规则执行有严格顺序（throttle → block → map → rewrite），新类型需要仔细考虑在管线中的位置。
2. **忘记终止标记**：如果新类型会中断请求（类似 block_request），需要设置 `flow.metadata["_relaycraft_terminated"] = True`。
3. **响应阶段遗漏**：某些规则类型需要在 request 和 response 两个阶段都执行（如 rewrite_header），需要在两个阶段的管线中都注册。
4. **TypeScript/Python 类型不同步**：确保前端类型定义与 Python 引擎读取的字段完全一致。

## 参考 (References)

- `src/types/rules.ts` — 完整类型定义
- `src/components/rules/form/actions/` — 规则表单组件目录
- `engine-core/addons/core/rules/engine.py` — 管线执行逻辑
- `engine-core/addons/core/rules/actions.py` — Action 执行器
- `engine-core/addons/core/rules/matcher.py` — 匹配器
- `engine-core/addons/tests/test_actions.py` — 动作测试
