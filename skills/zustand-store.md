# Skill: Zustand Store 状态管理

> 版本：1.0
> 最后更新：2026-02-26
> 适用范围：`frontend`

## 适用场景 (When to Use)

- 需要创建新的全局状态模块
- 修改/扩展现有 Store
- 处理异步操作（Tauri invoke、网络请求）

## 前置条件 (Prerequisites)

- 了解 Zustand v5 API
- 了解 Tauri invoke 通信机制
- 依赖技能：`skills/tauri-command.md`（如果 Store 需要调用 Rust 命令）

## 步骤 (Steps)

### Step 1: 创建 Store 文件

在 `src/stores/` 目录下创建，命名：`use[Domain]Store.ts`。

### Step 2: 定义接口

先定义 Store 的 State 和 Actions 接口。

### Step 3: 实现 Store

使用 `create<StoreInterface>()` 创建。

### Step 4: 在组件中使用

使用选择器模式订阅。

## 代码模板 (Code Template)

### 标准 Store

```typescript
import { invoke } from "@tauri-apps/api/core";
import { create } from "zustand";
import { notify } from "../lib/notify";

// ==================== Type Definitions ====================

interface MyData {
  id: string;
  name: string;
}

interface MyStore {
  // ========== State ==========
  items: MyData[];
  selectedId: string | null;
  loading: boolean;

  // ========== Actions ==========
  fetchItems: () => Promise<void>;
  addItem: (item: MyData) => void;
  selectItem: (id: string | null) => void;
  deleteItem: (id: string) => Promise<void>;
}

// ==================== Store Implementation ====================

export const useMyStore = create<MyStore>((set, get) => ({
  // ========== Initial State ==========
  items: [],
  selectedId: null,
  loading: false,

  // ========== Actions ==========

  fetchItems: async () => {
    set({ loading: true });
    try {
      const items = await invoke<MyData[]>("list_my_items");
      set({ items });
    } catch (error) {
      console.error("Failed to fetch items:", error);
      notify.error(String(error));
    } finally {
      set({ loading: false });
    }
  },

  addItem: (item) => {
    set((state) => ({ items: [...state.items, item] }));
  },

  selectItem: (id) => {
    set({ selectedId: id });
  },

  deleteItem: async (id) => {
    try {
      await invoke("delete_my_item", { id });
      set((state) => ({
        items: state.items.filter((item) => item.id !== id),
        selectedId: state.selectedId === id ? null : state.selectedId,
      }));
    } catch (error) {
      console.error("Failed to delete item:", error);
      notify.error(String(error));
    }
  },
}));
```

### 组件中使用选择器

```tsx
// 正确：选择器模式，仅在 items 变化时重渲染
const items = useMyStore((state) => state.items);
const fetchItems = useMyStore((state) => state.fetchItems);

// 正确：在事件处理器中直接调用 getState()
const handleClick = () => {
  useMyStore.getState().addItem(newItem);
};

// 错误：订阅整个 Store
// const store = useMyStore(); ← 不要这样做
```

### 跨 Store 通信

```typescript
// 在一个 Store 内部调用另一个 Store 的 action
import { useOtherStore } from "./otherStore";

// Store 内部
someAction: async () => {
  // 通过 getState() 访问其他 Store
  const otherData = useOtherStore.getState().someData;
  await useOtherStore.getState().someAction();
},
```

## 检查清单 (Checklist)

- [ ] Store 文件放在 `src/stores/` 目录
- [ ] 命名为 `use[Domain]Store.ts`，导出为 `use[Domain]Store`
- [ ] 先定义完整的 TypeScript 接口（State + Actions）
- [ ] 异步操作使用 `try/catch`，错误通过 `notify.error()` 或 `console.error` 处理
- [ ] 加载状态使用 `loading` 字段
- [ ] 组件中使用选择器模式订阅
- [ ] set 的 updater 函数使用回调形式 `set((state) => ({...}))` 处理依赖当前状态的更新

## 常见陷阱 (Pitfalls)

1. **直接订阅整个 Store**：`const { items, loading } = useMyStore()` 会在 Store 任何字段变更时重渲染。应分别用选择器：`useMyStore((s) => s.items)` 和 `useMyStore((s) => s.loading)`。
2. **异步操作中忘记 error handling**：`invoke` 可能抛异常，必须 try/catch。
3. **set 中直接读取 state**：在 `set()` 内需要基于当前状态更新时，使用回调形式 `set((state) => ...)` 而非 `set({ items: get().items.filter(...) })`（后者在并发场景下可能读到旧值）。
4. **循环依赖**：Store A 的初始化代码直接 import Store B，Store B 又 import Store A。使用 `getState()` 动态访问来避免。

## 参考 (References)

- `src/stores/uiStore.ts` — 简单 UI 状态 Store 示例
- `src/stores/trafficStore.ts` — 复杂 Store（含 LRU 缓存、异步加载）
- `src/stores/ruleStore.ts` — 带 CRUD 操作的 Store
- `src/stores/settingsStore.ts` — 配置管理 Store
