#!/bin/bash
# Cross-compiles Dawaya for Windows from macOS/Linux.
# The webapp source is copied into ./www and embedded into a single .exe.
set -euo pipefail
cd "$(dirname "$0")"

GO="${GO:-go}"
# Prefer the synced www/ output: scripts/sync-web.sh rewrites the ?v= cache
# busting there, and webapp/ still carries the previous revision.
WEBAPP="${WEBAPP:-../www}"
[ -d "$WEBAPP" ] || WEBAPP="../webapp"
OUT="${OUT:-dist/Dawaya.exe}"

if [ ! -d "$WEBAPP" ]; then
  echo "webapp source not found: $WEBAPP" >&2
  exit 1
fi

ROOT="$(cd .. && pwd)"
/usr/bin/python3 "$ROOT/scripts/gen-privacy-config.py"
/usr/bin/python3 "$ROOT/scripts/privacy-check.py"

echo "==> staging web assets"
rsync -a --delete --exclude '.DS_Store' "$WEBAPP"/ www/
rm -f www/ios-shell.js

# On-device llama.cpp runtime: llama-server.exe plus its DLLs are embedded in the
# exe and unpacked into %LOCALAPPDATA%\Dawaya\runtime on first launch. The staged
# set in llama/ is llama.cpp b11985 windows-x64 CPU build - llama/README.txt carries
# the archive URL and SHA-256 and records that each file was checked against it.
# LLAMA_WIN_ZIP replaces it; when the zip is absent whatever is already staged is
# embedded unchanged, and only an empty llama/ folder falls back to smart search.
LLAMA_WIN_ZIP="${LLAMA_WIN_ZIP:-/tmp/llama-runtime/win.zip}"
mkdir -p llama
if [ -f "$LLAMA_WIN_ZIP" ]; then
  echo "==> staging llama.cpp runtime from $LLAMA_WIN_ZIP"
  rm -f llama/*.dll llama/*.exe
  unzip -oq "$LLAMA_WIN_ZIP" 'llama-server.exe' '*.dll' -d llama
else
  echo "==> llama runtime zip not found; embedding the runtime already in llama/" >&2
fi
RUNTIME_FILES=$(find llama -maxdepth 1 \( -name '*.dll' -o -name '*.exe' \) | wc -l | tr -d ' ')
if [ "$RUNTIME_FILES" = "0" ]; then
  echo "!! no llama.cpp runtime staged: the assistant will answer from smart search only" >&2
fi

echo "==> embedding icon, manifest and version resources"
if ! command -v go-winres >/dev/null 2>&1; then
  GOBIN="$PWD/tools" "$GO" install github.com/tc-hib/go-winres@latest
  WINRES="$PWD/tools/go-winres"
else
  WINRES="$(command -v go-winres)"
fi
rm -f rsrc_windows_*.syso
"$WINRES" simply \
  --arch amd64 \
  --out rsrc \
  --manifest gui \
  --icon tools/dawaya.ico \
  --product-name "Drugcopeia" \
  --file-description "Drugcopeia - offline Egypt medicine, condition and lab test guide" \
  --product-version 1.7.8.0 \
  --file-version 1.7.8.0 \
  --original-filename "Dawaya.exe" \
  --copyright "Dawaya"

echo "==> building $OUT"
mkdir -p "$(dirname "$OUT")"
GOOS=windows GOARCH=amd64 CGO_ENABLED=0 "$GO" build \
  -trimpath \
  -ldflags "-s -w -H windowsgui" \
  -o "$OUT" .

ls -lh "$OUT"
