const fs = require("node:fs");
const path = require("node:path");
const { execSync } = require("node:child_process");

const OUTPUT_FILE = path.join(__dirname, "../THIRD-PARTY-LICENSES.md");
const TAURI_DIR = path.join(__dirname, "../src-tauri");
const ENGINE_DIR = path.join(__dirname, "../engine-core");

console.log("📦 Generating Third-Party License Report...");

// Helper to run commands
function run(cmd, cwd = process.cwd()) {
  try {
    return execSync(cmd, {
      cwd,
      encoding: "utf8",
      maxBuffer: 10 * 1024 * 1024, // 10MB
      env: { ...process.env, PYTHONUTF8: "1", PYTHONIOENCODING: "utf-8" },
    });
  } catch (e) {
    console.error(`Error running command: ${cmd}`);
    console.error(e.stderr || e.message);
    return null;
  }
}

// 1. Rust Licenses (cargo-license)
console.log("🦀 Scanning Rust dependencies...");
let rustLicenses =
  "## Backend Dependencies (Rust)\n\n| Package | Version | License | Repository |\n| :--- | :--- | :--- | :--- |\n";
try {
  // Check if cargo-license is installed
  try {
    execSync("cargo license --version", { stdio: "ignore" });
  } catch {
    console.log("Installing cargo-license...");
    execSync("cargo install cargo-license");
  }

  const rustOutput = run(`cargo license --json`, TAURI_DIR);
  if (rustOutput) {
    const crates = JSON.parse(rustOutput).filter((c) => c.name !== "relaycraft");
    console.log(`Found ${crates.length} Rust dependencies.`);
    crates.forEach((c) => {
      rustLicenses += `| ${c.name} | ${c.version} | ${c.license || "Unknown"} | ${c.repository || "N/A"} |\n`;
    });
  }
} catch (_e) {
  console.warn("⚠️ Failed to generate Rust licenses.");
  rustLicenses += "*(Generation Failed)*\n";
}

// 2. Frontend Licenses (license-checker)
console.log("⚛️ Scanning Frontend dependencies...");
let frontendLicenses = "## Frontend Dependencies (Node.js)\n\n";
try {
  // We use npx to run license-checker without permanent install
  const jsonOutput = run("npx -y license-checker --json --production", path.join(__dirname, ".."));
  if (jsonOutput) {
    const allLicenses = JSON.parse(jsonOutput);
    const pkgs = Object.keys(allLicenses).filter((pkg) => !pkg.startsWith("relaycraft@"));
    console.log(`Found ${pkgs.length} Frontend dependencies.`);
    pkgs.forEach((pkg) => {
      const info = allLicenses[pkg];
      frontendLicenses += `### ${pkg}\n`;
      frontendLicenses += `* **License:** ${info.licenses}\n`;
      frontendLicenses += `* **Repository:** ${info.repository}\n`;
      if (info.licenseFile) {
        // frontendLicenses += `* [License File](${info.licenseFile})\n`;
      }
      frontendLicenses += `\n---\n\n`;
    });
  }
} catch (_e) {
  console.warn("⚠️ Failed to generate Frontend licenses.");
  frontendLicenses += "*(Generation Failed)*\n";
}

// 3. Python Licenses (pip-licenses)
console.log("🐍 Scanning Python dependencies...");
let pythonLicenses = "## Engine Dependencies (Python)\n\n";
try {
  // Check if pip-licenses is installed
  try {
    execSync("pip-licenses --version", { stdio: "ignore" });
  } catch {
    // Try installing it in the implementation environment if possible,
    // but for now, we assume it's available or user needs to pip install it.
    // In CI usage, we will install it explicitly.
    console.log("Attempting to install pip-licenses...");
    execSync("pip install pip-licenses");
  }

  // Generate markdown table (without full license text to save space)
  const pipOutput = run("pip-licenses --format=markdown --with-urls", ENGINE_DIR);
  if (pipOutput) {
    const lines = pipOutput.split("\n");
    console.log(`Found ${Math.max(0, lines.length - 2)} Python dependencies.`);
    pythonLicenses += pipOutput;
    pythonLicenses += "\n\n---\n\n";
  }
} catch (_e) {
  console.warn("⚠️ Failed to generate Python dependencies. Is pip-licenses installed?");
  pythonLicenses += "*(Generation Failed)*\n";
}

// Combine and Write
const splitLine =
  "\n\n********************************************************************************\n\n";
const finalContent =
  `# Third-Party Licenses\n\nThis project makes use of the following open source packages:\n\n` +
  rustLicenses +
  splitLine +
  frontendLicenses +
  splitLine +
  pythonLicenses;

fs.writeFileSync(OUTPUT_FILE, finalContent);
console.log(`✅ Licenses written to ${OUTPUT_FILE}`);
