# Skill: 插件 UI 开发

> 版本：1.0
> 最后更新：2026-03-29
> 适用范围：`frontend`

## 适用场景 (When to Use)

- 开发新的 RelayCraft 官方/第三方插件
- 为插件添加 UI 界面
- 处理插件样式与宿主的隔离和主题兼容

## 前置条件 (Prerequisites)

- 了解宿主三层架构（参考 `AGENTS.md` §二）
- 了解插件系统基本概念（参考 `AGENTS.md` §4.4）
- 依赖的技能：`skills/react-component.md`、`skills/i18n-workflow.md`

---

## 核心原则

### 样式完全自包含

**所有插件都是独立仓库**，无法依赖宿主的 Tailwind 构建时扫描。因此插件必须：

1. 自行搭建 Tailwind + PostCSS 构建管线
2. 通过 CSS 变量桥接宿主主题
3. 用 `.{plugin-name}-root`（如 `.api-manager-root`）scope 所有 CSS 规则，避免样式污染

### 宿主暴露的资源

插件通过 `globalThis.RelayCraft` 获取宿主资源：

```typescript
const { api, components, icons } = globalThis.RelayCraft;
```

---

## 步骤 (Steps)

### Step 1: 插件项目结构

```
my-plugin/
├── src/
│   ├── main.ts          # 入口，注册页面/功能
│   ├── plugin.css        # 插件自有样式 (Tailwind + 自定义)
│   ├── types.ts          # 类型定义
│   └── ui/
│       ├── panels.ts     # UI 渲染逻辑
│       └── modals.ts     # 弹窗渲染逻辑
├── vite.config.ts        # Vite 构建配置 (含 PostCSS)
└── index.js              # 构建产物 (IIFE)
```

### Step 2: Vite + Tailwind + CSS 隔离管线

`vite.config.ts` 中配置：

```typescript
import cssInjectedByJs from "vite-plugin-css-injected-by-js";
import tailwindcss from "@tailwindcss/postcss";

// 自定义 PostCSS 插件：隔离插件 CSS
function isolatePluginCss() {
  return {
    postcssPlugin: "isolate-plugin-css",
    OnceExit(root: any) {
      root.walk((node: any) => {
        // 1. 剥离 @layer properties { * {...} } (Tailwind 全局重置)
        if (node.type === "atrule" && node.name === "layer"
            && node.params.trim() === "properties") {
          node.remove();
          return;
        }
        // 2. 剥离 :root 变量声明 (宿主已提供)
        if (node.type === "rule" && /^:root\b/.test(node.selector)) {
          node.remove();
          return;
        }
        // 3. 所有规则 scope 到 .{plugin-name}-root（使用插件全名，禁止缩写）
        if (node.type === "rule") {
          if (node.parent?.type === "atrule" && node.parent.name === "keyframes") return;
          node.selectors = node.selectors.map((sel: string) => {
            if (sel.startsWith(".api-manager-root")) return sel;
            return `.api-manager-root ${sel}`;
          });
        }
      });
    },
  };
}
isolatePluginCss.postcss = true;

export default defineConfig({
  plugins: [cssInjectedByJs()],
  css: {
    postcss: {
      plugins: [tailwindcss(), isolatePluginCss()],
    },
  },
  build: {
    lib: {
      entry: "src/main.ts",
      formats: ["iife"],
      name: "MyPlugin",
      fileName: () => "index.js",
    },
    cssMinify: "esbuild",
  },
});
```

### Step 3: plugin.css — 桥接宿主主题

```css
@import "tailwindcss/utilities";
@source ".";

@theme {
  /* 间距 — 启用 h-8, w-60, p-4, gap-2 等工具类 */
  --spacing: 0.25rem;

  /* 圆角 */
  --radius: 0.25rem;
  --radius-md: 0.375rem;
  --radius-lg: 0.5rem;

  /* 语义色 — 回退值匹配宿主默认主题
     运行时由宿主 themeStore 通过 inline style 覆盖 */
  --color-background: #0b0c0f;
  --color-foreground: #e6edf3;
  --color-primary: #60a5fa;
  --color-muted: #11141a;
  --color-muted-foreground: #8b949e;
  --color-border: rgba(255, 255, 255, 0.08);
  /* ... 其他颜色变量 ... */

  /* 字体 — 必须与宿主 token 一致 */
  --font-sans: "Inter", -apple-system, BlinkMacSystemFont, sans-serif;
  --font-mono: "JetBrains Mono", "Fira Code", monospace;
  --text-micro: 0.625rem;  /* 10px */
  --text-tiny: 0.6875rem;  /* 11px */
  --text-ui: 0.8125rem;    /* 13px */
}
```

