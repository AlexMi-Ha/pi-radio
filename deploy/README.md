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
`PI_RADIO_PRESETS_PATH`), each with a default placeholder value:

| Variable                  | Default | Meaning                          |
|---------------------------|---------|-----------------------------------|
| `PI_RADIO_GPIO_POWER_BTN` | `17`    | Power button GPIO (BCM numbering) |
| `PI_RADIO_GPIO_MODE_BTN`  | `27`    | Mode button GPIO                  |
| `PI_RADIO_GPIO_ACTION_BTN`| `22`    | Action button GPIO                |
| `PI_RADIO_GPIO_ENCODER_A` | `23`    | Rotary encoder A (quadrature) GPIO|
| `PI_RADIO_GPIO_ENCODER_B` | `24`    | Rotary encoder B (quadrature) GPIO|
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
