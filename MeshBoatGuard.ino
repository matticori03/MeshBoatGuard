/*
 * ======================================================================================
 * PROJECT: MeshBoatGuard - IoT Boat Security Board (Board 2)
 * AUTHORS: Mattia Coriale, Gabriele Alessandria, Federico Rissolio
 * 
 * OVERVIEW:
 *   ESP32 security board software for boat monitoring.
 *   
 *   KEY FEATURES:
 *   1. LIGHT SLEEP & WAKEUP: Low power mode. Wakes up on sensor interrupts (reed/PIR) 
 *      or UART RX messages from Meshtastic.
 *   2. RTC MEMORY: Saves system state, node name, and battery level across sleep cycles.
 *   3. COMPACT JSON: Sends short JSON payloads (< 65 chars) to optimize LoRa bandwidth.
 *   4. COMMAND HANDLER: Parses incoming Meshtastic commands to arm/disarm and config.
 *   5. SIMULATORS & ACTUATORS: Software battery simulator and Buzzer/LED alarm output.
 * ======================================================================================
 */

#include <Arduino.h>
#include <esp_sleep.h>
#include "DHT.h"

// ======================================================================================
// HARDWARE PIN CONFIG (ESP32)
// ======================================================================================
#define PIN_REED_PORTELLO   4   // Magnetic sensor 1: Bow hatch (RTC GPIO 10)
#define PIN_REED_CABINA     13  // Magnetic sensor 2: Cabin door (RTC GPIO 14)
#define PIN_PULSANTE_PIR    14  // PIR presence sensor (RTC GPIO 16)
#define PIN_DHT             27  // DHT11 Temp/Humidity sensor data pin
#define PIN_BUZZER_LED      15  // Alarm buzzer/LED output

// UART2 Config for Meshtastic Board
// NOTE: Using GPIO 32 for RX because it's an RTC pin that supports wakeup!
#define UART_MESHTASTIC_RX  32  // ESP32 RX2 (RTC GPIO 9) <-- Meshtastic TX
#define UART_MESHTASTIC_TX  33  // ESP32 TX2 (RTC GPIO 8) --> Meshtastic RX

// DHT11 Sensor Setup
#define DHTTYPE DHT11
DHT dht(PIN_DHT, DHTTYPE);

// Wakeup pin mask (Reed and PIR sensors - Active HIGH)
#define BUTTON_PIN_BITMASK  ((1ULL << PIN_REED_PORTELLO) | (1ULL << PIN_REED_CABINA) | (1ULL << PIN_PULSANTE_PIR))

// Wait time before returning to sleep
const unsigned long AWAKE_TIMEOUT_MS = 10000; // 10s to listen for serial commands

// ======================================================================================
// RTC MEMORY VARIABLES (Kept during sleep)
// ======================================================================================
RTC_DATA_ATTR bool systemArmed      = true;            // Alarm state: true = ARMED, false = DISARMED
RTC_DATA_ATTR char deviceName[16]   = "BoatGuard_01";  // Short device name
RTC_DATA_ATTR int  simulatedBattery = 100;             // Simulated battery %

// Data structure for radio payload
struct SensorData {
  float temperature;
  float humidity;
  int batteryPercent;
};

// ======================================================================================
// FUNCTION PROTOTYPES
// ======================================================================================
void checkWakeupReason();
SensorData readSensors();
int simulateSoftwareBattery();
void triggerAlarm(const char* sensorSource);
void sendMeshtasticJson(const char* msgType, const char* sensorSource, const SensorData& data);
void handleIncomingSerial();
void processMeshtasticCommand(String jsonString);
void enterDeepSleep();

