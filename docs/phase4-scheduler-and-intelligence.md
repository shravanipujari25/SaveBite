# SaveBite — Phase 4: Scheduler, Intelligence & Analytics Documentation

## 1. Overview

Phase 4 of **SaveBite** delivers the backend intelligence layer, background scheduling engine, avoided-waste tracking, smart recipe rescue, household grocery shopping lists with deterministic overbuy warnings, and household-scoped analytics and AI assistant proxying.

All Phase 4 functionality strictly preserves:
- Custom bcrypt + JWT authentication (no Supabase Auth migration).
- Strict household isolation across all queries, mutations, scheduled processing, and AI contexts.
- Non-destructive database operations without automated migrations.
- Graceful degradation when external AI or IoT services are unavailable.

---

## 2. Implemented API Routes & Example Payloads

All endpoints (except health) require a valid JWT bearer token: `Authorization: Bearer <TOKEN>` and active household membership.

### 2.1 Inventory Multi-Item Consumption (`POST /api/v1/inventory/use-ingredients`)

Consumes multiple ingredients in a single atomic transaction. Depleted items (`quantity <= 0`) are marked as `consumed`. Items at risk (`use_first_score >= 70`, `adj_days_left <= 2`, or `critical`/`use_soon` freshness bucket) with a known `estimated_unit_price` automatically log avoided-waste monetary savings into `avoided_waste_log`.

**Request:**
```http
POST /api/v1/inventory/use-ingredients HTTP/1.1
Host: localhost:5000
Authorization: Bearer <TOKEN>
Content-Type: application/json

{
  "items": [
    {
      "inventory_item_id": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
      "quantity": 2
    },
    {
      "inventory_item_id": "7ca95f64-5717-4562-b3fc-2c963f66afa7",
      "quantity": 0.5
    }
  ],
  "source": "recipe_rescue",
  "recipe_name": "Vegetable Pasta"
}
```

**Success Response (200 OK):**
```json
{
  "status": "success",
  "data": {
    "consumed_items": [
      {
        "item_id": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
        "name": "Tomatoes",
        "consumed_quantity": 2,
        "remaining_quantity": 0,
        "unit": "piece",
        "status": "consumed"
      },
      {
        "item_id": "7ca95f64-5717-4562-b3fc-2c963f66afa7",
        "name": "Olive Oil",
        "consumed_quantity": 0.5,
        "remaining_quantity": 1.5,
        "unit": "bottle",
        "status": "active"
      }
    ],
    "total_avoided_savings": 5.00,
    "avoided_waste_items": [
      {
        "item_id": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
        "name": "Tomatoes",
        "quantity": 2,
        "unit": "piece",
        "estimated_savings": 5.00
      }
    ]
  }
}
```

---

### 2.2 Recipe Rescue Route (`GET /api/v1/recipes/rescue`)

Retrieves pantry items prioritizing high Use-First scores (`use_first_score >= 50`) and imminent shelf-life expiry (`adj_days_left <= 4`), and requests recipe recommendations from the AI service.

**Request:**
```http
GET /api/v1/recipes/rescue?limit=5 HTTP/1.1
Host: localhost:5000
Authorization: Bearer <TOKEN>
```

**Success Response (200 OK):**
```json
{
  "status": "success",
  "data": {
    "recipes": [
      {
        "id": "e4f80877-bb89-4977-9d41-0ca98132e185",
        "title": "Fresh Tomato Basil Pasta",
        "description": "A quick 15-minute pasta dish using ripe tomatoes.",
        "prep_time_minutes": 5,
        "cook_time_minutes": 10,
        "servings": 2,
        "ingredients": ["Ripe Tomatoes", "Pasta", "Olive Oil", "Garlic"],
        "instructions": [
          "Boil pasta until al dente.",
          "Saute diced ripe tomatoes and minced garlic in olive oil.",
          "Toss pasta with sauce and garnish with basil."
        ],
        "rescued_items": [
          {
            "id": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
            "name": "Ripe Tomatoes",
            "quantity": 3,
            "unit": "piece",
            "freshness_bucket": "critical",
            "use_first_score": 90
          }
        ],
        "waste_reduction_score": 85
      }
    ],
    "candidate_ingredients": [...],
    "total_at_risk_count": 1
  }
}
```

---

### 2.3 Shopping List CRUD (`/api/v1/shopping-list`)

