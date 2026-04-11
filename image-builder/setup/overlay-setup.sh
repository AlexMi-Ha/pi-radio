echo "== Setting up writable data dir =="
mkdir -p /mnt/data
mkdir -p /opt/pi-radio/data
chown -R 1000:1000 /mnt/data /opt/pi-radio/data

if ! grep -q "/opt/pi-radio/data" /etc/fstab; then
    echo "/mnt/data /opt/pi-radio/data none bind 0 0" >> /etc/fstab
fi
mount -a

echo "== Switching root filesystem to read-only =="
mount -o remount,ro /