// ======================================================================================
// SETUP: Runs on boot and wakeup
// ======================================================================================
void setup() {
  // 1. Init USB Debug Serial
  Serial.begin(115200);

  // 2. Init UART2 for Meshtastic (RX 32, TX 33)
  Serial2.begin(115200, SERIAL_8N1, UART_MESHTASTIC_RX, UART_MESHTASTIC_TX);

  Serial.println(F("\n=================================================="));
  Serial.println(F("    MeshBoatGuard - Security System Started      "));
  Serial.print(F(" Device: ")); Serial.println(deviceName);
  Serial.print(F(" State: ")); Serial.println(systemArmed ? "ARMED" : "DISARMED");
  Serial.println(F("==================================================\n"));

  // 3. Init I/O Pins
  pinMode(PIN_REED_PORTELLO, INPUT_PULLDOWN);
  pinMode(PIN_REED_CABINA, INPUT_PULLDOWN);
  pinMode(PIN_PULSANTE_PIR, INPUT_PULLDOWN);
  pinMode(UART_MESHTASTIC_RX, INPUT_PULLUP); // Pull-up because idle UART is HIGH
  pinMode(PIN_BUZZER_LED, OUTPUT);
  digitalWrite(PIN_BUZZER_LED, LOW);

  // 4. Init DHT11
  dht.begin();

  // 5. Handle Wakeup
  checkWakeupReason();
}

// ======================================================================================
// MAIN LOOP: Listen for incoming commands before sleeping
// ======================================================================================
void loop() {
  unsigned long startMillis = millis();

  Serial.println(F("[LOOP] Listening for Meshtastic UART commands..."));

  // Stay awake for AWAKE_TIMEOUT_MS
  while (millis() - startMillis < AWAKE_TIMEOUT_MS) {
    handleIncomingSerial();
    delay(50);
  }

  // Setup interrupts and go back to sleep
  enterDeepSleep();
}

// ======================================================================================
// FUNCTION 1: COMPACT JSON FORMATTER
// ======================================================================================
/**
 * @brief Formats essential data into a short JSON string (<65 chars).
 */
void sendMeshtasticJson(const char* msgType, const char* sensorSource, const SensorData& data) {
  String jsonPayload = "{";
  jsonPayload += "\"t\":\"" + String(msgType) + "\",";
  jsonPayload += "\"dev\":\"" + String(deviceName) + "\",";
  jsonPayload += "\"s\":\"" + String(systemArmed ? "ARM" : "DIS") + "\",";
  jsonPayload += "\"src\":\"" + String(sensorSource) + "\",";
  jsonPayload += "\"tmp\":" + String(isnan(data.temperature) ? 0.0 : data.temperature, 1) + ",";
  jsonPayload += "\"hum\":" + String(isnan(data.humidity) ? 0.0 : (int)data.humidity) + ",";
  jsonPayload += "\"bat\":" + String(data.batteryPercent);
  jsonPayload += "}\n";

  Serial.print(F("[TX MESHTASTIC JSON] (Length: "));
  Serial.print(jsonPayload.length());
  Serial.print(F(" chars) -> "));
  Serial.print(jsonPayload);

  // Send JSON to Meshtastic via UART2
  Serial2.print(jsonPayload);
}

// ======================================================================================
// FUNCTION 2: MESHTASTIC COMMAND HANDLERS
// ======================================================================================
/**
 * @brief Reads incoming UART2 or USB debug data.
 */
void handleIncomingSerial() {
  if (Serial2.available()) {
    Serial.println(F("[DEBUG] Receiving UART2 data..."));
    String incomingMessage = Serial2.readStringUntil('\n');
    incomingMessage.trim();
    
    Serial.print(F("[RX UART2 MESHTASTIC] Raw Data: '"));
    Serial.print(incomingMessage);
    Serial.println(F("'"));
    
    if (incomingMessage.length() > 0) {
      processMeshtasticCommand(incomingMessage);
    }
  }

  if (Serial.available()) {
    String debugMessage = Serial.readStringUntil('\n');
    debugMessage.trim();
    if (debugMessage.length() > 0) {
      Serial.print(F("[RX USB DEBUG] Raw Data: "));
      Serial.println(debugMessage);
      processMeshtasticCommand(debugMessage);
    }
  }
}

/**
 * @brief Parses JSON command and runs the requested action.
 */
