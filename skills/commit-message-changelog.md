# Skill: AI Commit Composer (Changelog-first)

> 版本：2.0
> 最后更新：2026-04-20
> 适用范围：`fullstack`

## 适用场景 (When to Use)

- 用户要求：写 commit message / 优化提交信息 / 生成 release note / 对齐 changelog

## 前置条件 (Prerequisites)

- 从 `git diff --cached --name-only` 获取 staged files 数量
- 提炼 5 个槽位：`scope`、`changed`、`why`、`impact`、`risk`

## 步骤 (Steps)

### Step 1: 填充输入槽位（必须）

```text
scope: <module>
changed: <key files or changes>
why: <reason>
impact: <user-visible behavior>
risk: <compat / rollback / migration>
```

### Step 2: 选择 type（必须）

- `feat`: 新增用户能力
- `fix`: 修复错误行为
- `perf`: 用户可感知性能改善
- `refactor`: 内部重构，无对外行为变化
- `style`: 纯视觉/格式/排版
- `docs`: 文档
- `chore`: 工具链/流程/依赖/发布杂项

### Step 3: 生成输出（固定格式）

```text
<type(scope): subject <=72 chars, single intent>

- <why>
- <impact>
[- <risk or technical note>]
[- <extra impact>]

Release note: <one line for changelog>
```

### Step 4: 按仓库规则补强（必须）

- staged files `>= 4`：body 必须 2-4 条 `- ` bullet
- 禁止 multi-intent subject（避免 and/with/consolidate）
- `feat/fix/perf` 的 subject 使用“用户结果表达”，不要写实现细节

### Step 5: 失败回退策略

- 信息不全时，先输出 `2-3` 个候选 subject（不同 type），并明确缺失槽位
- 无法判断 type 时默认 `fix` 或 `chore`，并提示用户确认

## 代码模板 (Code Template)

```text
fix(traffic): prevent duplicated websocket frames on reconnect

- avoid appending repeated frames during stream reconnection
- keep traffic detail timeline stable during rapid tab switches

Release note: Fixed duplicated WebSocket frames in Traffic details after reconnect.
```

## 检查清单 (Checklist)

- [ ] subject 单一意图，<=72 chars
- [ ] type 在白名单
- [ ] 多文件提交满足 2-4 条 body bullet
- [ ] 第一条解释 why，第二条解释 impact
- [ ] 提供一行可直接用于 changelog 的 release note

## 验证命令 (Verification)

```bash
pnpm commitlint
```

## 常见陷阱 (Pitfalls)

1. subject 写成实现过程而不是用户结果
2. 一个提交表达多个发布意图
3. 只写 what，不写 why/impact
