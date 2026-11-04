# Guida Configurazione Nodi Meshtastic – MeshBoatGuard

Questa guida descrive passo-passo la procedura completa per configurare da zero entrambi i nodi hardware del sistema **MeshBoatGuard**:
1. **Nodo di Terra (Gateway Wi-Fi)**: collegato al Wi-Fi locale, fa da ponte tra la radio LoRa e Mosquitto/Node-RED via MQTT.
2. **Nodo Barca (Bridge Seriale)**: collegato tramite UART seriale all'ESP32 che gestisce i sensori antifurto.

---

## PARTE 1: Configurazione Canale Primario `meshboat` (Su ENTRAMBI i Nodi)

Entrambi i nodi devono comunicare sullo stesso canale radio LoRa privato (Indice `0` - Primary Channel).

### Passaggi:
1. Connettiti al nodo (tramite app Meshtastic via Bluetooth o interfaccia Web/USB).
2. Vai su **Radio Configuration** $\rightarrow$ **Channels** $\rightarrow$ Seleziona il **Canale 0 (Primary)**.
3. Imposta i seguenti parametri:
   - **Channel Name**: `meshboat`
   - **PSK / Password (Pre-Shared Key)**: imposta una chiave/password personalizzata (o condividila tramite QR code dal primo al secondo nodo).
   - **Uplink Enabled**: `true` (abilitato)
   - **Downlink Enabled**: `true` (abilitato)
   - **Position Precision / Sharing**: `true` (abilitato)
4. Assicurati che le impostazioni LoRa di base siano identiche su entrambi:
   - **Region**: `EU_868`
   - **Modem Preset**: `MediumFast`

---

## PARTE 2: Configurazione Nodo di Terra (Gateway Wi-Fi)

Questo nodo riceve i pacchetti LoRa e li invia a Mosquitto via Wi-Fi; inoltra inoltre i comandi ricevuti da Telegram/Node-RED verso la barca.

### 1. Abilitare la Rete Wi-Fi
Nel menu **Network Config**:
- **Wi-Fi**: Abilitato (`true`)
- **SSID**: Inserisci il nome della rete Wi-Fi / Hotspot (la stessa a cui è collegato il PC con Docker).
- **Password**: Inserisci la password della rete Wi-Fi.
- Salva e applica.

### 2. Recuperare gli Indirizzi IP (PC e Nodo)
- **IP del PC (Server Mosquitto)**:  
  Sul Mac/PC apri il terminale per scoprire il tuo IP locale:
  ```bash
  ipconfig getifaddr en0   # o l'interfaccia Wi-Fi attiva
  ```
  *(Es. `192.168.1.50` oppure `10.119.234.225`)*
- **IP del Nodo Meshtastic**:  
  Dall'interfaccia del nodo (o dalla lista client del router/hotspot), annota l'indirizzo IP assegnato al nodo Meshtastic.

### 3. Riconnessione dell'App via Rete (Wi-Fi)
> **Attenzione:** Sulle schede ESP32 radio, l'attivazione del Wi-Fi spesso disabilita o rende instabile il Bluetooth per limitazioni dell'antenna/radio condivisa.
- Nell'app Meshtastic, aggiungi una nuova connessione scegliendo **Network / Wi-Fi** anziché Bluetooth.
- Inserisci l'indirizzo IP del nodo appena ottenuto per gestirlo direttamente via LAN.

### 4. Creare il Canale Secondario `mqtt` (Tecnico per Downlink)
Il firmware Meshtastic accetta comandi JSON downlink via MQTT **esclusivamente** se esiste un canale secondario dedicato chiamato `mqtt`.
- Vai in **Channels** e aggiungi un nuovo canale (es. Canale 1 o successivo).
- **Channel Name**: `mqtt`
- **PSK / Password**: Lasciare **vuota** (nessuna crittografia).
- **Uplink Enabled**: `true`
- **Downlink Enabled**: `true`
- **Position / Posizione**: `false` (disabilitata, non serve sul canale tecnico).

