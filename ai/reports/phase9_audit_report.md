# Phase 9: Audit and Gap Analysis Report

**Date:** 2026-10-25  
**Project:** SaveBite AI — Grocery Intelligence and Food-Waste Management System  
**Module:** `ai/`  
**Verdict:** **AUDIT COMPLETED**

---

## 1. Executive Summary

This report delivers a comprehensive audit and gap analysis of the SaveBite AI subsystem (`ai/`) across Phases 1 through 8. The existing codebase comprises a FastAPI application, an in-memory product catalog, a shelf-life estimation service, a multi-factor Use-First priority scoring engine, synthetic IoT sensor telemetry intelligence, duplicate-purchase detection, recipe recommendation intelligence, and a master unified grocery orchestration endpoint (`POST /grocery/analyze`).

The audit verified that **all 216 existing automated tests pass with 0 failures**. However, critical functional gaps exist regarding computer vision (image product identification and freshness classification), gas sensor monitoring (e.g. MQ-4, MQ-135, or volatile organic compounds / ethylene), and the direct ingestion of vision/environmental signals into priority scoring.

---

## 2. Feature-by-Feature Status Matrix

| Feature / Capability | Status | Evidence (Files, Functions, Tests) | Description & Findings |
| :--- | :--- | :--- | :--- |
| **FastAPI Foundation & Health** | **Completed** | `app/main.py`<br>`GET /health`<br>`tests/test_health.py` | FastAPI app with title, version, tags, and healthy status endpoint. |
| **Grocery Product Catalog & Name Normalization** | **Completed** | `app/services/product_catalog.py`<br>`app/data/products.csv`<br>`GET /products/{product_name}`<br>`tests/test_product_catalog.py` | In-memory catalog (40 items), aliases, normalized string lookups, plural/singular stemming, storage zones, base shelf-life. |
| **Text-Based Grocery Entry** | **Completed** | `app/services/duplicate_purchase_service.py` (`InventoryItem`, `ProposedPurchaseItem`)<br>`app/services/grocery_orchestration_service.py` | Full text/JSON schema support for entering product names, quantities, units, purchase dates, expiry dates, and opened flags. |
| **Shelf-Life Estimation Engine** | **Completed** | `app/services/shelf_life_service.py`<br>`POST /shelf-life/estimate`<br>`tests/test_shelf_life_service.py` | Rule-based estimation factoring catalog baselines, storage zones, temperature, opened status, and user package expiry dates. |
| **Use-First Priority Scoring Engine** | **Completed** | `app/services/priority_scoring.py`<br>`POST /priority/score`<br>`tests/test_priority_scoring.py` | Multi-factor explainable scoring (Urgency 55%, Perishability 20%, Storage Warnings 15%, Freshness penalty 10%). Red/Orange/Yellow/Green/Black categories. |
| **Simulated Sensor Analysis** | **Completed (Partial Scope)** | `app/services/sensor_service.py`<br>`app/data/sample_sensor_data.json`<br>`tests/test_sensor_service.py` | Rule-based evaluation of synthetic temperature, humidity, door-open duration, and power cuts across refrigerator, freezer, and pantry. |
| **Gas Sensor Monitoring** | **Missing** | `app/services/sensor_service.py` | No fields, thresholds, or alert rules exist for gas sensors (VOC, ethylene, methane, CO2, ammonia). |
| **Duplicate-Purchase Detection** | **Completed** | `app/services/duplicate_purchase_service.py`<br>`tests/test_duplicate_purchase_service.py` | Unit conversions (mass, volume, count), stock availability checks, and purchase recommendations (`avoid_purchase`, `reduce_quantity`, etc.). |
| **Recipe Recommendation Intelligence** | **Completed** | `app/services/recipe_recommendation_service.py`<br>`app/data/sample_recipes.json`<br>`POST /recipes/recommend`<br>`tests/test_recipe_recommendation_service.py` | 25 curated recipes; prioritized by required ingredient match, near-expiry ingredients, and Use-First priority bonus. |
| **Unified Orchestration Endpoint** | **Completed** | `app/services/grocery_orchestration_service.py`<br>`POST /grocery/analyze`<br>`tests/test_grocery_orchestration_service.py` | End-to-end coordination returning product resolutions, shelf-life estimates, priority scores, sensor telemetry alerts, duplicate purchase checks, and recipes. |
| **Image-Based Product Identification** | **Missing** | N/A | No image upload schemas, computer vision models, or OCR/classification pipelines exist in the repository. |
| **Image-Based Freshness Classification** | **Missing** | N/A | No trained machine learning models, weights (`.onnx`, `.pt`, `.h5`, `.joblib`), or image evaluation pipelines exist. |
| **Cross-Module Sensor/Vision Integration** | **Partial** | `app/services/grocery_orchestration_service.py`<br>`app/services/priority_scoring.py` | Sensor alerts are returned side-by-side in `UnifiedAnalyzeResponse`, but anomalous sensor alerts do not automatically adjust `storage_zone_warnings` or Use-First scores. Priority scoring has a boolean `freshness_override` parameter, but it is not exposed in `InventoryItem` or `UnifiedAnalyzeRequest`. |

