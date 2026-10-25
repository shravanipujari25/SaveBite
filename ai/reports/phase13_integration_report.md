# Phase 13 Integration Report — SaveBite AI Module

## 1. Executive Summary

Phase 13 implemented **End-to-End AI Integration** for the SaveBite Grocery Intelligence and Food-Waste Management System. All existing AI capabilities (Phases 1–12) were inspected, verified, and connected through a coherent integration layer without rewriting any working service.

**Status: COMPLETE**

The following integration work was performed:
- Added `freshness_overrides` and `freshness_confidence` fields to `POST /grocery/analyze`, enabling callers who have already run `/vision/assess-freshness` to pass a confirmed freshness signal into Use-First priority scoring — with strict confidence gating.
- Added `POST /vision/analyze` — a new combined endpoint that performs grocery identification and optional freshness assessment in a single request and returns a structured `orchestration_hint` block that callers can forward directly into `POST /grocery/analyze`.
- Added 89 new comprehensive integration tests covering all service integrations, API contracts, safety constraints, priority formula regression, and the two new Phase 13 endpoints.
- All 312 pre-existing tests remained passing. Final suite: **401 passed, 0 failures, 1 pre-existing warning**.

---

## 2. Initial Baseline

**Command:** `.\.venv\Scripts\pytest.exe tests/ -q --tb=short`

| Metric | Value |
|---|---|
| Tests passed | 312 |
| Tests failed | 0 |
| Tests skipped | 0 |
| Warnings | 1 (`StarletteDeprecationWarning`) |
| Python | 3.12.4 |
| pytest | 9.1.1 |

**Pre-existing warning:**
```
StarletteDeprecationWarning: Using `httpx` with `starlette.testclient` is deprecated; install `httpx2` instead.
  from starlette.testclient import TestClient as TestClient
```
This warning comes from the `fastapi/testclient.py` shim and predates Phase 13. It does not cause failures. It was not suppressed and is left for a dedicated maintenance task.

**Pre-existing limitations identified:**
- The `InventoryItem` model (in `duplicate_purchase_service.py`) has no `storage_zone` field; orchestration already uses `getattr(item, "storage_zone", None)` defensively.
- `POST /grocery/analyze` accepted only text-based inventory — no image-derived grocery input.
- Freshness assessment results were not plumbed into priority scoring's `freshness_override` flag from the orchestration layer.
- No combined image endpoint existed; callers needed two separate round trips for identification + freshness.

---

## 3. Architecture and Data Flow

```mermaid
graph TD
    subgraph "Client"
        C[Frontend / IoT / Backend]
    end

    subgraph "FastAPI — app/main.py"
        H[GET /health]
        P[GET /products/{name}]
        SL[POST /shelf-life/estimate]
        PS[POST /priority/score]
        RC[POST /recipes/recommend]
        GA[POST /grocery/analyze]
        VI[POST /vision/identify]
        VF[POST /vision/assess-freshness]
        VA[POST /vision/analyze  ★Phase 13]
        SA[POST /sensors/analyze]
    end

    subgraph "Service Layer"
        CAT[product_catalog.py]
        SHELF[shelf_life_service.py]
        SCORE[priority_scoring.py]
        REC[recipe_recommendation_service.py]
        DUP[duplicate_purchase_service.py]
        SENSOR[sensor_service.py]
        IMGID[image_identification_service.py]
        FRESH[freshness_assessment_service.py]
        ORCH[grocery_orchestration_service.py]
    end

    subgraph "Model Artifacts"
        MODEL[app/models/freshness/freshness_classifier.joblib]
    end

    C --> GA --> ORCH
    C --> VI --> IMGID --> CAT
    C --> VF --> FRESH --> MODEL
    C --> VA --> IMGID --> CAT
    VA --> FRESH --> MODEL
    C --> SA --> SENSOR
    C --> RC --> REC
    C --> PS --> SCORE
    C --> SL --> SHELF

    ORCH --> CAT
    ORCH --> SHELF
    ORCH --> SCORE
    ORCH --> SENSOR
    ORCH --> DUP
    ORCH --> REC

    SCORE -. freshness_override .- ORCH
```

### Orchestration Execution Order

`POST /grocery/analyze` follows this internal sequence (unchanged from Phase 8 design, Phase 13 adds freshness wire):

