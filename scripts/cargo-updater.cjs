/**
 * Custom version updater for Cargo.toml (used by bump-extra-files.cjs)
 */
const _stringify = (obj) => JSON.stringify(obj, null, 2);

module.exports.readVersion = (contents) => {
  const match = contents.match(/^version\s*=\s*"([^"]+)"/m);
  return match ? match[1] : null;
};

module.exports.writeVersion = (contents, version) =>
  contents.replace(/^version\s*=\s*"[^"]+"/m, `version = "${version}"`);
