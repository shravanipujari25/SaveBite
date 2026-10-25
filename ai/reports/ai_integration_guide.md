# SaveBite AI Module — Integration Guide

Practical integration documentation for **Frontend**, **Backend**, and **IoT/Hardware** teams connecting to the SaveBite AI subsystem.

---

## A. AI Module Overview

### System Purpose
The SaveBite AI module provides stateless, deterministic, and ML-assisted grocery intelligence for food-waste reduction:
1. **Catalog Resolution & Normalization**: Maps unstructured grocery descriptions to canonical products.
2. **Shelf-Life Estimation**: Calculates storage life, expiry dates, and conditions using baseline rules and storage environments.
3. **Use-First Priority Scoring**: Generates explainable priority scores (0–100) and traffic-light categories (Red, Orange, Yellow, Green, Black).
4. **IoT Environmental Monitoring**: Evaluates temperature, humidity, door events, power cuts, and gas/VOC telemetry for anomalies.
5. **Duplicate-Purchase Prevention**: Checks proposed purchases against recorded inventory to suggest reductions or avoid unnecessary buys.
6. **Inventory-Aware Recipe Recommendations**: Ranks recipes prioritizing ingredients nearing expiration.
7. **Vision Intelligence**: Classifies grocery products and estimates visible surface decay (apple, banana, orange).

### Responsibilities: AI Subsystem vs Backend
| Responsibility | Owned by AI Subsystem | Owned by Backend / Application |
|---|---|---|
| **Inventory Persistence** | ❌ None (stateless, request-scoped) | ✅ Database storage, user inventories, historical logs |
| **Authentication & Auth** | ❌ None (internal microservice) | ✅ JWT, API tokens, user authorization, rate limiting |
| **Hardware Telemetry** | ❌ Receives formatted JSON batches | ✅ MQTT/HTTP broker, hardware ingestion, sensor time-series DB |
| **Image Storage** | ❌ Processes bytes in memory | ✅ S3/Blob storage, CDN, image archiving |
| **Decision Disclaimers** | ✅ Generates explainable warnings | ✅ Displays disclaimers to end users before action |

---

## B. Setup & Startup Instructions

### Prerequisites
- **Python**: 3.12 (tested on 3.12.4)
- **Virtual Environment**: Recommended inside `ai/.venv`

### Installation
```bash
cd ai
python -m venv .venv
# Windows:
.\.venv\Scripts\activate
# Linux/macOS:
source .venv/bin/activate

pip install -r requirements.txt
```

### Application Startup
```bash
# Development server (FastAPI with Uvicorn):
uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload
```
- **Local Base URL**: `http://127.0.0.1:8000`
- **Interactive Swagger Docs**: `http://127.0.0.1:8000/docs`
- **OpenAPI Schema**: `http://127.0.0.1:8000/openapi.json`

---

## C. Verified Endpoint Reference

The AI service exposes **10 HTTP endpoints**.

### 1. `GET /health`
- **Purpose**: Liveness and service identity check.
- **Request Parameters**: None.
- **Example Response (200 OK)**:
```json
{
  "status": "healthy",
  "service": "SaveBite AI Service",
  "version": "0.1.0"
}
```

---

### 2. `GET /products/{product_name}`
- **Purpose**: Look up canonical product metadata and baseline storage shelf-life.
- **Path Parameter**: `product_name` (e.g., `Milk`, `banana`, `whole_milk`).
- **Example Response (200 OK)**:
```json
{
  "product_id": "GRC016",
  "product_name": "Milk",
  "category": "Dairy",
  "base_shelf_life_days": 7,
  "storage_zone": "refrigerator",
  "opened_shelf_life_days": 5,
  "sensitivity": "high",
  "source": "https://www.foodsafety.gov/keep-food-safe/foodkeeper-app"
}
```
- **Error (404 Not Found)**:
```json
{
  "detail": "Product 'unknown_item' not found in catalog."
}
```

---

