/**
 * Online eval for RelayCraft AI assistants.
 *
 * Supports suites:
 * - filter
 * - regex
 * - naming
 * - rule
 * - script
 *
 * Env:
 *   OPENAI_API_KEY / LLM_API_KEY     required
 *   OPENAI_BASE_URL / LLM_BASE_URL   optional, default https://api.openai.com/v1
 *   LLM_MODEL / OPENAI_MODEL         optional, default gpt-4o-mini
 *   LLM_TEMPERATURE                  optional, default 0
 *   AI_EVAL_SUITES                   optional, csv; default "all"
 *   AI_EVAL_CASE_LEVEL               optional, basic|extended|all; default basic
 *   AI_EVAL_CASES_DIR                optional, default .github/evals
 *   AI_EVAL_REPORT_PATH              optional, default ai_eval_report.json
 *   AI_EVAL_USE_TOOLS                optional, default true
 *   AI_EVAL_PASS_RATE_THRESHOLD      optional, 0~1; default 0.95 when basic, otherwise 1
 *   AI_EVAL_FAIL_ON_INFRA            optional, default false
 *   AI_EVAL_MAX_RETRIES              optional, integer >=0; default 0
 */
import fs from "node:fs";
import path from "node:path";

const ALL_SUITES = ["filter", "regex", "naming", "rule", "script"];

const apiKey = process.env.OPENAI_API_KEY || process.env.LLM_API_KEY;
const baseUrl = (
  process.env.OPENAI_BASE_URL ||
  process.env.LLM_BASE_URL ||
  "https://api.openai.com/v1"
).replace(/\/$/, "");
const model = process.env.LLM_MODEL || process.env.OPENAI_MODEL || "gpt-4o-mini";
const rawTemp = process.env.LLM_TEMPERATURE;
const parsedTemp = rawTemp != null && rawTemp !== "" ? Number.parseFloat(rawTemp) : Number.NaN;
const temperature = Number.isFinite(parsedTemp) ? parsedTemp : 0;
const casesDir = process.env.AI_EVAL_CASES_DIR || ".github/evals";
const reportPath = process.env.AI_EVAL_REPORT_PATH || "ai_eval_report.json";
const caseLevel = parseCaseLevel(process.env.AI_EVAL_CASE_LEVEL || "basic");
const useTools = !["0", "false", "no"].includes(
  String(process.env.AI_EVAL_USE_TOOLS || "true").toLowerCase(),
);
const suites = parseSuites(process.env.AI_EVAL_SUITES || "all");
const rawThreshold = process.env.AI_EVAL_PASS_RATE_THRESHOLD;
const parsedThreshold =
  rawThreshold != null && rawThreshold !== "" ? Number.parseFloat(rawThreshold) : Number.NaN;
const passRateThreshold = Number.isFinite(parsedThreshold)
  ? Math.max(0, Math.min(1, parsedThreshold))
  : caseLevel === "basic"
    ? 0.95
    : 1;
const failOnInfra = ["1", "true", "yes"].includes(
  String(process.env.AI_EVAL_FAIL_ON_INFRA || "false").toLowerCase(),
);
const rawMaxRetries = process.env.AI_EVAL_MAX_RETRIES;
const parsedMaxRetries =
  rawMaxRetries != null && rawMaxRetries !== "" ? Number.parseInt(rawMaxRetries, 10) : Number.NaN;
const maxRetries =
  Number.isFinite(parsedMaxRetries) && parsedMaxRetries > 0 ? Math.floor(parsedMaxRetries) : 0;

if (!apiKey) {
  console.error("Missing OPENAI_API_KEY or LLM_API_KEY.");
  process.exit(1);
}

function parseSuites(raw) {
  const parts = String(raw)
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (parts.length === 0 || parts.includes("all")) return ALL_SUITES;
  const unique = [...new Set(parts)].filter((s) => ALL_SUITES.includes(s));
  if (unique.length === 0) return ALL_SUITES;
  return unique;
}

