const fs = require("node:fs");
const path = require("node:path");

/**
 * This script generates the standard Tauri 2.0 latest.json for the updater.
 * It scans the provided directory for signed binaries and their .sig files.
 */

const artifactsDir = process.argv[2] || "dist";
const version = process.argv[3];
const repoUrl = "https://github.com/relaycraft/relaycraft/releases/download";

if (!version) {
  console.error("Usage: node generate-update-json.cjs <artifacts-dir> <version>");
  process.exit(1);
}

const tag = `v${version.replace(/^v/, "")}`;
const output = {
  version: version.replace(/^v/, ""),
  notes: `Release ${tag}`,
  pub_date: new Date().toISOString(),
  platforms: {},
};

// Platform mapping: Tauri bundle name pattern -> Tauri platform key
const _platformMap = [
  { pattern: /\.msi\.zip$/, key: "windows-x86_64" },
  { pattern: /\.nsis\.zip$/, key: "windows-x86_64" },
  { pattern: /\.msi$/, key: "windows-x86_64" },
  { pattern: /\.exe$/, key: "windows-x86_64" },
  { pattern: /\.app\.tar\.gz$/, key: "macos-aarch64" },
  { pattern: /\.app\.tar\.gz$/, key: "macos-x86_64" },
  { pattern: /\.deb\.gz$/, key: "linux-x86_64" },
  { pattern: /\.AppImage\.tar\.gz$/, key: "linux-x86_64" },
];

function getSignature(filePath) {
  const sigPath = `${filePath}.sig`;
  if (fs.existsSync(sigPath)) {
    return fs.readFileSync(sigPath, "utf8").trim();
  }
  return null;
}

// Logic to refine platform keys based on common filenames
function getPlatformKeys(filename) {
  const lowerFile = filename.toLowerCase();

  if (lowerFile.includes("universal")) {
    if (lowerFile.includes("macos") || lowerFile.includes("apple-darwin") || lowerFile.endsWith(".tar.gz")) {
      return ["macos-aarch64", "macos-x86_64"];
    }
  }

  if (lowerFile.includes("aarch64") || lowerFile.includes("arm64")) {
    if (lowerFile.includes("macos") || lowerFile.includes("apple-darwin")) return ["macos-aarch64"];
    if (lowerFile.includes("linux")) return ["linux-aarch64"];
  }

  if (lowerFile.includes("x64") || lowerFile.includes("x86_64") || lowerFile.includes("amd64")) {
    if (lowerFile.includes("macos") || lowerFile.includes("apple-darwin")) return ["macos-x86_64"];
    if (lowerFile.includes("windows")) return ["windows-x86_64"];
    if (lowerFile.includes("linux")) return ["linux-x86_64"];
  }

  // Fallback based on extension
  if (lowerFile.endsWith(".msi.zip") || lowerFile.endsWith(".msi") || lowerFile.endsWith(".exe") || lowerFile.endsWith(".nsis.zip")) {
    return ["windows-x86_64"];
  }

  if (lowerFile.endsWith(".app.tar.gz") || (lowerFile.endsWith(".tar.gz") && lowerFile.includes("apple-darwin"))) {
    return ["macos-aarch64", "macos-x86_64"];
  }

  if (lowerFile.endsWith(".deb") || lowerFile.endsWith(".appimage") || lowerFile.endsWith(".appimage.tar.gz")) {
    return ["linux-x86_64"];
  }

  return [];
}

const files = fs.readdirSync(artifactsDir);
files.forEach((file) => {
  const lowerFile = file.toLowerCase();
  // We only care about the archives/installers that Tauri updater uses
  if (
    lowerFile.endsWith(".zip") ||
    lowerFile.endsWith(".tar.gz") ||
    lowerFile.endsWith(".gz") ||
    lowerFile.endsWith(".msi") ||
    lowerFile.endsWith(".exe") ||
    lowerFile.endsWith(".appimage") ||
    lowerFile.endsWith(".deb")
  ) {
    if (lowerFile.endsWith(".sig")) return; // handled by getSignature

    const keys = getPlatformKeys(file);
    keys.forEach((key) => {
      const signature = getSignature(path.join(artifactsDir, file));
      if (signature) {
        output.platforms[key] = {
          signature,
          url: `${repoUrl}/${tag}/${file}`,
        };
      }
    });
  }
});

fs.writeFileSync(path.join(artifactsDir, "latest.json"), JSON.stringify(output, null, 2));
console.log(`✅ successfully generated latest.json in ${artifactsDir}`);
console.log(JSON.stringify(output, null, 2));
