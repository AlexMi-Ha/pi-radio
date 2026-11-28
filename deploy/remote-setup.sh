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
    # separate from the root filesystem, so it physically survives the root
    # overlay (see enable-readonly below) across reboots - though by default
    # overlay-fs also force-mounts it read-only (see ensure_boot_writable).
    if [ -d /boot/firmware ]; then
        echo /boot/firmware
    else
        echo /boot
    fi
}

root_is_overlay() {
    mount | awk '$3 == "/" { print $0 }' | grep -qi overlay
}

# Raspberry Pi OS's overlay-fs feature write-protects /boot/firmware itself
# (via overlayroot, which can't apply its RW copy-up mechanism to a FAT
# partition, so it just force-mounts it "ro" in fstab) - but cmd_deploy's
# own config.txt edits and the app-data image file (see
# setup_app_data_partition) need it writable by root at deploy time. Patches
# fstab back to rw and remounts live so it takes effect immediately, without
# requiring a reboot first. Only root ever writes to this partition directly
# (the app itself never does - see setup_app_data_partition), so no
# uid=/umask= override is needed here.
ensure_boot_writable() {
    local bdir
    bdir="$(boot_dir)"
    sed -i -E "s#^([^[:space:]]+[[:space:]]+${bdir}[[:space:]]+vfat[[:space:]]+)[^[:space:]]+#\1defaults,rw#" /etc/fstab
    mount -o remount,rw "$bdir" 2>/dev/null || true
}

APP_DATA_MOUNT="/var/lib/pi-radio"
APP_DATA_IMG_SIZE_MB=64

