# Spec: [功能名称]

> 状态：`draft` | `review` | `approved` | `in-progress` | `done`
> 优先级：`P0-critical` | `P1-high` | `P2-medium` | `P3-low`
> 创建日期：YYYY-MM-DD
> 关联 Issue：#xxx

## 目标 (Goals)

- [ ] 简洁描述该功能要实现什么（一句话）
- [ ] 可量化的交付物

## 背景 (Context)

为什么需要这个功能？当前痛点是什么？

### 相关模块

- `src/components/xxx/` — 相关前端组件
- `src-tauri/src/xxx/` — 相关 Rust 模块
- `engine-core/addons/core/xxx.py` — 相关引擎模块

## 数据模型 (Data Model)

### TypeScript 类型

```typescript
interface NewFeatureData {
  id: string;
  // ...
}
```

### Rust 结构体（如需）

```rust
#[derive(Serialize, Deserialize)]
pub struct NewFeature {
    // ...
}
```

### Python 数据结构（如需）

```python
# 描述涉及的数据结构
```

## 接口契约 (Interface Contract)

### 前端 Store 变更

- `useXxxStore`：新增 action `doSomething()`
- 新增 Store `useNewStore`（如需）

### Tauri Commands

```
command_name(arg1: Type1, arg2: Type2) -> Result<ReturnType, String>
```

### Python Engine API（如需）

```
POST /_relay/xxx
Body: { ... }
Response: { ... }
```

## 引用技能 (Required Skills)

- MUST USE `skills/react-component.md` — 组件创建
- MUST USE `skills/tauri-command.md` — Tauri 命令实现
- SHOULD USE `skills/i18n-workflow.md` — 国际化

## 实现计划 (Implementation Plan)

1. **Phase 1**: 数据层 (Types + Store + Rust Command)
2. **Phase 2**: UI 层 (Components)
3. **Phase 3**: 引擎层 (Python, 如需)
4. **Phase 4**: 测试 + 文档

## 验收标准 (Acceptance Criteria)

- [ ] 功能正常工作（描述具体场景）
- [ ] 通过 `pnpm lint` + `pnpm test`
- [ ] 通过 `cargo test`
- [ ] i18n 覆盖（zh.json + en.json 同步更新）
- [ ] 无 TypeScript 类型错误
- [ ] 三平台兼容（如涉及系统 API）

## 约束 (Constraints)

- 遵循 `AGENTS.md` §三 的不可违反原则
- （列出该功能特有的约束）

## 设计决策 (Design Decisions)

| 决策点 | 选项 A | 选项 B | 选择 | 原因 |
|:---|:---|:---|:---|:---|
| ... | ... | ... | ... | ... |