### 3. `POST /shelf-life/estimate`
- **Purpose**: Calculate remaining shelf life for a grocery item under specific storage conditions.
- **Request Body**:
```json
{
  "product_name": "Milk",
  "storage_zone": "refrigerator",
  "purchase_date": "2026-10-20",
  "opened": false,
  "storage_temperature_c": 3.5,
  "package_use_by_date": null,
  "as_of_date": "2026-10-25"
}
```
- **Example Response (200 OK)**:
```json
{
  "product_name": "Milk",
  "product_found": true,
  "estimated_end_date": "2026-10-27",
  "estimated_remaining_days": 2,
  "reference_shelf_life_days": 7,
  "storage_zone": "refrigerator",
  "storage_advice": "Store in refrigerator below 4°C.",
  "reliability": "high",
  "warnings": []
}
```

---

### 4. `POST /priority/score`
- **Purpose**: Score and rank grocery items by Use-First urgency.
- **Request Body**:
```json
{
  "items": [
    {
      "item_id": "ITEM-1",
      "product_name": "Milk",
      "purchase_date": "2026-10-20",
      "opened": false,
      "storage_zone": "refrigerator",
      "as_of_date": "2026-10-25",
      "freshness_override": false
    }
  ]
}
```
- **Example Response (200 OK)**:
```json
{
  "as_of_date": "2026-10-25",
  "scored_items": [
    {
      "item_id": "ITEM-1",
      "product_name": "Milk",
      "product_found": true,
      "rank": 1,
      "score": 67.86,
      "priority_category": "Orange",
      "estimated_remaining_days": 2,
      "reference_shelf_life_days": 7,
      "urgency_ratio": 0.714,
      "warnings": [],
      "explanation": "2 day(s) of estimated storage life remaining. Approximately 71% of reference shelf life elapsed. Priority category: 'Orange' (score 67.9/100).",
      "shelf_life_reliability": "high",
      "unavailability_reason": null
    }
  ],
  "unscorable_items": [],
  "weights_used": {
    "urgency": 55.0,
    "sensitivity": 20.0,
    "warnings": 15.0,
    "freshness_penalty": 10.0
  }
}
```

---

### 5. `POST /recipes/recommend`
- **Purpose**: Suggest recipes utilizing items currently in inventory, prioritizing those nearing expiry.
- **Request Body**:
```json
{
  "inventory": [
    {
      "inventory_item_id": "INV-1",
      "product_name": "Milk",
      "quantity": 1.0,
      "unit": "l",
      "purchase_date": "2026-10-20",
      "opened": false
    }
  ],
  "limit": 5,
  "as_of_date": "2026-10-25"
}
```
- **Example Response (200 OK)**:
```json
{
  "recommendations": [
    {
      "recipe_id": "REC-001",
      "recipe_name": "Creamy Oatmeal",
      "score": 75.0,
      "matching_ingredients": ["Milk"],
      "missing_ingredients": ["Rolled Oats", "Honey"],
      "instructions": "Simmer oats in milk until creamy..."
    }
  ],
  "total_evaluated": 12
}
```

---

### 6. `POST /grocery/analyze` (Unified Master Orchestration)
- **Purpose**: Master endpoint coordinating catalog lookup, shelf life, priority ranking, duplicate purchase checks, sensor telemetry evaluation, and recipe generation.
- **Request Body**:
```json
{
  "inventory": [
    {
      "inventory_item_id": "INV-001",
      "product_name": "Banana",
      "quantity": 3.0,
      "unit": "piece",
      "purchase_date": "2026-10-21",
      "opened": false,
      "storage_zone": "pantry"
    }
  ],
  "proposed_purchases": [
    {
      "purchase_item_id": "PUR-001",
      "product_name": "Banana",
      "quantity": 6.0,
      "unit": "piece"
    }
  ],
  "sensor_readings": [
    {
      "reading_id": "SEN-R1",
      "sensor_id": "PANTRY-01",
      "storage_zone": "pantry",
      "timestamp": "2026-10-25T10:00:00Z",
      "temperature_c": 22.0,
      "humidity_percent": 55.0,
      "gas_ppm": 15.0,
      "simulated": true
    }
  ],
  "freshness_overrides": {
    "INV-001": "visibly_spoiled"
  },
  "freshness_confidence": {
    "INV-001": 0.85
  },
  "as_of_date": "2026-10-25"
}
```
- **Response Structure (200 OK)**:
Returns `overall_status`, `inventory_summary`, `product_resolutions`, `shelf_life_estimates`, `priority_scores`, `sensor_analysis`, `duplicate_purchase_analysis`, and `recipe_recommendations`.