---

## 3. Test Suite Verification & Baseline

Execution command:
```powershell
.\.venv\Scripts\pytest.exe -v
```
**Results:**
- Total tests collected: **216**
- Passed: **216**
- Failed: **0**
- Warnings: **1** (Starlette/httpx testclient deprecation warning)
- Execution time: **1.24s**

---

## 4. Current API Schemas (`POST /grocery/analyze`)

### Request Schema (`UnifiedAnalyzeRequest`)
```json
{
  "inventory": [
    {
      "inventory_item_id": "string",
      "product_id": "string (optional)",
      "product_name": "string (required)",
      "quantity": 1.0,
      "unit": "string (required: kg, g, l, ml, unit, etc.)",
      "purchase_date": "YYYY-MM-DD (optional)",
      "expiry_date": "YYYY-MM-DD (optional)",
      "estimated_expiry_date": "YYYY-MM-DD (optional)",
      "opened": false,
      "status": "available | consumed | discarded | expired",
      "simulated": true
    }
  ],
  "proposed_purchases": [
    {
      "product_id": "string (optional)",
      "product_name": "string (required)",
      "requested_quantity": 1.0,
      "unit": "string (required)"
    }
  ],
  "sensor_readings": [
    {
      "reading_id": "string (required)",
      "sensor_id": "string (required)",
      "storage_zone": "refrigerator | freezer | pantry",
      "timestamp": "ISO 8601 string",
      "temperature_c": 4.0,
      "humidity_percent": 65.0,
      "door_open": false,
      "power_cut_hours": 0.0,
      "simulated": true
    }
  ],
  "include_recipes": true,
  "recipe_limit": 5,
  "as_of_date": "YYYY-MM-DD (optional)"
}
```

### Response Schema (`UnifiedAnalyzeResponse`)
```json
{
  "as_of_date": "YYYY-MM-DD",
  "overall_status": "completed | partial_success | failed",
  "inventory_summary": {
    "total_items": 0,
    "eligible_items": 0,
    "expired_items": 0,
    "unavailable_items": 0,
    "unresolved_products": 0
  },
  "product_resolutions": [],
  "shelf_life_estimates": [],
  "priority_scores": [],
  "sensor_analysis": {
    "status": "completed | skipped | failed",
    "simulated": false,
    "total_readings_analyzed": 0,
    "anomalies_detected": 0,
    "alerts": [],
    "message": "string"
  },
  "duplicate_purchase_analysis": {
    "status": "completed | skipped | failed",
    "total_proposed": 0,
    "results": [],
    "message": "string"
  },
  "recipe_recommendations": {
    "status": "completed | skipped | failed",
    "total_recommendations": 0,
    "recommendations": [],
    "message": "string"
  },
  "warnings": [],
  "errors": [],
  "simulated_data_used": false
}
```

---

## 5. Detailed Gap Analysis

