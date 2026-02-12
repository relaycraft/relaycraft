/**
 * Custom updater for standard-version to handle version strings in HTML files
 * Matches <div class="version">v1.2.3</div>
 */
module.exports.readVersion = (contents) => {
    const match = contents.match(/<div class="version">v([^<]+)<\/div>/);
    return match ? match[1] : null;
};

module.exports.writeVersion = (contents, version) => {
    return contents.replace(
        /(<div class="version">)v[^<]+(<\/div>)/,
        `$1v${version}$2`
    );
};