**关键**：使用非 `inline` 的 `@theme`，这样 Tailwind 生成的工具类引用 `var(--color-*)` 而非硬编码 hex，确保主题切换时动态更新。

### Step 4: 使用宿主共享组件

宿主通过 `SharedComponents` 暴露的组件（`pluginLoader.ts`）：

| 组件 | 用途 |
|:---|:---|
| `Button` | 按钮 |
| `Input` | 输入框 |
| `Textarea` | 多行输入 |
| `Select` | 下拉选择器 |
| `Switch` | 开关 |
| `Skeleton` | 骨架屏 |
| `Tabs` / `TabsList` / `TabsTrigger` / `TabsContent` | 标签页 |
| `Tooltip` | 提示气泡（Portal 渲染，毛玻璃风格） |

通过 `api.ui.components` 可额外获取：`Editor`、`DiffEditor`。

```typescript
const { Button, Input, Select, Tabs, TabsList, TabsTrigger, TabsContent, Tooltip }
  = CoreComponents || {};
const { Editor } = api.ui?.components || {};
```

### Step 5: 使用宿主图标

宿主通过 `PluginIcons` 暴露 Lucide 图标子集。插件应从此集合取图标而非自行引入：

```typescript
// 推荐：创建图标映射工具
function pickIcon(hostIcons, name) {
  const icon = hostIcons?.[name];
  return icon && (typeof icon === "function" || typeof icon === "object") ? icon : null;
}
```

**当前可用图标**（截至 2026-03-29）：

`AlertTriangle`, `BookOpen`, `Bot`, `Bug`, `Check`, `CheckCircle2`, `ChevronDown`,
`ChevronRight`, `Circle`, `CircleHelp`, `Copy`, `File`, `FileCode2`, `FileJson`,
`Filter`, `Folder`, `Globe`, `Image`, `Info`, `KeyRound`, `Link`, `ListTree`,
`Loader2`, `Pause`, `Pencil`, `Play`, `Plus`, `RefreshCcw`, `Search`, `Send`,
`Settings`, `Sparkles`, `SquareTerminal`, `Trash2`, `WandSparkles`, `Wifi`, `X`, `XCircle`

如需新图标，在宿主 `src/plugins/pluginLoader.ts` 的 `PluginIcons` 中添加。

### Step 6: Tooltip 使用模式

为图标按钮提供优雅的提示气泡，优于原生 `title` 属性：

```typescript
// tip 辅助函数 — Tooltip 可用时包裹，否则优雅退化
const tip = (content: string, child: any) =>
  Tooltip ? el(Tooltip, { content }, child) : child;

// 用法
tip(
  t("send"),
  el(Button, { onClick: send, className: "h-9 w-10 p-0" },
    el(icons.Send, { width: 15 })
  ),
);
```

---

## 样式模式参考

### 颜色引用

插件 CSS 中引用颜色必须使用 `var(--color-*)` 或 `color-mix()`，**禁止硬编码 hex**：

```css
/* ✅ 正确 — 运行时跟随主题 */
background: color-mix(in srgb, var(--color-muted) 20%, transparent);
border-color: color-mix(in srgb, var(--color-border) 40%, transparent);
color: var(--color-primary);

/* ❌ 错误 — 主题切换时不更新 */
background: #11141a33;
color: #60a5fa;
```

### 字体大小

使用宿主定义的字体 token：

| Token | 变量 | 值 | 用途 |
|:---|:---|:---|:---|
| `text-micro` | `--text-micro` | 10px | 最小技术文字 |
| `text-tiny` | `--text-tiny` | 11px | badge、标签、mono 输入 |
| `text-ui` | `--text-ui` | 13px | 主 UI 基线 |

```css
font-size: var(--text-ui);     /* 正文 */
font-size: var(--text-tiny);   /* 小标签 */
font-size: var(--text-micro);  /* 极小文字 */
```

Tailwind 中直接使用 `text-ui`、`text-tiny`、`text-micro` 工具类。

### 视觉层次

对标宿主 Composer 面板的分层模式：

```
┌ 内容区底色 muted/8% ──────────────────────────────┐
│  ┌ 命令栏 muted/18% + rounded + shadow ──────────┐ │
│  └────────────────────────────────────────────────┘ │
│  ┌ 卡片面板 card/16% + rounded-xl + border ──────┐ │
│  │  Tab 条 muted/10% + border-b ──────────────── │ │
│  │  内容区 padding 14-16px ──────────────────── │ │
│  └────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────┘
```

### Key/Value 列表（对标 Composer HeaderListEditor）

