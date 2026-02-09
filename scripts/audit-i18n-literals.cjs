const fs = require("node:fs");
const path = require("node:path");

const IGNORE_FILES = ["node_modules", "dist", ".git", "target"];
const _IGNORE_JSX_ATTRS = [
  "className",
  "style",
  "type",
  "id",
  "role",
  "variant",
  "size",
  "position",
  "side",
  "align",
  "src",
  "alt",
];

function walk(dir, callback) {
  fs.readdirSync(dir).forEach((file) => {
    const fullPath = path.join(dir, file);
    if (fs.statSync(fullPath).isDirectory()) {
      if (!IGNORE_FILES.includes(file)) walk(fullPath, callback);
    } else if (fullPath.endsWith(".tsx")) {
      callback(fullPath);
    }
  });
}

console.log("--- i18n Hardcoded String Audit ---");
let totalFound = 0;

walk("./src", (filePath) => {
  const content = fs.readFileSync(filePath, "utf8");

  // Very basic regex to find text between JSX tags that contains Chinese or multiple words
  // This is a naive check to replace the heavy ESLint plugin
  const jsxTextRegex = />([^<>{}\n]+)</g;
  let match = jsxTextRegex.exec(content);
  while (match !== null) {
    const text = match[1].trim();
    if (text && (/[\\u4e00-\\u9fa5]/.test(text) || text.split(" ").length > 1)) {
      // Skip common symbols/numbers
      if (/^[0-9\\s.:,\\-_#]+$/.test(text)) {
        match = jsxTextRegex.exec(content);
        continue;
      }

      console.log(`[LITERAL] ${filePath}: "${text}"`);
      totalFound++;
    }
    match = jsxTextRegex.exec(content);
  }
});

console.log(`\nFound ${totalFound} potential hardcoded strings.`);
if (totalFound > 0) {
  console.log("Suggestion: Wrap these strings with t() from useTranslation().");
}
