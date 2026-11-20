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