1. **Catalog resolution** — Normalize product names, map to canonical catalog entries, count unresolved items.
2. **Shelf-life estimation** — Per-item estimation from catalog baseline, storage zone, expiry date, opened state.
3. **Use-First priority scoring** — Rule-based score using urgency (55%), perishability (20%), storage warnings (15%), freshness (10%). ★**Phase 13:** `freshness_override` flag populated when caller supplies a confirmed `visibly_spoiled` condition with confidence ≥ 0.60.
4. **Sensor telemetry analysis** — Optional; processes gas/VOC/temperature/humidity readings and generates environmental alerts.
5. **Duplicate-purchase detection** — Optional; compares proposed purchases against existing inventory.
6. **Recipe recommendations** — Optional; ranks recipes using priority data and available stock.
7. **Response aggregation** — Overall status, warnings, errors, and `simulated_data_used` flag.

### Combined Vision Flow (`POST /vision/analyze`)

1. **Grocery identification** (`image_identification_service.py`) — Returns product name, category, confidence, catalog match.
2. **Eligibility check** — Only runs freshness if: product name is present, confidence is reliable (`is_confident=True` and `requires_confirmation=False`), and the product is in the supported freshness category set (`{apple, banana, orange, lemon, tomato}`).
3. **Freshness assessment** (`freshness_assessment_service.py`) — Optional; runs on same image bytes.
4. **`orchestration_hint` block** — Convenience dictionary the caller can forward into `POST /grocery/analyze` without additional processing.

---

## 4. Files Changed

| File | Type | Action | Reason |
|---|---|---|---|
| `app/services/grocery_orchestration_service.py` | Production | Modified | Added `freshness_overrides` and `freshness_confidence` optional fields to `UnifiedAnalyzeRequest`; added confidence-gated `freshness_override` wiring in priority scoring step. |
| `app/main.py` | Production | Modified | Added `POST /vision/analyze` combined endpoint; `CombinedVisionAnalysisResponse` schema; `_FRESHNESS_SUPPORTED_CATEGORIES` constant. |
| `tests/test_phase13_integration.py` | Test | Created | 89 integration tests covering all services, API contracts, safety constraints, priority formula regression, freshness override integration, and combined vision endpoint. |
| `reports/phase13_integration_report.md` | Documentation | Created | This report. |

**Files NOT modified:** All Phase 1–12 service files, model artifacts, existing test files, and dependency manifests remain unchanged.

---

## 5. Integration Results

### Text-based Grocery Entry

| | Detail |
|---|---|
| **Existing behavior verified** | `POST /grocery/analyze` normalizes names, estimates shelf life, scores priority, detects duplicates, recommends recipes, and propagates sensor alerts. |
| **New integration behavior** | Optional `freshness_overrides` map allows callers to provide freshness results from a prior `/vision/assess-freshness` call without an extra round trip through orchestration. |
| **Relevant tests** | `TestTextBasedGroceryAnalysis` (8 tests), `TestEndToEndScenarios` (6 tests), `TestFreshnessOverrideIntegration` (5 tests). |
| **Remaining limitations** | `InventoryItem` does not carry `storage_zone` as a declared field. Orchestration uses `getattr(item, "storage_zone", None)` as a defensive fallback. |

### Image Identification

| | Detail |
|---|---|
| **Existing behavior verified** | `POST /vision/identify` validates JPEG/PNG/WEBP (≤5MB, 16px–4096px), extracts HSV/texture features, scores against 14 prototype profiles, returns confidence and catalog match. |
| **New integration behavior** | `/vision/analyze` wraps identification as the first step of a combined flow. |
| **Relevant tests** | `TestImageIdentification` (10 tests), `TestCombinedVisionEndpoint` (9 tests). |
| **Remaining limitations** | Prototype-based; not a trained deep-learning model. Limited to 14 product categories. Confidence varies significantly with image quality and lighting. |

### Freshness Assessment

