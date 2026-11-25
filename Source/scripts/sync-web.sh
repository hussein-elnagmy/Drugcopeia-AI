#!/bin/bash
# Rebuilds www/ from webapp/, injects the native bridge, and updates the
# bundled copies used by the Xcode and Gradle projects. Use this instead of
# the npm scripts when Node.js is not installed.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WEBAPP="$ROOT/webapp"
WWW="$ROOT/www"
BRIDGE="$ROOT/native/ios-shell.js"

[ -d "$WEBAPP" ] || { echo "missing webapp/: $WEBAPP" >&2; exit 1; }
[ -f "$BRIDGE" ] || { echo "missing native bridge: $BRIDGE" >&2; exit 1; }

# Generated first: the privacy config is the only source of the host allowlist
# that both net.js and the Android network security config enforce.
/usr/bin/python3 "$ROOT/scripts/gen-privacy-config.py"

rsync -a --delete-excluded --exclude '.DS_Store' "$WEBAPP"/ "$WWW"/
cp "$BRIDGE" "$WWW/ios-shell.js"

/usr/bin/python3 - "$WWW/index.html" "$WWW/service-worker.js" <<'PY'
import re, sys
html_path, sw_path = sys.argv[1], sys.argv[2]
sw = open(sw_path, encoding='utf-8').read()
match = re.search(r'dawaya-shell-v(\d+)', sw)
if not match:
    raise SystemExit('service-worker.js has no dawaya-shell-vN cache name')
version = match.group(1)
sw = re.sub(r'\?v=\d+', f'?v={version}', sw)
open(sw_path, 'w', encoding='utf-8').write(sw)
html = open(html_path, encoding='utf-8').read()
html = re.sub(r'\?v=\d+', f'?v={version}', html)
tag = f'<script src="ios-shell.js?v={version}"></script>'
if tag not in html:
    marker = '<script src="core.js'
    pos = html.find(marker)
    if pos < 0:
        raise SystemExit('index.html has no core.js script tag')
    html = html[:pos] + tag + '\n  ' + html[pos:]
open(html_path, 'w', encoding='utf-8').write(html)
print(f'web assets revision v{version}')
PY

for dest in "$ROOT/ios/App/App/public" "$ROOT/android/app/src/main/assets/public"; do
  [ -d "$dest" ] || continue
  rsync -a --delete --exclude '.DS_Store' "$WWW"/ "$dest"/
  echo "synced -> ${dest#$ROOT/}"
done

echo "privacy gate"
/usr/bin/python3 "$ROOT/scripts/privacy-check.py"