---

### 7. `POST /vision/identify`
- **Purpose**: Extract features from image and identify likely grocery product.
- **Content-Type**: `multipart/form-data`
- **Form Field**: `file` (Binary image; JPEG, PNG, or WEBP; ≤ 5MB).
- **Example Response (200 OK)**:
```json
{
  "identified_product_name": "Banana",
  "matched_product_id": "GRC002",
  "category": "Fruit",
  "confidence": 0.82,
  "is_confident": true,
  "requires_confirmation": false,
  "top_candidates": [
    {"product_name": "Banana", "confidence": 0.82},
    {"product_name": "Lemon", "confidence": 0.45}
  ],
  "disclaimer": "Product identification only; does not evaluate freshness or food safety."
}
```

---

### 8. `POST /vision/assess-freshness`
- **Purpose**: Classify visible decay into `fresh`, `ripe`, `visibly_spoiled`, or `uncertain`.
- **Content-Type**: `multipart/form-data`
- **Form Fields**:
  - `file` (Binary image; JPEG, PNG, WEBP; ≤ 5MB)
  - `product_hint` (Optional string: `"apple"`, `"banana"`, `"orange"`, `"lemon"`, `"tomato"`)
- **Example Response (200 OK)**:
```json
{
  "product_category": "banana",
  "condition": "ripe",
  "confidence": 0.884,
  "is_confident": true,
  "requires_confirmation": false,
  "class_probabilities": {
    "fresh": 0.051,
    "ripe": 0.884,
    "visibly_spoiled": 0.065
  },
  "model_version": "savebite-freshness-v1.0.0",
  "image_metadata": {
    "format": "JPEG",
    "width": 640,
    "height": 480,
    "file_size_bytes": 45120
  },
  "message": "Visible condition assessed as 'ripe' with 88.4% confidence."
}
```

---

### 9. `POST /vision/analyze` (Combined Vision Workflow)
- **Purpose**: One-stop image upload performing identification + freshness assessment and building the `orchestration_hint`.
- **Content-Type**: `multipart/form-data`
- **Form Field**: `file` (Binary image; ≤ 5MB).
- **Example Response (200 OK)**:
```json
{
  "identification": {
    "identified_product_name": "Banana",
    "confidence": 0.82,
    "is_confident": true,
    "requires_confirmation": false
  },
  "freshness": {
    "condition": "visibly_spoiled",
    "confidence": 0.91,
    "is_confident": true,
    "requires_confirmation": false
  },
  "freshness_skipped_reason": null,
  "orchestration_hint": {
    "suggested_product_name": "Banana",
    "requires_confirmation": false,
    "freshness_condition": "visibly_spoiled",
    "freshness_confidence": 0.91,
    "freshness_is_confident": true,
    "freshness_requires_confirmation": false
  },
  "disclaimer": "Image analysis provides estimates of visible surface condition only. It does not assess microbiological safety..."
}
```

---

### 10. `POST /sensors/analyze`
- **Purpose**: Batch evaluation of IoT readings for zone threshold breaches and sequential anomalies.
- **Request Body**:
```json
{
  "readings": [
    {
      "reading_id": "R1",
      "sensor_id": "FRIDGE-01",
      "storage_zone": "refrigerator",
      "timestamp": "2026-10-25T10:00:00Z",
      "temperature_c": 8.5,
      "humidity_percent": 75.0,
      "gas_ppm": 120.0,
      "voc_index": 280.0,
      "simulated": true
    }
  ]
}
```
- **Example Response (200 OK)**:
```json
{
  "as_of": "2026-10-25T10:00:00Z",
  "total_readings": 1,
  "valid_readings": 1,
  "invalid_readings": 0,
  "overall_status": "warning",
  "active_alerts": [
    {
      "alert_id": "ALT-R1-TEMP-HIGH",
      "sensor_id": "FRIDGE-01",
      "storage_zone": "refrigerator",
      "alert_type": "high_temperature",
      "severity": "warning",
      "message": "Observed temperature (8.5°C) exceeded configured maximum (4.0°C).",
      "observed_value": 8.5,
      "threshold": 4.0,
      "simulated": true
    }
  ],
  "results_by_reading": [...]
}
```

---

## D. Frontend Integration Notes

