/**
 * Fetches English release notes from release_body_en.md (written by CI),
 * calls an OpenAI-compatible Chat Completions API, and writes translated_release.md
 * for `gh release edit --notes-file`.
 *
 * Env:
 *   OPENAI_API_KEY / LLM_API_KEY — required
 *   OPENAI_BASE_URL / LLM_BASE_URL — default https://api.openai.com/v1
 *     MiniMax 国内站: https://api.minimaxi.com/v1（见 platform.minimaxi.com OpenAI 兼容文档）
 *   LLM_MODEL / OPENAI_MODEL — default gpt-4o-mini（MiniMax 示例: MiniMax-M2.7）
 *   LLM_TEMPERATURE — optional; default 0.1。MiniMax 要求 (0, 1]，文档常推荐 1.0
 *   TRANSLATION_CONTEXT_FILES — optional; comma-separated repo-relative paths。未设置时默认读取
 *     `.github/translation-context.md` 与 `README.md`（存在则纳入，单文件有长度上限）
 *   TRANSLATION_CONTEXT_MAX_CHARS — optional; single-file cap, default 8000
 */
import fs from "node:fs";
import path from "node:path";

const DEFAULT_CONTEXT_FILES = [".github/translation-context.md", "README.md"];

const apiKey = process.env.OPENAI_API_KEY || process.env.LLM_API_KEY;
const baseUrl = (
  process.env.OPENAI_BASE_URL ||
  process.env.LLM_BASE_URL ||
  "https://api.openai.com/v1"
).replace(/\/$/, "");
const model = process.env.LLM_MODEL || process.env.OPENAI_MODEL || "gpt-4o-mini";
const rawTemp = process.env.LLM_TEMPERATURE;
const parsedTemp = rawTemp != null && rawTemp !== "" ? Number.parseFloat(rawTemp) : Number.NaN;
const temperature = Number.isFinite(parsedTemp) ? parsedTemp : 0.1;
const inputPath = process.env.RELEASE_BODY_PATH || "release_body_en.md";
const outPath = process.env.TRANSLATED_OUT_PATH || "translated_release.md";

const isMiniMaxHost = /minimaxi\.com|minimax\.io/i.test(baseUrl);

const contextMaxChars = (() => {
  const raw = process.env.TRANSLATION_CONTEXT_MAX_CHARS;
  const n = raw != null && raw !== "" ? Number.parseInt(raw, 10) : Number.NaN;
  return Number.isFinite(n) && n > 0 ? n : 8000;
})();

/**
 * Load optional project docs from repo root (cwd) to ground terminology.
 * Returns empty string if nothing readable.
 */
function loadTranslationContext() {
  const rawList = process.env.TRANSLATION_CONTEXT_FILES?.trim();
  const paths = rawList
    ? rawList
        .split(",")
        .map((p) => p.trim())
        .filter(Boolean)
    : DEFAULT_CONTEXT_FILES;

  const chunks = [];
  for (const rel of paths) {
    const abs = path.resolve(process.cwd(), rel);
    if (!(fs.existsSync(abs) && fs.statSync(abs).isFile())) {
      continue;
    }
    let text = fs.readFileSync(abs, "utf8");
    if (text.length > contextMaxChars) {
      text = `${text.slice(0, contextMaxChars)}\n\n… [truncated, ${contextMaxChars} chars max per file]`;
    }
    chunks.push(`### File: ${rel}\n\n${text.trim()}`);
  }
  if (chunks.length === 0) {
    return "";
  }
  return chunks.join("\n\n---\n\n");
}

/** Strip MiniMax interleaved-thinking wrappers if they still appear in message.content */
function stripInterleavedThinking(text) {
  return text.replace(/<redacted_thinking>[\s\S]*?<\/redacted_thinking>/gi, "").trim();
}

const originalBody = fs.existsSync(inputPath) ? fs.readFileSync(inputPath, "utf8") : "";

if (!originalBody.trim()) {
  console.log("No release body to translate; skipping.");
  process.exit(0);
}

if (!apiKey) {
  console.error("Missing OPENAI_API_KEY or LLM_API_KEY.");
  process.exit(1);
}

const translationContext = loadTranslationContext();
if (translationContext) {
  console.log(`Loaded translation context (${translationContext.length} chars from project docs).`);
}

const contextSection = translationContext
  ? `
以下是本项目参考文档摘录（用于统一产品名、功能译法与语气；请勿把本段当作要翻译的正文去输出）。

${translationContext}

---
`
  : "";

const prompt = `你是一个资深的技术研发文档翻译专家。请将以下 GitHub Release / Changelog 从英文翻译为中文。

规则：
1. 保持原有的 Markdown 格式（缩进、列表、加粗、链接、代码块）不变。
2. 专业术语（如 UI、Hook、Proxy、API、TLS、WebSocket、MCP 等）在中文语境下可保留英文或常见译法，保持一致性；若「参考文档」中有约定译名或产品名，请优先遵循参考文档。
3. 语气专业、自然，符合中国开发者阅读习惯。
4. 只输出译文正文，不要前言、不要 "Here is the translation" 等套话。
${contextSection}
待翻译原文：

${originalBody}`;

console.log(`Calling LLM (model=${model}, base=${baseUrl})...`);

try {
  const requestBody = {
    model,
    messages: [{ role: "user", content: prompt }],
    temperature,
  };
  /** MiniMax: 将思考过程从 content 中分离，避免译文中夹带 think 块（见官方 OpenAI 兼容文档） */
  if (isMiniMaxHost) {
    requestBody.reasoning_split = true;
  }

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(requestBody),
  });

  const data = await response.json();

  if (!response.ok) {
    console.error("API error:", response.status, JSON.stringify(data));
    process.exit(1);
  }

  let translatedBody = data.choices?.[0]?.message?.content;
  if (!translatedBody || typeof translatedBody !== "string") {
    console.error("Model returned no text:", JSON.stringify(data));
    process.exit(1);
  }

  const stripped = stripInterleavedThinking(translatedBody);
  translatedBody = stripped || translatedBody.trim();

  if (!translatedBody) {
    console.error("Translation empty after processing.");
    process.exit(1);
  }

  const finalMarkdown = `${originalBody.trimEnd()}

---

## 简体中文

${translatedBody.trim()}
`;

  fs.writeFileSync(outPath, finalMarkdown, "utf8");
  console.log(`Wrote ${outPath}`);
} catch (err) {
  console.error("translate_release failed:", err);
  process.exit(1);
}
