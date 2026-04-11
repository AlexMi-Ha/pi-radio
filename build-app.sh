#!/usr/bin/env bash
set -e

npm ci
npm run build

mkdir -p dist/setup
cp install.sh dist/setup/