1. **User Confirmation on Low Confidence**:
   - When `identification.requires_confirmation == true` (confidence < 0.65), prompt the user: *"We detected Banana (54% confidence). Is this correct?"* with an edit option.
2. **Freshness Assessment Display**:
   - Display predicted condition (`fresh`, `ripe`, `visibly_spoiled`) with appropriate badge colors.
   - For `uncertain`, prompt the user to manually select the condition.
3. **Disclaimers**:
   - Always display the disclaimer alongside freshness results: *"Visual condition estimation only. Does not replace smell, touch, or manufacturer expiry dates."*
4. **Use-First Priority Colors**:
   - **Red (Score ≥ 80)**: Urgent — consume today or discard.
   - **Orange (Score 60–79)**: High priority — consume within 1–2 days.
   - **Yellow (Score 35–59)**: Moderate priority.
   - **Green (Score < 35)**: Low priority / stable.
   - **Black (None)**: Unrecognized product or unscoreable item.

---

## E. Backend Integration Notes

1. **Vision-to-Orchestration Data Flow**:
   - Call `POST /vision/analyze`.
   - Take `response.orchestration_hint.freshness_condition` and `freshness_confidence`.
   - Pass them directly to `POST /grocery/analyze` inside `freshness_overrides` and `freshness_confidence`:
   ```python
   orchestration_payload = {
       "inventory": user_inventory,
       "freshness_overrides": {
           item_id: vision_res["orchestration_hint"]["freshness_condition"]
       },
       "freshness_confidence": {
           item_id: vision_res["orchestration_hint"]["freshness_confidence"]
       }
   }
   ```
2. **Freshness Override Policy**:
   - The AI module **strictly requires** `freshness_condition == "visibly_spoiled"` **AND** `confidence >= 0.60` before applying the spoilage score penalty.
   - Submitting `fresh`, `ripe`, `uncertain`, or confidence `< 0.60` will safely be ignored without errors.
3. **Storage & Statelessness**:
   - The AI service stores **nothing**. Every request must include the full contextual inventory.

---

## F. IoT Integration Notes

1. **Telemetry Fields**:
   - `temperature_c`: Celsius float.
   - `humidity_percent`: 0.0 to 100.0 float.
   - `door_open`: boolean.
   - `power_cut_hours`: elapsed power interruption hours.
   - `gas_ppm`: calibrated multi-gas sensor reading (≥ 0.0).
   - `voc_index`: dimensionless VOC index (0–500, e.g., Sensirion SGP40/41).
   - `ethylene_ppm`: dedicated C2H4 sensor reading (≥ 0.0). Do NOT populate from generic VOC sensors!
   - `simulated`: Must be `true` for all test/synthetic telemetry.
2. **Sustained Anomaly Detection**:
   - Consecutive threshold breaches (default 3 readings) trigger `sustained_abnormal_temperature`, `sustained_high_gas_ppm`, and `sustained_high_voc_index`.
   - Note: Sustained anomaly detection for `ethylene_ppm` is not implemented; it triggers point-in-time alerts only.
3. **Development Defaults**:
   - Thresholds are illustrative development guidelines, not certified commercial food-safety limits.

---

## G. Confidence & Safety Limitations

1. **Freshness Classifier Scope**:
   - **Formally Trained & Evaluated (Phase 11)**: `Apple`, `Banana`, `Orange`.
   - **Experimental / Heuristic Hints**: `Lemon`, `Tomato`.
   - Unsupported products are automatically returned as `condition: "uncertain"`.
2. **No Pathogen Detection**:
   - Surface color and texture analysis cannot detect bacterial pathogens (e.g., *Salmonella*, *E. coli*, *Listeria*), viral contamination, or internal rot.

---

## H. Known Limitations & Future Work

1. **No Built-in Authentication**: API is designed for internal network deployment. API Gateway or reverse-proxy authentication must be applied before public exposure.
2. **Double Image Decoding**: `POST /vision/analyze` decodes image bytes independently in identification and freshness services. Overhead is minimal (<25ms).
3. **No Sustained Ethylene Tracking**: Point-in-time ethylene breaches trigger alerts, but sequential consecutive breach tracking is not implemented.
4. **Item-Level Sensor Association**: Sensor alerts are aggregated at the storage-zone level (`refrigerator`, `pantry`), not associated with specific grocery items.
