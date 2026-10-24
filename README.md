# SaveBite

AI-powered grocery intelligence and food-waste management platform utilizing React, Node.js, Supabase PostgreSQL, IoT environmental telemetry, and machine learning to actively prevent food spoilage, optimize household groceries, and promote sustainable consumption.

> **Tagline:** *"Save Food. Save Money. Waste Less."*

---

## 1. Project Architecture

The platform consists of five modular tiers designed for high resilience, security, and independent scalability:

```
┌───────────────────────┐      REST API / JWT       ┌────────────────────────┐
│  frontend/            │ ────────────────────────> │  backend/              │
│  React + Vite +       │                           │  Node.js + Express     │
│  Tailwind CSS         │                           │  Zod + Pino + bcrypt   │
└───────────────────────┘                           └───────────┬────────────┘
                                                                │
           ┌────────────────────────────────────────────────────┼──────────────────────────────┐
           │                                                    │                              │
           ▼                                                    ▼                              ▼
┌───────────────────────┐                           ┌────────────────────────┐    ┌────────────────────────┐
│  iot/                 │   MQTT QoS 1 / REST HTTP  │  supabase/             │    │  ai/                   │
│  ESP32 Sensor Hubs /  │ ────────────────────────> │  PostgreSQL Database + │    │  FastAPI Microservice  │
│  Virtual Simulator    │                           │  Row Level Security    │    │  (Vision, Recipes, NLP)│
└───────────────────────┘                           └────────────────────────┘    └────────────────────────┘
```

- `frontend/` — Mobile-responsive React + Vite web dashboard featuring inventory management, telemetry visualization, visual freshness inspection, recipe rescue, and AI assistant chat.
- `backend/` — Express / Node.js API orchestrator enforcing strict household-level data isolation, rate limiting, Zod schema validation, background intelligence scheduling, and resilient AI proxies.
- `ai/` — Python FastAPI intelligence microservice powering receipt OCR, image-based freshness analysis, recipe rescue generation, and culinary advice.
- `iot/` — Hardware firmware for ESP32 microcontroller nodes and a virtual simulator publishing temperature, humidity, and air quality telemetry.
- `supabase/` — Database migration documentation and SQL definitions.
- `docs/` — Architectural specifications, manual database migration scripts, and demo guides.

---

## 2. Software Prerequisites

- **Node.js:** `v20.x` or higher (Active LTS recommended)
- **npm:** `v10.x` or higher
- **Python:** `v3.10+` (if running the AI FastAPI service locally)
- **Docker & Docker Compose:** Required only for running local Mosquitto MQTT broker
- **Database:** Supabase PostgreSQL account or local PostgreSQL instance

---

## 3. Environment Configuration

### Backend Environment Variables (`backend/.env`)

Copy `backend/.env.example` to `backend/.env` and supply your project secrets. Never commit `.env` to source control.

```bash
# Server Configuration
PORT=5000
NODE_ENV=development
FRONTEND_URL=http://localhost:5173

# Authentication Secrets
JWT_SECRET=your-super-secret-jwt-key-min-32-chars-long
JWT_EXPIRES_IN=7d

# Supabase PostgreSQL Configuration
SUPABASE_URL=https://your-project-id.supabase.co
SUPABASE_SECRET_KEY=your-supabase-service-role-secret-key

# Storage Configuration
SUPABASE_STORAGE_BUCKET_RECEIPTS=receipts
SUPABASE_STORAGE_BUCKET_FRESHNESS=freshness-scans

# AI Microservice Configuration
AI_SERVICE_URL=http://localhost:8000
AI_REQUEST_TIMEOUT_MS=15000

# Rate Limiting Configuration (Per 15-minute window)
AUTH_RATE_LIMIT_MAX=20
AI_RATE_LIMIT_MAX=60
TELEMETRY_RATE_LIMIT_MAX=300
UPLOAD_RATE_LIMIT_MAX=40

# MQTT Telemetry Broker Configuration
MQTT_ENABLED=false
MQTT_BROKER_URL=mqtt://localhost:1883
MQTT_TELEMETRY_TOPIC=savebite/+/+/telemetry
MQTT_CLIENT_ID=savebite-backend-dev
MQTT_USERNAME=
MQTT_PASSWORD=

# Background Intelligence Scheduler
SCHEDULER_ENABLED=false
SCHEDULER_INTERVAL_MS=3600000
```

---

## 4. Supabase Database & Storage Setup

SaveBite follows a zero-automatic-migration policy for deployment safety. All database tables and columns must be created manually using the Supabase SQL Editor:

