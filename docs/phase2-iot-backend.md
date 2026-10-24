# SaveBite Phase 2: IoT Backend Ingestion & Smart Storage Documentation

## 1. Objective & Architectural Overview

SaveBite Phase 2 implements the backend data-collection and smart storage pipeline for IoT sensors (temperature, humidity, and gas/air-quality sensor nodes), whether from physical ESP32 microcontrollers or software simulators.

```
+------------------------------------+       +------------------------------------+
|  Physical ESP32 / Sensor Node      |       |  ESP32 / Telemetry Simulator       |
|  (DHT22 / BME280 / MQ-135)         |       |  (Node.js / Python / Postman / curl|
+-----------------+------------------+       +-----------------+------------------+
                  |                                            |
                  | MQTT (QoS 1)                               | HTTP POST
                  | topic: savebite/:hhId/:devCode/telemetry   | /api/v1/telemetry
                  v                                            v
+---------------------------------------------------------------------------------+
|                         SaveBite Node.js / Express Backend                      |
|                                                                                 |
|  - MQTT Subscriber: Validates topic components, parses JSON, ingests readings   |
|  - Telemetry Ingestion API: Authenticates household, validates physical bounds  |
|  - Device Management API: Registers hardware/simulators, tracks last_seen_at    |
|  - Non-AI Operational Thresholds: Evaluates temp/gas alerts with cooldowns     |
|  - Notifications API: Exposes household alerts and read receipts                |
+----------------------------------------+----------------------------------------+
                                         | Scoped SQL / Service Role
                                         v
+---------------------------------------------------------------------------------+
|                           Supabase PostgreSQL Database                          |
|                                                                                 |
|  - public.devices (hardware/simulator registry scoped to households)            |
|  - public.sensor_readings (raw measurement time-series)                         |
|  - public.device_events (operational lifecycle & threshold breaches)             |
|  - public.notifications (household-scoped alert notices)                        |
|  - Supabase Realtime publication (prepared for future live dashboards)          |
+---------------------------------------------------------------------------------+
```

> [!IMPORTANT]
> **No AI Classification in Phase 2**: In this phase, the backend focuses exclusively on reliable, validated ingestion and storage of raw measurements. Raw gas values (`air_quality_raw`) are preserved with their original units (`'raw'`) without unjustified conversion to AQI or ppm, and without claiming that toxic gas has been identified. An external AI service will analyze this stored historical data in a future phase.

---

## 2. Database Schema & Migration Guide

