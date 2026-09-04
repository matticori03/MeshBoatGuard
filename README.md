# MeshBoatGuard – IoT Boat Security System via Meshtastic

**Authors:** Mattia Coriale (5640317), Gabriele Alessandria (5622102), Federico Rissolio (5241314)  
**Course:** Internet of Things (IoT) 

---

## Project Overview

**MeshBoatGuard** is an IoT security system for boats that uses the **Meshtastic** mesh network protocol to transmit alerts and telemetry without cellular coverage.

The system consists of two main parts:
1. **The Boat Node (ESP32 + Meshtastic TX/RX):** Installed on the boat. It runs on battery, stays in ultra-low power *Light Sleep*, and wakes up instantly via hardware interrupts (sensors or incoming remote commands).
2. **The Ground Station (Docker Stack):** A self-hosted server running Mosquitto (MQTT), Node-RED, InfluxDB, and Grafana to process data, store metrics, and send Telegram alerts.

---

## Hardware Wiring & Pinout

> **Full Mermaid Diagram:** Check **[SCHEMA_COLLEGAMENTI_HARDWARE.md](SCHEMA_COLLEGAMENTI_HARDWARE.md)** for the complete wiring between the **Seeed Studio XIAO ESP32S3** (Meshtastic) and the **ESP32** (Security Board).

| Hardware / Sensor | Function | ESP32 Pin | XIAO ESP32S3 Pin | Notes & Interrupts |
| :--- | :--- | :--- | :--- | :--- |
| **Reed Sensor 1 (Bow)** | Digital Input | **GPIO 4** | - | Wakeup (`EXT1_WAKEUP`) |
| **Reed Sensor 2 (Cabin)** | Digital Input | **GPIO 13** | - | Wakeup (`EXT1_WAKEUP`) |
| **PIR Sensor** | Digital Input | **GPIO 14** | - | Wakeup (`EXT1_WAKEUP`) |
| **Meshtastic TX** | UART2 RX | **GPIO 32** *(RTC)*| **D6 / TX** (GPIO 43) | **Remote Wakeup!** (`EXT0_WAKEUP`) |
| **Meshtastic RX** | UART2 TX | **GPIO 33** *(RTC)*| **D7 / RX** (GPIO 44) | Sends JSON payloads |
| **DHT11 Sensor** | Temp / Humidity | **GPIO 27** | - | Environmental data |
| **Buzzer / LED** | Digital Output | **GPIO 15** | - | Local alarm signal |

> **Crucial Note on RX Pin (GPIO 32):** We use GPIO 32 for UART RX because it is an RTC-capable pin. When a remote command arrives from Meshtastic via LoRa, the UART line drops to LOW (Start bit), instantly waking the ESP32 from sleep to process the message.

---

## Firmware Architecture (ESP32)

The ESP32 runs the `MeshBoatGuard.ino` firmware, designed for maximum power efficiency:
1. It stays in **Light Sleep** (CPU halted, RAM and UART active).
2. It wakes up on **physical sensor triggers** (Reed/PIR) or **remote serial messages** from Meshtastic.
3. Checks system state (ARMED/DISARMED) stored in RTC memory.
4. Reads temperature, humidity, and simulated battery level.
5. Formats and sends a compact JSON payload via UART.
6. Returns to Light Sleep.

---

## Ultra-Compact JSON Payloads (LoRa Optimized)

To save LoRa bandwidth, JSON keys are reduced to a single character. Payloads are kept under 65 bytes.

**Keys:**
- `t`: Message type (`ALM` = Alarm, `TEL` = Telemetry, `ACK` = Command Ack, `CFG` = Config)
- `dev`: Device ID (e.g., `BoatGuard_01`)
- `s`: Alarm state (`ARM` or `DIS`)
- `src`: Trigger source (`PRUA`, `CABINA`, `PIR`, `CMD`, `TIMER`, `BOOT`)
- `tmp`: Temperature (°C)
- `hum`: Humidity (%)
- `bat`: Battery (%)

**Example Outbound (ESP32 → Meshtastic):**
```json
{"t":"ALM","dev":"BoatGuard_01","s":"ARM","src":"PRUA","tmp":24.5,"hum":58,"bat":98}
```

**Example Inbound Commands (Meshtastic → ESP32):**
```json
{"cmd":"ARM","val":1}   // Arm system
{"cmd":"ARM","val":0}   // Disarm system
```

---

## How to Flash the ESP32

1. Open `MeshBoatGuard.ino` in **Arduino IDE** (or PlatformIO).
2. Install the **ESP32** board package and the **DHT sensor library** (by Adafruit).
3. Select **ESP32 Dev Module**.
4. Connect the ESP32 via USB and click **Upload**.

---

## Ground Station Server Stack

The project includes a full Docker backend stack to ingest Meshtastic data via MQTT, store it, and visualize it.

**Architecture:**
- **Mosquitto (MQTT):** Receives data from the local Meshtastic node.
- **Node-RED:** Parses JSON payloads, handles logic, writes to DB, and manages the Telegram Bot (`/arm`, `/disarm`, `/status`).
- **InfluxDB v2:** Time-series database for telemetry and logs.
- **Grafana:** Dashboard for real-time monitoring.

### Quick Start
All services are defined in [`docker-compose.yml`](docker-compose.yml).
To start the server:
```bash
docker compose up -d
```

> **Server Documentation:** For detailed setup instructions, `.env` configuration, and Telegram bot setup, please refer to the **[Server README](server/README_SERVER.md)** and the **[MQTT Migration Docs](docs/MQTT_MESHTASTIC.md)**.