| | Detail |
|---|---|
| **Existing behavior verified** | `POST /vision/assess-freshness` loads a singleton MLP classifier from `app/models/freshness/freshness_classifier.joblib`. Returns `fresh`/`ripe`/`visibly_spoiled`/`uncertain`. Confidence threshold: 0.60. Unsupported product hints → `uncertain`. |
| **New integration behavior** | `/vision/analyze` runs freshness only on confident identifications of supported categories. Result is included in `orchestration_hint.freshness_condition` and `freshness_confidence`. Caller then forwards these into `POST /grocery/analyze`. |
| **Relevant tests** | `TestFreshnessAssessment` (9 tests), `TestPriorityFormulaRegression::test_freshness_override_increases_score`, `TestFreshnessOverrideIntegration` (5 tests), `TestSafetyConstraints::test_freshness_limitations_field_contains_safety_caveats`. |
| **Remaining limitations** | Model supports apple, banana, orange, lemon, tomato only (partially consistent with Phase 11 report which mentioned only apple, banana, orange). Lemon and tomato are accepted as hints per the service implementation. |

### Shelf-Life Estimation

| | Detail |
|---|---|
| **Existing behavior verified** | `POST /shelf-life/estimate` returns `estimated_end_date`, `estimated_remaining_days`, reliability level, storage zone assumption, and per-item warnings. |
| **New integration behavior** | None — shelf-life estimation was already correctly wired in orchestration. |
| **Relevant tests** | `TestAPIContract::test_shelf_life_estimate_endpoint`. |
| **Remaining limitations** | Reliability is `unavailable` for unknown products. |

### Use-First Priority Scoring

| | Detail |
|---|---|
| **Existing behavior verified** | Formula weights: urgency 55%, perishability 20%, storage warnings 15%, freshness penalty 10%. Categories: Red (≥80), Orange (≥60), Yellow (≥35), Green (<35), Black (unscoreable). |
| **New integration behavior** | `freshness_override` in `GroceryItem` is now populated from orchestration when: (a) caller provides `freshness_overrides[item_id] == "visibly_spoiled"` AND (b) `freshness_confidence[item_id] >= 0.60`. Uncertain, low-confidence, or `fresh`/`ripe` conditions do NOT activate the penalty. |
| **Relevant tests** | `TestPriorityFormulaRegression` (8 tests) including regression on weights, boundaries, and category mappings. |
| **Remaining limitations** | Formula not modified. The 10% freshness weight is additive only when `freshness_override=True`. |

### Duplicate Detection

| | Detail |
|---|---|
| **Existing behavior verified** | `check_duplicate_purchases` compares proposed purchases against usable inventory using catalog ID matching and name normalization. Operates within-request only — no persistent database. |
| **New integration behavior** | None — already wired in orchestration. |
| **Relevant tests** | `TestDuplicateDetectionAndRecipes` (6 tests). |
| **Remaining limitations** | No cross-session inventory database. Duplicate detection applies only to the inventory provided in the current request. |

### Sensor Intelligence (Temperature / Humidity / Gas / VOC / Ethylene)

| | Detail |
|---|---|
| **Existing behavior verified** | `POST /sensors/analyze` accepts `temperature_c`, `humidity_percent`, `door_open`, `power_interruption_minutes`, `gas_ppm`, `voc_index`, `ethylene_ppm`. Point-in-time threshold checks for all fields. Sustained anomaly detection for temperature and gas/VOC (not ethylene). All readings must be `simulated=True`. |
| **New integration behavior** | Sensor alerts already flow through `POST /grocery/analyze` via the `sensor_analysis` section. Gas/VOC alerts verified to propagate correctly through orchestration. |
| **Relevant tests** | `TestSensorIntelligenceIntegration` (10 tests) covering temperature, gas, VOC, ethylene, malformed data, and cross-service isolation. |
| **Remaining limitations** | Sustained ethylene anomaly detection is not implemented (documented as future work in Phase 12). Sensor alerts are zone-level environmental signals; they are not attached to individual grocery items in the current data model. |

### Recipe Recommendations

| | Detail |
|---|---|
| **Existing behavior verified** | `POST /recipes/recommend` returns ranked recipes using inventory and priority data. Unknown ingredients yield recipes with score=0 (not an empty list — the service returns the full recipe catalog with zero availability scores). |
| **New integration behavior** | None — already wired in orchestration. |
| **Relevant tests** | `TestDuplicateDetectionAndRecipes::test_recipe_recommendations_with_known_items`, `test_empty_recipe_result_is_valid`, `test_recipe_failure_does_not_corrupt_priority_results`. |
| **Remaining limitations** | Recipe database is simulated. No nutrition facts or food-safety guarantees are provided. |

