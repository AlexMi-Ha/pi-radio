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
node src/index.js
```
- Keyboard input simulates buttons/encoders.
- Console output simulates LEDs/audio.

## Raspberry Pi Deployment
- Replace mock adapters with GPIO adapters:
```bash
const GpioInputAdapter = require('./adapters/input/GpioInputAdapter');
const MpvAudioAdapter = require('./adapters/audio/MpvAudioAdapter');
```
- Configure GPIO pins in src/config/gpioConfig.js.


# Usage
## Hardware
- Volume: Rotate encoder
- Mode: Press mode buttons
- Favorites: Press favorite buttons
- Power/Idle: Toggle idle state with designated button
- LEDs reflect current mode, favorites, and network status

## REST API Example
tbd

# Testing
- Core logic is fully testable without hardware
- Mock adapters allow unit testing the state machine
- Example:
```bash
npm test
```

# Notes
- Idle state stops audio but keeps API and Web UI accessible.
- Core state is always authoritative; hardware and API always reflect the same state.
- Designed for kitchen use with external speakers and amplifier.