# Presets/settings/logs need to survive the read-only root overlay, so they
# can't live under /opt or /var on the root filesystem - but they also
# shouldn't live directly on the FAT boot partition, since FAT has no real
# per-file Unix permissions (any mount-wide mask that lets the unprivileged
# "pi" user write there lets it write to config.txt/cmdline.txt/the kernel
# too - a compromised app process could then get persistent, pre-boot code
# execution). Instead, a single ext4 image FILE lives on the boot partition
# (so it physically survives the overlay) and gets loop-mounted at
# $APP_DATA_MOUNT, which - being real ext4 - supports normal ownership: only
# root (via the loop mount) ever touches the boot partition itself, while
# the app gets a normal pi-owned, 0700 directory with no access to anything
# else on that partition.
setup_app_data_partition() {
    local bdir img
    bdir="$(boot_dir)"
    img="$bdir/pi-radio-data.img"

    mkdir -p "$APP_DATA_MOUNT"

    if [ ! -f "$img" ]; then
        echo "== Creating app data image ($APP_DATA_IMG_SIZE_MB MB) at $img =="
        dd if=/dev/zero of="$img" bs=1M count="$APP_DATA_IMG_SIZE_MB" status=none
        mkfs.ext4 -q "$img"
    fi

    # fsck pass 0 (last field): a loop-mounted image file isn't a real boot
    # device systemd-fsck@.service expects, and this is non-critical, easily
    # recreated data, so skip fsck rather than fight that integration.
    ensure_config_txt_line /etc/fstab "$img $APP_DATA_MOUNT ext4 loop,rw 0 0"

    if ! mountpoint -q "$APP_DATA_MOUNT"; then
        mount -o loop "$img" "$APP_DATA_MOUNT"
    fi

    chown "$APP_USER:$APP_USER" "$APP_DATA_MOUNT"
    chmod 700 "$APP_DATA_MOUNT"
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

# Raspberry Pi OS soft-blocks the onboard Bluetooth radio via rfkill on some
# images (confirmed via `rfkill list` showing hci0 soft-blocked), which makes
# bluetoothd's own "power on" fail silently from the app's point of view -
# BluetoothAudioProvider.start()'s `bluetoothctl power on` exits 1 with
# bluetoothd logging "Failed to set mode: Failed (0x03)". Unblocking is
# idempotent (a no-op if already unblocked) and takes effect immediately, no
# reboot needed.
unblock_bluetooth_rfkill() {
    echo "== Unblocking Bluetooth radio (rfkill) =="
    rfkill unblock bluetooth
}

# bluez-alsa-utils ships a bluealsa.service, but its default profile set isn't
# guaranteed to include A2DP sink across Raspberry Pi OS versions - without
# it, a phone can pair/connect fine but still has no A2DP sink profile to
# stream audio to, so it keeps playing out of its own speakers even once
# "Paired" in the app. Pinning -p a2dp-sink via a drop-in makes the Pi always
# advertise itself as a sink, which is the only profile BluetoothAudioProvider
# (via bluealsa-aplay) ever needs.
configure_bluealsa_sink() {
    echo "== Configuring bluealsa for A2DP sink =="
    mkdir -p /etc/systemd/system/bluealsa.service.d
    cat > /etc/systemd/system/bluealsa.service.d/override.conf <<'EOF'
[Service]
ExecStart=
ExecStart=/usr/bin/bluealsa -p a2dp-sink
EOF
    systemctl daemon-reload
    systemctl enable bluealsa.service
    systemctl restart bluealsa.service
}

# BlueZ defaults the adapter's advertised Class of Device major/minor bits to
# 0 ("Miscellaneous") - phones (confirmed on iOS) only list a Bluetooth
# accessory in their audio-output picker once it's paired AND its class says
# "this is an audio device", so without this the Pi can bond/connect fine but
# never actually appears as a selectable A2DP output. 0x000414 = major class
# Audio/Video (0x04), minor class Loudspeaker (0x05) - see the Bluetooth
# Assigned Numbers "Baseband" class-of-device tables. Service class bits
# (Rendering/Audio/Telephony, already set correctly) are managed separately
# by bluetoothd itself based on active profiles, not by this config value.
configure_bluetooth_device_class() {
    echo "== Setting Bluetooth device class to Audio/Loudspeaker =="
    local conf=/etc/bluetooth/main.conf
    if grep -qE '^[[:space:]]*#?[[:space:]]*Class[[:space:]]*=' "$conf"; then
        sed -i -E 's/^[[:space:]]*#?[[:space:]]*Class[[:space:]]*=.*/Class = 0x000414/' "$conf"
    else
        sed -i '/^\[General\]/a Class = 0x000414' "$conf"
    fi
    systemctl restart bluetooth
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

    ensure_boot_writable

    echo "== Installing system packages =="
    apt-get update
    apt-get upgrade -y
    apt-get install -y curl mpv alsa-utils bluez bluez-alsa-utils i2c-tools gpiod

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

    echo "== Setting up persistent app data storage at $APP_DATA_MOUNT =="
    setup_app_data_partition
    {
        echo "PI_RADIO_PRESETS_PATH=$APP_DATA_MOUNT/presets.json"
        echo "PI_RADIO_SETTINGS_PATH=$APP_DATA_MOUNT/settings.json"
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

    unblock_bluetooth_rfkill
    configure_bluetooth_device_class
    configure_bluealsa_sink

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

# raspi-config's do_overlayfs enables overlayroot (see /etc/overlayroot.conf)
# with a bare "overlayroot=tmpfs" kernel param, leaving its "recurse" option
# at the default of 1 - which overlayroot.conf documents as "all filesystems
# will be mounted read-only", not just "/". It discovers every OTHER local
# mount in /etc/fstab too (confirmed via mount(8) after enabling: our own
# $APP_DATA_MOUNT ext4 loop mount gets a SECOND tmpfs-backed overlay stacked
# on top of it, same as root) and silently discards writes to it on every
# reboot - defeating the entire point of that partition. recurse=0 limits
# the read-only/tmpfs treatment to "/" alone, leaving other local mounts
# (just the data partition, here) writing straight through to their real
# backing device.
set_overlayroot_recurse_0() {
    local cmdline="$(boot_dir)/cmdline.txt"
    if grep -qE '(^|[[:space:]])overlayroot=tmpfs:recurse=0([[:space:]]|$)' "$cmdline"; then
        return
    fi
    sed -i -E 's/(^|[[:space:]])overlayroot=tmpfs([[:space:]]|$)/\1overlayroot=tmpfs:recurse=0\2/' "$cmdline"
}

# raspi-config's own disable_overlayfs() strips the overlay param with
# `sed ... "s/\(.*\)overlayroot=tmpfs \(.*\)/\1\2/"` - that regex requires a
# literal space right after "tmpfs", which set_overlayroot_recurse_0 above
# removes by rewriting the token to "overlayroot=tmpfs:recurse=0". With the
# suffix in the way, raspi-config's sed silently matches nothing (not an
# error), so `raspi-config nonint do_overlayfs 1` reports success while
# leaving the overlay fully enabled - confirmed on-device: cmd_disable_readonly
# printed "Disabled" but the overlay was still active after the next reboot.
# Strip the suffix back off first so raspi-config's exact-match regex works.
unset_overlayroot_recurse_0() {
    local cmdline="$(boot_dir)/cmdline.txt"
    sed -i -E 's/(^|[[:space:]])overlayroot=tmpfs:recurse=0([[:space:]]|$)/\1overlayroot=tmpfs\2/' "$cmdline"
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
        # do_overlayfs also write-protects /boot/firmware - undo that (see
        # ensure_boot_writable) while the real /etc/fstab is still editable
        # (the overlay itself only takes effect on the next reboot).
        ensure_boot_writable
        set_overlayroot_recurse_0
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
    ensure_boot_writable
    unset_overlayroot_recurse_0
    if raspi-config nonint do_overlayfs 1; then
        # The /boot/firmware "ro" fstab entry is independent of the root
        # overlay toggle - disabling the overlay alone doesn't revert it.
        # cmd_deploy also calls ensure_boot_writable itself (belt-and-
        # suspenders - it's the one that actually needs this to hold).
        ensure_boot_writable
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
