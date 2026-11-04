#!/bin/bash
# Creates DesktopBonk-source.zip (and DesktopBonk-app.zip if build/DesktopBonk.app exists).
set -euo pipefail
cd "$(dirname "$0")"
rm -f DesktopBonk-source.zip
git ls-files 2>/dev/null | zip -q DesktopBonk-source.zip -@ || zip -qr DesktopBonk-source.zip . -x "build/*" ".git/*" "*.zip" "tests/output/*"
echo "✓ DesktopBonk-source.zip"
if [ -d build/DesktopBonk.app ]; then
  (cd build && ditto -c -k --keepParent DesktopBonk.app ../DesktopBonk-app.zip 2>/dev/null || zip -qry ../DesktopBonk-app.zip DesktopBonk.app)
  echo "✓ DesktopBonk-app.zip"
fi
