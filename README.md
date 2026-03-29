# Smart Kitchen Radio

A modular Node.js-based audio player for your kitchen, supporting Internet radio, Bluetooth, FM, and Spotify. Designed with **Ports & Adapters (Hexagonal) architecture**, allowing easy development, testing, and hardware integration.

---

## Features

- **Audio Modes**
  - Internet Radio
  - Bluetooth Audio
  - FM Radio
  - Spotify
- **Controls**
  - Rotary encoder for volume
  - Buttons for mode selection and favorite stations
  - Optional RGB LED for network / system status
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
tbd


# Usage
## Hardware
- Volume: Rotate encoder
- Mode: Press mode buttons
- Favorites: Press favorite buttons
- Power/Idle: Toggle idle state with designated button
- LEDs reflect current mode, favorites, and network status

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
  "preset": 1
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
  "internet_radio": ["http://station1.com", "http://station2.com", "", "", ""],
  "fm": ["101.1", "102.3", "", "", ""]
}
```

### Get Presets By Mode

- Endpoint: GET /api/preset/:mode
- :mode can be "internet_radio" or "fm"
- Response:
```json
["http://station1.com", "http://station2.com", "", "", ""]
```

### Get Preset By Index

- Endpoint: GET /api/preset/:mode/:presetId
- Response:
```json
"http://station1.com"
```

### Set Preset Value

- Endpoint: POST /api/preset/:mode/:presetId
- Body:
```json
{
  "value": "http://newstation.com"
}
```

</details>
<br><br>
This API allows full remote control of the radio:

- Change power idle/power
- Switch modes (internet radio / FM / Bluetooth / Spotify)
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