```css
/* 图标 toggle 代替原生 checkbox */
.am-kv-toggle--on { color: var(--color-primary); }
.am-kv-toggle--off { color: color-mix(in srgb, var(--color-muted-foreground) 30%, transparent); }

/* 合并输入组 — key | value 在同一个圆角容器内 */
.am-kv-input-group {
  background: color-mix(in srgb, var(--color-muted) 20%, transparent);
  border: 1px solid color-mix(in srgb, var(--color-border) 40%, transparent);
  border-radius: 10px;
}
.am-kv-input-group:focus-within {
  border-color: color-mix(in srgb, var(--color-primary) 40%, transparent);
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--color-primary) 20%, transparent);
}

/* 禁用态 */
.am-kv-input-group--disabled { opacity: 0.5; filter: grayscale(1); }
```

---

## 检查清单 (Checklist)

- [ ] 插件根元素包含 scope 类 `.{plugin-name}-root`（如 `.api-manager-root`），使用插件全名，禁止缩写
- [ ] 所有 CSS 规则通过 PostCSS 插件 scope 到 `.{plugin-name}-root`
- [ ] 颜色使用 `var(--color-*)` / `color-mix()`，无硬编码 hex
- [ ] 字体大小使用 `--text-micro` / `--text-tiny` / `--text-ui` token
- [ ] 已剥离 `@layer properties` 和 `:root` 声明，不污染宿主
- [ ] 宿主组件通过 `CoreComponents` 获取，非自行实现
- [ ] 图标从 `PluginIcons` 获取，非自行引入
- [ ] 所有用户可见文本使用 `t()` 函数
- [ ] 使用 `Tooltip` 包裹图标按钮（通过 `tip()` 辅助函数退化）
- [ ] `@theme` 使用非 `inline` 模式，确保主题切换生效
- [ ] 构建产物 (`index.js`) 中 `color-mix` 和 `var(--color-*)` 正确保留

## 验证命令 (Verification)

```bash
# 构建插件
pnpm run build:api-manager    # 或对应的构建脚本

# 验证无硬编码颜色（在 CSS 自定义规则中）
python3 -c "
import re
with open('my-plugin/index.js') as f:
    content = f.read()
# 检查 color-mix 和 var 引用是否存在
print(f'color-mix: {content.count(\"color-mix\")} refs')
print(f'var(--color-): {content.count(\"var(--color-\")} refs')
"

# 验证无样式污染（无全局 :root 或 @layer properties）
python3 -c "
with open('my-plugin/index.js') as f:
    c = f.read()
print('POLLUTION' if ':root{' in c or '@layer properties' in c else 'CLEAN')
"
```

## 常见陷阱 (Pitfalls)

1. **`@theme inline` 导致主题失效**：使用 `@theme inline` 时 Tailwind 会将颜色内联为硬编码 hex，宿主运行时的 `setProperty` 无法覆盖。**必须使用非 inline 的 `@theme`**。

2. **CSS 选择器匹配不到宿主组件**：宿主的 `TabsContent` 使用 `role="tabpanel"` 而非 Radix 的 `data-state`；`TabsList` 无 `role="tablist"`。定位子元素时用 `> :first-child`（TabsList）和 `> [role="tabpanel"]`（TabsContent）。

3. **Tailwind 工具类污染宿主**：如 `.flex`、`.border` 等通用类若不 scope 会覆盖宿主样式。`isolatePluginCss` PostCSS 插件将所有规则前缀 `.{plugin-name}-root`（如 `.api-manager-root`），确保完全隔离。根类命名**必须使用插件全名**，禁止缩写，避免跨插件冲突。

4. **Select 下拉溢出**：下拉菜单在靠近窗口底部时会超出边界。用 CSS 让 `.relaycraft-popup` 在特定容器内向上展开：
   ```css
   .my-container .relaycraft-popup {
     bottom: 100%; top: auto; margin-bottom: 4px;
   }
   ```

5. **半透明背景叠加**：宿主 vibrancy 模式下 `--color-background` 可能是半透明 `rgba()`。弹窗背景使用 `color-mix(in srgb, var(--color-background) 95%, transparent)` + `backdrop-filter: blur(24px)` 获得毛玻璃效果。

6. **缺少图标导致 UI 空洞**：使用 `pickIcon` / `pickFirstIcon` 时，如果图标不在 `PluginIcons` 中会返回 null。确保 `renderIcon()` 返回 null 时不破坏布局。

## 参考 (References)

- 宿主共享组件注册：`src/plugins/pluginLoader.ts` → `SharedComponents`、`PluginIcons`
- 宿主插件 API：`src/plugins/api.ts` → `createPluginApi()`
- 宿主主题系统：`src/stores/themeStore.ts`、`src/index.css` → `@theme` 块
- 宿主 Tooltip 组件：`src/components/common/Tooltip.tsx`
- 宿主 Composer（参考实现）：`src/components/composer/ComposerView.tsx`
- 参考插件实现：`relaycraft-plugins/api-manager/`
- 插件类型定义：`src/types/plugin.ts`