### Combined Vision Endpoint (`POST /vision/analyze`)

| | Detail |
|---|---|
| **Existing behavior verified** | N/A — this is a new Phase 13 endpoint. |
| **New integration behavior** | Accepts a single image. Returns `identification`, optional `freshness`, `freshness_skipped_reason`, `orchestration_hint`, and `disclaimer`. Freshness is skipped when: (a) identification is not confident, (b) the product is not in the freshness-supported category set, or (c) freshness inference fails. |
| **Relevant tests** | `TestCombinedVisionEndpoint` (9 tests). |
| **Remaining limitations** | Image bytes are decoded twice (once for identification, once for freshness) within a single request. This is a known, bounded overhead for the current traffic scale and was not optimized. |

---

## 6. API Contract

All endpoints verified against the actual FastAPI OpenAPI schema (`GET /openapi.json`).

| Endpoint | Method | Input | Response |
|---|---|---|---|
| `/health` | GET | — | `{status, service, version}` |
| `/products/{product_name}` | GET | Path param | `ProductResponse` |
| `/shelf-life/estimate` | POST | `ShelfLifeEstimateRequest` (JSON) | `ShelfLifeEstimateResponse` |
| `/priority/score` | POST | `PriorityScoreRequest` (JSON) | `PriorityScoreResponse` |
| `/recipes/recommend` | POST | `RecipeRecommendRequest` (JSON) | `RecipeRecommendationResponse` |
| `/grocery/analyze` | POST | `UnifiedAnalyzeRequest` (JSON) ★with `freshness_overrides`, `freshness_confidence` | `UnifiedAnalyzeResponse` |
| `/vision/identify` | POST | `multipart/form-data` (file: JPEG/PNG/WEBP ≤5MB) | `GroceryImageIdentifyResponse` |
| `/vision/assess-freshness` | POST | `multipart/form-data` (file + optional `product_hint` form field) | `FreshnessAssessmentResponse` |
| `/vision/analyze` | POST ★Phase 13 | `multipart/form-data` (file: JPEG/PNG/WEBP ≤5MB) | `CombinedVisionAnalysisResponse` |
| `/sensors/analyze` | POST | `SensorBatchRequest` (JSON with `readings[]`) | `SensorBatchAnalysisResponse` |

### New `UnifiedAnalyzeRequest` fields (backward-compatible, all optional)

```json
{
  "freshness_overrides": {
    "ITEM-ID-1": "visibly_spoiled",
    "ITEM-ID-2": "fresh"
  },
  "freshness_confidence": {
    "ITEM-ID-1": 0.82,
    "ITEM-ID-2": 0.91
  }
}
```

### New `CombinedVisionAnalysisResponse` schema

```json
{
  "identification": { /* GroceryImageIdentifyResponse */ },
  "freshness": null,
  "freshness_skipped_reason": "Identified product 'Broccoli' is not in the freshness model's supported category set.",
  "orchestration_hint": {
    "suggested_product_name": "Broccoli",
    "requires_confirmation": false,
    "freshness_condition": null,
    "freshness_confidence": null
  },
  "disclaimer": "Image analysis provides estimates of visible product type and surface condition. ..."
}
```

### Key validation rules (unchanged from Phases 10–12)

- Images: JPEG, PNG, WEBP only; max 5MB; min 16×16px; max 4096×4096px.
- Sensor readings: `gas_ppm`, `voc_index`, `ethylene_ppm` must be finite non-negative numbers or absent (never treated as zero if absent).
- Priority weights: urgency 55% + perishability 20% + storage 15% + freshness 10% = 100%.
- `freshness_override` activated only when `freshness_overrides[id] == "visibly_spoiled"` AND `freshness_confidence[id] >= 0.60`.

---

## 7. Test Results

### Baseline (pre-Phase 13)

```
Command: .\.venv\Scripts\pytest.exe tests/ -q --tb=short
Result:  312 passed, 1 warning in 4.74s
```

### Phase 13 new tests (isolated run)

```
Command: .\.venv\Scripts\pytest.exe tests/test_phase13_integration.py -v --tb=short
Result:  89 passed, 1 warning in 3.92s
```

### Final full suite

```
Command: .\.venv\Scripts\pytest.exe tests/ -q --tb=short
Result:  401 passed, 1 warning in 4.96s
```

