#!/usr/bin/env node
/**
 * RelayCraft plugin manifest validator.
 *
 * Usage:
 *   node scripts/validate-plugin-manifest.mjs <plugin-dir>
 *
 * Validates a plugin directory against the manifest contract
 * (`src/types/plugin.ts` / `src-tauri/src/plugins/config.rs`):
 *
 *   Errors (exit 1):
 *   - manifest file (plugin.yaml / plugin.yml / plugin.json) missing or unparseable
 *   - missing required fields: id / name / version
 *   - malformed id (expecting reverse-domain style, e.g. "com.example.plugin")
 *   - version is not a SemVer string
 *   - unknown permissions (must be a subset of the known permission set)
 *   - capabilities.ui.entry / capabilities.ui.settings_schema /
 *     capabilities.i18n.locales files that do not exist
 *   - engines.relaycraft present but not a plausible SemVer range
 *
 *   Warnings (exit 0):
 *   - missing description / author / icon
 *   - engines.relaycraft not declared (no compatibility guarantee)
 */

import fs from "node:fs";
import path from "node:path";
import { load as loadYaml } from "js-yaml";

// Known permissions — keep in sync with `PluginPermission` in
// src/types/plugin.ts and KNOWN_PERMISSIONS in src-tauri/src/plugins/registry.rs.
const KNOWN_PERMISSIONS = [
  "proxy:read",
  "proxy:write",
  "fs:read_logs",
  "network:outbound",
  "ai:chat",
  "stats:read",
  "rules:write",
  "rules:read",
  "traffic:read",
  "storage:read",
  "storage:write",
];

const MANIFEST_CANDIDATES = ["plugin.yaml", "plugin.yml", "plugin.json"];

// Lenient reverse-domain id: at least two dot-separated segments.
const ID_PATTERN = /^[A-Za-z][A-Za-z0-9_-]*(\.[A-Za-z0-9_-]+)+$/;
// SemVer: MAJOR.MINOR.PATCH with optional prerelease/build.
const SEMVER_PATTERN = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$/;
// Plausible SemVer range characters (e.g. ">=1.4.0 <2.0.0", "^1.4", "*").
const RANGE_CHARS_PATTERN = /^[0-9A-Za-z.\-+*<>=!~^|, ]+$/;
// Obvious operator garbage: repeated comparison operators ("<<", "==", "~~").
// "||" is a legitimate range separator and intentionally not covered here.
const RANGE_BAD_OPERATOR_PATTERN = /([<>=!~^])\1/;

const errors = [];
const warnings = [];

function error(message) {
  errors.push(message);
}

function warn(message) {
  warnings.push(message);
}

function findManifest(dir) {
  for (const name of MANIFEST_CANDIDATES) {
    const filePath = path.join(dir, name);
    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      return filePath;
    }
  }
  return null;
}

function parseManifest(filePath) {
  const content = fs.readFileSync(filePath, "utf8");
  if (filePath.endsWith(".json")) {
    return JSON.parse(content);
  }
  return loadYaml(content);
}

function checkFileExists(dir, relativePath, fieldName) {
  if (typeof relativePath !== "string" || relativePath.trim() === "") {
    error(`${fieldName} must be a non-empty file path`);
    return;
  }
  const filePath = path.join(dir, relativePath);
  if (!(fs.existsSync(filePath) && fs.statSync(filePath).isFile())) {
    error(`${fieldName} points to a missing file: ${relativePath}`);
  }
}

