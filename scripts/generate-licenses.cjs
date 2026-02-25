const fs = require("node:fs");
const path = require("node:path");
const { execSync } = require("node:child_process");

const OUTPUT_FILE = path.join(__dirname, "../src/assets/licenses.json");
const TAURI_DIR = path.join(__dirname, "../src-tauri");
const ENGINE_DIR = path.join(__dirname, "../engine-core");

console.log("📦 Generating Third-Party License Report...");

// Ensure output directory exists
const outputDir = path.dirname(OUTPUT_FILE);
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

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

const licenses = [];

// 1. Rust Licenses (cargo-license)
console.log("🦀 Scanning Rust dependencies...");
try {
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
      licenses.push({
        ecosystem: "Rust",
        name: c.name,
        version: c.version,
        license: c.license || "Unknown",
        repository: c.repository || "N/A"
      });
    });
  }
} catch (_e) {
  console.warn("⚠️ Failed to generate Rust licenses.");
}

// 2. Frontend Licenses (pnpm licenses)
console.log("⚛️ Scanning Frontend dependencies via pnpm...");
try {
  const jsonOutput = run("pnpm licenses list --json --prod", path.join(__dirname, ".."));
  if (jsonOutput) {
    const allLicenses = JSON.parse(jsonOutput);
    let count = 0;
    Object.entries(allLicenses).forEach(([licenseType, pkgs]) => {
      pkgs.forEach((pkg) => {
        if (!pkg.name.startsWith("relaycraft")) {
          count++;
          licenses.push({
            ecosystem: "Node.js",
            name: pkg.name,
            version: pkg.versions && pkg.versions.length > 0 ? pkg.versions[0] : "Unknown",
            license: pkg.license || licenseType || "Unknown",
            repository: pkg.homepage || pkg.repository || "N/A",
          });
        }
      });
    });
    console.log(`Found ${count} Frontend dependencies.`);
  }
} catch (e) {
  console.warn("⚠️ Failed to generate Frontend licenses.");
}

// Helper to find a suitable python version for mitmproxy (requires >= 3.10)
function getPythonCmd() {
  const candidates = process.platform === "win32"
    ? ["python", "py -3.12", "py -3"]
    : ["python3.12", "python3.11", "python3", "python"];

  for (const cmd of candidates) {
    try {
      execSync(`${cmd} --version`, { stdio: "ignore" });
      return cmd;
    } catch (e) { }
  }
  return "python3";
}

// 3. Python Licenses (pip-licenses)
console.log("🐍 Scanning Python dependencies via temp venv...");
const venvDir = path.join(ENGINE_DIR, ".venv_licenses");
try {
  const basePython = getPythonCmd();
  console.log(`  ↳ Using ${basePython} to create venv...`);
  run(`${basePython} -m venv .venv_licenses`, ENGINE_DIR);
  const venvPython =
    process.platform === "win32"
      ? path.join(venvDir, "Scripts", "python.exe")
      : path.join(venvDir, "bin", "python3");

  // Install requirements and pip-licenses into the isolated environment
  console.log("  ↳ Installing core packages...");
  run(`"${venvPython}" -m pip install --upgrade pip --quiet`, ENGINE_DIR);
  run(`"${venvPython}" -m pip install -r requirements.txt --quiet`, ENGINE_DIR);
  console.log("  ↳ Installing pip-licenses...");
  run(`"${venvPython}" -m pip install pip-licenses --quiet`, ENGINE_DIR);

  const pipOutput = run(
    `"${venvPython}" -m piplicenses --format=json --with-urls`,
    ENGINE_DIR
  );
  if (pipOutput) {
    const pythonDeps = JSON.parse(pipOutput);
    // filter out the pip-licenses itself and its direct deps if we want, but it's fine to include
    console.log(`Found ${pythonDeps.length} Python dependencies.`);
    pythonDeps.forEach((dep) => {
      licenses.push({
        ecosystem: "Python",
        name: dep.Name,
        version: dep.Version,
        license: dep.License || "Unknown",
        repository: dep.URL || "N/A",
      });
    });
  }
} catch (e) {
  console.warn("⚠️ Failed to generate Python dependencies.");
} finally {
  // Always clean up the temp venv
  try {
    fs.rmSync(venvDir, { recursive: true, force: true });
  } catch (e) { }
}

// Sort alphabetically by name
licenses.sort((a, b) => a.name.localeCompare(b.name));

// Write to JSON
fs.writeFileSync(OUTPUT_FILE, JSON.stringify(licenses, null, 2));
console.log(`✅ Licenses written to ${OUTPUT_FILE}`);
