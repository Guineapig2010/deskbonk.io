// `npm run install-app` — packages Desktop Bonk into a real macOS app, puts it in Applications and opens it.
// No Xcode needed: Electron ships prebuilt.
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFileSync } = require('child_process');

(async () => {
  const root = path.join(__dirname, '..');
  const mod = require('@electron/packager');
  const packager = mod.packager || mod.default || mod;
  const platform = process.argv.includes('--platform=darwin') ? 'darwin' : process.platform;
  const arch = (process.argv.find((a) => a.startsWith('--arch=')) || '').slice(7) || process.arch;
  console.log(`📦 Packaging Desktop Bonk for ${platform}-${arch}…`);
  const out = await packager({
    dir: root, name: 'Desktop Bonk', platform, arch, out: path.join(root, 'dist'), overwrite: true, prune: true, asar: false,
    icon: path.join(root, 'NoInstall', 'AppIcon.icns'),
    appBundleId: 'io.deskbonk.DesktopBonk', appCategoryType: 'public.app-category.arcade-games',
    extendInfo: { LSUIElement: true },
    ignore: [/^\/dist($|\/)/, /^\/build/, /^\/tests($|\/)/, /^\/docs($|\/)/, /^\/NoInstall\/launcher\.js$/, /\.swift$/, /\.zip$/,
      /^\/Package\.swift$/, /^\/STATUS\.md$/, /^\/make_.*\.sh$/, /^\/build_app\.sh$/, /^\/Desktop Bonk\.html$/, /^\/\.git/],
  });
  const appPath = path.join(out[0], 'Desktop Bonk.app');
  if (platform !== 'darwin' || process.platform !== 'darwin') { console.log('✓ Packaged at', out[0]); return; }

  let dest = '/Applications/Desktop Bonk.app';
  try { fs.accessSync('/Applications', fs.constants.W_OK); } catch (e) {
    fs.mkdirSync(path.join(os.homedir(), 'Applications'), { recursive: true });
    dest = path.join(os.homedir(), 'Applications', 'Desktop Bonk.app');
  }
  try { execFileSync('osascript', ['-e', 'tell application "Desktop Bonk" to quit']); } catch (e) { /* not running */ }
  fs.rmSync(dest, { recursive: true, force: true });
  execFileSync('ditto', [appPath, dest]);
  try { execFileSync('xattr', ['-cr', dest]); } catch (e) { /* fine */ }
  try { execFileSync('codesign', ['--force', '--deep', '--sign', '-', dest], { stdio: 'ignore' }); } catch (e) { /* fine */ }
  console.log('✓ Installed to', dest);
  execFileSync('open', [dest]);
  console.log('🎮 Desktop Bonk is running — look at the bottom-right of your screen. Next time open it from Applications.');
})().catch((e) => { console.error('✗ Install failed:', e && e.message ? e.message : e); process.exit(1); });