1. Open your **Supabase Dashboard** > **SQL Editor**.
2. Open and execute the manual SQL script located in [`docs/phase5-manual-sql.md`](file:///d:/SaveBite/docs/phase5-manual-sql.md).
3. Confirm creation of the following tables:
   - `users`, `profiles`, `households`, `household_members`
   - `inventory_items`, `inventory_events`, `waste_log`, `avoided_waste_log`
   - `devices`, `sensor_readings`, `device_events`, `device_pairing_tokens`
   - `receipts`, `receipt_items`, `freshness_scans`, `shopping_list_items`, `notifications`
4. Set up two private Supabase Storage buckets:
   - `receipts` (Private, max 10MB, allowed types: `image/jpeg`, `image/png`, `application/pdf`)
   - `freshness-scans` (Private, max 10MB, allowed types: `image/jpeg`, `image/png`)

---

## 5. Backend Installation & Execution

### Install Dependencies

```bash
cd backend
npm install
```

### Option A: Start Backend (MQTT Disabled — Default Demo Mode)

In this mode, the server runs completely standalone. Telemetry ingestion is fully supported via HTTP REST API (`POST /api/v1/telemetry`).

```bash
cd backend
npm run dev
```

### Option B: Start Backend + Mosquitto MQTT Broker

To enable real-time IoT hardware or simulator publishing over MQTT:

1. Start the local Eclipse Mosquitto MQTT broker via Docker Compose:
   ```bash
   docker compose -f docker-compose.mqtt.yml up -d
   ```
2. In `backend/.env`, set:
   ```env
   MQTT_ENABLED=true
   MQTT_BROKER_URL=mqtt://localhost:1883
   ```
3. Start the backend:
   ```bash
   cd backend
   npm run dev
   ```

---

## 6. Repeatable Demo Seed Script

To prepare the platform for demonstrations, run the deterministic seed script:

```bash
cd backend
npm run seed:demo
```

### Seed Safety & Idempotency:
- Generates approximately 7 days of realistic SaveBite kitchen activity:
  - 1 Demo User (`demo@savebite.com` / `DemoPassword123!`)
  - 1 Demo Smart Kitchen Household (`owner` role)
  - 1 ESP32 Refrigerator Sensor Hub (`source_type: simulator`)
  - 10 Realistic grocery inventory items across 7 categories (`produce`, `dairy`, `bakery`, `pantry`, `beverages`, `frozen`, `leftovers`)
  - 21 Environmental sensor readings spanning 7 days (incorporates simulated temperature spike during refrigerator door-open event)
  - 3 Device lifecycle and alert events
  - 3 Household risk and temperature notifications
  - Realistic waste records and avoided waste savings logs
- **Safe & Idempotent:** Uses deterministic UUIDs. Re-running `npm run seed:demo` updates existing records without creating duplicates.
- **Production Guard:** Strict safety check prevents the script from executing if `NODE_ENV=production`.

---

## 7. Running Automated Tests

SaveBite features a comprehensive, zero-external-dependency automated test suite using Node.js native test runner (`node:test`). Tests run sequentially with in-memory database mocks:

```bash
cd backend
npm test
```

### Test Coverage Highlights:
- **Total Tests:** 202 tests across 72 suites (100% pass rate)
- **Household Isolation Audit:** User A vs User B cross-household boundary enforcement across inventory, telemetry, notifications, receipts, scans, shopping lists, and analytics.
- **Client Spoofing Defense:** Verifies that client-supplied `household_id` parameters are ignored in favor of server-derived JWT context.
- **AI Request Resilience:** Tests bounded retries with exponential backoff and jitter, non-retry of 4xx client errors, timeouts (504), network outages (502), and anti-fabrication assertions.
- **MQTT Broker Resilience:** Verifies non-blocking startup when MQTT is disabled or unreachable, safe discard of malformed JSON messages, and graceful shutdown.
- **Seed Idempotency:** Validates zero-duplicate guarantees across repeated runs.

---

## 8. End-to-End Demo Verification Flow

For a comprehensive, step-by-step walkthrough covering all 15 operational scenarios with ready-to-run `curl` commands, refer to the complete runbook:

👉 **[`docs/phase5-demo-guide.md`](file:///d:/SaveBite/docs/phase5-demo-guide.md)**

### Supported Capabilities Demonstrated:
1. User registration and household provisioning
2. Household-scoped grocery inventory CRUD
3. Hardware/Simulator IoT device registration
4. Simulator telemetry ingestion (HTTP & MQTT)
5. Sensor reading historical analytics
6. Door ajar / temperature spike notification trigger
7. Scheduled intelligence Use-First priority recalculation
8. Ingredient consumption and waste logging
9. Smart shopping list item management
10. Financial waste analytics and avoided-waste cost savings
11. Receipt upload, OCR parsing, and inventory confirmation
12. Barcode product lookup (OpenFoodFacts)
13. Camera-based visual freshness evaluation
14. AI recipe rescue and culinary assistant chat
15. Multi-tenant household authorization isolation

---

## 9. Troubleshooting & Common Error Codes

| HTTP Status | Error Code | Cause & Recommended Action |
|-------------|------------|----------------------------|
| `400` | `VALIDATION_ERROR` | Request payload, query, or path parameter failed Zod validation. Check schema constraints (e.g., valid UUID format, non-negative numbers). |
| `401` | `UNAUTHORIZED` | Missing, expired, malformed, or tampered JWT access token in `Authorization: Bearer <TOKEN>` header. |
| `403` | `FORBIDDEN_HOUSEHOLD` | User's household membership is inactive or user is not authorized for the requested household operation. |
| `403` | `FORBIDDEN_DEVICE` | The device code specified in telemetry ingestion belongs to a different household. Cross-household telemetry is prohibited. |
| `404` | `NOT_FOUND` | The requested resource (item, device, receipt, notification) does not exist or belongs to another household. |
| `429` | `RATE_LIMIT_EXCEEDED` | Exceeded endpoint rate limit threshold (auth, AI, upload, or telemetry). Wait for the reset window (15 minutes). |
| `502` | `AI_SERVICE_UNAVAILABLE` | External FastAPI AI microservice is offline, unreachable, or refused connection. Ensure AI service is running on `AI_SERVICE_URL`. |
| `502` | `AI_MALFORMED_RESPONSE` | AI microservice returned invalid JSON or an unexpected payload schema. Check AI service logs. |
| `504` | `AI_SERVICE_TIMEOUT` | AI microservice did not respond within `AI_REQUEST_TIMEOUT_MS` (default 15000ms). |

---

## 10. License

SaveBite is developed for academic and hackathon demonstration purposes.
