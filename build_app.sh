#!/bin/bash
# Builds build/DesktopBonk.app (universal when possible) with the Xcode command-line tools.
# Requirements: macOS 12+, Xcode or "xcode-select --install". No third-party dependencies.
set -euo pipefail
cd "$(dirname "$0")"

SRC="Sources/DesktopBonk"
OUT="build"
APP="$OUT/DesktopBonk.app"
SDK="$(xcrun --show-sdk-path --sdk macosx)"
MIN="12.0"

rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources" "$OUT/obj"

built=()
for arch in arm64 x86_64; do
  echo "• compiling for $arch…"
  if xcrun swiftc -O -swift-version 5 -target "$arch-apple-macos$MIN" -sdk "$SDK" \
      "$SRC"/*.swift -framework Cocoa -framework WebKit -framework Carbon \
      -o "$OUT/obj/DesktopBonk-$arch"; then
    built+=("$OUT/obj/DesktopBonk-$arch")
  else
    echo "  (skipping $arch)"
  fi
done
if [ ${#built[@]} -eq 0 ]; then echo "Build failed" >&2; exit 1; fi
lipo -create "${built[@]}" -output "$APP/Contents/MacOS/DesktopBonk"

cp Packaging/Info.plist "$APP/Contents/Info.plist"
cp -R "$SRC/Web" "$APP/Contents/Resources/Web"
if [ -d Packaging/AppIcon.iconset ] && command -v iconutil >/dev/null; then
  iconutil -c icns Packaging/AppIcon.iconset -o "$APP/Contents/Resources/AppIcon.icns" || true
fi
# ad-hoc signature so macOS runs it locally without complaint
codesign --force --deep --sign - "$APP" >/dev/null 2>&1 || true

echo "✓ Built $APP"
echo "  Run it:  open \"$APP\"     (or drag it into /Applications)"
