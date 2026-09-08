# MQTT instead of Serial — Setup, Commands and Troubleshooting

Technical log of migrating the ground stack from a USB serial connection (`/dev/ttyACM0`) to MQTT, using a self-hosted Mosquitto broker, for uplink (telemetry/boat alarms → Node-RED) and downlink (commands `/arm` `/disarm` `/status` → boat).

## Why

The ground Meshtastic gateway no longer needs to be physically connected via USB to the PC running Node-RED: it communicates via MQTT on the same WiFi/hotspot network. Secondary advantage: multiple clients can read the same stream via MQTT without fighting for a single serial port.

## Architecture

```
Meshtastic gateway node (Heltec V4, WiFi)
        │  MQTT on LAN, port 1884, authenticated (listener_allow_anonymous=false)
        ▼
   Mosquitto (self-hosted container)
        │  Internal MQTT on Docker network, port 1883, anonymous (never exposed to host)
        ▼
     Node-RED  →  Telegram / InfluxDB / Grafana
```

Two separate listeners in [server/mosquitto/config/mosquitto.conf](../server/mosquitto/config/mosquitto.conf):
- **1883**: only container-to-container on the Docker Compose network, anonymous (it is never reachable from the outside, so authentication is not needed).
- **1884**: published on the host/LAN, authenticated, used by the physical gateway node.

## Mosquitto Setup

```bash
mkdir -p server/mosquitto/config server/mosquitto/data server/mosquitto/log
docker run --rm -v "$(pwd)/server/mosquitto/config:/mosquitto/config" \
  eclipse-mosquitto:2 mosquitto_passwd -c -b /mosquitto/config/passwd meshboat meshboat
docker compose up -d mosquitto
```

The `passwd` file is not versioned (it must be regenerated on every machine). Test user used in this project: `meshboat` / `meshboat`.

## Gateway Node Setup (Heltec V4, firmware 2.7.22)

### Module Config → MQTT
| Field | Value |
|---|---|
| Enabled | true |
| Server Address | `<pc-lan-ip>:1884` (e.g. `10.119.234.225:1884`) |
| Username / Password | `meshboat` / `meshboat` |
| Encryption enabled | **false** (plain text is needed for JSON output) |
| JSON enabled | true |
| Uplink enabled | true |
| Downlink enabled | true |
| **Proxy to Client Enabled** | **false** — otherwise the node waits for a companion app to act as a BLE proxy instead of connecting via WiFi on its own |

### "meshboat" Channel (the real one used by the project)
Already configured with `uplinkEnabled: true`, `downlinkEnabled: true` — verified via CLI, no action needed.

### "mqtt" Channel (required by the firmware, dedicated to downlink)
The Meshtastic firmware accepts JSON downlinks **only** on a channel literally named `mqtt` with `downlinkEnabled: true` — it's a technical gateway, the real traffic is still redirected to the real channel via the `"channel"` field in the JSON payload. Added via CLI (see below), not via the app (the toggle was not visible in the UI).

## CLI Commands Used (meshtastic Python CLI, via USB)

```bash
# installation (if missing)
pip install --user meshtastic

# inspect node, channels, role
meshtastic --port /dev/cu.usbmodem1401 --info

# add the "mqtt" channel required for downlink
meshtastic --port /dev/cu.usbmodem1401 --ch-add mqtt
# → assigned to index 6

# enable downlink on that channel
meshtastic --port /dev/cu.usbmodem1401 --ch-set downlink_enabled true --ch-index 6

# reboot required so the MQTT module rereads the channel list and subscribes to the new topics
meshtastic --port /dev/cu.usbmodem1401 --reboot
```

## MQTT Commands Used for Debugging (Mosquitto via Docker, no local install)

```bash
# raw listening of all Meshtastic traffic on the broker
docker run --rm --network host eclipse-mosquitto:2 mosquitto_sub \
  -h 127.0.0.1 -p 1884 -u meshboat -P meshboat -t 'msh/#' -v

# manual publishing of a downlink command (bypasses Node-RED, useful to isolate problems)
docker run --rm --network host eclipse-mosquitto:2 mosquitto_pub \
  -h 127.0.0.1 -p 1884 -u meshboat -P meshboat \
  -t "msh/EU_868/2/json/mqtt/!1ba174e0" \
  -m '{"from":463566048,"type":"sendtext","channel":0,"payload":"test invio"}'
```

