#!/usr/bin/env bash
# Runs the browser test on a temporary Gerrit site.
# Environment: GERRIT_VERSION (default 3.10.9), JAVA (default java),
# CHROME (default /usr/bin/chromium-browser), WORK (default e2e/.work).
set -euo pipefail

cd "$(dirname "$0")/.."
ROOT=$PWD
GERRIT_VERSION=${GERRIT_VERSION:-3.10.9}
JAVA=${JAVA:-java}
WORK=$(realpath -m "${WORK:-e2e/.work}")
PORT=8089
WAR=$WORK/gerrit-$GERRIT_VERSION.war
SITE=$WORK/site-$GERRIT_VERSION

npm run build
mkdir -p "$WORK/screenshots"
if [ ! -f "$WAR" ]; then
  curl -sfo "$WAR" "https://gerrit-releases.storage.googleapis.com/gerrit-$GERRIT_VERSION.war"
fi

# A new site for each run, so that the test data starts empty.
rm -rf "$SITE"
# Gerrit unpacks the war file in ./tmp, so run it from the work directory.
cd "$WORK"
"$JAVA" -jar "$WAR" init --batch --dev --no-auto-start -d "$SITE" >"$WORK/init.log" 2>&1
git config -f "$SITE/etc/gerrit.config" httpd.listenUrl "http://localhost:$PORT/"
git config -f "$SITE/etc/gerrit.config" gerrit.canonicalWebUrl "http://localhost:$PORT/"
git config -f "$SITE/etc/gerrit.config" sshd.listenAddress off
cp "$ROOT/dist/renderer-diff.js" "$SITE/plugins/"
mkdir -p "$SITE/static"
cp "$ROOT/dist/mermaid.min.js" "$SITE/static/"

"$JAVA" -jar "$WAR" daemon -d "$SITE" --console-log >"$WORK/gerrit.log" 2>&1 &
GERRIT_PID=$!
trap 'kill $GERRIT_PID' EXIT
curl -sf --noproxy localhost --retry 60 --retry-connrefused --retry-delay 2 \
  -o /dev/null "http://localhost:$PORT/config/server/version"

cd "$ROOT"
node e2e/test.mjs "http://localhost:$PORT" "$WORK/screenshots"
