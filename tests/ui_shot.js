// Screenshot the game UI in Chromium over a mock desktop backdrop (white or dark).
// usage: node tests/ui_shot.js "<query>" out.png [w] [h] [backdrop] [waitMs] [keys]
const { chromium } = require('playwright');
const path = require('path');
(async () => {
  const [query = '', out = 'ui.png', w = '720', h = '520', backdrop = 'white', wait = '1500', keys = ''] = process.argv.slice(2);
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: +w, height: +h }, deviceScaleFactor: 1 });
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  const url = 'file://' + path.join(__dirname, '..', 'Sources', 'DesktopBonk', 'Web', 'index.html') + '?nopause&' + query;
  await page.goto(url);
  // emulate the desktop behind the transparent window
  await page.addStyleTag({ content: backdrop === 'white'
    ? 'html{background:#fff url("data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%22720%22 height=%22520%22><rect width=%22100%25%22 height=%2244%22 fill=%22%23eceff3%22/><text x=%2220%22 y=%2290%22 font-family=%22Helvetica%22 font-size=%2222%22 fill=%22%23222%22>How can I help you today?</text><rect x=%2220%22 y=%22120%22 width=%22600%22 height=%2210%22 fill=%22%23ddd%22/><rect x=%2220%22 y=%22140%22 width=%22520%22 height=%2210%22 fill=%22%23ddd%22/><rect x=%2220%22 y=%22160%22 width=%22560%22 height=%2210%22 fill=%22%23ddd%22/></svg>") no-repeat}'
    : 'html{background:#1e1f24}' });
  await page.waitForTimeout(+wait);
  for (const k of keys.split(',').filter(Boolean)) {
    const [key, ms] = k.split(':');
    if (key === 'click') { await page.click(ms); continue; }
    await page.keyboard.down(key); await page.waitForTimeout(+(ms || 300)); await page.keyboard.up(key);
  }
  await page.waitForTimeout(200);
  await page.screenshot({ path: out });
  console.log('errors:', JSON.stringify(errs));
  await browser.close();
})();