### 5.1 Image-Based Product Identification
- **Current State:** Completely missing.
- **Gaps:**
  - No image ingestion endpoints (multipart/form-data or Base64 payload).
  - No computer vision models (e.g. YOLO, MobileNet, EfficientNet, or ViT) or feature extraction pipelines.
  - No mapping between predicted visual labels and canonical `product_id` in `app/data/products.csv`.
  - No vision dependencies installed (`pillow`, `torch`, `torchvision`, `opencv-python`, etc.).

### 5.2 Image-Based Freshness Classification
- **Current State:** Completely missing.
- **Gaps:**
  - No trained model weights, evaluation metrics, or training datasets in `ai/`.
  - While `app/services/priority_scoring.py` defines a `weight_freshness_penalty` (10%) and accepts a boolean `freshness_override`, there is no model or automated pipeline to set this flag.
  - No multi-class freshness score (e.g. Fresh, Fair, Spoiled) or confidence score.

### 5.3 Sensor Intelligence: Temperature, Humidity, and Gas
- **Current State:** Temperature and humidity telemetry are fully supported with rule-based threshold evaluation and sustained anomaly detection. Gas sensing is missing.
- **Gaps:**
  - **Gas Sensors:** `SensorReading` schema lacks gas sensor fields (e.g. `gas_ppm`, `voc_index`, `air_quality_score`, `ethylene_ppm`).
  - **Threshold Configs:** `ZoneThresholdConfig` does not define normal or anomalous gas concentration boundaries.
  - **Safety Notice:** Gas sensor spikes or environmental anomalies must indicate storage environment concerns and cannot be treated as definitive laboratory proof of food spoilage or pathogen presence.

### 5.4 Cross-Module Integration Gaps
- **Sensor Alert to Priority Feedback:** In `grocery_orchestration_service.py`, if a storage zone (e.g. `refrigerator`) exhibits a `critical` temperature excursion, that alert is reported in `sensor_analysis`, but it is **not propagated** into the `storage_condition_warning` of refrigerator items in `priority_scores`.
- **Freshness Flag Exposure:** `InventoryItem` (in `duplicate_purchase_service.py`) does not contain `freshness_override`. Therefore, when callers invoke `POST /grocery/analyze`, they cannot pass freshness observations into the inventory items.

### 5.5 Dependencies & Environment
- `requirements.txt` currently includes only: `fastapi`, `uvicorn`, `pydantic`, `pandas`, `scikit-learn`, `pytest`, `httpx`.
- Heavy vision libraries (PyTorch/TensorFlow) are absent. If image models are introduced, lightweight onnxruntime or pre-trained lightweight backbones must be planned carefully to maintain fast startup and small resource footprints.

---

## 6. Recommended Implementation Roadmap for Next Phase

1. **Step 1: Sensor Intelligence Expansion (Gas Telemetry & Zone Alert Propagation)**
   - Add optional gas metrics (`gas_ppm`, `voc_index`, `ethylene_ppm`) to `SensorReading` and `sample_sensor_data.json`.
   - Add threshold checks to `ZoneThresholdConfig` in `sensor_service.py`.
   - Propagate active zone sensor alerts into inventory items' storage condition warnings during orchestration.

2. **Step 2: Schema Alignment for Freshness & Sensory Signals**
   - Add optional `freshness_override` and `freshness_score` to `InventoryItem`.
   - Connect user/vision freshness inputs directly to Phase 4 `prioritize_items()`.

3. **Step 3: Lightweight Image Ingestion & Classification Pipeline**
   - Implement `POST /vision/identify-product` and `POST /vision/assess-freshness` endpoints accepting image uploads (or Base64 strings).
   - Use a lightweight, explainable classifier or pre-trained vision backbone (with simulated fallback/mock options for environments lacking heavy GPU/CUDA setups).
   - Integrate vision outputs directly into the unified grocery analysis request.

4. **Step 4: End-to-End Testing & Integration Verification**
   - Write integration tests verifying that high sensor temperatures or degraded visual freshness dynamically elevate Use-First priority scores.
   - Run full regression testing across all phases.

---

## 7. Confirmation of Constraints
- **Zero code modifications** were made to application code or existing services during this audit.
- No files outside `ai/` were inspected or modified.
- All 216 existing automated tests remain passing.
