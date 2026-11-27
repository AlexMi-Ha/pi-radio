# Raspberry Pi deployment

This replaces the old `image-builder/`-based approach (building a custom
`.img` file by loop-mounting the OS image). Instead, we flash a stock
Raspberry Pi OS image using Raspberry Pi Imager's built-in customisation
features, then deploy the app over SSH with a small script.

## 1. Flash the SD card

Use the official [Raspberry Pi Imager](https://www.raspberrypi.com/software/).
Pick **Raspberry Pi OS Lite (64-bit)**, then click the gear icon / "Edit
Settings" (OS customisation) before writing and set:

- **Hostname**: e.g. `pi-radio` (device will be reachable at `pi-radio.local`)
- **Username/password**: e.g. `pi` / your password (the deploy scripts assume
  the user is called `pi` - see `APP_USER` in `remote-setup.sh` if you use a
  different name)
- **Enable SSH**: use "Allow public-key authentication only" and paste your
  SSH public key
- **Configure WiFi**: SSID + password + your WiFi country

This is the officially supported way to set these up and avoids needing any
custom WiFi-setup script - it works across Raspberry Pi OS releases without
us having to track whether the OS uses `dhcpcd` or `NetworkManager`.

**To change WiFi later**, either re-run this customisation and reflash, or
SSH in and run `sudo nmtui` (Raspberry Pi OS's NetworkManager text UI) to
add/change a WiFi connection without reflashing.

## 2. First boot

Insert the card, power on the Pi, and wait a minute or two for it to boot and
join your WiFi. Confirm you can reach it:

```bash
ssh pi@pi-radio.local
```

## 3. Deploy the app

From your dev machine, in the project root:

```bash
./deploy/provision.sh pi@pi-radio.local
```

This builds the app locally, copies `dist/`, `package.json` and
`package-lock.json` to the Pi, and on the Pi: upgrades system packages and
installs `curl`, `mpv`, `alsa-utils`, `bluez` and `i2c-tools`, runs `npm ci
--omit=dev`, and installs + enables the `pi-radio` systemd service
(auto-starts on boot, restarts on crash).
It then enables the read-only root overlay (see step 4 below) and reboots -
so every `provision.sh` run, including the first one, always ends with the
filesystem locked down, protecting the SD card from power-loss corruption.

Give it a minute to reboot, then open `http://pi-radio.local:4200/` to
confirm it's running.

This also enables the I2C interface (`raspi-config nonint do_i2c 0`) and sets
`PI_RADIO_USE_HARDWARE=true` in `/etc/default/pi-radio`, which switches the
app from the console-logging mock input/display adapters (used by `npm run
dev`) to the real GPIO buttons/encoder and I2C LCD adapters.

### Custom configuration (`deploy/.env`)

All of the environment variables below can be set in one place on your dev
machine instead of editing `/etc/default/pi-radio` on the Pi by hand:

```bash
cp deploy/.env.example deploy/.env
# edit deploy/.env
./deploy/provision.sh pi@pi-radio.local
```

`deploy/.env` is gitignored (machine-specific); `deploy/.env.example` is the
checked-in template listing every variable with its default. If present,
`provision.sh` copies it to the Pi and `remote-setup.sh` appends it on top of
the three defaults it always computes itself (`PI_RADIO_PRESETS_PATH`,
`PI_RADIO_SETTINGS_PATH`, `PI_RADIO_USE_HARDWARE`) when writing
`/etc/default/pi-radio` - so you only need to set the variables you actually
want to change, and can still override those three if needed. Re-run
`provision.sh` after editing `deploy/.env` to apply changes.

### Hardware configuration

Buttons, the rotary encoder, and the LCD's I2C bus/address are configured via
environment variables (set in `/etc/default/pi-radio` alongside
`PI_RADIO_PRESETS_PATH`/`PI_RADIO_SETTINGS_PATH`, or via `deploy/.env` as
above), each with a default placeholder value:

| Variable                  | Default | Meaning                          |
|---------------------------|---------|-----------------------------------|
| `PI_RADIO_GPIO_POWER_BTN` | `17`    | Power button GPIO (BCM numbering) |
| `PI_RADIO_GPIO_MODE_BTN`  | `27`    | Mode button GPIO                  |
| `PI_RADIO_GPIO_ACTION_BTN`| `22`    | Action button GPIO                |
| `PI_RADIO_GPIO_ENCODER_A` | `23`    | Rotary encoder A (quadrature) GPIO|
| `PI_RADIO_GPIO_ENCODER_B` | `24`    | Rotary encoder B (quadrature) GPIO|
| `PI_RADIO_GPIO_ENCODER_BTN`| `25`   | Rotary encoder push button (mute) GPIO|
| `PI_RADIO_VOLUME_STEP`    | `6`     | Volume change per encoder detent  |
| `PI_RADIO_I2C_BUS`        | `1`     | I2C bus number (`/dev/i2c-1`)     |
| `PI_RADIO_I2C_LCD_ADDRESS`| `0x3e`  | AiP31068L LCD module I2C address  |

Buttons, the encoder's push button, and the encoder's A/B quadrature lines
are all wired momentary/switch-to-GND, active-low, relying on the Pi's
internal pull-up rather than external resistors. `remote-setup.sh`'s
`cmd_deploy` enables these automatically on every deploy, adding a
`gpio=<power>,<mode>,<action>,<encoderA>,<encoderB>,<encoderBtn>=pu` line to
`config.txt` (picking up any `PI_RADIO_GPIO_*` overrides from `deploy/.env`
above) - no manual config.txt editing needed. This is a `config.txt` change,
so it needs a reboot to take effect (same as the audio HAT changes below;
`provision.sh` reboots automatically at the end of a normal deploy).

Before first deploying with real hardware, wire the LCD and confirm its I2C address with:

```bash
ssh pi@pi-radio.local
i2cdetect -y 1
```

The display is a Waveshare LCD1602 I2C Module (AiP31068L native-I2C
controller, not a PCF8574 GPIO-expander backpack), default address `0x3e`.
If yours differs, set `PI_RADIO_I2C_LCD_ADDRESS` in `/etc/default/pi-radio`
and restart the service (`sudo systemctl restart pi-radio`).

> Real-hardware behavior (button feel/debounce tuning, encoder direction,
> LCD contrast/address) has not been verified against physical hardware -
> confirm all of this after deploying to an actual Pi with the parts wired
> up.

### Logging

By default, logs only go to the console (captured by systemd/journald -
`journalctl -u pi-radio`). To additionally mirror log output to a file, set
in `/etc/default/pi-radio`:

| Variable                          | Default              | Meaning                                       |
|------------------------------------|----------------------|------------------------------------------------|
| `PI_RADIO_LOG_TO_FILE`             | `false`              | Set to `true` to enable file logging           |
| `PI_RADIO_LOG_FILE_PATH`           | `logs/pi-radio.log`  | Path of the log file (appended to)             |
| `PI_RADIO_LOG_MAX_FILE_SIZE_BYTES` | `5242880` (5MB)      | Size at which the log file is rotated          |
| `PI_RADIO_LOG_MAX_FILES`           | `3`                  | Rotated backups kept (`<path>.1` .. `<path>.N`)|

The log file's parent directory is created automatically if missing. Once
the active file reaches `PI_RADIO_LOG_MAX_FILE_SIZE_BYTES`, it's rotated to
`<path>.1` (bumping older backups up to `.2`, `.3`, ...) and a fresh file is
started, so disk usage stays bounded (at most roughly
`maxFileSizeBytes * (maxFiles + 1)`) instead of growing forever. If the
read-only overlay (see above) is enabled, point `PI_RADIO_LOG_FILE_PATH` at
the same persistent app-data mount used for `PI_RADIO_PRESETS_PATH`
(`/var/lib/pi-radio/...`), otherwise writes will fail once the overlay is
active.

### Bluetooth

No extra setup is needed beyond the `bluez` package `provision.sh` already
installs - `remote-setup.sh` also runs `rfkill unblock bluetooth` on every
deploy, since some Pi OS images ship with the onboard Bluetooth radio
soft-blocked, which otherwise makes `bluetoothctl power on` (and so
switching the app into `bluetooth` mode) fail with `bluetoothd` logging
"Failed to set mode: Failed (0x03)". Live pairing/connection status and
AVRCP track metadata work by talking to `bluetoothd` over the system D-Bus
(`org.bluez`), which any user
(including the `pi` service account) can read from under BlueZ's default
D-Bus policy. This has only been developed against the BlueZ D-Bus API
documentation (`https://github.com/bluez/bluez/tree/master/doc`), not a real
Bluetooth adapter - confirm pairing, A2DP audio routing, and the "Paired"/
track-title display after deploying to a Pi with a Bluetooth adapter and an
actual phone/device to pair.

The name advertised to pairing devices defaults to the Pi's hostname. To set
a custom name, set `PI_RADIO_BLUETOOTH_NAME` in `deploy/.env` (see above) -
`remote-setup.sh` applies it once via `bluetoothctl system-alias` during
deploy (this is persisted by `bluetoothd` itself, not the app, so it isn't
re-applied on every app start - re-run `./deploy/provision.sh` after
changing it).

### Audio HAT (e.g. RaspiAudio HiFiBerry DAC)

By default, Raspberry Pi OS plays audio through the onboard headphone jack
(or HDMI), even if a DAC HAT's `dtoverlay` is already active via EEPROM
auto-ID or an existing `config.txt` line - `aplay -l` will show the HAT as a
card, but it won't be ALSA's default device, so the app's audio (spawned
with no `--audio-device` flag) won't reach it. To make a HAT the default,
set in `deploy/.env`:

```bash
PI_RADIO_AUDIO_HAT=hifiberry-dac
```

(the value is the HAT's `dtoverlay` name - `hifiberry-dac` for the RaspiAudio
HiFiBerry DAC HAT this app was developed against; check your HAT's docs if
it's a different one). When set, `remote-setup.sh` idempotently:

- Ensures `dtoverlay=<value>` is present in `config.txt`.
- Flips `dtparam=audio=on` to `dtparam=audio=off` (disabling onboard analog
  audio).
- Adds `hdmi_ignore_edid_audio=1` (suppressing HDMI audio specifically,
  without disabling HDMI video, since that's still useful for debugging).
- Installs `deploy/asound.conf` as `/etc/asound.conf`, wrapping the HAT in
  ALSA's `softvol` plugin under a mixer control named `Master`. This is
  needed because DACs like the HiFiBerry have no hardware volume control
  (`amixer -c sndrpihifiberry scontrols` returns nothing) but
  `AudioAdapter.ts` always runs `amixer set Master <vol>%` - `softvol` gives
  it a `Master` control to act on, and because it sits at the ALSA default
  level (not inside mpv), the same control also governs Bluetooth (A2DP)
  output volume through the one rotary encoder.

Leave `PI_RADIO_AUDIO_HAT` unset if you have no audio HAT - onboard audio is
left untouched by default.

> `softvol`'s `Master` control doesn't actually exist until something opens
> the PCM at least once (ALSA creates it lazily on first use) - so if
> nothing has played yet (e.g. no preset URL configured), `amixer set
> Master` fails with "Unable to find simple control". `pi-radio.service`'s
> `ExecStartPre` plays one second of silence through the default device on
> every boot specifically to prime this control before the app's first
> `setVolume()` call, so this shouldn't surface in practice - but it's why
> that line is there if you're wondering.

`config.txt` changes only take effect after a reboot. `./deploy/provision.sh`
already reboots automatically at the end of every run (see "The read-only
root filesystem" below), so a normal deploy picks this up with no extra
step. If you instead ran `remote-setup.sh deploy` directly on the Pi, reboot
it yourself (`sudo reboot`) afterwards.

Verify after reboot:

```bash
cat /proc/asound/cards   # the HAT should be the only/first card
amixer scontrols         # should list 'Master'
speaker-test -c2 -t wav -l1   # no -D flag needed - should play through the HAT
```

## 4. The read-only root filesystem

`./deploy/provision.sh` always ends by enabling Raspberry Pi OS's built-in
overlay filesystem and rebooting (root becomes a RAM-backed overlay; the
underlying filesystem is never written to again, so a power cut can't
corrupt it) - this happens automatically on every run, including the first
one, so you never end up with an unprotected SD card. You don't need to run
this step by hand; it's documented here so you understand what
`provision.sh` is doing and why a plain `ssh`+edit on the Pi won't persist
(see "Updating the app later" below).

Preset data (the 5 station URLs) is stored at `/var/lib/pi-radio/presets.json`
(`PI_RADIO_PRESETS_PATH`) - so presets you edit via the web UI keep
persisting across reboots, while everything else (the OS, the app code)
resets to this known-good state on every boot.

`/var/lib/pi-radio` isn't on the root filesystem itself (which the overlay
discards every reboot); it's a small ext4 filesystem loop-mounted from a
single image file stored on the boot partition
(`/boot/firmware/pi-radio-data.img`), set up by `remote-setup.sh`'s
`setup_app_data_partition`. The boot partition is separate FAT32 storage
that stays writable even with the overlay active, but FAT has no real
per-file Unix permissions - a mount-wide mask that let the unprivileged `pi`
user write there would also let it write to `config.txt`/`cmdline.txt`/the
kernel image, turning a compromised app process into persistent, pre-boot
code execution. Loop-mounting a real ext4 filesystem from a file on that
partition avoids that: only root (via the loop mount, at deploy time) ever
touches the FAT partition directly, while the app gets a normal pi-owned,
`0700` directory with no access to anything else on it.

The last mode, volume, and preset are persisted the same way
(`/var/lib/pi-radio/settings.json`, `PI_RADIO_SETTINGS_PATH`), written
whenever the radio is put into idle (powered off) - so the radio comes back
up in the same state you left it in, instead of resetting to the defaults
on every reboot.

> The exact `raspi-config nonint do_overlayfs` flag can vary across OS
> releases. If `enable-readonly` reports failure, open `sudo raspi-config` on
> the Pi and enable it manually under **Advanced Options > Overlay FS**.

## Updating the app later

Once the overlay is active, the root filesystem (including `/opt/pi-radio`)
only "writes" into RAM - any redeploy would be silently lost on the next
reboot. `./deploy/provision.sh` handles the whole round-trip automatically
every time you run it:

1. Checks the target over SSH; if the overlay is active, disables it and
   reboots the Pi, waiting for it to come back online.
2. Builds and deploys the app as normal.
3. Enables the overlay again and reboots once more, so the Pi always ends
   up locked down with the update applied.

So updating code or `deploy/.env` is always just:

```bash
./deploy/provision.sh pi@pi-radio.local
```

`remote-setup.sh deploy` still refuses to run while the overlay is active
(as a safety net, in case the automatic disable/reboot step above was
skipped or failed), so you can't accidentally deploy into storage that
disappears on reboot.
