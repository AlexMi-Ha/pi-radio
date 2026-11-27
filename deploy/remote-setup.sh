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

# Idempotently ensures an exact line is present verbatim in a config.txt-style
# file (appends if missing, no-op if already there) - used instead of a
# key=value replace since config.txt can legitimately have multiple
# `dtoverlay=...` lines for unrelated overlays and we must not clobber them.
ensure_config_txt_line() {
    local file="$1" line="$2"
    grep -qFx "$line" "$file" || echo "$line" >> "$file"
}

# Idempotently sets a `key=value` line, replacing any existing uncommented
# `key=...` line (there should only ever be one for keys like
# `dtparam=audio`) rather than duplicating it on re-deploy.
set_config_txt_kv() {
    local file="$1" key="$2" value="$3"
    if grep -qE "^${key}=" "$file"; then
        sed -i "s|^${key}=.*|${key}=${value}|" "$file"
    else
        echo "${key}=${value}" >> "$file"
    fi
}

# Gated on PI_RADIO_AUDIO_HAT (set via deploy/.env) - disables onboard/HDMI
# audio so the HAT's DAC becomes ALSA's only/default card, and installs the
# softvol mixer config so `amixer set Master` (AudioAdapter.ts) has a
# control to act on. Sets $AUDIO_HAT_CONFIGURED (0/1) so the caller knows
# whether config.txt was touched (and therefore needs a reboot).
configure_audio_hat() {
    local staging_dir="$1"
    AUDIO_HAT_CONFIGURED=0
    local hat="${PI_RADIO_AUDIO_HAT:-}"
    if [ -z "$hat" ]; then
        return
    fi

    local cfg
    cfg="$(boot_dir)/config.txt"
    echo "== Configuring audio HAT '$hat' in $cfg =="
    ensure_config_txt_line "$cfg" "dtoverlay=$hat"
    set_config_txt_kv "$cfg" "dtparam=audio" "off"
    set_config_txt_kv "$cfg" "hdmi_ignore_edid_audio" "1"
    AUDIO_HAT_CONFIGURED=1

    echo "== Installing ALSA softvol mixer config (/etc/asound.conf) =="
    cp "$staging_dir/asound.conf" /etc/asound.conf
}

# Enables the Pi's internal pull-ups on every GPIO line GpioInputAdapter
# reads (src/adapters/input/GpioInputAdapter.ts) - power/mode/action buttons,
# the encoder's push button, and the encoder's A/B quadrature lines. All six
# are read as "falling"/"both" with activeLow semantics, i.e. the code
# expects each pin to idle high and be pulled low on press/rotation; `onoff`
# (sysfs-based) has no pull-up/down option of its own, so an unpowered pin
# floats and produces spurious or missing edges unless the breakout board
# supplies its own pull-up. Always run, not gated like configure_audio_hat,
# since cmd_deploy always sets PI_RADIO_USE_HARDWARE=true below.
configure_gpio_pullups() {
    local cfg
    cfg="$(boot_dir)/config.txt"

    local power mode action enc_a enc_b enc_btn
    power="$(grep -E '^PI_RADIO_GPIO_POWER_BTN=' "$ENV_FILE" | tail -n1 | cut -d= -f2-)"
    mode="$(grep -E '^PI_RADIO_GPIO_MODE_BTN=' "$ENV_FILE" | tail -n1 | cut -d= -f2-)"
    action="$(grep -E '^PI_RADIO_GPIO_ACTION_BTN=' "$ENV_FILE" | tail -n1 | cut -d= -f2-)"
    enc_a="$(grep -E '^PI_RADIO_GPIO_ENCODER_A=' "$ENV_FILE" | tail -n1 | cut -d= -f2-)"
    enc_b="$(grep -E '^PI_RADIO_GPIO_ENCODER_B=' "$ENV_FILE" | tail -n1 | cut -d= -f2-)"
    enc_btn="$(grep -E '^PI_RADIO_GPIO_ENCODER_BTN=' "$ENV_FILE" | tail -n1 | cut -d= -f2-)"

    # Defaults mirror createInputAdapter() in src/index.ts.
    local pins="${power:-17},${mode:-27},${action:-22},${enc_a:-23},${enc_b:-24},${enc_btn:-25}"

    echo "== Enabling internal pull-ups on GPIO pins $pins in $cfg =="
    ensure_config_txt_line "$cfg" "gpio=$pins=pu"
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
    apt-get upgrade -y
    apt-get install -y curl mpv alsa-utils bluez i2c-tools

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
    # The boot partition is vfat, which has no concept of per-file Unix
    # ownership - chown always fails there with "Operation not permitted",
    # even as root, since it's an unsupported filesystem operation rather
    # than a permissions issue. Its default mount options (no uid=/gid=/
    # umask=) already leave it world-writable, so no chown is needed for
    # $APP_USER to write presets/settings there.
    if ! findmnt -n -o FSTYPE --target "$bdir" | grep -qi vfat; then
        chown "$APP_USER:$APP_USER" "$bdir/pi-radio"
    fi
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

    # PI_RADIO_AUDIO_HAT, if set in deploy/.env, is likewise applied here
    # rather than left to the app - it gates config.txt/asound.conf changes
    # that only make sense at deploy time (see configure_audio_hat above).
    local PI_RADIO_AUDIO_HAT
    PI_RADIO_AUDIO_HAT="$(grep -E '^PI_RADIO_AUDIO_HAT=' "$ENV_FILE" | tail -n1 | cut -d= -f2-)"
    configure_audio_hat "$staging_dir"

    configure_gpio_pullups

    echo "== Installing systemd service =="
    cp "$staging_dir/pi-radio.service" "/etc/systemd/system/$SERVICE_NAME.service"
    systemctl daemon-reload
    systemctl enable "$SERVICE_NAME"
    systemctl restart "$SERVICE_NAME"

    echo "== Deploy complete =="
    systemctl status "$SERVICE_NAME" --no-pager || true

    echo "== config.txt was updated (GPIO pull-ups$( [ "$AUDIO_HAT_CONFIGURED" -eq 1 ] && echo ", audio HAT" ) ) - reboot required to take effect =="
    echo "(provision.sh reboots automatically via enable-readonly at the end"
    echo "of a normal deploy; if you ran remote-setup.sh deploy directly, run"
    echo "'sudo reboot' yourself.)"
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
