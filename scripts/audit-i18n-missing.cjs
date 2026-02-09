const fs = require("node:fs");
const path = require("node:path");

const zh = JSON.parse(fs.readFileSync("src/locales/zh.json", "utf8"));

function getKeys(obj, prefix = "") {
  const keys = new Set();
  for (const key in obj) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (typeof obj[key] === "object" && obj[key] !== null && !Array.isArray(obj[key])) {
      getKeys(obj[key], fullKey).forEach((k) => {
        keys.add(k);
      });
    } else {
      keys.add(fullKey);
    }
  }
  return keys;
}

const definedKeys = getKeys(zh);
const usedKeys = new Map();

function walk(dir) {
  fs.readdirSync(dir).forEach((file) => {
    const fullPath = path.join(dir, file);
    if (fs.statSync(fullPath).isDirectory()) {
      if (!["node_modules", "dist", ".git", "target"].includes(file)) walk(fullPath);
    } else if (fullPath.endsWith(".ts") || fullPath.endsWith(".tsx")) {
      const content = fs.readFileSync(fullPath, "utf8");
      const tRegex = /\b(?:i18n\.)?t\(['"]([^'"]+)['"]/g;
      let match = tRegex.exec(content);
      while (match !== null) {
        const key = match[1];
        if (key.includes(".") && !key.startsWith(".") && !key.startsWith("/")) {
          if (!usedKeys.has(key)) usedKeys.set(key, []);
          usedKeys.get(key).push(fullPath);
        }
        match = tRegex.exec(content);
      }
    }
  });
}

walk("./src");

const results = [];
usedKeys.forEach((files, key) => {
  if (!definedKeys.has(key)) {
    results.push({ key, files: [...new Set(files)] });
  }
});

fs.writeFileSync("i18n_missing_report.json", JSON.stringify(results, null, 2));
console.log(`Found ${results.length} missing i18n keys. Report saved to i18n_missing_report.json.`);
