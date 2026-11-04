// Loads the game simulation (no DOM) into Node for headless tests.
const path = require('path');
const WEB = path.join(__dirname, '..', 'Sources', 'DesktopBonk', 'Web');
global.planck = require(path.join(WEB, 'vendor', 'planck.min.js'));
const order = ['util', 'config', 'world', 'sim', 'maps', 'ai', 'match'];
for (const f of order) {
  try { require(path.join(WEB, 'js', f + '.js')); } catch (e) { if (e.code !== 'MODULE_NOT_FOUND') throw e; }
}
module.exports = global.DB;