### Migration File
[20261024000003_create_iot_and_telemetry.sql](file:///d:/SaveBite/supabase/migrations/20261024000003_create_iot_and_telemetry.sql)

### Manual Application in Supabase Dashboard
1. Open your **Supabase Dashboard** -> **SQL Editor**.
2. Open a new query window.
3. Paste the contents of `supabase/migrations/20261024000003_create_iot_and_telemetry.sql`.
4. Click **Run**.
5. The migration executes non-destructively:
   - Creates `public.devices` with `device_code` unique constraint.
   - Creates `public.sensor_readings` with physical bounds checking (-50.00°C to 100.00°C temperature, 0.00% to 100.00% humidity, non-negative gas).
   - Creates `public.device_events` for operational event logging.
   - Creates `public.notifications` for household alert tracking.
   - Creates high-performance descending time indexes (`recorded_at DESC`, `occurred_at DESC`).
   - Attaches `handle_updated_at` trigger to `devices`.
   - Enables Row-Level Security (RLS) with policies for `service_role`.
   - Configures `supabase_realtime` publication membership for live updates.

---

## 3. Physical vs. Simulator Telemetry

SaveBite explicitly distinguishes real ESP32 hardware from simulated test sources via the `source_type` field:
- `physical`: Microcontrollers deployed in actual refrigerators, freezers, or pantries.
- `simulator`: Automated mock scripts, Postman runs, or local hardware simulators.

Both sources follow identical validation and storage pipelines, but the `source_type` flag allows future AI models and analytics to filter out synthetic test data from production models.

---

## 4. API Endpoints Reference

Base URL: `http://localhost:5000/api/v1`

All requests require custom JWT authentication:
```
Authorization: Bearer <accessToken>
```

---

### A. Register Sensor Device
- **Method**: `POST`
- **Path**: `/api/v1/devices`
- **Description**: Registers a hardware or simulator sensor node to the authenticated user's active household. Device registration is idempotent for the same household and rejects cross-household device code collisions (`409 Conflict`).
- **Request Body**:
```json
{
  "name": "Kitchen Fridge Node",
  "device_code": "SAVE-ESP32-001",
  "device_type": "esp32",
  "zone": "refrigerator",
  "source_type": "physical"
}
```
- **Allowed `device_type`**: `esp32`, `sensor_node`, `simulator`, `other`
- **Allowed `zone`**: `refrigerator`, `freezer`, `pantry`, `counter`, `other`
- **Allowed `source_type`**: `physical`, `simulator`
- **Response (`201 Created`)**:
```json
{
  "status": "success",
  "data": {
    "device": {
      "id": "d1111111-2222-3333-4444-555555555555",
      "household_id": "hhhhhhhh-1111-2222-3333-444444444444",
      "name": "Kitchen Fridge Node",
      "device_code": "SAVE-ESP32-001",
      "device_type": "esp32",
      "zone": "refrigerator",
      "source_type": "physical",
      "status": "active",
      "last_seen_at": null,
      "created_at": "2026-10-24T18:00:00.000Z",
      "updated_at": "2026-10-24T18:00:00.000Z"
    }
  }
}
```

---

### B. List Household Devices
- **Method**: `GET`
- **Path**: `/api/v1/devices`
- **Query Parameters**:
  - `zone`: Filter by zone (`refrigerator`, `freezer`, etc.)
  - `status`: `active`, `inactive`, `maintenance`, `all` (default: `all`)
  - `source_type`: `physical`, `simulator`
- **Response (`200 OK`)**:
```json
{
  "status": "success",
  "data": {
    "devices": [
      {
        "id": "d1111111-2222-3333-4444-555555555555",
        "household_id": "hhhhhhhh-1111-2222-3333-444444444444",
        "name": "Kitchen Fridge Node",
        "device_code": "SAVE-ESP32-001",
        "device_type": "esp32",
        "zone": "refrigerator",
        "source_type": "physical",
        "status": "active",
        "last_seen_at": "2026-10-24T18:15:00.000Z",
        "created_at": "2026-10-24T18:00:00.000Z"
      }
    ]
  }
}
```

---

### C. Ingest Telemetry (HTTP)
- **Method**: `POST`
- **Path**: `/api/v1/telemetry`
- **Description**: Ingests sensor readings from a device or simulator. Verifies device ownership against caller household, updates `devices.last_seen_at`, and triggers non-AI operational threshold alerts if configured boundaries are breached.
- **Request Body**:
```json
{
  "device_code": "SAVE-ESP32-001",
  "recorded_at": "2026-10-24T18:15:00.000Z",
  "source_type": "simulator",
  "readings": {
    "temperature_c": 3.8,
    "humidity_percent": 62.4,
    "air_quality_raw": 195,
    "air_quality_unit": "raw"
  },
  "metadata": {
    "sensor_model": "DHT22 + MQ-135",
    "firmware_version": "1.0.0"
  }
}
```
- **Validation Rules**:
  - `temperature_c`: Optional, -50.00 to 100.00 °C, finite.
  - `humidity_percent`: Optional, 0.00 to 100.00 %, finite.
  - `air_quality_raw`: Optional, non-negative finite number.
  - `recorded_at`: ISO 8601, cannot exceed 10 minutes into the future.
- **Response (`201 Created`)**:
```json
{
  "status": "success",
  "data": {
    "reading_id": "r1111111-2222-3333-4444-555555555555",
    "recorded_at": "2026-10-24T18:15:00.000Z",
    "received_at": "2026-10-24T18:15:01.120Z"
  }
}
```

---

### D. Get Historical Readings
- **Method**: `GET`
- **Path**: `/api/v1/devices/:id/readings`
- **Query Parameters**:
  - `from`: ISO 8601 start timestamp (e.g. `2026-10-24T00:00:00Z`)
  - `to`: ISO 8601 end timestamp (e.g. `2026-10-24T23:59:59Z`)
  - `limit`: Bounded integer, 1 to 200 (default: `50`)
  - `source_type`: `physical` or `simulator`
- **Response (`200 OK`)**:
```json
{
  "status": "success",
  "data": {
    "device": {
      "id": "d1111111-2222-3333-4444-555555555555",
      "name": "Kitchen Fridge Node",
      "device_code": "SAVE-ESP32-001",
      "zone": "refrigerator",
      "source_type": "physical",
      "status": "active",
      "last_seen_at": "2026-10-24T18:15:00.000Z"
    },
    "readings": [
      {
        "id": "r1111111-2222-3333-4444-555555555555",
        "recorded_at": "2026-10-24T18:15:00.000Z",
        "temperature_c": 3.8,
        "humidity_percent": 62.4,
        "air_quality_raw": 195,
        "air_quality_unit": "raw",
        "source_type": "physical",
        "metadata": { "firmware_version": "1.0.0" }
      }
    ]
  }
}
```

---

### E. List Household Notifications
- **Method**: `GET`
- **Path**: `/api/v1/notifications`
- **Query Parameters**:
  - `is_read`: `true` or `false`
  - `type`: `threshold_alert`, `operational`, `system`, `inventory`
  - `limit`: 1 to 100 (default: `20`)
- **Response (`200 OK`)**:
```json
{
  "status": "success",
  "data": {
    "notifications": [
      {
        "id": "n1111111-2222-3333-4444-555555555555",
        "household_id": "hhhhhhhh-1111-2222-3333-444444444444",
        "device_id": "d1111111-2222-3333-4444-555555555555",
        "type": "threshold_alert",
        "title": "Temperature High Warning",
        "message": "Elevated temperature of 14.5°C detected in refrigerator. Warning threshold: 10°C.",
        "severity": "warning",
        "is_read": false,
        "created_at": "2026-10-24T18:10:00.000Z",
        "read_at": null
      }
    ]
  }
}
```

---

### F. Mark Notification as Read
- **Method**: `PATCH`
- **Path**: `/api/v1/notifications/:id/read`
- **Description**: Marks notification as read and records `read_at` timestamp. Idempotent. Scoped strictly to user's household (User B cannot read User A's alerts).
- **Response (`200 OK`)**:
```json
{
  "status": "success",
  "data": {
    "notification": {
      "id": "n1111111-2222-3333-4444-555555555555",
      "is_read": true,
      "read_at": "2026-10-24T18:20:00.000Z"
    }
  }
}
```