function parseCaseLevel(raw) {
  const normalized = String(raw || "basic").trim().toLowerCase();
  if (normalized === "all" || normalized === "extended" || normalized === "basic") {
    return normalized;
  }
  return "basic";
}

function pickCaseTier(testCase) {
  const tier = String(testCase?.tier || "basic").trim().toLowerCase();
  if (tier === "basic" || tier === "extended") return tier;
  return "basic";
}

function extractTemplateLiteral(content, exportName) {
  const marker = `export const ${exportName} = \``;
  const start = content.indexOf(marker);
  if (start < 0) return "";
  const bodyStart = start + marker.length;
  const end = content.indexOf("`;", bodyStart);
  if (end < 0) return "";
  return content.slice(bodyStart, end);
}

function loadPrompts() {
  const root = process.cwd();
  const promptEntryFile = path.resolve(root, "src/lib/ai/prompts.ts");
  const promptDir = path.resolve(root, "src/lib/ai/prompts");

  const sources = [];
  if (fs.existsSync(promptEntryFile) && fs.statSync(promptEntryFile).isFile()) {
    sources.push(fs.readFileSync(promptEntryFile, "utf8"));
  }
  if (fs.existsSync(promptDir) && fs.statSync(promptDir).isDirectory()) {
    const promptFiles = fs
      .readdirSync(promptDir)
      .filter((name) => name.endsWith(".ts"))
      .sort();
    for (const name of promptFiles) {
      const file = path.resolve(promptDir, name);
      sources.push(fs.readFileSync(file, "utf8"));
    }
  }
  if (sources.length === 0) {
    throw new Error(`prompt sources not found: ${promptEntryFile}, ${promptDir}`);
  }
  const source = sources.join("\n");
  const pick = (name) => {
    const raw = extractTemplateLiteral(source, name);
    if (!raw.trim()) throw new Error(`${name} not found`);
    return raw
      .replace(/{{LANGUAGE}}/g, "Chinese")
      .replace(/{{TERMINOLOGY}}/g, "RelayCraft 术语")
      .replace(/{{ACTIVE_TAB}}/g, "traffic")
      .replace(/{{CURRENT_FILTER}}/g, "None")
      .replace(/{{SUMMARY}}/g, "Summary")
      .replace(/{{KEY_LOGIC}}/g, "Key Logic")
      .replace(/{{SUGGESTIONS}}/g, "Suggestions")
      .replace(/{{RESTART_NOTICE}}/g, "Restart Notice")
      .replace(/{{BREAKDOWN}}/g, "Breakdown")
      .replace(/{{SAMPLES}}/g, "Samples");
  };

  return {
    filter: pick("FILTER_ASSISTANT_SYSTEM_PROMPT"),
    regex: pick("REGEX_ASSISTANT_SYSTEM_PROMPT"),
    naming: pick("NAMING_ASSISTANT_SYSTEM_PROMPT"),
    rule: pick("PROXY_RULE_SYSTEM_PROMPT"),
    script: pick("MITMPROXY_SYSTEM_PROMPT"),
  };
}

function loadSuiteCases(suite) {
  const file = path.resolve(process.cwd(), casesDir, `${suite}_cases.json`);
  if (!(fs.existsSync(file) && fs.statSync(file).isFile())) {
    throw new Error(`eval cases file not found: ${file}`);
  }
  const data = JSON.parse(fs.readFileSync(file, "utf8"));
  if (!Array.isArray(data) || data.length === 0) {
    throw new Error(`${suite} cases must be a non-empty array`);
  }
  const filtered = data.filter((testCase) => {
    const tier = pickCaseTier(testCase);
    if (caseLevel === "all") return true;
    return tier === caseLevel;
  });
  if (filtered.length === 0) {
    throw new Error(`${suite} cases empty after filtering by AI_EVAL_CASE_LEVEL=${caseLevel}`);
  }
  return filtered;
}