**Net gain:** +89 tests. Zero regressions. Same pre-existing `StarletteDeprecationWarning`.

### Test class breakdown

| Test Class | Tests | Coverage |
|---|---|---|
| `TestTextBasedGroceryAnalysis` | 8 | Orchestration text flow, edge cases |
| `TestImageIdentification` | 10 | `/vision/identify` happy + error paths |
| `TestFreshnessAssessment` | 9 | `/vision/assess-freshness` happy + error paths |
| `TestSensorIntelligenceIntegration` | 10 | All gas/VOC/temp sensor scenarios |
| `TestDuplicateDetectionAndRecipes` | 6 | Duplicate detection + recipe edge cases |
| `TestEndToEndScenarios` | 6 | Full orchestration flow tests |
| `TestAPIContract` | 13 | All 10 routes + OpenAPI schema |
| `TestPriorityFormulaRegression` | 8 | Weight regression, category boundaries |
| `TestFreshnessOverrideIntegration` | 5 | Phase 13 freshness→priority bridge |
| `TestCombinedVisionEndpoint` | 9 | Phase 13 `/vision/analyze` endpoint |
| `TestSafetyConstraints` | 6 | Safety caveats, no food-safety claims |

---

## 8. Safety and Uncertainty

### Confidence gating

| Capability | Threshold | Effect of Low Confidence |
|---|---|---|
| Image identification | `is_confident`: 0.65 | `requires_confirmation=True`; unrecognised items return `identified_product_name=null` |
| Freshness assessment | 0.60 | Condition forced to `uncertain`; `requires_confirmation=True` |
| Freshness override (orchestration) | 0.60 | `freshness_override` flag NOT activated; priority score unaffected |
| Combined vision freshness | identification must be `is_confident=True` and `requires_confirmation=False` | Freshness assessment skipped; reason returned in `freshness_skipped_reason` |

### Explicit safety guarantees preserved

1. **Uncertain freshness does not change priority.** Tests `test_uncertain_freshness_does_not_trigger_override` and `test_low_confidence_spoilage_does_not_trigger_override` verify this numerically.
2. **`fresh` and `ripe` conditions add zero penalty.** Tests `test_fresh_condition_does_not_add_spoilage_penalty` and `test_ripe_condition_does_not_add_spoilage_penalty` confirm this.
3. **Freshness override does not change expiry dates.** The `package_use_by_date` field in priority scoring comes from the inventory item, not from the freshness assessment.
4. **Gas/VOC alerts are environmental signals.** Test `test_gas_sensor_alert_message_is_environmental_not_spoilage` confirms alert messages do not contain food-safety claims.
5. **Sensor alerts do not alter Use-First priority scores.** Test `test_sensor_alert_does_not_change_priority_formula` verifies score equality with and without sensor alerts.
6. **All freshness and vision responses carry explicit limitations fields** describing what the model cannot assess (microbiological pathogens, bacterial toxins, food safety).
7. **Combined vision endpoint includes a disclaimer** in every response.

---

## 9. Dependency and Warning Status

| Item | Status |
|---|---|
| `StarletteDeprecationWarning` in `fastapi/testclient.py` | **Pre-existing.** Source: `fastapi.testclient` imports `starlette.testclient` which requires `httpx2` in the current version. No `httpx` or `fastapi` versions were changed. Not suppressed. Recorded for maintenance. |
| New dependencies introduced | **None.** Phase 13 used only modules already present in the project. |
| Dependency file changes | **None.** `requirements.txt` / `pyproject.toml` were not modified. |

---

## 10. Known Limitations

