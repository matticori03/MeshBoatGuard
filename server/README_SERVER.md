# Ground Station & Server Stack – MeshBoatGuard

This module manages the ground infrastructure of the **MeshBoatGuard** system, as described in the project proposal.

The ground station intercepts data sent via LoRa radio by the **Meshtastic Boat Node (Board 1)**. It processes alerts via **Node-RED**, sends push notifications and receives commands via **Telegram**, logs all events into **InfluxDB**, and provides visual monitoring via **Grafana**.

---

## Server Stack Architecture

```
 ┌───────────────────────────────────┐
 │ MESHTASTIC GROUND NODE (GATEWAY)  │  (MQTT firmware module: uplink+downlink)
 └─────────────────┬─────────────────┘
                   │ MQTT over LAN (port 1884, authenticated)
                   ▼
 ┌───────────────────────────────────┐
 │      MOSQUITTO (self-hosted)      │
 └─────────────────┬─────────────────┘
                   │ Internal Docker MQTT (port 1883, container-to-container only)
                   ▼
 ┌───────────────────────────────────┐       ┌───────────────────────────────┐
 │             NODE-RED              │ <---> │  TELEGRAM CLOUD API BOT       │
 │ - JSON Ingestion & Routing        │       │  - Instant Push Notifications │
 │ - Telegram Commands Handling      │       │  - Commands: /arm /disarm /stat│
 └─────────────────┬─────────────────┘       └───────────────────────────────┘
                   │ (HTTP Line Protocol)
                   ▼
 ┌───────────────────────────────────┐
 │            INFLUXDB v2            │ (Time-Series Database & Logs)
 └─────────────────┬─────────────────┘
                   │ (Flux Queries)
                   ▼
 ┌───────────────────────────────────┐
 │              GRAFANA              │ (Monitoring & Alarms Dashboard)
 └───────────────────────────────────┘
```

The Meshtastic gateway is no longer connected via USB to the Node-RED PC: it communicates via MQTT over the LAN. The Mosquitto broker has two separate listeners (see [server/mosquitto/config/mosquitto.conf](mosquitto/config/mosquitto.conf)):
- **1883** — internal Docker network only, anonymous, used by Node-RED.
- **1884** — published on host/LAN, authenticated, used by the physical gateway.

---

## Quick Start with Docker Compose

All server stack services are containerized via Docker and can be managed with a single command.

