import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const enPath = path.join(__dirname, '../src/locales/en.json');
const zhPath = path.join(__dirname, '../src/locales/zh.json');

function loadJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (e) {
    console.error(`Error reading ${filePath}:`, e.message);
    process.exit(1);
  }
}

function flattenKeys(obj, prefix = '') {
  let keys = {};
  for (const key in obj) {
    if (typeof obj[key] === 'object' && obj[key] !== null && !Array.isArray(obj[key])) {
      Object.assign(keys, flattenKeys(obj[key], prefix + key + '.'));
    } else {
      keys[prefix + key] = obj[key];
    }
  }
  return keys;
}

const en = loadJson(enPath);
const zh = loadJson(zhPath);

const enKeys = flattenKeys(en);
const zhKeys = flattenKeys(zh);

const missingInZh = Object.keys(enKeys).filter(key => !zhKeys.hasOwnProperty(key));
const extraInZh = Object.keys(zhKeys).filter(key => !enKeys.hasOwnProperty(key));
const emptyInZh = Object.keys(zhKeys).filter(key => zhKeys[key] === '' || zhKeys[key] === null);

console.log('\n--- 🛡️  i18n Safety Check ---\n');
console.log(`Checking:\n  - ${path.relative(process.cwd(), enPath)}\n  - ${path.relative(process.cwd(), zhPath)}\n`);

let hasIssues = false;

if (missingInZh.length > 0) {
  hasIssues = true;
  console.log(`❌ CRITICAL: Missing keys in zh.json (${missingInZh.length}):`);
  missingInZh.forEach(k => console.log(`  - ${k}`));
  console.log('   (These keys exist in en.json but are missing in zh.json)\n');
}

if (extraInZh.length > 0) {
  hasIssues = true;
  console.log(`⚠️  WARNING: Extra keys in zh.json (${extraInZh.length}):`);
  extraInZh.forEach(k => console.log(`  - ${k}`));
  console.log('   (These keys exist in zh.json but are missing in en.json)\n');
}

if (emptyInZh.length > 0) {
  hasIssues = true;
  console.log(`⚠️  WARNING: Empty values in zh.json (${emptyInZh.length}):`);
  emptyInZh.forEach(k => console.log(`  - ${k}`));
  console.log('   (These keys have empty strings or null values)\n');
}

if (!hasIssues) {
  console.log('✅ PASS: All locales are perfectly synced.\n');
} else {
  console.log('------------------------------');
  // Only exit with error if there are missing keys (critical), extra keys are just warnings
  if (missingInZh.length > 0) {
    console.log('💥 FAILED: Critical issues found. Please fix before committing.\n');
    process.exit(1);
  } else {
    console.log('⚠️  PASSED WITH WARNINGS: Safe to proceed, but consider cleaning up.\n');
  }
}
