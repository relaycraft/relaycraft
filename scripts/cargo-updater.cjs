/**
 * Custom updater for standard-version to handle Cargo.toml
 */
const stringify = (obj) => JSON.stringify(obj, null, 2);

module.exports.readVersion = function (contents) {
    const match = contents.match(/^version\s*=\s*"([^"]+)"/m);
    return match ? match[1] : null;
};

module.exports.writeVersion = function (contents, version) {
    return contents.replace(/^version\s*=\s*"[^"]+"/m, `version = "${version}"`);
};
