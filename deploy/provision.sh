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

is_overlay_active() {
    ssh "$TARGET" "mount | awk '\$3 == \"/\" { print \$0 }' | grep -qi overlay"
}

wait_for_ssh() {
    echo -n "Waiting for $TARGET to come back online"
    local attempt=0
    local max_attempts=60  # ~5 minutes at 5s apart
    while ! ssh -o ConnectTimeout=5 -o BatchMode=yes "$TARGET" true 2>/dev/null; do
        attempt=$((attempt + 1))
        if [ "$attempt" -ge "$max_attempts" ]; then
            echo
            echo "ERROR: $TARGET did not come back online in time." >&2
            exit 1
        fi
        echo -n "."
        sleep 5
    done
    echo " back online."
}

reboot_and_wait() {
    echo "== Rebooting $TARGET =="
    ssh "$TARGET" "sudo reboot" || true
    sleep 10  # give sshd time to actually go down before we start polling
    wait_for_ssh
}

if is_overlay_active; then
    echo "== Read-only overlay is active on $TARGET; disabling it and rebooting =="
    ssh "$TARGET" "mkdir -p $REMOTE_STAGING"
    scp -q "$SCRIPT_DIR/remote-setup.sh" "$TARGET:$REMOTE_STAGING/"
    ssh -t "$TARGET" "chmod +x $REMOTE_STAGING/remote-setup.sh && sudo $REMOTE_STAGING/remote-setup.sh disable-readonly"
    reboot_and_wait
fi

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
    "$SCRIPT_DIR/asound.conf" \
    "$TARGET:$REMOTE_STAGING/"

if [ -f "$SCRIPT_DIR/.env" ]; then
    echo "== Copying deploy/.env to $TARGET =="
    scp -q "$SCRIPT_DIR/.env" "$TARGET:$REMOTE_STAGING/pi-radio.env"
else
    echo "== No deploy/.env found, using built-in defaults only (see deploy/.env.example) =="
fi

echo "== Running remote setup (sudo password may be requested) =="
ssh -t "$TARGET" "chmod +x $REMOTE_STAGING/remote-setup.sh && sudo $REMOTE_STAGING/remote-setup.sh deploy $REMOTE_STAGING"

echo "== Enabling the read-only overlay to protect the SD card =="
ssh -t "$TARGET" "sudo $REMOTE_STAGING/remote-setup.sh enable-readonly"
reboot_and_wait

echo "== Done. The radio should be running at http://${TARGET#*@}:4200/ =="