function cleanText(content) {
  if (!content) return "";
  return String(content)
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/<redacted_thinking>[\s\S]*?<\/redacted_thinking>/gi, "")
    .replace(/^```[\w]*\n/, "")
    .replace(/\n```$/, "")
    .replace(/^`+|`+$/g, "")
    .replace(/^(filter|query|search|response|result|answer|output|pattern|name):\s*/i, "")
    .trim();
}

function normalizeFilterQuery(content) {
  const cleaned = cleanText(content);
  if (!cleaned) return "";
  const aliasMap = {
    host: "domain",
    d: "domain",
    s: "status",
    m: "method",
    t: "type",
    h: "header",
    rb: "reqbody",
    body: "resbody",
    src: "source",
    dur: "duration",
    sz: "size",
  };
  const out = [];
  const tokens = cleaned.split(/\s+/).filter(Boolean);
  for (const token of tokens) {
    const negative = token.startsWith("-") || token.startsWith("!");
    const body = negative ? token.slice(1) : token;
    const firstColon = body.indexOf(":");
    if (firstColon === -1) {
      out.push(token);
      continue;
    }
    const rawKey = body.slice(0, firstColon).toLowerCase();
    const value = body.slice(firstColon + 1).trim();
    if (!value) continue;
    const key = aliasMap[rawKey] || rawKey;
    const prefix = negative ? "-" : "";
    if (key === "status" && value.includes(",")) {
      const values = value
        .split(",")
        .map((v) => v.trim())
        .filter(Boolean);
      for (const item of values) out.push(`${prefix}${key}:${item}`);
      continue;
    }
    out.push(`${prefix}${key}:${value}`);
  }
  return out.join(" ").trim();
}

function getSuiteConfig(prompts) {
  return {
    filter: {
      prompt: prompts.filter,
      toolName: "generate_filter",
      tools: [
        {
          type: "function",
          function: {
            name: "generate_filter",
            description: "Generate a RelayCraft traffic filter query string",
            parameters: {
              type: "object",
              properties: { filter: { type: "string" } },
              required: ["filter"],
            },
          },
        },
      ],
      userPrompt: (input) => input,
      outputFromTool: (args) => (typeof args.filter === "string" ? args.filter : ""),
      outputFromText: (text) => text,
      normalize: (raw) => normalizeFilterQuery(raw),
      validate: (output, testCase) => validateFilterCase(output, testCase),
    },
    regex: {
      prompt: prompts.regex,
      toolName: "generate_regex",
      tools: [
        {
          type: "function",
          function: {
            name: "generate_regex",
            description: "Generate regex pattern",
            parameters: {
              type: "object",
              properties: { pattern: { type: "string" } },
              required: ["pattern"],
            },
          },
        },
      ],
      userPrompt: (input) => `[REGEX ONLY] ${input}`,
      outputFromTool: (args) => (typeof args.pattern === "string" ? args.pattern : ""),
      outputFromText: (text) => text,
      normalize: (raw) => cleanText(raw),
      validate: (output, testCase) => validateRegexCase(output, testCase),
    },
    naming: {
      prompt: prompts.naming,
      toolName: "generate_name",
      tools: [
        {
          type: "function",
          function: {
            name: "generate_name",
            description: "Generate concise name",
            parameters: {
              type: "object",
              properties: { name: { type: "string" } },
              required: ["name"],
            },
          },
        },
      ],
      userPrompt: (input, testCase) => {
        if (testCase && testCase.config && typeof testCase.config === "object") {
          return `Generate a name for this rule config: ${JSON.stringify(testCase.config)}`;
        }
        return input;
      },
      outputFromTool: (args) => (typeof args.name === "string" ? args.name : ""),
      outputFromText: (text) => text,
      normalize: (raw) => cleanText(raw).replace(/\s+/g, " ").trim(),
      validate: (output, testCase) => validateNamingCase(output, testCase),
    },
    rule: {
      prompt: `${prompts.rule}\n\n## Current Application Context:\n{"activeTab":"rules","activeRule":null}`,
      toolName: "generate_rule",
      tools: [
        {
          type: "function",
          function: {
            name: "generate_rule",
            description: "根据用户需求生成代理规则",
            parameters: {
              type: "object",
              properties: {
                name: { type: "string" },
                rule_type: {
                  type: "string",
                  enum: [
                    "map_local",
                    "map_remote",
                    "rewrite_header",
                    "rewrite_body",
                    "throttle",
                    "block_request",
                  ],
                },
                match: {
                  type: "object",
                  properties: {
                    request: { type: "array" },
                    response: { type: "array" },
                  },
                  required: ["request"],
                },
                actions: { type: "array" },
                enabled: { type: "boolean" },
                priority: { type: "number" },
              },
              required: ["name", "rule_type", "match", "actions"],
            },
          },
        },
      ],
      userPrompt: (input) => input,
      outputFromTool: (args) => args,
      outputFromText: (text) => parseRuleFromText(text),
      normalize: (raw) => raw,
      validate: (output, testCase) => validateRuleCase(output, testCase),
    },
    script: {
      prompt: prompts.script,
      toolName: "generate_script",
      tools: [
        {
          type: "function",
          function: {
            name: "generate_script",
            description: "生成 mitmproxy Python 脚本",
            parameters: {
              type: "object",
              properties: { code: { type: "string" } },
              required: ["code"],
            },
          },
        },
      ],
      userPrompt: (input) =>
        `Task: Write a complete mitmproxy addon script (Addon class) for the requirement.\nRequirement: ${input}\nProvide code inside \`\`\`python\`\`\` block.`,
      outputFromTool: (args) => (typeof args.code === "string" ? args.code : ""),
      outputFromText: (text) => text,
      normalize: (raw) => extractPythonCode(raw),
      validate: (output, testCase) => validateScriptCase(output, testCase),
    },
  };
}

