#!/usr/bin/env bash
set -e

if [ ! -d "/opt/pi-radio" ]; then
    echo "ERROR: /opt/pi-radio does not exist."
    echo "It is recommended that this script runs inside the prebuilt Pi image where the app directory is already provisioned."
    exit 1
fi

echo "== Installing dependencies =="
apt-get update
apt-get install -y \
    curl \
    alsa-utils \
    mpv


echo "== Installing Node.js =="
curl -fsSL https://deb.nodesource.com/setup_24.x | bash -
apt-get install -y nodejs npm

echo "== Installing app =="
cd /opt/pi-radio
npm ci --production

echo "== Installing systemd services =="
cp files/pi-radio.service /etc/systemd/system/

systemctl enable pi-radio

echo "== Done =="