function validate(dir, manifestPath, manifest) {
  const relManifest = path.basename(manifestPath);

  // Required fields
  for (const field of ["id", "name", "version"]) {
    if (typeof manifest[field] !== "string" || manifest[field].trim() === "") {
      error(`${relManifest}: missing required field "${field}"`);
    }
  }

  // id format
  if (typeof manifest.id === "string" && manifest.id.trim() !== "") {
    if (!ID_PATTERN.test(manifest.id.trim())) {
      error(
        `${relManifest}: id "${manifest.id}" is not a valid reverse-domain id (expected something like "com.example.plugin")`,
      );
    }
  }

  // version semver
  if (typeof manifest.version === "string" && manifest.version.trim() !== "") {
    if (!SEMVER_PATTERN.test(manifest.version.trim())) {
      error(`${relManifest}: version "${manifest.version}" is not a valid SemVer string`);
    }
  }

  // permissions subset
  if (manifest.permissions !== undefined) {
    if (!Array.isArray(manifest.permissions)) {
      error(`${relManifest}: permissions must be an array of strings`);
    } else {
      const unknown = manifest.permissions.filter((p) => !KNOWN_PERMISSIONS.includes(p));
      for (const p of unknown) {
        error(
          `${relManifest}: unknown permission "${p}". Valid values: ${KNOWN_PERMISSIONS.join(", ")}`,
        );
      }
    }
  }

  // engines.relaycraft
  const relaycraftRange = manifest.engines?.relaycraft;
  if (relaycraftRange === undefined) {
    warn(
      `${relManifest}: engines.relaycraft is not declared; the host cannot check compatibility and users get no upgrade protection`,
    );
  } else if (
    typeof relaycraftRange !== "string" ||
    relaycraftRange.trim() === "" ||
    !RANGE_CHARS_PATTERN.test(relaycraftRange.trim()) ||
    RANGE_BAD_OPERATOR_PATTERN.test(relaycraftRange) ||
    !/\d/.test(relaycraftRange)
  ) {
    error(`${relManifest}: engines.relaycraft "${relaycraftRange}" is not a valid SemVer range`);
  }

  // capabilities file references
  const capabilities = manifest.capabilities ?? {};
  if (capabilities.ui?.entry !== undefined) {
    checkFileExists(dir, capabilities.ui.entry, "capabilities.ui.entry");
  }
  if (capabilities.ui?.settings_schema !== undefined) {
    checkFileExists(dir, capabilities.ui.settings_schema, "capabilities.ui.settings_schema");
  }
  if (capabilities.i18n?.locales !== undefined) {
    if (typeof capabilities.i18n.locales !== "object" || capabilities.i18n.locales === null) {
      error(`${relManifest}: capabilities.i18n.locales must be a map of locale -> file path`);
    } else {
      for (const [locale, filePath] of Object.entries(capabilities.i18n.locales)) {
        checkFileExists(dir, filePath, `capabilities.i18n.locales.${locale}`);
      }
    }
  }

  // Recommended metadata
  if (manifest.description === undefined) warn(`${relManifest}: missing recommended field "description"`);
  if (manifest.author === undefined) warn(`${relManifest}: missing recommended field "author"`);
  if (manifest.icon === undefined) warn(`${relManifest}: missing recommended field "icon"`);
}

function main() {
  console.log("\n╔════════════════════════════════════════════╗");
  console.log("║     🛡️  RelayCraft Plugin Manifest Check     ║");
  console.log("╚════════════════════════════════════════════╝\n");

  const dir = process.argv[2];
  if (!dir) {
    console.error("Usage: node scripts/validate-plugin-manifest.mjs <plugin-dir>");
    process.exit(1);
  }
  if (!(fs.existsSync(dir) && fs.statSync(dir).isDirectory())) {
    console.error(`❌ ERROR: Not a directory: ${dir}\n`);
    process.exit(1);
  }

  console.log(`📁 Plugin directory: ${path.resolve(dir)}\n`);

  const manifestPath = findManifest(dir);
  if (!manifestPath) {
    error(`no manifest found (expected one of: ${MANIFEST_CANDIDATES.join(", ")})`);
  } else {
    console.log(`📄 Manifest: ${path.basename(manifestPath)}`);
    let manifest = null;
    try {
      manifest = parseManifest(manifestPath);
    } catch (e) {
      error(`failed to parse ${path.basename(manifestPath)}: ${e.message}`);
    }
    if (manifest !== null && (typeof manifest !== "object" || Array.isArray(manifest))) {
      error(`${path.basename(manifestPath)}: manifest must be a mapping/object at the top level`);
      manifest = null;
    }
    if (manifest !== null) {
      validate(dir, manifestPath, manifest);
    }
  }

  console.log("");
  for (const message of errors) {
    console.log(`  ❌ ERROR: ${message}`);
  }
  for (const message of warnings) {
    console.log(`  ⚠️  WARNING: ${message}`);
  }
  if (errors.length === 0 && warnings.length === 0) {
    console.log("  ✅ No issues found");
  }

  console.log("\n═══════════════════════════════════════════════");
  if (errors.length > 0) {
    console.log(`💥 FAILED: ${errors.length} error(s), ${warnings.length} warning(s)\n`);
    process.exit(1);
  }
  if (warnings.length > 0) {
    console.log(`⚠️  PASSED WITH WARNINGS: ${warnings.length} warning(s)\n`);
  } else {
    console.log("✅ PASS: manifest is valid\n");
  }
  process.exit(0);
}

main();
