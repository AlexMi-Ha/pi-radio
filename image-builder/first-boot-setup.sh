#!/usr/bin/env bash
set -e

MARKER_FILE="/boot/first-boot-done"

if [ -f "$MARKER_FILE" ]; then
    echo "== First boot setup already completed, skipping =="
    exit 0
fi

echo "== Running first boot setup =="

/opt/pi-radio/setup/wifi-setup.sh
/opt/pi-radio/setup/install.sh
/opt/pi-radio/setup/overlay-setup.sh

systemctl disable first-boot-setup.service

touch "$MARKER_FILE" # /boot is always writable

echo "== First boot setup complete =="