1. **Freshness model scope:** The trained MLP classifier was reported to support apple, banana, and orange. The inference service code accepts `lemon` and `tomato` as supported hints. No additional training was performed. Accuracy on lemon and tomato may differ from the reported 80.95%.
2. **Image bytes decoded twice in `/vision/analyze`:** Identification and freshness each parse the image independently. This is bounded and acceptable for the current load profile. A shared decoded-image intermediate would require refactoring the service interfaces.
3. **No persistent inventory database:** Duplicate detection and recipe recommendations operate only on the inventory supplied in the current API request. No cross-session state is maintained.
4. **Sustained ethylene anomaly detection not implemented:** As documented in Phase 12, sequential ethylene anomaly detection was intentionally omitted. It remains future work.
5. **Sensor alerts are zone-level, not grocery-level:** There is no data-model field linking a specific grocery item to a specific sensor zone. Zone association requires explicit design in a future phase.
6. **`InventoryItem` lacks `storage_zone` as a declared field:** The orchestration layer reads it via `getattr(item, "storage_zone", None)`. If the model is extended to include this field, it will be picked up automatically.
7. **Image identification accuracy depends on lighting and framing:** The prototype-based HSV approach is sensitive to background colour, image angle, and illumination. It is not a trained neural network.
8. **No performance benchmarking was conducted:** The current environment does not have a dedicated load-testing setup. Model loading uses a singleton pattern (no repeated disk I/O after first load).

---

## 11. Integration Readiness

The AI module is **ready for integration** with the following conditions:

### Ready for use

| Interface | Readiness |
|---|---|
| `POST /grocery/analyze` (text-based) | ✅ Production-grade orchestration |
| `POST /vision/identify` | ✅ Prototype-quality; must be presented as prototype |
| `POST /vision/assess-freshness` | ✅ ML model with explicit uncertainty handling |
| `POST /vision/analyze` | ✅ Combined convenience endpoint; Phase 13 new |
| `POST /sensors/analyze` | ✅ Simulated readings with clear simulation markers |
| `POST /priority/score` | ✅ Deterministic rule-based engine |
| `POST /shelf-life/estimate` | ✅ Rule-based with reliability levels |
| `POST /recipes/recommend` | ✅ Simulated database; no inventory persistence |
| `GET /health` | ✅ Operational |

### What external teams need to know

1. **All sensor readings must be marked `simulated: true`** — no physical hardware is connected.
2. **The freshness model requires model artifacts** at `app/models/freshness/freshness_classifier.joblib`. If this file is absent, `POST /vision/assess-freshness` returns HTTP 503.
3. **Image uploads are multipart/form-data** — standard `file` field, no Base64 encoding.
4. **`freshness_overrides` and `freshness_confidence`** are the bridge from vision to orchestration. The frontend should pass these when it has a freshness result and wants priority scoring to reflect it.
5. **Confidence thresholds:** 0.65 for image identification reliability, 0.60 for freshness override activation.
6. **Sensor thresholds are illustrative** development defaults — they must be calibrated against real hardware readings before production deployment.
7. **No authentication** is implemented in the AI service. It is assumed to be behind an internal network boundary.

---

## 12. Phase 14 Recommendations

1. **API authentication layer** — Add an API key or JWT middleware to the FastAPI application before any external-facing deployment.
2. **Persistent inventory database** — Replace the per-request inventory model with a database-backed inventory service to enable cross-session duplicate detection and recipe recommendations.
3. **Model versioning and retraining pipeline** — Establish a CI/CD pipeline that retrains and evaluates the freshness classifier when new image data is available. Track model versions with a model registry.
4. **Image preprocessing optimization** — Share the decoded PIL image object between the identification and freshness services within a single `/vision/analyze` request to avoid double decoding.
5. **Zone-to-grocery association** — Add a `storage_zone` field to `InventoryItem` and enable per-item sensor alert attachment based on zone matching.
6. **Sustained ethylene anomaly detection** — Implement sequential ethylene detection in `sensor_service.py` following the same pattern as gas_ppm sustained detection.
7. **Load and performance testing** — Run k6 or Locust benchmarks against `/grocery/analyze` and `/vision/analyze` to establish p50/p95/p99 latency baselines.
8. **Hardware sensor calibration** — Replace illustrative threshold defaults with validated thresholds once real sensor hardware data is available.
9. **Integration test CI** — Wire `pytest tests/` into a GitHub Actions / CI pipeline so regression coverage is enforced on every commit.

---

## Appendix: Phase 13 Changes Confined to `ai/`

```
ai/
├── app/
│   ├── main.py                                     ★ Modified (Phase 13)
│   └── services/
│       └── grocery_orchestration_service.py         ★ Modified (Phase 13)
├── tests/
│   └── test_phase13_integration.py                 ★ Created  (Phase 13)
└── reports/
    └── phase13_integration_report.md               ★ Created  (Phase 13)
```

No files outside `ai/` were modified.
No files from Phases 1–12 were deleted or replaced.
