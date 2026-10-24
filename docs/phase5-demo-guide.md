# SaveBite — Phase 5 End-to-End Demo Verification Guide

This runbook details a complete, step-by-step verification flow for the SaveBite platform covering all 15 operational capabilities across Phases 1 through 5. Every scenario is executable using standard `curl` commands or any REST client (e.g., Postman / Insomnia).

---

## Prerequisites & Base URL

- **Backend Base URL:** `http://localhost:5000/api/v1`
- **Authentication:** Custom JWT Bearer tokens passed via header: `Authorization: Bearer <TOKEN>`
- **Content Type:** `application/json` (except file uploads which use `multipart/form-data`)

---

## Scenario 1: User Signup and Household Initialization

Register a new household chef. The backend provisions both the user and a dedicated household with `owner` role atomically.

```bash
curl -X POST http://localhost:5000/api/v1/auth/signup \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Chef Demo",
    "email": "demo.chef@savebite.com",
    "password": "Password123!"
  }'
```

**Expected Response (HTTP 201):**
```json
{
  "status": "success",
  "data": {
    "user": {
      "id": "USER_UUID",
      "name": "Chef Demo",
      "email": "demo.chef@savebite.com",
      "role": "user"
    },
    "household": {
      "id": "HOUSEHOLD_UUID",
      "name": "Chef Demo's Household",
      "role": "owner"
    },
    "accessToken": "eyJhbGciOi..."
  }
}
```
> **Tip:** Export the token for subsequent requests:  
> `export TOKEN="eyJhbGciOi..."`

---

## Scenario 2: Household-Scoped Inventory Management

Create a new perishable inventory item in the refrigerator.

```bash
curl -X POST http://localhost:5000/api/v1/inventory \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Organic Whole Milk",
    "category": "dairy",
    "quantity": 1,
    "unit": "bottle",
    "storage_location": "refrigerator",
    "purchase_date": "2026-10-24",
    "expiry_date": "2026-10-27",
    "estimated_unit_price": 4.29,
    "currency": "USD"
  }'
```

**List active inventory items:**
```bash
curl -X GET "http://localhost:5000/api/v1/inventory?status=active&location=refrigerator" \
  -H "Authorization: Bearer $TOKEN"
```

**Expected Response (HTTP 200):**
```json
{
  "status": "success",
  "data": {
    "items": [
      {
        "id": "ITEM_UUID",
        "name": "Organic Whole Milk",
        "category": "dairy",
        "storage_location": "refrigerator",
        "status": "active"
      }
    ],
    "pagination": { "page": 1, "total": 1 }
  }
}
```

---

## Scenario 3: Device Registration (IoT Node)

Register an ESP32 sensor hub monitoring the refrigerator.

```bash
curl -X POST http://localhost:5000/api/v1/devices \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Kitchen Fridge Sensor Hub",
    "device_code": "ESP32-KITCHEN-FRIDGE-01",
    "device_type": "esp32",
    "zone": "refrigerator",
    "source_type": "simulator"
  }'
```

**Expected Response (HTTP 201):**
```json
{
  "status": "success",
  "data": {
    "device": {
      "id": "DEVICE_UUID",
      "device_code": "ESP32-KITCHEN-FRIDGE-01",
      "zone": "refrigerator",
      "source_type": "simulator"
    }
  }
}
```

---

## Scenario 4: Simulator Telemetry Ingestion (HTTP)

Ingest real-time telemetry from the simulator node. Notice `source_type: "simulator"`.

```bash
curl -X POST http://localhost:5000/api/v1/telemetry \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "device_code": "ESP32-KITCHEN-FRIDGE-01",
    "source_type": "simulator",
    "readings": {
      "temperature_c": 3.8,
      "humidity_percent": 64.5,
      "air_quality_raw": 145.0,
      "air_quality_unit": "raw"
    },
    "metadata": {
      "battery_level": 94,
      "firmware_version": "1.2.0-sim"
    }
  }'
```

