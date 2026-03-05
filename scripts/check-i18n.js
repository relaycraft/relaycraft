import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const localesDir = path.join(__dirname, "../src/locales");
const srcDir = path.join(__dirname, "../src");

// ============================================
// 工具函数
// ============================================

function loadJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (e) {
    console.error(`Error reading ${filePath}:`, e.message);
    process.exit(1);
  }
}

function flattenKeys(obj, prefix = "") {
  const keys = {};
  for (const key in obj) {
    if (typeof obj[key] === "object" && obj[key] !== null && !Array.isArray(obj[key])) {
      Object.assign(keys, flattenKeys(obj[key], `${prefix + key}.`));
    } else {
      keys[prefix + key] = obj[key];
    }
  }
  return keys;
}

// 提取字符串中的插值占位符 {{variable}}
function extractPlaceholders(str) {
  if (typeof str !== "string") return [];
  const regex = /\{\{(\w+)\}\}/g;
  const placeholders = [];
  for (const match of str.matchAll(regex)) {
    placeholders.push(match[1]);
  }
  return placeholders;
}

// 递归获取目录下所有文件
function getAllFiles(dir, extensions = [".ts", ".tsx", ".js", ".jsx"]) {
  const files = [];
  if (!fs.existsSync(dir)) return files;

  const items = fs.readdirSync(dir);
  for (const item of items) {
    const fullPath = path.join(dir, item);
    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
      files.push(...getAllFiles(fullPath, extensions));
    } else if (extensions.some((ext) => item.endsWith(ext))) {
      files.push(fullPath);
    }
  }
  return files;
}

// ============================================
// 检查1: Key 同步检查
// ============================================

function checkKeySync(locales) {
  const localeNames = Object.keys(locales);
  const baseLocale = locales[localeNames[0]];
  const baseKeys = flattenKeys(baseLocale);

  const issues = {
    missing: {}, // 某语言缺失的 key
    extra: {}, // 某语言多余的 key
    empty: {}, // 某语言的空值
  };

  for (const locale of localeNames) {
    issues.missing[locale] = [];
    issues.extra[locale] = [];
    issues.empty[locale] = [];
  }

  // 以第一个语言为基准检查所有语言
  for (const locale of localeNames) {
    const localeKeys = flattenKeys(locales[locale]);

    // 检查缺失的 key
    for (const key of Object.keys(baseKeys)) {
      if (!Object.hasOwn(localeKeys, key)) {
        issues.missing[locale].push(key);
      }
    }

    // 检查多余的 key
    for (const key of Object.keys(localeKeys)) {
      if (!Object.hasOwn(baseKeys, key) && locale !== localeNames[0]) {
        issues.extra[locale].push(key);
      }
      // 检查空值
      if (localeKeys[key] === "" || localeKeys[key] === null) {
        issues.empty[locale].push(key);
      }
    }
  }

  return issues;
}

// ============================================
// 检查2: 占位符一致性检查
// ============================================

function checkPlaceholderConsistency(locales) {
  const localeNames = Object.keys(locales);
  const baseLocale = locales[localeNames[0]];
  const baseKeys = flattenKeys(baseLocale);

  const issues = [];

  for (const key of Object.keys(baseKeys)) {
    const basePlaceholders = extractPlaceholders(baseKeys[key]);
    if (basePlaceholders.length === 0) continue;

    for (const locale of localeNames.slice(1)) {
      const localeKeys = flattenKeys(locales[locale]);
      if (!Object.hasOwn(localeKeys, key)) continue;

      const localePlaceholders = extractPlaceholders(localeKeys[key]);

      // 检查占位符是否一致
      const missing = basePlaceholders.filter((p) => !localePlaceholders.includes(p));
      const extra = localePlaceholders.filter((p) => !basePlaceholders.includes(p));

      if (missing.length > 0 || extra.length > 0) {
        issues.push({
          key,
          baseLocale: localeNames[0],
          targetLocale: locale,
          basePlaceholders,
          localePlaceholders,
          missing,
          extra,
        });
      }
    }
  }

  return issues;
}

// ============================================
// 检查3: 未使用的 key 检测
// ============================================

