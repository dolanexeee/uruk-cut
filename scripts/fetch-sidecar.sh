#!/usr/bin/env bash
# Fetch a static FFmpeg build and install it as the Tauri sidecar binary:
#   src-tauri/binaries/uruk-ffmpeg-<target-triple>[.exe]
#
# Usage:
#   scripts/fetch-sidecar.sh                # auto-detect host triple
#   scripts/fetch-sidecar.sh <triple>       # explicit, e.g. x86_64-pc-windows-msvc
#
# The sidecar binaries are NOT committed to git (they are ~80 MB per OS);
# this script is the single source of truth for obtaining them — the
# release workflow (.github/workflows/release-desktop.yml) calls it per
# matrix entry, and local desktop builds need it too.
#
# Upstream static builds used:
#   Linux   — johnvansickle.com static builds (GPLv3 build of FFmpeg,
#             shipped UNMODIFIED as a standalone executable next to the app)
#   Windows — gyan.dev "release essentials" (GPLv3 build, unmodified)
#   macOS   — static builds, unmodified: Intel via evermeet.cx direct
#             release file, Apple Silicon via osxexperts.net. (evermeet's
#             getrelease/* endpoints were retired — 404/410 as of
#             2026-10-16 — so do not use them.)
set -euo pipefail

TRIPLE="${1:-}"
if [ -z "$TRIPLE" ]; then
  case "$(uname -s)-$(uname -m)" in
    Linux-x86_64)           TRIPLE="x86_64-unknown-linux-gnu" ;;
    Linux-aarch64|Linux-arm64) TRIPLE="aarch64-unknown-linux-gnu" ;;
    Darwin-arm64)           TRIPLE="aarch64-apple-darwin" ;;
    Darwin-x86_64)          TRIPLE="x86_64-apple-darwin" ;;
    MINGW64_NT*-x86_64|MSYS_NT*-x86_64) TRIPLE="x86_64-pc-windows-msvc" ;;
    *) echo "fetch-sidecar: cannot auto-detect triple for $(uname -s)-$(uname -m); pass one explicitly" >&2; exit 1 ;;
  esac
fi

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST_DIR="$ROOT/src-tauri/binaries"
mkdir -p "$DEST_DIR"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

case "$TRIPLE" in
  x86_64-unknown-linux-gnu)
    curl -fL --retry 3 -o "$TMP/ff.tar.xz" \
      https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz
    tar -xJf "$TMP/ff.tar.xz" -C "$TMP"
    cp "$TMP"/ffmpeg-*-amd64-static/ffmpeg "$DEST_DIR/uruk-ffmpeg-$TRIPLE"
    ;;
  aarch64-unknown-linux-gnu)
    curl -fL --retry 3 -o "$TMP/ff.tar.xz" \
      https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-arm64-static.tar.xz
    tar -xJf "$TMP/ff.tar.xz" -C "$TMP"
    cp "$TMP"/ffmpeg-*-arm64-static/ffmpeg "$DEST_DIR/uruk-ffmpeg-$TRIPLE"
    ;;
  x86_64-pc-windows-msvc)
    curl -fL --retry 3 -o "$TMP/ff.zip" \
      https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip
    unzip -q "$TMP/ff.zip" -d "$TMP"
    cp "$TMP"/ffmpeg-*-essentials_build/bin/ffmpeg.exe "$DEST_DIR/uruk-ffmpeg-$TRIPLE.exe"
    ;;
  aarch64-apple-darwin)
    curl -fL --retry 3 -o "$TMP/ff.zip" \
      https://www.osxexperts.net/ffmpeg9arm.zip
    unzip -q "$TMP/ff.zip" -d "$TMP"
    cp "$TMP/ffmpeg" "$DEST_DIR/uruk-ffmpeg-$TRIPLE"
    ;;
  x86_64-apple-darwin)
    curl -fL --retry 3 -o "$TMP/ff.zip" \
      https://evermeet.cx/ffmpeg/ffmpeg-9.0.2.zip
    unzip -q "$TMP/ff.zip" -d "$TMP"
    cp "$TMP/ffmpeg" "$DEST_DIR/uruk-ffmpeg-$TRIPLE"
    ;;
  *)
    echo "fetch-sidecar: unsupported triple '$TRIPLE'" >&2
    exit 1
    ;;
esac

chmod +x "$DEST_DIR"/uruk-ffmpeg-"$TRIPLE"* 2>/dev/null || true
echo "fetch-sidecar: installed $(ls "$DEST_DIR"/uruk-ffmpeg-"$TRIPLE"*)"
