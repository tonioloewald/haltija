#!/bin/bash
# Generate app icons from SVG using macOS built-in tools only

set -e

APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
ROOT_DIR="$(cd "$APP_DIR/../.." && pwd)"
SVG="$ROOT_DIR/haltija-icon.svg"
ICONS="$APP_DIR/icons"

mkdir -p "$ICONS"

# Use qlmanage to convert SVG to PNG (built into macOS)
echo "Converting SVG to PNG..."
qlmanage -t -s 1024 -o "$ICONS" "$SVG" 2>/dev/null
mv "$ICONS/haltija-icon.svg.png" "$ICONS/icon_1024x1024.png"

# Resize with sips (built into macOS)
for size in 512 256 128 64 32 16; do
  sips -z $size $size "$ICONS/icon_1024x1024.png" --out "$ICONS/icon_${size}x${size}.png" >/dev/null
  echo "  ${size}x${size}"
done

cp "$ICONS/icon_512x512.png" "$ICONS/icon.png"

# Create .icns
echo "Creating .icns..."
ICONSET="$ICONS/icon.iconset"
mkdir -p "$ICONSET"
cp "$ICONS/icon_16x16.png" "$ICONSET/icon_16x16.png"
cp "$ICONS/icon_32x32.png" "$ICONSET/icon_16x16@2x.png"
cp "$ICONS/icon_32x32.png" "$ICONSET/icon_32x32.png"
cp "$ICONS/icon_64x64.png" "$ICONSET/icon_32x32@2x.png"
cp "$ICONS/icon_128x128.png" "$ICONSET/icon_128x128.png"
cp "$ICONS/icon_256x256.png" "$ICONSET/icon_128x128@2x.png"
cp "$ICONS/icon_256x256.png" "$ICONSET/icon_256x256.png"
cp "$ICONS/icon_512x512.png" "$ICONSET/icon_256x256@2x.png"
cp "$ICONS/icon_512x512.png" "$ICONSET/icon_512x512.png"
cp "$ICONS/icon_1024x1024.png" "$ICONSET/icon_512x512@2x.png"
iconutil -c icns "$ICONSET" -o "$ICONS/icon.icns"
rm -rf "$ICONSET"

echo "Done! Icons in $ICONS"
