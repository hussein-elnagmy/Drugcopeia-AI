#!/bin/bash
# Builds a self-contained native macOS app (Intel + Apple Silicon) from the
# offline webapp. No Apple Developer account is required: the bundle is
# ad-hoc signed so it runs locally.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
BUILD="$ROOT/build/macos"
APP="$BUILD/Dawaya.app"
CONTENTS="$APP/Contents"
# Prefer the synced www/ output: scripts/sync-web.sh rewrites the ?v= cache
# busting there, and webapp/ still carries the previous revision.
WWW="${WWW:-$ROOT/www}"
[ -d "$WWW" ] || WWW="$ROOT/webapp"

if [ ! -d "$WWW" ]; then
  echo "www/ not found. Run scripts/sync-web.mjs first." >&2
  exit 1
fi

# Regenerate the allowlist artifacts and refuse to build a bundle that breaks a
# privacy rule (banned SDK, undeclared host, new permission, drifted mirror).
/usr/bin/python3 "$ROOT/scripts/gen-privacy-config.py"
/usr/bin/python3 "$ROOT/scripts/privacy-check.py"

rm -rf "$BUILD"
mkdir -p "$CONTENTS/MacOS" "$CONTENTS/Resources"

cp "$HERE/Info.plist" "$CONTENTS/Info.plist"

# llama.cpp prebuilt runtime (b11985 XCFramework). Point LLAMA_XCFRAMEWORK at the
# extracted xcframework; tools/ai/fetch-llama.sh downloads it when missing.
LLAMA_XCFRAMEWORK="${LLAMA_XCFRAMEWORK:-$ROOT/native/apple/llama.xcframework}"
if [ ! -d "$LLAMA_XCFRAMEWORK/macos-arm64_x86_64/llama.framework" ]; then
  LLAMA_XCFRAMEWORK="/tmp/llama-runtime/apple/build-apple/llama.xcframework"
fi
LLAMA_FRAMEWORK="$LLAMA_XCFRAMEWORK/macos-arm64_x86_64/llama.framework"
if [ ! -d "$LLAMA_FRAMEWORK" ]; then
  echo "llama.framework not found. Run tools/ai/fetch-llama.sh first." >&2
  exit 1
fi
mkdir -p "$CONTENTS/Frameworks"
cp -R "$LLAMA_FRAMEWORK" "$CONTENTS/Frameworks/"

# Web assets (kept as a folder so relative fetches and the service worker work).
rsync -a --delete "$WWW/" "$CONTENTS/Resources/www/"

# Reminder alert tone, resolved by UNNotificationSound(named:) from the bundle.
cp "$HERE/DawayaAlert.caf" "$CONTENTS/Resources/DawayaAlert.caf"

# App icon.
ICON_SOURCE="$ROOT/webapp/assets/red-crescent-rx.png"
[ -f "$ICON_SOURCE" ] || ICON_SOURCE="$ROOT/webapp/assets/apple-touch-icon.png"
if [ -f "$ICON_SOURCE" ]; then
  ICONSET="$BUILD/AppIcon.iconset"
  mkdir -p "$ICONSET"
  for spec in "16:icon_16x16.png" "32:icon_16x16@2x.png" "32:icon_32x32.png" "64:icon_32x32@2x.png" "128:icon_128x128.png" "256:icon_128x128@2x.png" "256:icon_256x256.png" "512:icon_256x256@2x.png" "512:icon_512x512.png" "1024:icon_512x512@2x.png"; do
    size="${spec%%:*}"
    name="${spec#*:}"
    sips -z "$size" "$size" "$ICON_SOURCE" --out "$ICONSET/$name" >/dev/null
  done
  iconutil -c icns "$ICONSET" -o "$CONTENTS/Resources/AppIcon.icns"
  rm -rf "$ICONSET"
fi

export DEVELOPER_DIR="${DEVELOPER_DIR:-/Applications/Xcode.app/Contents/Developer}"

# llama.framework itself requires macOS 13.3, so the app floor moves with it.
MACOS_TARGET="13.3"
FRAMEWORK_SEARCH="$LLAMA_XCFRAMEWORK/macos-arm64_x86_64"

SRC=("$HERE/main.swift" "$ROOT/native/apple/LlamaEngine.swift" "$ROOT/native/apple/PhotoReader.swift")

echo "Compiling x86_64…"
xcrun --sdk macosx swiftc -O -whole-module-optimization \
  -target x86_64-apple-macos$MACOS_TARGET \
  -F "$FRAMEWORK_SEARCH" -framework llama \
  -Xlinker -rpath -Xlinker @executable_path/../Frameworks \
  -framework Cocoa -framework WebKit -framework Network -framework Security -framework UserNotifications -framework Vision \
  -o "$BUILD/Dawaya-x86_64" "${SRC[@]}"

echo "Compiling arm64…"
xcrun --sdk macosx swiftc -O -whole-module-optimization \
  -target arm64-apple-macos$MACOS_TARGET \
  -F "$FRAMEWORK_SEARCH" -framework llama \
  -Xlinker -rpath -Xlinker @executable_path/../Frameworks \
  -framework Cocoa -framework WebKit -framework Network -framework Security -framework UserNotifications -framework Vision \
  -o "$BUILD/Dawaya-arm64" "${SRC[@]}"

lipo -create "$BUILD/Dawaya-x86_64" "$BUILD/Dawaya-arm64" -output "$CONTENTS/MacOS/Dawaya"
chmod +x "$CONTENTS/MacOS/Dawaya"
rm -f "$BUILD/Dawaya-x86_64" "$BUILD/Dawaya-arm64"

echo "Signing…"
# The xcframework ships with symlinks materialized as real copies (the source
# archive cannot carry symlinks). codesign requires a canonical framework
# layout - Versions/Current as a symlink and root entries as symlinks into it -
# otherwise it rejects the bundle as "format is ambiguous".
FW="$CONTENTS/Frameworks/llama.framework"
if [ -d "$FW/Versions/A" ]; then
  if [ -d "$FW/Versions/Current" ] && [ ! -L "$FW/Versions/Current" ]; then
    rm -rf "$FW/Versions/Current"
  fi
  [ -L "$FW/Versions/Current" ] || ln -s A "$FW/Versions/Current"
  for entry in Headers Modules Resources llama; do
    if [ -e "$FW/$entry" ] && [ ! -L "$FW/$entry" ]; then
      rm -rf "$FW/$entry"
    fi
    [ -L "$FW/$entry" ] || ln -s "Versions/Current/$entry" "$FW/$entry"
  done
fi
codesign --force --sign - --timestamp=none "$FW"
codesign --force --sign - --timestamp=none "$APP"
codesign --verify --deep --strict "$APP"

echo "Bundling disk image…"
DMG="$ROOT/build/Dawaya-mac.dmg"
rm -f "$DMG"
hdiutil create -quiet -volname "Dawaya" -srcfolder "$APP" -ov -format UDZO "$DMG"

echo "Built: $APP"
echo "Built: $DMG"
