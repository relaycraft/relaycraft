/**
 * Custom updater for standard-version to handle version strings in HTML files.
 * Supports:
 * - Splash footer: <div class="footer-line">v1.2.3 · © …</div>
 * - Legacy: <div class="version">v1.2.3</div>
 */
module.exports.readVersion = (contents) => {
  const footer = contents.match(/<div class="footer-line">v([^·<]+)/);
  if (footer) return footer[1].trim();
  const legacy = contents.match(/<div class="version">v([^<]+)<\/div>/);
  return legacy ? legacy[1].trim() : null;
};

module.exports.writeVersion = (contents, version) => {
  if (/<div class="footer-line">v[^·]+/.test(contents)) {
    return contents.replace(/(<div class="footer-line">)v[^·]+(·)/, `$1v${version}$2`);
  }
  return contents.replace(/(<div class="version">)v[^<]+(<\/div>)/, `$1v${version}$2`);
};