### 5. Configurare il Modulo MQTT
Nel menu **Module Config** $\rightarrow$ **MQTT**:
- **Enabled**: `true`
- **Server Address**: `<IP_DEL_PC>:1884` *(porta 1884 esposta da Mosquitto per la LAN)*
- **Username**: `meshboat`
- **Password**: `meshboat`
- **Encryption Enabled**: `false` *(obbligatorio: deve viaggiare in chiaro per permettere l'output in JSON)*
- **JSON Enabled**: `true`
- **Uplink Enabled**: `true`
- **Downlink Enabled**: `true`
- **OK to MQTT**: `true` *(consente al nodo di inoltrare i pacchetti a MQTT)*
- **Ignore MQTT**: `false` *(il nodo NON deve ignorare il traffico proveniente da MQTT)*
- **Proxy to Client**: `false` *(disabilitato: il nodo usa il proprio Wi-Fi in autonomia)*

### 6. Allineamento con il file `.env` di Node-RED
1. Recupera l'esadecimale del nodo gateway (visibile su *My Node Info*, es. `!1ba174e0`).
2. Verifica che nel file `.env` alla radice del progetto sia configurato:
   ```env
   MESHTASTIC_MQTT_DOWNLINK_TOPIC=msh/EU_868/2/json/mqtt/!<hex_id_del_tuo_gateway>
   ```
3. Se modifichi il file `.env`, riavvia Node-RED:
   ```bash
   docker compose restart nodered
   ```

---

## PARTE 3: Configurazione Nodo Barca (Bridge Seriale per ESP32)

Questo nodo (es. Seeed Studio XIAO ESP32-S3) non usa il Wi-Fi: dialoga direttamente con la scheda sensori ESP32 via interfaccia seriale UART.

### 1. Verificare il Canale Primario
- Canale 0 denominato `meshboat`, con la stessa chiave PSK del nodo di terra.
- Uplink, Downlink e Posizione abilitati.

### 2. Configurare il Modulo Seriale (Serial Module)
Nel menu **Module Config** $\rightarrow$ **Serial**:
- **Enabled**: `true`
- **Mode**: `TEXTMSG` *(legge i JSON compatti inviati dall'ESP32 e li trasmette via LoRa; recapita i comandi LoRa sulla seriale)*
- **Baud Rate**: `115200` (`BAUD_115200`)
- **Echo**: `false`
- **RX Pin**: `44` *(D7 / RX sulla XIAO ESP32-S3)*
- **TX Pin**: `43` *(D6 / TX sulla XIAO ESP32-S3)*

*(In alternativa, configurabile da terminale USB tramite CLI:)*
```bash
meshtastic --set serial.enabled true \
           --set serial.mode TEXTMSG \
           --set serial.baud BAUD_115200 \
           --set serial.rxd 44 \
           --set serial.txd 43 \
           --set serial.echo false \
           --reboot
```

### 3. Collegamenti Hardware con l'ESP32
- **XIAO TX (D6 / GPIO 43)** $\longrightarrow$ **ESP32 RX2 (GPIO 32)** *(Pin RTC per risveglio da Light Sleep via EXT0)*
- **XIAO RX (D7 / GPIO 44)** $\longleftarrow$ **ESP32 TX2 (GPIO 33)**
- **GND** $\longleftrightarrow$ **GND** *(Massa in comune obbligatoria)*

---

## Riepilogo di Verifica Flusso

1. **Uplink (Barca $\rightarrow$ Server)**:  
   Sensore scatta $\rightarrow$ ESP32 invia JSON su UART $\rightarrow$ Nodo Barca LoRa trasmette su `meshboat` $\rightarrow$ Gateway Terra riceve $\rightarrow$ inoltra a Mosquitto:1884 $\rightarrow$ Node-RED riceve e notifica su Telegram.
2. **Downlink (Telegram $\rightarrow$ Barca)**:  
   Comando `/arm` su Telegram $\rightarrow$ Node-RED pubblica su topic `.../mqtt/!<hex_id>` $\rightarrow$ Gateway riceve su canale `mqtt` $\rightarrow$ trasmette via radio su canale `meshboat` $\rightarrow$ Nodo Barca riceve $\rightarrow$ sputa su UART $\rightarrow$ ESP32 si sveglia su GPIO 32 e si arma.