- `POST /api/v1/shopping-list`: Add item with automatic overbuy warnings if similar active items exist in pantry.
- `GET /api/v1/shopping-list`: List shopping list items (supports `?is_purchased=false`).
- `GET /api/v1/shopping-list/:id`: Get item by ID.
- `PATCH /api/v1/shopping-list/:id`: Update item fields.
- `POST /api/v1/shopping-list/:id/purchase`: Mark item purchased.
- `DELETE /api/v1/shopping-list/:id`: Delete item.

**Create Item Request with Overbuy Warning:**
```http
POST /api/v1/shopping-list HTTP/1.1
Host: localhost:5000
Authorization: Bearer <TOKEN>
Content-Type: application/json

{
  "name": "Whole Milk",
  "quantity": 1,
  "unit": "bottle",
  "category": "dairy"
}
```

**Response (201 Created):**
```json
{
  "status": "success",
  "data": {
    "item": {
      "id": "72f1a9b2-1082-4217-a169-dc3079b764b8",
      "household_id": "hhhhhhhh-1111-2222-3333-444444444444",
      "name": "Whole Milk",
      "quantity": 1,
      "unit": "bottle",
      "category": "dairy",
      "is_purchased": false,
      "created_at": "2026-10-24T18:00:00.000Z"
    },
    "warnings": [
      {
        "type": "inventory_overbuy_warning",
        "message": "You currently have 2 bottle of 'Organic Whole Milk' stored in refrigerator (expires 2026-11-01).",
        "existing_item": {
          "id": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
          "name": "Organic Whole Milk",
          "quantity": 2,
          "unit": "bottle",
          "storage_location": "refrigerator",
          "expiry_date": "2026-11-01"
        }
      }
    ]
  }
}
```

---

### 2.4 Household Analytics (`/api/v1/analytics`)

- `GET /api/v1/analytics/waste?period=month`: Aggregate waste log for period with reasons and category breakdowns.
- `GET /api/v1/analytics/most-wasted?period=month`: Rank items by monetary cost and frequency, preserving units.
- `GET /api/v1/analytics/savings?period=month`: Avoided waste savings from recipe rescue and confirmed consumption.
- `GET /api/v1/analytics/monthly-comparison?month=2026-10`: Month-over-month absolute and percentage change with safe zero-baseline division.

---

### 2.5 AI Assistant Proxy (`POST /api/v1/assistant/chat`)

Forwards user chat messages along with current active pantry inventory to the FastAPI assistant endpoint.

**Request:**
```http
POST /api/v1/assistant/chat HTTP/1.1
Host: localhost:5000
Authorization: Bearer <TOKEN>
Content-Type: application/json

{
  "message": "What can I cook with ingredients expiring this week?",
  "include_inventory": true
}
```

**Response (200 OK):**
```json
{
  "status": "success",
  "data": {
    "reply": "You have eggs and ripe tomatoes approaching their shelf-life. A Shakshuka would be delicious!",
    "suggested_actions": ["Search Shakshuka Recipe", "Log Consumption"]
  }
}
```

---

### 2.6 User Profile (`/api/v1/profile`)

- `GET /api/v1/profile`: Returns safe profile (`id`, `name`, `email`, `role`, `avatar_url`, `preferences`). Strictly excludes `password_hash` and `token_version`.
- `PATCH /api/v1/profile`: Updates `name`, `avatar_url`, `preferences`. Rejects privilege escalation.

---

### 2.7 Household Settings (`/api/v1/household/settings`)

- `GET /api/v1/household/settings`: Returns household settings and member roster.
- `PATCH /api/v1/household/settings`: Restricted to household `owner` or `admin`. Regular `member` returns 403 Forbidden.

---

### 2.8 Device Pairing (`/api/v1/devices/pairing-token` & `/api/v1/devices/pair`)

- `POST /api/v1/devices/pairing-token`: Generates a cryptographically random, ephemeral 15-minute token (`PAIR-XXXXXXXX`).
- `POST /api/v1/devices/pair`: Consumes the token and registers the hardware sensor node under the household. Single-use enforcement prevents token replay.

---

## 3. Scheduled Intelligence Engine

### 3.1 Timing & Frequency
- Frequency: **Every 15 minutes** (configurable via `SCHEDULER_INTERVAL_MINUTES=15`).
- Control: Toggleable via `SCHEDULER_ENABLED=true/false`.
- Timezone: Evaluated against UTC ISO timestamps.

