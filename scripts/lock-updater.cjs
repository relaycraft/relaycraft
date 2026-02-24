/**
 * Custom updater for standard-version to handle Cargo.lock
 * It specifically targets the relaycraft package to avoid updating other dependencies
 */
module.exports.readVersion = (contents) => {
    const match = contents.match(/name\s*=\s*"relaycraft"\s+version\s*=\s*"([^"]+)"/);
    return match ? match[1] : null;
};

module.exports.writeVersion = (contents, version) => {
    return contents.replace(
        /(name\s*=\s*"relaycraft"\s+version\s*=\s*)"[^"]+"/,
        `$1"${version}"`
    );
};
