# Smart Kitchen Radio

A modular Node.js-based audio player for your kitchen, supporting Internet radio and Bluetooth. Designed with **Ports & Adapters (Hexagonal) architecture**, allowing easy development, testing, and hardware integration.

---

## Features

- **Audio Modes**
  - Internet Radio
  - Bluetooth Audio
- **Controls**
  - Rotary encoder for volume
  - Buttons for power, mode toggle, and preset/pairing
  - LEDs for mode and preset/pairing status, plus a 16x2 LCD for station/track info
- **Web UI & API**
  - Configure favorite stations and network
  - REST API to control device programmatically
- **Stateless Hardware UI**
  - Core state resides in software
  - Hardware inputs emit events, outputs reflect state
- **Extensible Design**
  - Ports & adapters allow testing without hardware


---

# Getting Started

## Installation
```bash
git clone <repo-url>
cd radio-project
npm install
```

## Development (Ubuntu / PC)
- Use mock adapters to simulate input and audio:
```bash
npm run dev
```
- Keyboard input simulates buttons/encoders.
- Console output simulates LEDs/audio.

## Raspberry Pi Deployment
See [`deploy/README.md`](deploy/README.md): flash a stock Raspberry Pi OS
image with Raspberry Pi Imager (hostname/SSH/WiFi configured at flash time),
then run `./deploy/provision.sh pi@<hostname>.local` to build and deploy the
app. The guide also covers locking the filesystem to read-only to protect
against power-loss corruption, and how to redeploy updates afterward.


# Usage
## Hardware
- Volume: Rotate encoder
- Mode: Press the mode-toggle button (cycles Internet Radio / Bluetooth)
- Action button: cycles presets in Internet Radio mode, triggers Bluetooth pairing in Bluetooth mode
- Power/Idle: Toggle idle state with designated button
- LEDs reflect current mode and preset/pairing status; the LCD shows station/track info

## REST API Example
The Kitchen Radio exposes a REST API for controlling power, mode, volume, and presets. All endpoints are JSON-based. The API is hosted on the port specified when creating the ApiAdapter (e.g., http://localhost:4200).

<details>
<summary>REST API Endpoints</summary>

### Get Current State

- Endpoint: GET /api/state
- Response:
```json
{
  "power": "power",
  "mode": "internet_radio",
  "volume": 70,
  "preset": 1,
  "pairing": false,
  "connected": false,
  "nowPlaying": { "title": "Artist - Song" }
}
```

### Set Power

- Endpoint: POST /api/power
- Body:
```json
{
  "power": "idle"
}
```
- Response: Returns the updated state.

### Set Mode

- Endpoint: POST /api/mode
- Body:
```json
{
  "mode": "bluetooth"
}
```
- Response: Returns the updated state.


### Set Volume

- Endpoint: POST /api/volume
- Body:
```json
{
  "volume": 50
}
```
- Response: Returns the updated state.


### Set Mute

- Endpoint: POST /api/mute
- Body:
```json
{
  "muted": true
}
```
- Response: Returns the updated state.


### Set Current Preset

- Endpoint: POST /api/preset
- Body:
```json
{
  "preset": 2
}
```
- Response: Returns the updated state.


### Get All Presets

- Endpoint: GET /api/preset
- Response:
```json
{
  "internet_radio": [
    { "name": "Station One", "value": "http://station1.com" },
    { "name": "", "value": "http://station2.com" },
    { "name": "", "value": "" },
    { "name": "", "value": "" },
    { "name": "", "value": "" }
  ]
}
```

### Get Presets By Mode

- Endpoint: GET /api/preset/:mode
- :mode can only be "internet_radio" (the only mode with presets)
- Response:
```json
[
  { "name": "Station One", "value": "http://station1.com" },
  { "name": "", "value": "http://station2.com" },
  { "name": "", "value": "" },
  { "name": "", "value": "" },
  { "name": "", "value": "" }
]
```

### Get Preset By Index

- Endpoint: GET /api/preset/:mode/:presetId
- Response:
```json
{ "name": "Station One", "value": "http://station1.com" }
```

### Set Preset Name and/or Value

- Endpoint: POST /api/preset/:mode/:presetId
- Body (either or both fields; omitted fields are left unchanged):
```json
{
  "name": "My Station",
  "value": "http://newstation.com"
}
```
- Response: the updated preset, e.g. `{ "name": "My Station", "value": "http://newstation.com" }`

</details>
<br><br>
This API allows full remote control of the radio:

- Change power idle/power
- Switch modes (internet radio / Bluetooth)
- Adjust volume
- Program and retrieve favourite stations

## UI

The program also exposes an UI under `localhost:4200/`. Here you have full control over the radio.

# Testing
- Core logic is fully testable without hardware
- Mock adapters allow unit testing the state machine
- Example:
```bash
npm run test
```

# Notes
- Idle state stops audio but keeps API and Web UI accessible.
- Core state is always authoritative; hardware and API always reflect the same state.
- Designed for kitchen use with external speakers and amplifier.