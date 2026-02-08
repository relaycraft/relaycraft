const fs = require('fs');
const path = require('path');

/**
 * This script generates the standard Tauri 2.0 latest.json for the updater.
 * It scans the provided directory for signed binaries and their .sig files.
 */

const artifactsDir = process.argv[2] || 'dist';
const version = process.argv[3];
const repoUrl = "https://github.com/relaycraft/relaycraft/releases/download";

if (!version) {
    console.error("Usage: node generate-update-json.cjs <artifacts-dir> <version>");
    process.exit(1);
}

const tag = `v${version.replace(/^v/, '')}`;
const output = {
    version: tag,
    notes: `Release ${tag}`,
    pub_date: new Date().toISOString(),
    platforms: {}
};

// Platform mapping: Tauri bundle name pattern -> Tauri platform key
const platformMap = [
    { pattern: /\.msi\.zip$/, key: 'windows-x86_64' },
    { pattern: /\.nsis\.zip$/, key: 'windows-x86_64' },
    { pattern: /\.msi$/, key: 'windows-x86_64' },
    { pattern: /\.exe$/, key: 'windows-x86_64' },
    { pattern: /\.app\.tar\.gz$/, key: 'macos-aarch64' },
    { pattern: /\.app\.tar\.gz$/, key: 'macos-x86_64' },
    { pattern: /\.deb\.gz$/, key: 'linux-x86_64' },
    { pattern: /\.AppImage\.tar\.gz$/, key: 'linux-x86_64' }
];


function getSignature(filePath) {
    const sigPath = `${filePath}.sig`;
    if (fs.existsSync(sigPath)) {
        return fs.readFileSync(sigPath, 'utf8').trim();
    }
    return null;
}

// Logic to refine platform keys based on common filenames
function getPlatformKey(filename) {
    if (filename.includes('aarch64') || filename.includes('arm64')) {
        if (filename.includes('macos') || filename.includes('apple-darwin')) return 'macos-aarch64';
        if (filename.includes('linux')) return 'linux-aarch64';
    }
    if (filename.includes('x64') || filename.includes('x86_64')) {
        if (filename.includes('macos') || filename.includes('apple-darwin')) return 'macos-x86_64';
        if (filename.includes('windows')) return 'windows-x86_64';
        if (filename.includes('linux')) return 'linux-x86_64';
    }
    // Fallback based on extension
    if (filename.endsWith('.msi.zip') || filename.endsWith('.msi')) return 'windows-x86_64';
    if (filename.endsWith('.exe')) return 'windows-x86_64';
    if (filename.endsWith('.app.tar.gz')) return 'macos-x86_64'; // Default to x64 if unknown
    if (filename.endsWith('.deb.gz') || filename.endsWith('.AppImage.tar.gz')) return 'linux-x86_64';

    return null;
}

const files = fs.readdirSync(artifactsDir);
files.forEach(file => {
    // We only care about the archives/installers that Tauri updater uses
    if (file.endsWith('.zip') || file.endsWith('.tar.gz') || file.endsWith('.gz') || file.endsWith('.msi') || file.endsWith('.exe')) {
        if (file.endsWith('.sig')) return; // handled by getSignature

        const key = getPlatformKey(file);
        if (key) {
            const signature = getSignature(path.join(artifactsDir, file));
            if (signature) {
                output.platforms[key] = {
                    signature,
                    url: `${repoUrl}/${tag}/${file}`
                };
            }
        }
    }
});

fs.writeFileSync(path.join(artifactsDir, 'latest.json'), JSON.stringify(output, null, 2));
console.log(`✅ successfully generated latest.json in ${artifactsDir}`);
console.log(JSON.stringify(output, null, 2));