**Expected Response (HTTP 201):**
```json
{
  "status": "success",
  "data": {
    "reading": {
      "id": "READING_UUID",
      "temperature_c": 3.8,
      "humidity_percent": 64.5,
      "air_quality_raw": 145.0,
      "source_type": "simulator"
    }
  }
}
```

---

## Scenario 5: Historical Sensor Readings Query

Query historical telemetry for the device:

```bash
curl -X GET "http://localhost:5000/api/v1/devices/DEVICE_UUID/readings?limit=10" \
  -H "Authorization: Bearer $TOKEN"
```

**Expected Response (HTTP 200):**
```json
{
  "status": "success",
  "data": {
    "readings": [
      {
        "id": "READING_UUID",
        "temperature_c": 3.8,
        "humidity_percent": 64.5,
        "source_type": "simulator",
        "recorded_at": "2026-10-24T..."
      }
    ],
    "count": 1
  }
}
```

---

## Scenario 6: Temperature Alert Notification Trigger

Simulate an elevated temperature spike (e.g. door left ajar causing 9.5°C in refrigerator):

```bash
curl -X POST http://localhost:5000/api/v1/telemetry \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "device_code": "ESP32-KITCHEN-FRIDGE-01",
    "source_type": "simulator",
    "readings": {
      "temperature_c": 9.5,
      "humidity_percent": 78.0,
      "air_quality_raw": 380.0
    }
  }'
```

**Check generated household notifications:**
```bash
curl -X GET http://localhost:5000/api/v1/notifications \
  -H "Authorization: Bearer $TOKEN"
```

**Expected Response (HTTP 200):**
```json
{
  "status": "success",
  "data": {
    "notifications": [
      {
        "id": "NOTIF_UUID",
        "type": "threshold_alert",
        "severity": "warning",
        "title": "Elevated Temperature Alert",
        "is_read": false
      }
    ]
  }
}
```

---

## Scenario 7: Scheduled Intelligence Execution

Manually trigger an intelligence cycle to update Use-First risk priorities and dynamic freshness buckets:

```bash
curl -X POST http://localhost:5000/api/v1/scheduler/run-cycle \
  -H "Authorization: Bearer $TOKEN"
```

**Expected Response (HTTP 200):**
```json
{
  "status": "success",
  "message": "Intelligence cycle completed successfully",
  "data": {
    "householdsEvaluated": 1,
    "itemsUpdated": 1,
    "alertsDispatched": 0
  }
}
```

---

## Scenario 8: Inventory Consumption and Waste Logging

Mark an item partially or fully consumed:

```bash
curl -X POST http://localhost:5000/api/v1/inventory/ITEM_UUID/consume \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "quantity": 1
  }'
```

Or log spoilage to the household waste log:
```bash
curl -X POST http://localhost:5000/api/v1/inventory/ITEM_UUID/waste \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "quantity": 1,
    "reason": "expired"
  }'
```

**Expected Response (HTTP 200):**
```json
{
  "status": "success",
  "message": "Item marked as waste and recorded in log"
}
```

---

## Scenario 9: Smart Shopping List Operations

Add an item to the shopping list:

```bash
curl -X POST http://localhost:5000/api/v1/shopping-list \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Eggs (12 pack)",
    "quantity": 1,
    "unit": "pack",
    "category": "dairy"
  }'
```

Mark item as purchased:
```bash
curl -X POST http://localhost:5000/api/v1/shopping-list/SHOPPING_ITEM_UUID/purchase \
  -H "Authorization: Bearer $TOKEN"
```

---

## Scenario 10: Waste Analytics & Estimated Cost Savings

Retrieve household waste metrics and avoided waste savings:

```bash
curl -X GET "http://localhost:5000/api/v1/analytics/waste?period=month" \
  -H "Authorization: Bearer $TOKEN"
```

**Expected Response (HTTP 200):**
```json
{
  "status": "success",
  "data": {
    "period": "month",
    "total_items_wasted": 1,
    "total_estimated_value": 4.29,
    "reasons_breakdown": {
      "expired": 1
    }
  }
}
```

---

