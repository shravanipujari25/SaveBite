#include <DHT.h>
#include <HTTPClient.h>
#include <WiFi.h>
#include <time.h>

// ==============================================================================
// 1. Hardware Pin Configurations (Exact User Pinout Preserved)
// ==============================================================================
#define DHT_PIN 4
#define DHT_TYPE DHT11
#define MQ135_PIN 34

// ==============================================================================
// 2. Wi-Fi and SaveBite Server Configuration
// ==============================================================================
// Configured Wi-Fi credentials and SaveBite server endpoint
const char *WIFI_SSID = "EngiiGenius";
const char *WIFI_PASSWORD = "";

// SaveBite backend telemetry endpoint
const char *SAVEBITE_SERVER_URL =
    "http://10.126.139.189:5000/api/v1/telemetry/device";
// Unique Device Code matching SaveBite hardware registry
const char *DEVICE_ID = "savebite-fridge-01";

// 5-second sampling interval (Exact requirement preserved)
const unsigned long SAMPLING_INTERVAL_MS = 5000;

DHT dht(DHT_PIN, DHT_TYPE);
unsigned long lastSampleTime = 0;

// NTP configuration for synchronized ISO 8601 timestamps
const char *NTP_SERVER = "pool.ntp.org";
const long GMT_OFFSET_SEC = 0; // UTC offset in seconds
const int DAYLIGHT_OFFSET_SEC = 0;

/**
 * Obtain current UTC timestamp in ISO 8601 format (e.g., 2026-10-25T10:30:00Z).
 * Falls back to estimated timestamp if NTP is not yet synchronized.
 */
String getIsoTimestamp() {
  struct tm timeinfo;
  if (!getLocalTime(&timeinfo, 500)) {
    // If NTP time not yet acquired, return empty string so backend uses server
    // time
    return "";
  }
  char buffer[32];
  strftime(buffer, sizeof(buffer), "%Y-%m-%dT%H:%M:%SZ", &timeinfo);
  return String(buffer);
}

void connectWiFi() {
  if (WiFi.status() == WL_CONNECTED)
    return;

  Serial.print("Connecting to Wi-Fi SSID: ");
  Serial.println(WIFI_SSID);

  WiFi.mode(WIFI_STA);
  if (WIFI_PASSWORD != nullptr && strlen(WIFI_PASSWORD) > 0) {
    WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  } else {
    WiFi.begin(WIFI_SSID);
  }

  unsigned long startAttemptTime = millis();
  // Try connecting for 10 seconds without blocking main execution indefinitely
  while (WiFi.status() != WL_CONNECTED && millis() - startAttemptTime < 10000) {
    delay(500);
    Serial.print(".");
  }
  Serial.println();

  if (WiFi.status() == WL_CONNECTED) {
    Serial.print("Wi-Fi connected! IP address: ");
    Serial.println(WiFi.localIP());
    // Initialize SNTP client for real timestamps
    configTime(GMT_OFFSET_SEC, DAYLIGHT_OFFSET_SEC, NTP_SERVER);
  } else {
    Serial.println(
        "Wi-Fi connection failed. Sensor loop will continue reading.");
  }
}

/**
 * Transmit sensor readings to the SaveBite backend.
 * Uses HTTP/HTTPS POST matching SaveBite telemetry schema.
 */
void transmitTelemetry(float temperature, float humidity, int gasValue,
                       bool dhtSuccess) {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("[SaveBite] Cannot send telemetry: Wi-Fi disconnected.");
    return;
  }

  HTTPClient http;
  http.begin(SAVEBITE_SERVER_URL);
  http.addHeader("Content-Type", "application/json");
  http.setTimeout(
      4000); // 4-second timeout to fit smoothly within 5-second loop

  // Construct JSON payload
  // If DHT reading failed, transmit temperature and humidity as null (or omit)
  // so invalid numbers are never recorded as real measurements.
  String payload = "{";
  payload += "\"deviceId\":\"" + String(DEVICE_ID) + "\",";

  if (dhtSuccess) {
    payload += "\"temperature\":" + String(temperature, 1) + ",";
    payload += "\"humidity\":" + String(humidity, 1) + ",";
  } else {
    payload += "\"temperature\":null,";
    payload += "\"humidity\":null,";
  }

  payload += "\"gasValue\":" + String(gasValue);

  String isoTime = getIsoTimestamp();
  if (isoTime.length() > 0) {
    payload += ",\"timestamp\":\"" + isoTime + "\"";
  }
  payload += "}";

  Serial.print("[SaveBite] Transmitting payload: ");
  Serial.println(payload);

  int httpResponseCode = http.POST(payload);

  if (httpResponseCode > 0) {
    Serial.print("[SaveBite] HTTP Response Code: ");
    Serial.println(httpResponseCode);
    if (httpResponseCode == 200 || httpResponseCode == 201) {
      Serial.println("[SaveBite] Telemetry ingested successfully by SaveBite!");
    } else {
      String response = http.getString();
      Serial.print("[SaveBite] Server Response: ");
      Serial.println(response);
    }
  } else {
    Serial.print("[SaveBite] HTTP POST failed, error: ");
    Serial.println(http.errorToString(httpResponseCode).c_str());
  }

  http.end();
}

void setup() {
  Serial.begin(115200);

  // Exact sensor setup from user's original code
  dht.begin();
  analogReadResolution(12);

  Serial.println("ESP32 + DHT11 + MQ-135");
  Serial.println("Sensor initialization complete");

  // Connect to Wi-Fi
  connectWiFi();
}

void loop() {
  unsigned long currentMillis = millis();

  // Enforce 5-second sampling interval (Preserves exact loop frequency)
  if (currentMillis - lastSampleTime >= SAMPLING_INTERVAL_MS ||
      lastSampleTime == 0) {
    lastSampleTime = currentMillis;

    // Read sensors
    float temperature = dht.readTemperature();
    float humidity = dht.readHumidity();
    int gasValue = analogRead(MQ135_PIN);

    Serial.println("-------------------------");

    bool dhtSuccess = true;
    if (isnan(temperature) || isnan(humidity)) {
      Serial.println("DHT11 reading failed!");
      dhtSuccess = false;
    } else {
      Serial.print("Temperature: ");
      Serial.print(temperature);
      Serial.println(" °C");

      Serial.print("Humidity: ");
      Serial.print(humidity);
      Serial.println(" %");
    }

    Serial.print("Gas Value: ");
    Serial.println(gasValue);

    // Reconnect Wi-Fi if dropped
    if (WiFi.status() != WL_CONNECTED) {
      connectWiFi();
    }

    // Transmit telemetry to SaveBite backend
    transmitTelemetry(temperature, humidity, gasValue, dhtSuccess);
  }

  delay(100);
}
