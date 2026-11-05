#!/bin/bash
# Builds "Desktop Bonk.app" that needs NO developer tools: the overlay window is created by
# macOS's built-in osascript (JavaScript for Automation) running NoInstall/launcher.js.
set -euo pipefail
cd "$(dirname "$0")"
A="build-lite/Desktop Bonk.app"
rm -rf build-lite && mkdir -p "$A/Contents/MacOS" "$A/Contents/Resources"
cp -R Sources/DesktopBonk/Web "$A/Contents/Resources/Web"
cp NoInstall/launcher.js NoInstall/AppIcon.icns "$A/Contents/Resources/"
cp Packaging/Info.plist "$A/Contents/Info.plist"
cat > "$A/Contents/MacOS/DesktopBonk" <<'SH'
#!/bin/bash
RES="$(cd "$(dirname "$0")/../Resources" && pwd)"
exec /usr/bin/osascript -l JavaScript "$RES/launcher.js" "$RES/Web"
SH
chmod +x "$A/Contents/MacOS/DesktopBonk"
(cd build-lite && rm -f ../DesktopBonk-NoInstall.zip && zip -qry ../DesktopBonk-NoInstall.zip "Desktop Bonk.app")
echo "✓ DesktopBonk-NoInstall.zip"