---

## 5. MQTT Ingestion Specification

### Configuration
In `backend/.env`:
```env
MQTT_ENABLED=true
MQTT_BROKER_URL=mqtt://localhost:1883
MQTT_CLIENT_ID=savebite-backend-subscriber
MQTT_TELEMETRY_TOPIC=savebite/+/+/telemetry
```

### Topic Format
```text
savebite/{householdId}/{deviceCode}/telemetry
```
Example:
```text
savebite/hhhhhhhh-1111-2222-3333-444444444444/SAVE-ESP32-001/telemetry
```

### Security & Topic Verification
When a message arrives:
1. The subscriber extracts `{householdId}` and `{deviceCode}` from the topic.
2. The subscriber verifies that `deviceCode` is registered to `{householdId}` in the database.
3. If the topic household does not match the database registration, the message is discarded with a structured warning.
4. If the MQTT broker is offline or unreachable, the Express server continues running normally, and HTTP ingestion remains 100% operational.

---

## 6. Testing Guide

Run all Phase 1 and Phase 2 automated tests:
```bash
cd backend
npm test
```

### Test Coverage Summary (103 Tests Total):
- `tests/iot.devices.test.js`: Device registration, duplicate code conflict prevention, listing, zone/source filtering, household isolation.
- `tests/iot.telemetry.test.js`: HTTP telemetry ingestion, physical bounds checks, partial readings, cross-household protection, historical time-range queries, operational threshold alerts, notification read receipts.
- `tests/iot.mqtt.test.js`: MQTT subscriber topic parsing, household verification, malformed JSON resilience, graceful startup when MQTT is disabled.
- Phase 1 suites (`auth.test.js`, `security.test.js`, `inventory.test.js`, `household.security.test.js`, `middleware.test.js`, `profile.repository.test.js`): All 73 tests continue to pass 100%.

---

## 7. Future AI Integration Contract

Raw sensor measurements stored in `sensor_readings` are preserved in high resolution for consumption by a future AI service:
- `recorded_at`: Sensor timestamp.
- `temperature_c`: Celsius measurement.
- `humidity_percent`: Humidity measurement.
- `air_quality_raw`: Raw gas/air resistance measurement.
- `air_quality_unit`: Measurement unit (`raw`).
- `metadata`: Sensor model, calibration, and firmware version.

A subsequent phase will introduce a Python FastAPI AI service to poll or subscribe to these readings and generate AI-driven spoilage predictions and dynamic shelf-life adjustments.
