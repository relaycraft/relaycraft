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

function validateWindowsPlatformKeys(platforms) {
  // We intentionally disallow generic Windows target to avoid MSI/NSIS fallback mixing.
  if (Object.prototype.hasOwnProperty.call(platforms, "windows-x86_64")) {
    throw new Error(
      "Invalid updater manifest: found forbidden key 'windows-x86_64'. Use only 'windows-x86_64-msi' and/or 'windows-x86_64-nsis'."
    );
  }
}


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
    if (
      lowerFile.includes("macos") ||
      lowerFile.includes("apple-darwin") ||
      lowerFile.endsWith(".tar.gz")
    ) {
      return ["darwin-aarch64", "darwin-x86_64"];
    }
  }

  if (lowerFile.includes("aarch64") || lowerFile.includes("arm64")) {
    if (lowerFile.includes("macos") || lowerFile.includes("apple-darwin"))
      return ["darwin-aarch64"];
    if (lowerFile.includes("linux")) return ["linux-aarch64"];
  }

  if (lowerFile.includes("x64") || lowerFile.includes("x86_64") || lowerFile.includes("amd64")) {
    if (lowerFile.includes("macos") || lowerFile.includes("apple-darwin")) return ["darwin-x86_64"];
    if (lowerFile.includes("windows")) {
      if (lowerFile.endsWith(".msi.zip") || lowerFile.endsWith(".msi")) return ["windows-x86_64-msi"];
      if (lowerFile.endsWith(".nsis.zip") || lowerFile.endsWith(".exe")) return ["windows-x86_64-nsis"];
      return [];
    }
    if (lowerFile.includes("linux")) return ["linux-x86_64"];
  }

  // Fallback based on extension
  if (lowerFile.endsWith(".msi.zip") || lowerFile.endsWith(".msi")) {
    return ["windows-x86_64-msi"];
  }

  if (lowerFile.endsWith(".nsis.zip") || lowerFile.endsWith(".exe")) {
    return ["windows-x86_64-nsis"];
  }

  if (
    lowerFile.endsWith(".app.tar.gz") ||
    (lowerFile.endsWith(".tar.gz") && lowerFile.includes("apple-darwin"))
  ) {
    return ["darwin-aarch64", "darwin-x86_64"];
  }

  if (
    lowerFile.endsWith(".deb") ||
    lowerFile.endsWith(".appimage") ||
    lowerFile.endsWith(".appimage.tar.gz")
  ) {
    return ["linux-x86_64"];
  }

  return [];
}

const files = fs.readdirSync(artifactsDir);
files.forEach((file) => {
  const lowerFile = file.toLowerCase();
  // We only care about the archives/installers that Tauri updater uses
  if (
    (lowerFile.endsWith(".zip") ||
      lowerFile.endsWith(".tar.gz") ||
      lowerFile.endsWith(".gz") ||
      lowerFile.endsWith(".msi") ||
      lowerFile.endsWith(".exe") ||
      lowerFile.endsWith(".appimage") ||
      lowerFile.endsWith(".deb")) &&
    !lowerFile.includes("control.tar.gz") &&
    !lowerFile.includes("data.tar.gz")
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

validateWindowsPlatformKeys(output.platforms);
fs.writeFileSync(path.join(artifactsDir, "latest.json"), JSON.stringify(output, null, 2));
console.log(`✅ successfully generated latest.json in ${artifactsDir}`);
console.log(JSON.stringify(output, null, 2));
