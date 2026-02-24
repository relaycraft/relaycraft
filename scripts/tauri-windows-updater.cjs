/**
 * Custom updater for standard-version to handle tauri.conf.json.
 *
 * This handles two version fields in a single pass:
 *   1. Top-level `version`  → public semver (e.g. 1.0.0-rc1) for macOS/Linux
 *   2. `bundle.windows.version` → Windows-only 4-part numeric version (e.g. 1.0.0.1)
 *
 * Windows MSI does not support pre-release semver labels.
 * The build number is persisted in `.build-number` and auto-increments each release.
 *
 * Examples:
 *   1.0.0-rc1 → version: "1.0.0-rc1", bundle.windows.version: "1.0.0.1"
 *   1.0.0-rc2 → version: "1.0.0-rc2", bundle.windows.version: "1.0.0.2"
 *   1.0.0     → version: "1.0.0",     bundle.windows.version: "1.0.0.3"
 */
const fs = require("node:fs");
const path = require("node:path");

const BUILD_NUMBER_FILE = path.join(__dirname, "..", ".build-number");

function readBuildNumber() {
    if (fs.existsSync(BUILD_NUMBER_FILE)) {
        const n = parseInt(fs.readFileSync(BUILD_NUMBER_FILE, "utf8").trim(), 10);
        return isNaN(n) ? 0 : n;
    }
    return 0;
}

function writeBuildNumber(n) {
    fs.writeFileSync(BUILD_NUMBER_FILE, String(n), "utf8");
}

/**
 * Convert a semver string to a Windows 4-part version.
 * Strips pre-release labels, appends the given build number.
 */
function toWindowsVersion(semver, build) {
    const base = semver.replace(/-[^+]+/, "").replace(/\+.*/, "");
    const parts = base.split(".").map(Number);
    while (parts.length < 3) parts.push(0);
    return `${parts[0]}.${parts[1]}.${parts[2]}.${build}`;
}

module.exports.readVersion = (contents) => {
    const obj = JSON.parse(contents);
    // standard-version reads the "current" version to determine the next one
    return obj.version ?? null;
};

module.exports.writeVersion = (contents, version) => {
    const obj = JSON.parse(contents);

    // 1. Update the public version field
    obj.version = version;

    // 2. Increment and persist build number
    const build = readBuildNumber() + 1;
    writeBuildNumber(build);

    // 3. Write Windows-compatible internal version
    if (!obj.bundle) obj.bundle = {};
    if (!obj.bundle.windows) obj.bundle.windows = {};
    obj.bundle.windows.version = toWindowsVersion(version, build);

    return JSON.stringify(obj, null, 2);
};