function parseRuleFromText(text) {
  const cleaned = cleanText(text);
  if (!cleaned) return {};
  try {
    const parsed = JSON.parse(cleaned);
    if (parsed && typeof parsed === "object") {
      if (parsed.rule && typeof parsed.rule === "object") return parsed.rule;
      return parsed;
    }
  } catch {
    return {};
  }
  return {};
}

function extractPythonCode(text) {
  const cleaned = String(text || "")
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/<redacted_thinking>[\s\S]*?<\/redacted_thinking>/gi, "")
    .trim();
  const block = cleaned.match(/```(?:python)?\s*([\s\S]*?)(?:```|$)/i);
  if (block && block[1].trim()) return block[1].trim();
  return cleaned.replace(/```/g, "").trim();
}

function validateContainsRules(outputLower, testCase, errors) {
  const mustContain = Array.isArray(testCase.mustContain) ? testCase.mustContain : [];
  for (const item of mustContain) {
    if (!outputLower.includes(String(item).toLowerCase())) {
      errors.push(`missing:${item}`);
    }
  }
  const mustContainAny = Array.isArray(testCase.mustContainAny) ? testCase.mustContainAny : [];
  for (const group of mustContainAny) {
    const options = Array.isArray(group) ? group : [group];
    const matched = options.some((item) => outputLower.includes(String(item).toLowerCase()));
    if (!matched) {
      errors.push(`missing_any:${options.join("|")}`);
    }
  }
  const mustNotContain = Array.isArray(testCase.mustNotContain) ? testCase.mustNotContain : [];
  for (const item of mustNotContain) {
    if (outputLower.includes(String(item).toLowerCase())) {
      errors.push(`contains_forbidden:${item}`);
    }
  }
}

function validateFilterCase(output, testCase) {
  const errors = [];
  if (!output) errors.push("empty_output");
  const tokens = output.split(/\s+/).filter(Boolean);
  for (const token of tokens) {
    if (!/^-?[a-z]+:.+$/i.test(token)) errors.push(`invalid_token_format:${token}`);
  }
  if (/(^|\s)-?status:[^\s,]*,[^\s]*/i.test(output)) errors.push("comma_status_not_allowed");
  validateContainsRules(output.toLowerCase(), testCase, errors);
  return errors;
}

function validateRegexCase(output, testCase) {
  const errors = [];
  if (!output) errors.push("empty_output");
  if (/```/.test(output)) errors.push("contains_markdown_fence");
  if (/\n/.test(output)) errors.push("regex_should_be_single_line");
  try {
    // biome-ignore lint/suspicious/noEmptyBlockStatements: regex compile probe
    new RegExp(output);
  } catch {
    errors.push("invalid_regex_syntax");
  }
  validateContainsRules(output.toLowerCase(), testCase, errors);
  return errors;
}

