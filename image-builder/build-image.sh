#!/usr/bin/env bash
set -e

IMG_URL="https://downloads.raspberrypi.org/raspios_lite_armhf_latest"
IMG_FILE="raspios-lite.img"
WORKDIR="$(pwd)/mnt"
DEPLOY_DIR="$(pwd)/../deploy"

mkdir -p $WORKDIR
mkdir -p $DEPLOY_DIR

if [ ! -f "$IMG_FILE" ]; then
    echo "== Downloading Raspberry Pi OS Lite =="
    wget -O raspios-lite.img.xz "$IMG_URL"
    unxz raspios-lite.img.xz
fi

echo "== Mounting Raspios root partition =="
ROOT_OFFSET=$(parted -sm "$IMG_FILE" unit b print | grep ":ext4:" | cut -d: -f2 | sed 's/B//')
sudo mkdir -p $WORKDIR
sudo mount -o loop,offset=$ROOT_OFFSET "$IMG_FILE" $WORKDIR

echo "== Copying pi-radio files =="
sudo mkdir -p $WORKDIR/opt/pi-radio
sudo cp -r ../dist/* $WORKDIR/opt/pi-radio/
sudo chown -R 1000:1000 $WORKDIR/opt/pi-radio

echo "== Copying services =="
sudo cp first-boot-setup.sh $WORKDIR/opt/pi-radio/
sudo cp first-boot-setup.service $WORKDIR/etc/systemd/system/
sudo chmod +x $WORKDIR/opt/pi-radio/first-boot-setup.sh
sudo chown 1000:1000 $WORKDIR/opt/pi-radio/first-boot-setup.sh

sudo cp -r setup $WORKDIR/opt/pi-radio/setup
sudo chmod +x $WORKDIR/opt/pi-radio/setup/*.sh
sudo chown -R 1000:1000 $WORKDIR/opt/pi-radio/setup

sudo ln -s /etc/systemd/system/first-boot-setup.service \
      $WORKDIR/etc/systemd/system/multi-user.target.wants/first-boot-setup.service

echo "== Cleanup =="
sudo umount $WORKDIR
rmdir $WORKDIR

echo "== Compressing image =="
xz -T0 -v "$IMG_FILE"
mv "$IMG_FILE.xz" "$DEPLOY_DIR/"

echo "== Image build complete! Output: $DEPLOY_DIR/$IMG_FILE.xz =="