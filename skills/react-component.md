# Skill: React 组件开发

> 版本：1.0
> 最后更新：2026-02-26
> 适用范围：`frontend`

## 适用场景 (When to Use)

- 创建新的 React 组件
- 修改/扩展现有组件
- 创建基础 UI 组件（Button, Input 等通用组件）

## 前置条件 (Prerequisites)

- 了解 RelayCraft 的 Tailwind CSS 主题变量体系（HSL CSS 变量）
- 了解 `cn()` 工具函数（`src/lib/utils.ts`）

## 步骤 (Steps)

### Step 1: 确定组件归属目录

```
src/components/
├── common/       # 可复用基础组件（Button, Modal, Select, Input...）
├── traffic/      # 流量监控功能
├── rules/        # 规则引擎 UI
│   ├── form/     # 规则表单子组件
│   └── hooks/    # 规则相关 Hooks
├── ai/           # AI 助手
├── composer/     # 请求构造器
├── scripts/      # 脚本编辑器
├── settings/     # 设置面板
├── plugins/      # 插件容器
├── layout/       # 布局（TitleBar, Sidebar, StatusBar）
├── notifications/ # 通知
└── session/      # 会话管理
```

### Step 2: 创建组件文件

文件名使用 PascalCase，与导出组件同名。每个组件一个文件。

### Step 3: 编写组件代码

遵循下面的代码模板。

### Step 4: 国际化

所有用户可见文本使用 `useTranslation()` 的 `t()` 函数。

### Step 5: 验证

- 运行 `pnpm lint` 确认无 Biome 错误
- 确认 `zh.json` 和 `en.json` 同步更新

## 代码模板 (Code Template)

### 基础功能组件

```tsx
import { useTranslation } from "react-i18next";
import { cn } from "../../lib/utils";

interface MyComponentProps {
  className?: string;
  // 定义 Props
}

export const MyComponent = ({ className }: MyComponentProps) => {
  const { t } = useTranslation();

  return (
    <div className={cn("base-styles", className)}>
      {t("module.key")}
    </div>
  );
};
```

### 基础 UI 组件（CVA 变体模式）

```tsx
import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";
import { cn } from "../../lib/utils";

const myComponentVariants = cva(
  "base-styles-shared-by-all-variants",
  {
    variants: {
      variant: {
        default: "variant-default-styles",
        secondary: "variant-secondary-styles",
      },
      size: {
        default: "h-8 px-4 text-ui",
        sm: "h-7 px-3 text-xs",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface MyComponentProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof myComponentVariants> {}

const MyComponent = React.forwardRef<HTMLDivElement, MyComponentProps>(
  ({ className, variant, size, ...props }, ref) => {
    return (
      <div
        className={cn(myComponentVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    );
  },
);
MyComponent.displayName = "MyComponent";

export { MyComponent, myComponentVariants };
```

### 带 Store 的功能组件

```tsx
import { useTranslation } from "react-i18next";
import { useMyStore } from "../../stores/myStore";
import { cn } from "../../lib/utils";

export const MyFeatureComponent = () => {
  const { t } = useTranslation();
  // 使用选择器订阅，优化重渲染
  const data = useMyStore((state) => state.data);
  const doAction = useMyStore((state) => state.doAction);

  return (
    <div className="p-4">
      <h2 className="text-ui font-bold">{t("feature.title")}</h2>
      {/* 组件内容 */}
    </div>
  );
};
```

## 检查清单 (Checklist)

- [ ] 使用函数组件 + Hooks（禁止 class 组件）
- [ ] 样式使用 Tailwind CSS utility classes + `cn()` 合并
- [ ] 颜色使用主题变量（`text-foreground`, `bg-background`, `text-primary` 等）
- [ ] 图标使用 `lucide-react`
- [ ] 所有用户可见文本经过 `t()` 国际化
- [ ] 基础组件使用 `forwardRef` 暴露 ref
- [ ] 基础组件使用 CVA 定义变体
- [ ] Store 订阅使用选择器模式 `useStore((state) => state.xxx)`
- [ ] 文件名 PascalCase，与导出组件同名
- [ ] 动画使用 `framer-motion`（如需）

## 常见陷阱 (Pitfalls)

1. **直接订阅整个 Store**：`const store = useMyStore()` 会导致该 Store 任何变更都触发重渲染。应使用选择器 `useMyStore((state) => state.specificField)`。
2. **硬编码颜色值**：禁止 `text-blue-500` 这类固定颜色（主题色除外），应使用语义化变量 `text-primary`, `text-muted-foreground`。
3. **忘记 i18n**：新增的按钮文本、标签、提示信息都需要走 `t()` 函数。
4. **内联 style 对象**：除 `framer-motion` 动画属性外，禁止使用 `style={{}}`，一律使用 Tailwind classes。

## 参考 (References)

- `src/components/common/Button.tsx` — CVA 变体模式标杆
- `src/components/common/Modal.tsx` — 弹窗组件模式
- `src/components/traffic/TrafficListItem.tsx` — 列表项组件模式
- `src/lib/utils.ts` — `cn()` 函数定义