### 3.2 Concurrency & Overlap Prevention
- Managed by `SchedulerService.isRunning`.
- If a cycle is in progress when the next tick arrives, the cycle is safely skipped and logged.
- In multi-replica environments, a distributed lock (e.g., Redis or PostgreSQL advisory lock `pg_try_advisory_lock`) should be configured if the scheduler is run on multiple worker instances.

### 3.3 Intelligence Workflow
1. Iterates over all households independently.
2. For each household:
   - Queries active inventory items from `inventory_items` (`status = 'active'`).
   - Retrieves the latest sensor reading from `sensor_readings` (temperature, humidity).
   - Retrieves the latest vision scan from `freshness_scans` if available.
   - Calls `/shelf-life/estimate` and `/use-first/score`.
   - Updates `adj_days_left`, `use_first_score`, `freshness_bucket`, and `last_intelligence_at`.
3. If an item crosses risk thresholds into `use_soon` or `critical`, a household notification is created.
4. Alerts are deduplicated within a 2-hour cooldown window.

---

## 4. Threshold & Freshness Bucket Definitions

| Freshness Bucket | Criteria | Severity |
| :--- | :--- | :--- |
| `expired` | `adj_days_left <= 0` or calendar expiry passed | Urgent |
| `critical` | `adj_days_left <= 2.0` OR `use_first_score >= 80` | Critical |
| `use_soon` | `adj_days_left <= 4.0` OR `use_first_score >= 70` | Warning |
| `fresh` | All other active inventory | Normal |

---

## 5. Avoided-Waste Calculation Logic

Avoided waste is only logged when:
1. The consumed item is verified to have been at risk (`use_first_score >= 70`, `adj_days_left <= 2.0`, or bucket is `critical`/`use_soon`).
2. The item has a valid, non-null `estimated_unit_price`.

**Formula:**
$$\text{Estimated Savings} = \text{Consumed Quantity} \times \text{Estimated Unit Price}$$

Recorded in `avoided_waste_log` and linked to the recipe name and source.

---

## 6. Required Database Changes (Manual Execution)

All SQL statements are consolidated in `docs/phase4-database-schema.sql`.

**Execution Steps in Supabase Dashboard:**
1. Open **Supabase Dashboard** -> **SQL Editor**.
2. Open or paste `docs/phase4-database-schema.sql`.
3. Execute the script.

**Summary of Created Structures:**
- `inventory_items`: Added `adj_days_left`, `use_first_score`, `freshness_bucket`, `last_intelligence_at`.
- `shopping_list_items`: Table with duplicate and purchase tracking.
- `avoided_waste_log`: Table tracking monetary savings from at-risk food consumption.
- `device_pairing_tokens`: Ephemeral 15-minute token storage for hardware pairing.
- `households.settings`: JSONB column for household preferences.
- `users.avatar_url` & `users.preferences`: Profile personalization columns.
- Triggers and RLS policies for `service_role`.

---

## 7. Environment Variables Configuration

Add the following placeholders to `.env`:

```env
# Phase 4 - Background Scheduler
SCHEDULER_ENABLED=true
SCHEDULER_INTERVAL_MINUTES=15

# Phase 4 - Intelligence Thresholds
USE_FIRST_ALERT_THRESHOLD=70
SHELF_LIFE_ALERT_THRESHOLD_DAYS=2.0
```

---

## 8. Postman Testing Guide

1. **Authenticate:** `POST /api/v1/auth/signin` to receive bearer token.
2. **Test Recipe Rescue:** Send `GET /api/v1/recipes/rescue`. Verify recipes return prioritized ingredients.
3. **Test Multi-Item Consumption:** Send `POST /api/v1/inventory/use-ingredients` with inventory IDs. Confirm stock decrements and `total_avoided_savings` is computed.
4. **Test Shopping List:** Send `POST /api/v1/shopping-list` with a product name matching an active pantry item. Verify the `inventory_overbuy_warning` appears.
5. **Test Analytics:** Send `GET /api/v1/analytics/monthly-comparison`. Check that month-over-month differences calculate without error.
6. **Test Assistant Proxy:** Send `POST /api/v1/assistant/chat` with `{"message": "Hello"}`. Check AI response structure.
7. **Test Device Pairing:** Send `POST /api/v1/devices/pairing-token` to obtain code, then `POST /api/v1/devices/pair` to pair.