### 1. Prerequisites
- [Docker](https://www.docker.com/) and Docker Compose installed on the ground server/PC.

### 2. Start Services
From the project root, run:

```bash
docker compose up -d
```

### 3. Default Credentials and Ports

| Service | Port | Dashboard URL | Default Credentials |
| :--- | :--- | :--- | :--- |
| **Node-RED** | `1880` | `http://localhost:1880` | None (Open Interface) |
| **InfluxDB v2** | `8086` | `http://localhost:8086` | User: `admin` \| Pass: `meshboatguard123` |
| **Grafana** | `3000` | `http://localhost:3000` | User: `admin` \| Pass: `admin` |
| **Mosquitto MQTT** | `1884` | — (no UI, MQTT protocol only) | See next section |

---

## MQTT Configuration (Mosquitto self-hosted)

### 1. Generate the password for the Meshtastic gateway

Listener `1884` (exposed on LAN) requires authentication. Generate the `passwd` file once:

```bash
mkdir -p server/mosquitto/config server/mosquitto/data server/mosquitto/log
docker run --rm -v "$(pwd)/server/mosquitto/config:/mosquitto/config" \
  eclipse-mosquitto:2 mosquitto_passwd -c -b /mosquitto/config/passwd meshboatguard "<choose-a-password>"
```

The `passwd` file is ignored in version control (see `.gitignore`): it must be regenerated on any machine hosting the stack.

### 2. Configure the physical Meshtastic gateway node

On the ground Meshtastic node (via Meshtastic app or CLI), go to **Module Config → MQTT**:
- **Server**: IP address of the machine running Docker, port `1884` (e.g., `192.168.1.50:1884`).
- **Username / Password**: The ones generated in step 1.
- **Encryption enabled**: Yes (use TLS only if the broker exposes it; here it's a private LAN, so it's optional).
- **JSON enabled**: Yes (required to send/receive JSON instead of raw protobuf).
- **Uplink enabled** and **Downlink enabled**: Both Yes.

### 3. Set up the downlink topic

Telegram commands (`/arm /disarm /status`) are sent on the following topic:
```
msh/<region>/2/json/mqtt/!<hex_id_gateway_node>
```
The Region (e.g., `EU_868`) and the gateway node ID (visible in the Meshtastic app, e.g., `!a1b2c3d4`) depend on your physical setup. Set this in a `.env` file in the project root (ignored in git):

```bash
MESHTASTIC_MQTT_DOWNLINK_TOPIC=msh/EU_868/2/json/mqtt/!a1b2c3d4
```

If this variable is not set, Node-RED logs a warning and drops outgoing commands instead of sending them to a wrong topic.

For a complete log of the setup, used commands, and debugging issues (e.g., the "mqtt" channel required by the firmware, exact JSON envelope format), see [docs/MQTT_MESHTASTIC.md](../docs/MQTT_MESHTASTIC.md).

---

## Telegram Bot Configuration (Node-RED)

1. Create a new bot on Telegram by talking to [@BotFather](https://t.me/BotFather) and get the **Bot Token**.
2. Open **Node-RED** (`http://localhost:1880`), double-click the `MeshBoatGuardBot` node (used by `Telegram Bot Commands` and `Send Telegram`) and paste the Token in the dedicated field. Click **Deploy**.
   - The token is saved in Node-RED's encrypted credential store (`server/nodered/data/flows_cred.json`, ignored in git) — it never ends up in `flows.json` or anywhere in the repo.
3. Send any message to your bot from Telegram, then retrieve your **Chat ID** (needed for push alarm notifications, which are not replies to commands, so a fixed recipient is needed):
   ```bash
   curl "https://api.telegram.org/bot<YOUR_TOKEN>/getUpdates"
   ```
   The value is in `result[0].message.chat.id`.
4. Set it in `.env` (ignored in git):
   ```bash
   TELEGRAM_DEFAULT_CHAT_ID=<your-chat-id>
   ```
5. Recreate the Node-RED container to load the new environment variable:
   ```bash
   docker compose up -d nodered
   ```

### Available Telegram Commands:
- `/arm` : Sends the JSON command `{"cmd":"ARM","val":1}` over radio to arm the onboard security system.
- `/disarm` : Sends the JSON command `{"cmd":"ARM","val":0}` to disarm it.
- `/status` : Requests the updated state and telemetry (temperature, humidity, battery).

### Troubleshooting: A command produces no response on Telegram
The `node-red-contrib-telegrambot` node keeps a sending queue for each chat. If a message gets stuck (e.g., transient network error), all subsequent messages to the same chat stay queued without visible errors in the logs. Solution: **Deploy** the flows in Node-RED (this resets the queues) and try the command again.

---

## Grafana Dashboard

The InfluxDB datasource and dashboard are **automatically provisioned** on startup (see `server/grafana/provisioning/`) — no manual configuration is needed. Go to `http://localhost:3000` and the "MeshBoatGuard - Ground Station & Boat Security" dashboard is already there, connected to the `telemetry` bucket.

---

## Testing with Simulated Data in Node-RED

Two test nodes (`Inject`) are already included in Node-RED:
- **Simulate BOW ALARM**: Sends an alarm JSON for the `"PRUA"` zone. Check for the Telegram notification with the 🚨 emoji.
- **Simulate TELEMETRY**: Sends periodic temperature, humidity, and battery data to the InfluxDB database.