## Node Serial Monitor (to see firmware logs in real time)

`screen` on Mac is too old for `-Logfile`; used direct `cat` on the port:

```bash
stty -f /dev/cu.usbmodem1401 115200
cat /dev/cu.usbmodem1401
# Ctrl+C to stop
```

## Node-RED: Manual Test Trigger Without Restarting the Stack

Live deploy via Admin API, without container restart (restarts are only needed when **env vars** change, not for flow changes):

```bash
curl -s http://localhost:1880/flows > /tmp/flows.json
# ... edit /tmp/flows.json with script/editor ...
curl -X POST http://localhost:1880/flows \
  -H "Content-Type: application/json" -H "Node-RED-Deployment-Type: full" \
  --data-binary @/tmp/flows.json

# to press an "inject" button via API instead of from the editor:
curl -X POST http://localhost:1880/inject/<inject-node-id>
```

## Problems Encountered (in chronological order) and Solutions

### 1. Wrong LAN IP
`ipconfig getifaddr` on some interfaces returned an address (`192.168.190.x`) which turned out to be a virtual interface (Apple Network Private Interface), not the real WiFi/hotspot. **Solution**: full `ifconfig`, look for the interface (`en0`) with the subnet that matches the one announced by the phone hotspot (`10.119.234.x`).

### 2. Empty Mosquitto Password File
`mosquitto_passwd -c` refuses to overwrite an existing file (even if empty). **Solution**: delete the old file before regenerating it.

### 3. "Proxy to Client Enabled" = true
If active, the node does not open its own MQTT connection but waits for a companion app to act as a proxy via BLE — with a direct connection configured (server/user/pass), this prevents connection. **Solution**: set to `false`.

### 4. No Downlink: Missing "mqtt" Channel
Node log: `JSON downlink received on channel not called 'mqtt' or without downlink enabled`. The "meshboat" channel already had downlink enabled, but the firmware **specifically** requires a channel named `mqtt` (not visible/addable from the app used) with downlink enabled, used only as a technical gateway. **Solution**: added via CLI (`--ch-add mqtt` + `--ch-set downlink_enabled true`), then rebooted the node to force the MQTT module to reload subscriptions.

### 5. "JSON received payload on MQTT but not a valid envelope"
Even with the right channel, the payload was rejected. Verified in the firmware source code (`MQTT.cpp`, `isValidJsonEnvelope()`/`onReceiveJson()` function) that the envelope requires:
- `"from"`: **must exactly match** the decimal node number of the node receiving the downlink — not a placeholder like `0`.
- `"payload"`: for `type: "sendtext"` it must be a **simple string**, not an object `{text: ...}` (that format is only used in the uplink that the node publishes on its own, not in the incoming downlink).

**Solution**: the Node-RED function "Wrap Command in Meshtastic JSON Downlink" ([server/nodered/data/flows.json](../server/nodered/data/flows.json)) automatically gets `from` by converting the hex ID already present in the topic to decimal (`parseInt(hexId, 16)`), avoiding the need to configure it separately.

### Final Result
Node log after the fix, "test invio" message successfully transmitted via radio:
```
INFO | [mqtt] JSON payload test invio, length 10
INFO | [mqtt] serialized json message: {"channel":0,"from":463566048,...,"payload":{"text":"test invio"},...}
DEBUG | [RadioIf] Started Tx (... Ch=0x8e encrypted len=32 ...)
DEBUG | [RadioIf] Completed sending (...)
```

## References

- [MQTT Module Configuration](https://meshtastic.org/docs/configuration/module/mqtt/)
- [MQTT Integrations Overview](https://meshtastic.org/docs/software/integrations/mqtt/)
- [Node-RED integration guide](https://meshtastic.org/docs/software/integrations/mqtt/nodered/)
- [GitHub: Publishing MQTT JSON Does Nothing (discussion #3988)](https://github.com/meshtastic/firmware/discussions/3988)
- [GitHub: MQTT JSON downlink fixes (PR #3183)](https://github.com/meshtastic/firmware/pull/3183)
