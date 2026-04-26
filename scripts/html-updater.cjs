/**
 * Custom version updater for HTML files (used by bump-extra-files.cjs).
 * Supports:
 * - Splash footer: <div class="footer-line">v1.2.3 · © …</div>
 * - Legacy: <div class="version">v1.2.3</div>
 */
module.exports.readVersion = (contents) => {
  const footer = contents.match(/<div class="footer-line">v([\d.+\-a-zA-Z]+)/);
  if (footer) return footer[1].trim();
  const legacy = contents.match(/<div class="version">v([^<]+)<\/div>/);
  return legacy ? legacy[1].trim() : null;
};

module.exports.writeVersion = (contents, version) => {
  if (/<div class="footer-line">v[\d.+\-a-zA-Z]+/.test(contents)) {
    return contents.replace(/(<div class="footer-line">)v[\d.+\-a-zA-Z]+/, `$1v${version}`);
  }
  return contents.replace(/(<div class="version">)v[^<]+(<\/div>)/, `$1v${version}$2`);
};