void processMeshtasticCommand(String jsonString) {
  String lowerJson = jsonString;
  lowerJson.toLowerCase();

  SensorData currentSensors = readSensors();

  // ------------------------------------------------------------------------------------
  // ACTION 1: Arm/Disarm System
  // ------------------------------------------------------------------------------------
  if (lowerJson.indexOf("arm") != -1 || lowerJson.indexOf("set_arm") != -1) {
    if (lowerJson.indexOf("true") != -1 || lowerJson.indexOf("\"val\":1") != -1 || lowerJson.indexOf("on") != -1) {
      systemArmed = true;
      Serial.println(F("[CMD HANDLER] -> SYSTEM ARMED!"));
      
      // Short beep feedback
      digitalWrite(PIN_BUZZER_LED, HIGH); delay(100); digitalWrite(PIN_BUZZER_LED, LOW); delay(100);
      digitalWrite(PIN_BUZZER_LED, HIGH); delay(100); digitalWrite(PIN_BUZZER_LED, LOW);

      sendMeshtasticJson("ACK", "CMD", currentSensors);
    } 
    else if (lowerJson.indexOf("false") != -1 || lowerJson.indexOf("\"val\":0") != -1 || lowerJson.indexOf("off") != -1) {
      systemArmed = false;
      Serial.println(F("[CMD HANDLER] -> SYSTEM DISARMED!"));
      
      // Long beep feedback
      digitalWrite(PIN_BUZZER_LED, HIGH); delay(400); digitalWrite(PIN_BUZZER_LED, LOW);

      sendMeshtasticJson("ACK", "CMD", currentSensors);
    }
  }

  // ------------------------------------------------------------------------------------
  // ACTION 2: Init and Config Device Params
  // ------------------------------------------------------------------------------------
  else if (lowerJson.indexOf("cfg") != -1 || lowerJson.indexOf("config") != -1) {
    int nameIndex = jsonString.indexOf("\"name\":");
    if (nameIndex == -1) nameIndex = jsonString.indexOf("\"dev\":");
    
    if (nameIndex != -1) {
      int startQuote = jsonString.indexOf("\"", nameIndex + 6);
      int endQuote = jsonString.indexOf("\"", startQuote + 1);
      if (startQuote != -1 && endQuote != -1) {
        String newName = jsonString.substring(startQuote + 1, endQuote);
        newName.toCharArray(deviceName, sizeof(deviceName));
        Serial.print(F("[CMD HANDLER] -> New name saved to RTC: "));
        Serial.println(deviceName);
      }
    }

    if (lowerJson.indexOf("rst_bat") != -1 || lowerJson.indexOf("reset_battery") != -1) {
      simulatedBattery = 100;
      Serial.println(F("[CMD HANDLER] -> Simulated battery reset to 100%"));
    }

    sendMeshtasticJson("CFG", "CFG", currentSensors);
  }

  // ------------------------------------------------------------------------------------
  // STATUS REQUEST
  // ------------------------------------------------------------------------------------
  else if (lowerJson.indexOf("stat") != -1 || lowerJson.indexOf("status") != -1) {
    sendMeshtasticJson("TEL", "STAT", currentSensors);
  }
}

