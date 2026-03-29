#!/bin/bash

set -e

echo "=== Kitchen Radio Installer ==="

# Check Node.js
if ! command -v node &> /dev/null
then
    echo "Node.js not found. Installing..."
    curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
    sudo apt update
    sudo apt install -y nodejs npm
else
    echo "Node.js is installed: $(node -v)"
fi

# Check npm
if ! command -v npm &> /dev/null
then
    echo "npm not found. Installing..."
    sudo apt update
    sudo apt install -y npm
else
    echo "npm is installed: $(npm -v)"
fi

# Check mpv
if ! command -v mpv &> /dev/null
then
    echo "mpv not found. Installing..."
    sudo apt update
    sudo apt install -y mpv
else
    echo "mpv is installed: $(mpv --version | head -n 1)"
fi

# Install Node dependencies
echo "Installing Node.js dependencies..."
npm install

# Build the project
echo "Building the project..."
npm run build

echo "=== Installation Complete! ==="