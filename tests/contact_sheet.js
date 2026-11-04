// Renders a bot-only match as a contact sheet PNG (frames every N seconds) for visual inspection.
// usage: node tests/contact_sheet.js <mapId> <level> <bots> <seconds> <out.png> [mode]
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
(async () => {
  const [mapId = 'flatline', level = '3', bots = '6', secs = '12', out = 'sheet.png', mode = 'classic'] = process.argv.slice(2);
  const WEB = path.join(__dirname, '..', 'Sources', 'DesktopBonk', 'Web');
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1600, height: 1200 }, deviceScaleFactor: 1 });
  await page.setContent('<html><body style="margin:0;background:#888"><canvas id=c></canvas><canvas id=sheet></canvas></body></html>');
  for (const f of ['vendor/planck.min.js', 'js/util.js', 'js/config.js', 'js/world.js', 'js/sim.js', 'js/maps.js', 'js/ai.js', 'js/match.js', 'js/render.js']) {
    await page.addScriptTag({ content: fs.readFileSync(path.join(WEB, f), 'utf8') });
  }
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e)));
  const res = await page.evaluate(({ mapId, level, bots, secs, mode }) => {
    const settings = DB.util.deepClone(DB.DEFAULT_SETTINGS);
    settings.match.spectate = true; settings.match.bots = +bots; settings.match.difficulty = +level; settings.match.mode = mode;
    const roster = DB.buildRoster(settings, DB.util.rng(5));
    const match = new DB.Match({ mode, roster, mapId, winTarget: 99, phys: DB.resolvePhysics(), seed: 11, countdown: 0, roundEndDelay: 0.5 });
    match.start();
    const c = document.getElementById('c');
    const r = new DB.Renderer(c); r.resize(390, 270, 1); r.setOptions({ background: 'solid' });
    const sheet = document.getElementById('sheet');
    const cols = 4, frames = 16, fw = 390, fh = 270;
    sheet.width = cols * fw; sheet.height = Math.ceil(frames / cols) * fh;
    const sc = sheet.getContext('2d');
    const every = Math.round((+secs * 60) / frames);
    let f = 0;
    for (let s = 0; s < +secs * 60; s++) {
      match.step(1 / 60);
      for (const e of match.events) r.addEvent(e); match.events.length = 0;
      if (s % every === every - 1 && f < frames) {
        r.draw(match, 1);
        sc.drawImage(c, (f % cols) * fw, Math.floor(f / cols) * fh);
        sc.fillStyle = '#fff'; sc.font = '12px sans-serif';
        sc.fillText(`t=${((s + 1) / 60).toFixed(1)} r${match.round} ${match.state}`, (f % cols) * fw + 6, Math.floor(f / cols) * fh + 14);
        f++;
      }
    }
    c.remove();
    return { history: match.history, kills: match.kills };
  }, { mapId, level, bots, secs, mode });
  await page.locator('#sheet').screenshot({ path: out });
  console.log(JSON.stringify(res), errs);
  await browser.close();
})();
