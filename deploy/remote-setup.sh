#!/usr/bin/env bash
# Runs ON the Raspberry Pi (as root, via sudo). Invoked by provision.sh over
# SSH - see deploy/README.md for the full deployment walkthrough.
set -euo pipefail

APP_DIR="/opt/pi-radio"
APP_USER="pi"
SERVICE_NAME="pi-radio"
ENV_FILE="/etc/default/pi-radio"

require_root() {
    if [ "$(id -u)" -ne 0 ]; then
        echo "This command must be run as root (sudo)." >&2
        exit 1
    fi
}

boot_dir() {
    # Bookworm and newer mount the FAT32 boot partition at /boot/firmware;
    # older releases use /boot directly. Either way this partition is
    # separate from the root filesystem and stays writable even when the
    # root overlay (see enable-readonly below) is active.
    if [ -d /boot/firmware ]; then
        echo /boot/firmware
    else
        echo /boot
    fi
}

root_is_overlay() {
    mount | awk '$3 == "/" { print $0 }' | grep -qi overlay
}

cmd_deploy() {
    require_root
    local staging_dir="${1:?staging directory required}"

    if root_is_overlay; then
        echo "ERROR: the root filesystem is currently a read-only overlay." >&2
        echo "App files written now would be lost on the next reboot." >&2
        echo "Run: sudo $0 disable-readonly, reboot, then re-run the deploy." >&2
        exit 1
    fi

    echo "== Installing system packages =="
    apt-get update
    apt-get install -y curl mpv alsa-utils bluez

    echo "== Enabling I2C interface (for the LCD display) =="
    if command -v raspi-config >/dev/null 2>&1; then
        raspi-config nonint do_i2c 0
    else
        echo "raspi-config not found; enable I2C manually if using the LCD display." >&2
    fi

    if ! command -v node >/dev/null 2>&1 || [ "$(node -v | sed 's/^v//' | cut -d. -f1)" -lt 20 ]; then
        echo "== Installing Node.js =="
        curl -fsSL https://deb.nodesource.com/setup_24.x | bash -
        apt-get install -y nodejs
    fi

    echo "== Installing app to $APP_DIR =="
    mkdir -p "$APP_DIR"
    rm -rf "$APP_DIR/dist"
    cp -r "$staging_dir/dist" "$APP_DIR/dist"
    cp "$staging_dir/package.json" "$staging_dir/package-lock.json" "$APP_DIR/"
    chown -R "$APP_USER:$APP_USER" "$APP_DIR"

    echo "== Installing npm production dependencies =="
    (cd "$APP_DIR" && sudo -u "$APP_USER" npm ci --omit=dev)

    local bdir
    bdir="$(boot_dir)"
    echo "== Setting up persistent preset/settings storage on $bdir =="
    mkdir -p "$bdir/pi-radio"
    chown "$APP_USER:$APP_USER" "$bdir/pi-radio"
    {
        echo "PI_RADIO_PRESETS_PATH=$bdir/pi-radio/presets.json"
        echo "PI_RADIO_SETTINGS_PATH=$bdir/pi-radio/settings.json"
        echo "PI_RADIO_USE_HARDWARE=true"
    } > "$ENV_FILE"

    # If deploy/.env was shipped (see provision.sh), append it on top - since
    # systemd's EnvironmentFile parsing keeps the last assignment of a given
    # key, any of the three defaults just written above can still be
    # overridden by the user's own file, while anything they didn't set
    # (e.g. PI_RADIO_BLUETOOTH_NAME) just adds new variables.
    if [ -f "$staging_dir/pi-radio.env" ]; then
        echo "== Applying custom settings from deploy/.env =="
        cat "$staging_dir/pi-radio.env" >> "$ENV_FILE"
    fi

    # PI_RADIO_BLUETOOTH_NAME, if set in deploy/.env, is applied here rather
    # than left to the app - it's a one-off adapter setting (persisted by
    # bluetoothd itself), not something the app needs to care about at
    # runtime.
    local bt_name
    bt_name="$(grep -E '^PI_RADIO_BLUETOOTH_NAME=' "$ENV_FILE" | tail -n1 | cut -d= -f2-)"
    if [ -n "$bt_name" ]; then
        echo "== Setting Bluetooth device name to '$bt_name' =="
        bluetoothctl system-alias "$bt_name"
    fi

    echo "== Installing systemd service =="
    cp "$staging_dir/pi-radio.service" "/etc/systemd/system/$SERVICE_NAME.service"
    systemctl daemon-reload
    systemctl enable "$SERVICE_NAME"
    systemctl restart "$SERVICE_NAME"

    echo "== Deploy complete =="
    systemctl status "$SERVICE_NAME" --no-pager || true
}

cmd_enable_readonly() {
    require_root
    echo "== Enabling the read-only root overlay =="
    echo "This protects the SD card from corruption on power loss."
    echo "IMPORTANT: run this only once you're happy with the currently"
    echo "deployed version - writes made after the next reboot will not persist."
    if ! command -v raspi-config >/dev/null 2>&1; then
        echo "raspi-config not found. Enable manually via your OS's overlay filesystem option." >&2
        exit 1
    fi
    if raspi-config nonint do_overlayfs 0; then
        echo "Enabled. Reboot to activate: sudo reboot"
    else
        echo "Automatic enable failed or 'do_overlayfs' is unsupported on this OS version." >&2
        echo "Enable it manually instead: sudo raspi-config -> Advanced Options -> Overlay FS." >&2
        exit 1
    fi
}

cmd_disable_readonly() {
    require_root
    echo "== Disabling the read-only root overlay (so the root filesystem is writable again) =="
    if ! command -v raspi-config >/dev/null 2>&1; then
        echo "raspi-config not found. Disable manually via your OS's overlay filesystem option." >&2
        exit 1
    fi
    if raspi-config nonint do_overlayfs 1; then
        echo "Disabled. Reboot for the root filesystem to be writable again: sudo reboot"
    else
        echo "Automatic disable failed or 'do_overlayfs' is unsupported on this OS version." >&2
        echo "Disable it manually instead: sudo raspi-config -> Advanced Options -> Overlay FS." >&2
        exit 1
    fi
}

case "${1:-}" in
    deploy) cmd_deploy "${2:-}" ;;
    enable-readonly) cmd_enable_readonly ;;
    disable-readonly) cmd_disable_readonly ;;
    *)
        echo "Usage: $0 {deploy <staging_dir>|enable-readonly|disable-readonly}" >&2
        exit 1
        ;;
esac