// ======================================================================================
// WAKEUP REASON HANDLER
// ======================================================================================
void checkWakeupReason() {
  esp_sleep_wakeup_cause_t wakeup_reason = esp_sleep_get_wakeup_cause();
  SensorData data = readSensors();

  switch (wakeup_reason) {
    case ESP_SLEEP_WAKEUP_EXT1: {
      uint64_t wakeup_pin_mask = esp_sleep_get_ext1_wakeup_status();
      Serial.print(F("[WAKEUP] Ext1 interrupt pin mask: 0x"));
      Serial.println((uint32_t)wakeup_pin_mask, HEX);

      const char* sensorTriggered = "GEN";

      if (wakeup_pin_mask & (1ULL << PIN_REED_PORTELLO)) {
        sensorTriggered = "PRUA";
        Serial.println(F(" -> EVENT: Bow hatch opened!"));
      } else if (wakeup_pin_mask & (1ULL << PIN_REED_CABINA)) {
        sensorTriggered = "CABINA";
        Serial.println(F(" -> EVENT: Cabin door opened!"));
      } else if (wakeup_pin_mask & (1ULL << PIN_PULSANTE_PIR)) {
        sensorTriggered = "PIR";
        Serial.println(F(" -> EVENT: Motion detected (PIR)!"));
      }

      if (systemArmed) {
        triggerAlarm(sensorTriggered);
        sendMeshtasticJson("ALM", sensorTriggered, data);
      } else {
        Serial.println(F("[INFO] Sensor triggered, but system is DISARMED."));
        sendMeshtasticJson("TEL", sensorTriggered, data);
      }
      break;
    }

    case ESP_SLEEP_WAKEUP_EXT0: {
      Serial.println(F("[WAKEUP] Remote message received (UART RX) -> EXT0"));
      Serial.println(F("[INFO] Waiting for incoming JSON packet..."));
      break;
    }

    case ESP_SLEEP_WAKEUP_TIMER: {
      Serial.println(F("[WAKEUP] Timer event."));
      sendMeshtasticJson("TEL", "TIMER", data);
      break;
    }

    default: {
      Serial.println(F("[BOOT] Initial system boot."));
      sendMeshtasticJson("TEL", "BOOT", data);
      break;
    }
  }
}

// ======================================================================================
// ALARM ACTUATOR (BUZZER / LED)
// ======================================================================================
void triggerAlarm(const char* sensorSource) {
  Serial.print(F("🚨 ALARM TRIGGERED! Sensor: "));
  Serial.println(sensorSource);

  for (int i = 0; i < 15; i++) {
    digitalWrite(PIN_BUZZER_LED, HIGH);
    delay(100);
    digitalWrite(PIN_BUZZER_LED, LOW);
    delay(100);
  }
}

// ======================================================================================
// READ SENSORS & BATTERY SIMULATOR
// ======================================================================================
SensorData readSensors() {
  SensorData d;
  
  // Real DHT11 reading
  d.humidity = dht.readHumidity();
  d.temperature = dht.readTemperature();

  // Fallback if DHT11 is not connected
  if (isnan(d.humidity) || isnan(d.temperature)) {
    d.temperature = 23.5;
    d.humidity = 60.0;
  }

  // Simulated battery level
  d.batteryPercent = simulateSoftwareBattery();

  return d;
}

/**
 * @brief SOFTWARE BATTERY SIMULATOR
 */
int simulateSoftwareBattery() {
  if (simulatedBattery > 5) {
    simulatedBattery--;
  }
  return simulatedBattery;
}

// ======================================================================================
// INTERRUPT SETUP & SLEEP
// ======================================================================================
void enterDeepSleep() {
  Serial.println(F("\n[SLEEP] Configuring wakeup interrupts (Sensors + RX)..."));
  
  // 1. Wakeup on physical sensors (Buttons/Reed) going HIGH
  esp_sleep_enable_ext1_wakeup(BUTTON_PIN_BITMASK, ESP_EXT1_WAKEUP_ANY_HIGH);

  // 2. Wakeup on RX line (Meshtastic/PC). 
  // Idle UART is HIGH, starts with a LOW bit. Use ext0 to wake on LOW (0).
  esp_sleep_enable_ext0_wakeup((gpio_num_t)UART_MESHTASTIC_RX, 0);

  Serial.println(F("[SLEEP] Entering Light Sleep (Ready for remote commands)...\n"));
  Serial.flush();

  // Switch to Light Sleep instead of Deep Sleep:
  // CPU halts, but RAM and UART registers stay active.
  // Wakeup is instant, preventing data loss on UART.
  esp_light_sleep_start();

  // Execution resumes here after Light Sleep (doesn't reboot!)
  Serial.println(F("\n[WAKEUP] Woke up from Light Sleep!"));
  
  // Re-check wakeup reason to process data immediately
  checkWakeupReason();
}