function validateNamingCase(output, testCase) {
  const errors = [];
  if (!output) errors.push("empty_output");
  if (output.length > 60) errors.push("name_too_long");
  if (/\n/.test(output)) errors.push("name_should_be_single_line");
  if (/[:{}[\]`]/.test(output)) errors.push("name_contains_structural_chars");
  validateContainsRules(output.toLowerCase(), testCase, errors);
  return errors;
}

function validateRuleCase(output, testCase) {
  const errors = [];
  if (!output || typeof output !== "object") {
    errors.push("empty_rule_object");
    return errors;
  }
  if (!output.name || typeof output.name !== "string") errors.push("missing_name");
  const allowedTypes = new Set([
    "map_local",
    "map_remote",
    "rewrite_header",
    "rewrite_body",
    "throttle",
    "block_request",
  ]);
  const normalizedRuleType =
    typeof output.rule_type === "string"
      ? output.rule_type
      : typeof output.type === "string"
        ? output.type
        : "";
  if (!allowedTypes.has(normalizedRuleType)) errors.push("invalid_rule_type");
  if (!output.match || typeof output.match !== "object") errors.push("missing_match");
  if (!Array.isArray(output.match?.request) || output.match.request.length === 0) {
    errors.push("missing_match_request");
  }
  if (!Array.isArray(output.actions) || output.actions.length === 0) errors.push("missing_actions");

  const flat = JSON.stringify(output).toLowerCase();
  validateContainsRules(flat, testCase, errors);
  return errors;
}

function validateScriptCase(output, testCase) {
  const errors = [];
  if (!output) errors.push("empty_script");
  const classNames = [...output.matchAll(/class\s+([A-Za-z_]\w*)\b/g)].map((m) => m[1]);
  if (classNames.length === 0) errors.push("missing_addon_class");
  const addonsMatch = output.match(/addons\s*=\s*\[([^\]]*)\]/);
  if (!addonsMatch) {
    errors.push("missing_addons_export");
  } else if (classNames.length > 0) {
    const addonsBody = addonsMatch[1];
    const bound = classNames.some((name) => new RegExp(`\\b${name}\\s*\\(`).test(addonsBody));
    if (!bound) errors.push("missing_addons_binding");
  }
  if (!/from\s+mitmproxy\s+import\b/.test(output)) errors.push("missing_mitmproxy_import");
  const flat = output.toLowerCase();
  validateContainsRules(flat, testCase, errors);
  return errors;
}

function parseToolArguments(data) {
  const argsText = data?.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
  if (!argsText || typeof argsText !== "string") return null;
  try {
    return JSON.parse(argsText);
  } catch {
    return null;
  }
}

function parsePlainText(data) {
  const text = data?.choices?.[0]?.message?.content;
  return typeof text === "string" ? text : "";
}

async function callModel(suiteCfg, userInput) {
  const requestBody = {
    model,
    temperature,
    messages: [
      { role: "system", content: suiteCfg.prompt },
      { role: "user", content: suiteCfg.userPrompt(userInput) },
    ],
  };

  if (useTools) {
    requestBody.tools = suiteCfg.tools;
    requestBody.tool_choice = { type: "function", function: { name: suiteCfg.toolName } };
  }

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(requestBody),
  });

  let data = {};
  try {
    data = await response.json();
  } catch {
    data = {};
  }
  if (!response.ok) throw new Error(`api_error_${response.status}: ${JSON.stringify(data)}`);
  return data;
}

function formatSummaryMarkdown(report) {
  const lines = [];
  lines.push("## AI Generation Eval");
  lines.push("");
  lines.push(`- Model: \`${report.model}\``);
  lines.push(`- Base URL: \`${report.baseUrl}\``);
  lines.push(`- Suites: \`${report.suites.join(",")}\``);
  lines.push(`- Case level: \`${report.caseLevel}\``);
  lines.push(`- Use tools: \`${report.useTools}\``);
  lines.push(
    `- Threshold: \`${report.passRateThreshold}\`, Fail on infra: \`${report.failOnInfra}\`, Max retries: \`${report.maxRetries}\``,
  );
  lines.push(
    `- Cases: ${report.total}, Passed: ${report.passed}, Failed: ${report.failed} (quality: ${report.qualityFailed}, infra: ${report.infraFailed})`,
  );
  lines.push(
    `- Quality pass rate: ${(report.qualityPassRate * 100).toFixed(2)}% (${report.qualityPassed}/${report.qualityTotal})`,
  );
  lines.push("");
  lines.push("### Suite Summary");
  lines.push("");
  lines.push("| Suite | Total | Passed | Failed |");
  lines.push("|---|---:|---:|---:|");
  for (const s of report.bySuite) {
    lines.push(`| ${s.suite} | ${s.total} | ${s.passed} | ${s.failed} |`);
  }
  lines.push("");
  lines.push("### Case Details");
  lines.push("");
  lines.push("| Suite | Case | Result | Failure Type | Output | Errors |");
  lines.push("|---|---|---|---|---|---|");
  for (const item of report.results) {
    const result = item.ok ? "PASS" : "FAIL";
    const failureType = item.failureType || "-";
    const output = String(item.outputPreview || "").replace(/\|/g, "\\|");
    const errs = (item.errors.length ? item.errors.join(", ") : "-").replace(/\|/g, "\\|");
    lines.push(`| ${item.suite} | ${item.id} | ${result} | ${failureType} | \`${output}\` | ${errs} |`);
  }
  lines.push("");
  return lines.join("\n");
}

function classifyFailure(errors) {
  const text = String(Array.isArray(errors) ? errors.join(" ") : errors || "").toLowerCase();
  if (
    text.includes("api_error_") ||
    text.includes("network") ||
    text.includes("fetch failed") ||
    text.includes("timeout") ||
    text.includes("econn") ||
    text.includes("enotfound") ||
    text.includes("eai_again")
  ) {
    return "infra_error";
  }
  return "quality_fail";
}

async function runSuite(suite, suiteCfg) {
  const cases = loadSuiteCases(suite);
  const results = [];
  console.log(`Running suite=${suite}, cases=${cases.length}`);
  for (const testCase of cases) {
    const id = String(testCase.id || "unknown_case");
    const input = String(testCase.input || "");
    const hasConfigObject = !!(testCase.config && typeof testCase.config === "object");
    if (!input.trim() && !hasConfigObject) {
      results.push({
        suite,
        id,
        ok: false,
        output: null,
        outputPreview: "",
        errors: ["empty_input_case"],
        failureType: "quality_fail",
      });
      continue;
    }
    let lastResult = null;
    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      try {
        const data = await callModel(
          {
            ...suiteCfg,
            userPrompt: (userInput) => suiteCfg.userPrompt(userInput, testCase),
          },
          input,
        );
        const toolArgs = useTools ? parseToolArguments(data) : null;
        const raw = toolArgs ? suiteCfg.outputFromTool(toolArgs) : suiteCfg.outputFromText(parsePlainText(data));
        const output = suiteCfg.normalize(raw);
        const errors = suiteCfg.validate(output, testCase);
        const outputPreview =
          typeof output === "string" ? output.slice(0, 200) : JSON.stringify(output).slice(0, 200);
        lastResult = {
          suite,
          id,
          ok: errors.length === 0,
          output,
          outputPreview,
          errors,
          failureType: errors.length === 0 ? null : "quality_fail",
        };
        if (lastResult.ok || attempt === maxRetries) break;
        console.log(
          `[${suite}/${id}] RETRY ${attempt + 1}/${maxRetries} -> validation failed: ${errors.join(", ")}`,
        );
      } catch (error) {
        const errorText = error instanceof Error ? error.message : "unknown_error";
        lastResult = {
          suite,
          id,
          ok: false,
          output: null,
          outputPreview: "",
          errors: [errorText],
          failureType: classifyFailure(errorText),
        };
        if (attempt === maxRetries) break;
        console.log(`[${suite}/${id}] RETRY ${attempt + 1}/${maxRetries} -> request error: ${errorText}`);
      }
    }
    results.push(lastResult);
    const status = lastResult.ok ? "PASS" : "FAIL";
    console.log(`[${suite}/${id}] ${status} -> ${lastResult.outputPreview || "request error"}`);
    if (!lastResult.ok) console.log(`  errors: ${lastResult.errors.join(", ")}`);
  }
  return results;
}

async function main() {
  const prompts = loadPrompts();
  const suiteConfig = getSuiteConfig(prompts);
  const allResults = [];

  console.log(
    `Running AI eval: model=${model}, baseUrl=${baseUrl}, suites=${suites.join(",")}, caseLevel=${caseLevel}, tools=${useTools}`,
  );

  for (const suite of suites) {
    const cfg = suiteConfig[suite];
    if (!cfg) {
      allResults.push({
        suite,
        id: "suite_config_missing",
        ok: false,
        output: null,
        outputPreview: "",
        errors: ["suite_config_missing"],
        failureType: "quality_fail",
      });
      continue;
    }
    const suiteResults = await runSuite(suite, cfg);
    allResults.push(...suiteResults);
  }

  const failed = allResults.filter((r) => !r.ok).length;
  const infraFailed = allResults.filter((r) => r.failureType === "infra_error").length;
  const qualityFailed = allResults.filter((r) => r.failureType === "quality_fail").length;
  const qualityTotal = allResults.length - infraFailed;
  const qualityPassed = qualityTotal - qualityFailed;
  const qualityPassRate = qualityTotal > 0 ? qualityPassed / qualityTotal : 1;
  const bySuite = suites.map((suite) => {
    const items = allResults.filter((r) => r.suite === suite);
    const sFailed = items.filter((r) => !r.ok).length;
    return {
      suite,
      total: items.length,
      passed: items.length - sFailed,
      failed: sFailed,
    };
  });

  const report = {
    at: new Date().toISOString(),
    model,
    baseUrl,
    caseLevel,
    useTools,
    suites,
    total: allResults.length,
    passed: allResults.length - failed,
    failed,
    passRateThreshold,
    failOnInfra,
    maxRetries,
    infraFailed,
    qualityFailed,
    qualityTotal,
    qualityPassed,
    qualityPassRate,
    bySuite,
    results: allResults,
  };

  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), "utf8");
  console.log(`Wrote ${reportPath}`);

  const summary = formatSummaryMarkdown(report);
  if (process.env.GITHUB_STEP_SUMMARY) {
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${summary}\n`, "utf8");
  } else {
    console.log(summary);
  }

  const qualityThresholdMet = qualityPassRate >= passRateThreshold;
  const infraGatePassed = !failOnInfra || infraFailed === 0;
  if (!qualityThresholdMet || !infraGatePassed) {
    console.error(
      `Gate failed: qualityPassRate=${qualityPassRate.toFixed(4)} threshold=${passRateThreshold}, infraFailed=${infraFailed}, failOnInfra=${failOnInfra}`,
    );
    process.exit(1);
  }
}

main().catch((error) => {
  console.error("ai_generation_eval failed:", error);
  process.exit(1);
});
