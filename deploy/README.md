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
`package-lock.json` to the Pi, and on the Pi: installs Node.js, `mpv`,
`alsa-utils` and `bluez`, runs `npm ci --omit=dev`, and installs + enables
the `pi-radio` systemd service (auto-starts on boot, restarts on crash).

Open `http://pi-radio.local:4200/` to confirm it's running.

This also enables the I2C interface (`raspi-config nonint do_i2c 0`) and sets
`PI_RADIO_USE_HARDWARE=true` in `/etc/default/pi-radio`, which switches the
app from the console-logging mock input/display adapters (used by `npm run
dev`) to the real GPIO buttons/encoder and I2C LCD adapters.

### Hardware configuration

Buttons, the rotary encoder, and the LCD's I2C bus/address are configured via
environment variables (set in `/etc/default/pi-radio` alongside
`PI_RADIO_PRESETS_PATH`/`PI_RADIO_SETTINGS_PATH`), each with a default
placeholder value:

| Variable                  | Default | Meaning                          |
|---------------------------|---------|-----------------------------------|
| `PI_RADIO_GPIO_POWER_BTN` | `17`    | Power button GPIO (BCM numbering) |
| `PI_RADIO_GPIO_MODE_BTN`  | `27`    | Mode button GPIO                  |
| `PI_RADIO_GPIO_ACTION_BTN`| `22`    | Action button GPIO                |
| `PI_RADIO_GPIO_ENCODER_A` | `23`    | Rotary encoder A (quadrature) GPIO|
| `PI_RADIO_GPIO_ENCODER_B` | `24`    | Rotary encoder B (quadrature) GPIO|
| `PI_RADIO_GPIO_ENCODER_BTN`| `25`   | Rotary encoder push button (mute) GPIO|
| `PI_RADIO_I2C_BUS`        | `1`     | I2C bus number (`/dev/i2c-1`)     |
| `PI_RADIO_I2C_LCD_ADDRESS`| `0x27`  | PCF8574 LCD backpack I2C address  |

Buttons are assumed wired momentary-push-to-GND with the Pi's internal
pull-up enabled (active-low, no external resistors needed). Before first
deploying with real hardware, wire the LCD and confirm its I2C address with:

```bash
ssh pi@pi-radio.local
i2cdetect -y 1
```

`0x27` and `0x3F` are the two common PCF8574 backpack addresses - if yours
differs, set `PI_RADIO_I2C_LCD_ADDRESS` in `/etc/default/pi-radio` and
restart the service (`sudo systemctl restart pi-radio`).

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
the same writable boot partition used for `PI_RADIO_PRESETS_PATH`, otherwise
writes will fail once the overlay is active.

### Bluetooth

No extra setup is needed beyond the `bluez` package `provision.sh` already
installs - live pairing/connection status and AVRCP track metadata work by
talking to `bluetoothd` over the system D-Bus (`org.bluez`), which any user
(including the `pi` service account) can read from under BlueZ's default
D-Bus policy. This has only been developed against the BlueZ D-Bus API
documentation (`https://github.com/bluez/bluez/tree/master/doc`), not a real
Bluetooth adapter - confirm pairing, A2DP audio routing, and the "Paired"/
track-title display after deploying to a Pi with a Bluetooth adapter and an
actual phone/device to pair.

## 4. Lock down the filesystem (read-only root)

Once you're happy with the deployed version, protect the SD card from
corruption on power loss by enabling Raspberry Pi OS's built-in overlay
filesystem (root becomes a RAM-backed overlay; the underlying filesystem is
never written to again, so a power cut can't corrupt it):

```bash
ssh pi@pi-radio.local
sudo /tmp/pi-radio-deploy/remote-setup.sh enable-readonly
sudo reboot
```

Preset data (the 5 station URLs) is stored on the boot partition
(`/boot/firmware/pi-radio/presets.json`), which is separate FAT32 storage
that stays writable even with the overlay active - so presets you edit via
the web UI keep persisting across reboots, while everything else (the OS,
the app code) resets to this known-good state on every boot.

The last mode, volume, and preset are persisted the same way
(`/boot/firmware/pi-radio/settings.json`, `PI_RADIO_SETTINGS_PATH`), written
whenever the radio is put into idle (powered off) - so the radio comes back
up in the same state you left it in, instead of resetting to the defaults
on every reboot.

> The exact `raspi-config nonint do_overlayfs` flag can vary across OS
> releases. If `enable-readonly` reports failure, open `sudo raspi-config` on
> the Pi and enable it manually under **Advanced Options > Overlay FS**.

## Updating the app later

Once the overlay is active, the root filesystem (including `/opt/pi-radio`)
only "writes" into RAM - any redeploy would be silently lost on the next
reboot. So before redeploying:

```bash
ssh pi@pi-radio.local
sudo /tmp/pi-radio-deploy/remote-setup.sh disable-readonly
sudo reboot
```

Then, once it's back up:

```bash
./deploy/provision.sh pi@pi-radio.local
```

`remote-setup.sh deploy` refuses to run while the overlay is active, so you
can't accidentally deploy into storage that disappears on reboot.

Finally, re-enable the overlay (step 4 above) and reboot once more.
