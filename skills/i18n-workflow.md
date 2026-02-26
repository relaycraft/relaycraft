# Skill: 国际化 (i18n) 工作流

> 版本：1.0
> 最后更新：2026-02-26
> 适用范围：`frontend`

## 适用场景 (When to Use)

- 新增任何面向用户的文本（按钮、标签、提示、错误信息等）
- 修改现有文本内容
- 新增功能模块（需要创建新的翻译键命名空间）

## 前置条件 (Prerequisites)

- 了解 `react-i18next` 的 `useTranslation()` Hook
- 了解项目的翻译文件结构

## 步骤 (Steps)

### Step 1: 确定翻译键

使用点分路径 `module.sub.key` 格式，遵循以下命名空间约定：

```
common.*         — 通用文本（save, cancel, delete, error, confirm...）
sidebar.*        — 侧边栏
titlebar.*       — 标题栏
traffic.*        — 流量监控模块
rules.*          — 规则引擎模块
scripts.*        — 脚本模块
composer.*       — 请求构造器
settings.*       — 设置模块
ai.*             — AI 助手
command_center.* — 命令中心
init.*           — 初始化/启动屏
plugins.*        — 插件相关
```

### Step 2: 添加中文翻译

编辑 `src/locales/zh.json`，在对应命名空间下添加键值对。

### Step 3: 添加英文翻译

编辑 `src/locales/en.json`，添加相同的键，值为英文翻译。

### Step 4: 在组件中使用

```tsx
import { useTranslation } from "react-i18next";

const MyComponent = () => {
  const { t } = useTranslation();
  return <span>{t("module.my_key")}</span>;
};
```

### Step 5: 验证一致性

```bash
pnpm check:i18n
```

## 代码模板 (Code Template)

### 基础使用

```tsx
const { t } = useTranslation();

// 简单文本
<h1>{t("rules.title")}</h1>

// 带插值
<p>{t("rules.export_zip_success", { path: "/some/path" })}</p>
// zh.json: "export_zip_success": "规则已导出到 {{path}}"
// en.json: "export_zip_success": "Rules exported to {{path}}"

// Tooltip / Placeholder
<input placeholder={t("common.search")} />
<Tooltip content={t("common.save")} />
```

### 翻译文件结构

```json
// src/locales/zh.json
{
  "common": {
    "save": "保存",
    "cancel": "取消",
    "delete": "删除",
    "confirm": "确认",
    "search": "搜索",
    "export": "导出",
    "import": "导入",
    "error": "错误"
  },
  "my_module": {
    "title": "我的模块",
    "description": "模块描述",
    "action_button": "执行操作",
    "success_msg": "操作成功",
    "error_msg": "操作失败：{{reason}}"
  }
}
```

### 非组件环境中使用

```typescript
// 在 Store 或工具函数中，直接导入 i18n 实例
import i18n from "../i18n";

const message = i18n.t("common.error");
```

## 检查清单 (Checklist)

- [ ] 所有用户可见文本都使用 `t()` 函数
- [ ] `zh.json` 和 `en.json` 同步更新，键完全一致
- [ ] 翻译键使用点分 snake_case 格式
- [ ] 动态内容使用 `{{variable}}` 插值，非字符串拼接
- [ ] 运行 `pnpm check:i18n` 无报错
- [ ] 切换语言后功能正常（开发时测试中英文切换）

## 常见陷阱 (Pitfalls)

1. **硬编码文本**：`<button>保存</button>` 是绝对禁止的，必须 `<button>{t("common.save")}</button>`。
2. **键不同步**：只在 `zh.json` 添加了键但忘记 `en.json`（或反之），会导致另一语言显示 raw key。
3. **字符串拼接翻译**：`t("prefix") + name + t("suffix")` 是错误的，不同语言语序不同。应使用插值：`t("key", { name })`。
4. **嵌套命名空间过深**：避免 `a.b.c.d.e.f` 超过 4 层嵌套，保持扁平。

## 验证命令 (Verification)

```bash
# 检查 i18n 键一致性
pnpm check:i18n

# 手动验证：在应用中切换到英文，检查是否有 raw key 显示
```

## 参考 (References)

- `src/locales/zh.json` — 中文翻译文件
- `src/locales/en.json` — 英文翻译文件
- `src/i18n.ts` — i18n 配置
- `scripts/check-i18n.js` — 一致性检查脚本
