echo "=== Setting up wifi ==="
WIFI_CONFIG="/boot/wifi-config.json"
WPA_CONF="/etc/wpa_supplicant/wpa_supplicant.conf"

if [ ! -f "$WIFI_CONFIG" ]; then
    echo "== No WiFi config found. Please create $WIFI_CONFIG =="
else
    if ! command -v jq >/dev/null 2>&1; then
        apt-get update
        apt-get install -y jq
    fi

    WIFI_SSID=$(jq -r .ssid "$WIFI_CONFIG")
    WIFI_PASSWORD=$(jq -r .password "$WIFI_CONFIG")

    cat <<EOF > "$WPA_CONF"
ctrl_interface=DIR=/var/run/wpa_supplicant GROUP=netdev
update_config=1
country=DE

network={
    ssid="$WIFI_SSID"
    psk="$WIFI_PASSWORD"
}
EOF

    chmod 600 "$WPA_CONF"

    # Remove config file after use
    [ -f "$WIFI_CONFIG" ] && rm "$WIFI_CONFIG"

    systemctl restart dhcpcd || true
fi