## Scenario 11: Receipt Upload & AI Parser Confirmation

Upload receipt image (JPEG, PNG, or PDF):

```bash
curl -X POST http://localhost:5000/api/v1/receipts/upload \
  -H "Authorization: Bearer $TOKEN" \
  -F "receipt=@/path/to/grocery_receipt.jpg"
```

Trigger AI parser:
```bash
curl -X POST http://localhost:5000/api/v1/receipts/RECEIPT_UUID/parse \
  -H "Authorization: Bearer $TOKEN"
```

Confirm an extracted line item into active inventory:
```bash
curl -X POST http://localhost:5000/api/v1/receipts/RECEIPT_UUID/items/LINE_UUID/confirm \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "item_name": "Organic Spinach",
    "category": "produce",
    "quantity": 1,
    "unit": "bag",
    "storage_location": "refrigerator"
  }'
```

---

## Scenario 12: Barcode Lookup

Query product metadata via barcode (integrated with OpenFoodFacts with graceful offline fallback):

```bash
curl -X GET http://localhost:5000/api/v1/barcodes/3017620422003 \
  -H "Authorization: Bearer $TOKEN"
```

**Expected Response (HTTP 200):**
```json
{
  "status": "success",
  "data": {
    "barcode": "3017620422003",
    "name": "Nutella",
    "brand": "Ferrero",
    "category": "pantry"
  }
}
```

---

## Scenario 13: Camera Freshness Scan

Upload a photo of an active inventory item to trigger visual freshness assessment:

```bash
curl -X POST http://localhost:5000/api/v1/inventory/ITEM_UUID/freshness-scan \
  -H "Authorization: Bearer $TOKEN" \
  -F "image=@/path/to/avocado.jpg"
```

**Expected Response (HTTP 200):**
```json
{
  "status": "success",
  "data": {
    "freshness_bucket": "use_soon",
    "confidence": 0.88,
    "visual_cues": ["slight browning", "soft texture detected"],
    "recommendation": "Consume within 48 hours or freeze."
  }
}
```

---

## Scenario 14: AI Recipe Rescue & Assistant Proxy

Request AI-generated recipes that prioritize using at-risk ingredients before they expire:

```bash
curl -X GET http://localhost:5000/api/v1/recipes/rescue \
  -H "Authorization: Bearer $TOKEN"
```

Chat with the SaveBite culinary & waste assistant:
```bash
curl -X POST http://localhost:5000/api/v1/assistant/chat \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "message": "What should I cook tonight with my milk and spinach?"
  }'
```

**Expected Response (HTTP 200):**
```json
{
  "status": "success",
  "data": {
    "reply": "You can prepare a creamy spinach soup or a quick spinach frittata!",
    "suggested_actions": ["Log spinach consumption", "View frittata recipe"]
  }
}
```

---

## Scenario 15: Cross-Household Isolation & Security Verification

Authenticate as User A, then attempt to access or modify resources belonging to Household B:

```bash
# Attempt to access User B's device using User A's token:
curl -X GET http://localhost:5000/api/v1/devices/USER_B_DEVICE_UUID \
  -H "Authorization: Bearer $TOKEN_A"
```

**Expected Response (HTTP 404):**
```json
{
  "status": "error",
  "message": "Device not found",
  "error": {
    "code": "NOT_FOUND",
    "message": "Device not found",
    "details": null
  }
}
```

```bash
# Attempt to ingest telemetry into User B's device code using User A's token:
curl -X POST http://localhost:5000/api/v1/telemetry \
  -H "Authorization: Bearer $TOKEN_A" \
  -H "Content-Type: application/json" \
  -d '{
    "device_code": "USER-B-DEVICE-CODE",
    "source_type": "simulator",
    "readings": { "temperature_c": 5.0 }
  }'
```

**Expected Response (HTTP 403):**
```json
{
  "status": "error",
  "message": "Device does not belong to this household",
  "error": {
    "code": "FORBIDDEN_DEVICE",
    "message": "Device does not belong to this household",
    "details": null
  }
}
```
