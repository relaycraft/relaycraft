# Release 说明翻译脚本

`translate_release.mjs` 与 CI 中的 [Translate Release Notes](../workflows/translate-release.yml) 使用同一逻辑：读入英文 Release 正文 → 可选读入仓库内**参考文档**注入提示词 → 调用 OpenAI 兼容的 `POST /v1/chat/completions` → 写出双语 Markdown。

### 参考文档（提高译名一致性）

- 默认会尝试读取（存在则纳入，**单文件最多约 8000 字符**，超出截断）：
  - [`.github/translation-context.md`](../translation-context.md) — **建议维护**：产品名、模块译法、术语表
  - 仓库根目录 `README.md` — 产品定位与功能列表
- 环境变量 **`TRANSLATION_CONTEXT_FILES`**：逗号分隔的相对路径，**若设置则只读这些文件**（不再使用默认列表）。例：  
  `TRANSLATION_CONTEXT_FILES=.github/translation-context.md,AGENTS.md`
- **`TRANSLATION_CONTEXT_MAX_CHARS`**：单文件上限（默认 `8000`）

本地或 CI 均在**仓库根目录**执行脚本，路径相对根目录解析。

## 使用 MiniMax 国内站（minimaxi.com）

与 [文本生成 · OpenAI API 兼容](https://platform.minimaxi.com/docs/api-reference/text-openai-api) 一致：

- **Base URL**：`https://api.minimaxi.com/v1`（不是国际站 `api.minimax.io`）
- **API Key**：在 [MiniMax 开放平台](https://platform.minimaxi.com/) 创建；Coding Plan / Token Plan 等订阅下的可用额度以控制台为准
- **模型示例**：`MiniMax-M2.7`、`MiniMax-M2.7-highspeed`、`MiniMax-M2.5` 等
- 脚本对 `api.minimaxi.com` / `api.minimax.io` 会自动加 **`reasoning_split: true`**（与官方 OpenAI 兼容说明一致），把思考过程从正文中拆开；若仍夹带 `<redacted_thinking>…</redacted_thinking>` 块，会在写文件前剔除
- 输出为“英文原文 + 分隔线 + 中文译文正文”，不再强制插入 `## 简体中文` 小节标题

MiniMax 文档说明 `temperature` 须在 **(0, 1]**，若接口报错可尝试：

```bash
export LLM_TEMPERATURE=0.5
# 或文档推荐值
export LLM_TEMPERATURE=1
```

## 本地验证（不访问 GitHub）

在仓库根目录：

```bash
# 1. 准备一段英文 Release 正文（与 CI 中 gh 导出的格式类似即可）
cat > release_body_en.md <<'EOF'
## 1.0.0

### Features

- Example feature for local test.
EOF

# 2. 填入密钥与 MiniMax 端点（勿提交密钥）
export OPENAI_API_KEY="你的_API_Key"
export OPENAI_BASE_URL="https://api.minimaxi.com/v1"
export LLM_MODEL="MiniMax-M2.7"

# 3. 运行（也可用: pnpm translate-release:local）
node .github/scripts/translate_release.mjs

# 4. 查看结果
cat translated_release.md
```

`release_body_en.md` 与 `translated_release.md` 已列入根目录 `.gitignore`，避免误提交本地试跑文件。

## 译文风格稳定性建议

- 标题建议使用固定中文映射，避免每次 release 因“同义词/Emoji”出现风格抖动
- 建议默认不新增 Emoji（除非原文标题已包含），减少视觉风格波动
- 若需要“营销化版本”，建议在发布前人工微调，而不是让模型每次自由发挥

## GitHub Actions 中的配置

在仓库 **Settings → Secrets** 中：

| Secret            | 说明                                                         |
| ----------------- | ------------------------------------------------------------ |
| `LLM_API_KEY`     | 必填，与本地 `OPENAI_API_KEY` 相同                           |
| `LLM_BASE_URL`    | 可选；使用 MiniMax 国内站时填 `https://api.minimaxi.com/v1`  |
| `LLM_MODEL`       | 可选，如 `MiniMax-M2.7`                                      |
| `LLM_TEMPERATURE` | 可选，如 `0.5` 或 `1`；未设置时脚本默认 `0.1`                |

## AI 生成评测（多助手）

新增脚本：`.github/scripts/ai_generation_eval.mjs`，对应工作流：
`[AI Generation Eval](../workflows/ai-generation-eval.yml)`。

用途：

- 基于 OpenAI 兼容接口做**在线能力回归**（非 UT）
- 统一评估 `filter / regex / naming / rule / script` 五类助手
- 默认优先走 tool call 路径，更贴近线上

默认用例集目录：

- `.github/evals/filter_cases.json`
- `.github/evals/regex_cases.json`
- `.github/evals/naming_cases.json`
- `.github/evals/rule_cases.json`
- `.github/evals/script_cases.json`

本地运行示例（推荐 `.env`）：

1. 复制模板并填写 key（项目根目录）：

```bash
cp .env.example .env
```

2. 运行默认回归（`basic` 分层，速度更快）：

```bash
node --env-file=.env .github/scripts/ai_generation_eval.mjs
```

3. 只跑某个套件（如 rule）：

```bash
AI_EVAL_SUITES=rule node --env-file=.env .github/scripts/ai_generation_eval.mjs
```

4. 跑全量用例（`basic + extended`）：

```bash
AI_EVAL_CASE_LEVEL=all node --env-file=.env .github/scripts/ai_generation_eval.mjs
```

5. 本地做一轮禁用 tools 的对照基线（不建议放 CI）：

```bash
AI_EVAL_USE_TOOLS=false node --env-file=.env .github/scripts/ai_generation_eval.mjs
```

可选环境变量：

- `AI_EVAL_SUITES`：要执行的套件（`all` / `filter,regex,naming,rule,script`）
- `AI_EVAL_CASE_LEVEL`：用例分层（`basic` / `extended` / `all`，默认 `basic`）
- `AI_EVAL_CASES_DIR`：用例目录（默认 `.github/evals`）
- `AI_EVAL_REPORT_PATH`：报告输出路径（默认 `ai_eval_report.json`）
- `AI_EVAL_USE_TOOLS`：是否使用 tools（默认 `true`）
- `AI_EVAL_PASS_RATE_THRESHOLD`：成功率阈值（0~1，`basic` 默认 `0.95`）
- `AI_EVAL_FAIL_ON_INFRA`：是否将 `infra_error` 作为门禁失败（默认 `false`）
- `AI_EVAL_MAX_RETRIES`：单用例最大重试次数（默认 `0`）

分层策略建议（业界常见）：

- `basic`：PR/日常提交必跑，保持分钟级反馈
- `all`：夜间定时、发版前、模型/提示词大改后执行
- `extended`：用于专项排查（只跑深水区样例）

命名助手说明：

- 当前主链路是规则编辑器 `BasicInfo` 内的“一键自动命名”
- `naming_cases.json` 使用 `config` 字段构造与线上一致的输入（而非自由文本提问）
