/**
 * Bumps version in non-JSON files that release-it can't handle natively.
 * Reuses the existing version updater modules (cargo-updater, lock-updater, html-updater).
 */
const fs = require("fs");
const path = require("path");

const cargoUpdater = require("./cargo-updater.cjs");
const lockUpdater = require("./lock-updater.cjs");
const htmlUpdater = require("./html-updater.cjs");

const version = process.argv[2];
if (!version) {
  console.error("Usage: node bump-extra-files.cjs <version>");
  process.exit(1);
}

const files = [
  { path: "src-tauri/Cargo.toml", updater: cargoUpdater },
  { path: "src-tauri/Cargo.lock", updater: lockUpdater },
  { path: "public/splash.html", updater: htmlUpdater },
];

for (const { path: filePath, updater } of files) {
  const fullPath = path.resolve(filePath);
  if (!fs.existsSync(fullPath)) {
    console.warn(`Skipping ${filePath} (not found)`);
    continue;
  }
  const contents = fs.readFileSync(fullPath, "utf-8");
  const updated = updater.writeVersion(contents, version);
  fs.writeFileSync(fullPath, updated);
  console.log(`Updated ${filePath} to ${version}`);
}