function checkUnusedKeys(locales) {
  const localeNames = Object.keys(locales);
  const baseKeys = flattenKeys(locales[localeNames[0]]);
  const allKeys = Object.keys(baseKeys);

  // 获取所有源文件
  const sourceFiles = getAllFiles(srcDir);
  const usedKeys = new Set();

  // 匹配 t("key") 或 t('key') 或 `t(\`key\`)`
  const _tCallRegex = /(?:useTranslation|t)\s*\([^)]*\)?\s*[\n\s]*t\s*\(\s*['"`]([^'"`]+)['"`]/g;
  // 更直接的 t("key") 模式
  const directTRegex = /\bt\s*\(\s*['"`]([^'"`]+)['"`]/g;

  for (const file of sourceFiles) {
    try {
      const content = fs.readFileSync(file, "utf8");

      // 查找所有 t() 调用
      for (const match of content.matchAll(directTRegex)) {
        usedKeys.add(match[1]);
      }

      // 重置正则
      directTRegex.lastIndex = 0;
    } catch (_e) {
      // 忽略读取错误
    }
  }

  // 找出未使用的 key
  const unusedKeys = allKeys.filter((key) => {
    // 精确匹配
    if (usedKeys.has(key)) return false;

    // 前缀匹配（对于带插值的 key，可能只使用了前缀）
    for (const used of usedKeys) {
      if (key.startsWith(`${used}.`) || used.startsWith(`${key}.`)) {
        return false;
      }
    }

    return true;
  });

  return {
    totalKeys: allKeys.length,
    usedKeysCount: usedKeys.size,
    unusedKeys,
    usedKeys: Array.from(usedKeys),
  };
}

// ============================================
// 检查4: 源码中硬编码文本检测 (可选，较慢)
// ============================================

function checkHardcodedText() {
  const sourceFiles = getAllFiles(srcDir);
  const potentialHardcoded = [];

  // 匹配 JSX 中的中文文本或看起来像 UI 文本的英文
  const jsxTextRegex = />([A-Z][a-zA-Z\s]{5,}|[\u4e00-\u9fa5]{2,})</g;

  for (const file of sourceFiles) {
    if (!file.endsWith(".tsx")) continue;

    try {
      const content = fs.readFileSync(file, "utf8");
      for (const match of content.matchAll(jsxTextRegex)) {
        const text = match[1].trim();
        // 排除一些常见的非国际化文本
        if (text.match(/^[A-Z\s]+$/) && text.length < 10) continue; // 缩写
        if (text.match(/^(GET|POST|PUT|DELETE|PATCH|HTTP|HTTPS|API|URL|JSON)$/i)) continue;

        potentialHardcoded.push({
          file: path.relative(srcDir, file),
          text: text.substring(0, 50),
          line: content.substring(0, match.index).split("\n").length,
        });
      }
    } catch (_e) {
      // 忽略
    }
  }

  return potentialHardcoded;
}

// ============================================
// 主程序
// ============================================

function main() {
  console.log("\n╔════════════════════════════════════════════╗");
  console.log("║       🛡️  RelayCraft i18n Safety Check      ║");
  console.log("╚════════════════════════════════════════════╝\n");

  // 自动发现所有语言文件
  const localeFiles = fs.readdirSync(localesDir).filter((f) => f.endsWith(".json"));

  const localeNames = localeFiles.map((f) => f.replace(".json", ""));
  console.log(`📚 Found ${localeNames.length} locale(s): ${localeNames.join(", ")}\n`);

  // 加载所有语言文件
  const locales = {};
  for (const file of localeFiles) {
    const locale = file.replace(".json", "");
    locales[locale] = loadJson(path.join(localesDir, file));
  }

  let hasCriticalIssues = false;
  let hasWarnings = false;

  // ----------------------------------------
  // 检查1: Key 同步
  // ----------------------------------------
  console.log("🔍 [1/4] Checking key synchronization...");
  const syncIssues = checkKeySync(locales);

  for (const locale of localeNames) {
    if (syncIssues.missing[locale].length > 0) {
      hasCriticalIssues = true;
      console.log(
        `  ❌ CRITICAL: Missing keys in ${locale}.json (${syncIssues.missing[locale].length}):`,
      );
      syncIssues.missing[locale].slice(0, 10).forEach((k) => {
        console.log(`      - ${k}`);
      });
      if (syncIssues.missing[locale].length > 10) {
        console.log(`      ... and ${syncIssues.missing[locale].length - 10} more`);
      }
    }

    if (syncIssues.extra[locale].length > 0) {
      hasWarnings = true;
      console.log(
        `  ⚠️  WARNING: Extra keys in ${locale}.json (${syncIssues.extra[locale].length}):`,
      );
      syncIssues.extra[locale].slice(0, 5).forEach((k) => {
        console.log(`      - ${k}`);
      });
      if (syncIssues.extra[locale].length > 5) {
        console.log(`      ... and ${syncIssues.extra[locale].length - 5} more`);
      }
    }

    if (syncIssues.empty[locale].length > 0) {
      hasWarnings = true;
      console.log(
        `  ⚠️  WARNING: Empty values in ${locale}.json (${syncIssues.empty[locale].length}):`,
      );
      syncIssues.empty[locale].slice(0, 5).forEach((k) => {
        console.log(`      - ${k}`);
      });
      if (syncIssues.empty[locale].length > 5) {
        console.log(`      ... and ${syncIssues.empty[locale].length - 5} more`);
      }
    }
  }

  if (!(hasCriticalIssues || hasWarnings)) {
    console.log("  ✅ All keys are synchronized\n");
  } else {
    console.log("");
  }

  // ----------------------------------------
  // 检查2: 占位符一致性
  // ----------------------------------------
  console.log("🔍 [2/4] Checking placeholder consistency...");
  const placeholderIssues = checkPlaceholderConsistency(locales);

  if (placeholderIssues.length > 0) {
    hasCriticalIssues = true;
    console.log(`  ❌ CRITICAL: Found ${placeholderIssues.length} placeholder mismatch(es):`);
    placeholderIssues.slice(0, 5).forEach((issue) => {
      console.log(`      - ${issue.key}:`);
      console.log(`        ${issue.baseLocale}: {{${issue.basePlaceholders.join("}}, {{")}}}}`);
      console.log(`        ${issue.targetLocale}: {{${issue.localePlaceholders.join("}}, {{")}}}}`);
      if (issue.missing.length > 0) {
        console.log(
          `        Missing in ${issue.targetLocale}: {{${issue.missing.join("}}, {{")}}}}`,
        );
      }
      if (issue.extra.length > 0) {
        console.log(`        Extra in ${issue.targetLocale}: {{${issue.extra.join("}}, {{")}}}}`);
      }
    });
    if (placeholderIssues.length > 5) {
      console.log(`      ... and ${placeholderIssues.length - 5} more`);
    }
    console.log("");
  } else {
    console.log("  ✅ All placeholders are consistent\n");
  }

  // ----------------------------------------
  // 检查3: 未使用的 key
  // ----------------------------------------
  console.log("🔍 [3/4] Checking for unused keys...");
  const unusedResult = checkUnusedKeys(locales);

  if (unusedResult.unusedKeys.length > 0) {
    hasWarnings = true;
    console.log(`  ⚠️  WARNING: Found ${unusedResult.unusedKeys.length} potentially unused key(s):`);
    console.log(
      `      Total keys: ${unusedResult.totalKeys}, Used keys: ${unusedResult.usedKeysCount}`,
    );
    unusedResult.unusedKeys.slice(0, 10).forEach((k) => {
      console.log(`      - ${k}`);
    });
    if (unusedResult.unusedKeys.length > 10) {
      console.log(`      ... and ${unusedResult.unusedKeys.length - 10} more`);
    }
    console.log("      (Note: Some keys may be used dynamically or in config)");
    console.log("");
  } else {
    console.log("  ✅ All keys are being used\n");
  }

  // ----------------------------------------
  // 检查4: 硬编码文本 (可选)
  // ----------------------------------------
  const checkHardcoded = process.argv.includes("--hardcoded");
  if (checkHardcoded) {
    console.log("🔍 [4/4] Checking for hardcoded text...");
    const hardcodedIssues = checkHardcodedText();

    if (hardcodedIssues.length > 0) {
      hasWarnings = true;
      console.log(`  ⚠️  WARNING: Found ${hardcodedIssues.length} potentially hardcoded text(s):`);
      hardcodedIssues.slice(0, 10).forEach((h) => {
        console.log(`      - ${h.file}:${h.line}: "${h.text}"`);
      });
      if (hardcodedIssues.length > 10) {
        console.log(`      ... and ${hardcodedIssues.length - 10} more`);
      }
      console.log("");
    } else {
      console.log("  ✅ No obvious hardcoded text found\n");
    }
  } else {
    console.log("🔍 [4/4] Skipping hardcoded text check (use --hardcoded to enable)\n");
  }

  // ----------------------------------------
  // 总结
  // ----------------------------------------
  console.log("═══════════════════════════════════════════════");

  if (hasCriticalIssues) {
    console.log("💥 FAILED: Critical issues found. Please fix before committing.\n");
    process.exit(1);
  } else if (hasWarnings) {
    console.log("⚠️  PASSED WITH WARNINGS: Safe to proceed, but consider cleaning up.\n");
    process.exit(0);
  } else {
    console.log("✅ PASS: All locales are perfectly synced and validated.\n");
    process.exit(0);
  }
}

main();
