#!/usr/bin/env bash
# Run this FROM YOUR DEV MACHINE to build and deploy the app to a Raspberry
# Pi that has already been flashed/configured (hostname, SSH, WiFi) via
# Raspberry Pi Imager. See deploy/README.md for the full walkthrough.
#
# Usage: ./deploy/provision.sh pi@pi-radio.local
set -euo pipefail

if [ $# -ne 1 ]; then
    echo "Usage: $0 <user@host>" >&2
    echo "Example: $0 pi@pi-radio.local" >&2
    exit 1
fi

TARGET="$1"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
REMOTE_STAGING="/tmp/pi-radio-deploy"

echo "== Building app locally =="
cd "$PROJECT_ROOT"
npm ci
npm run build

echo "== Copying files to $TARGET =="
ssh "$TARGET" "rm -rf $REMOTE_STAGING && mkdir -p $REMOTE_STAGING"
scp -rq \
    "$PROJECT_ROOT/dist" \
    "$PROJECT_ROOT/package.json" \
    "$PROJECT_ROOT/package-lock.json" \
    "$SCRIPT_DIR/remote-setup.sh" \
    "$SCRIPT_DIR/pi-radio.service" \
    "$TARGET:$REMOTE_STAGING/"

echo "== Running remote setup (sudo password may be requested) =="
ssh -t "$TARGET" "chmod +x $REMOTE_STAGING/remote-setup.sh && sudo $REMOTE_STAGING/remote-setup.sh deploy $REMOTE_STAGING"

echo "== Done. The radio should be running at http://${TARGET#*@}:4200/ =="
