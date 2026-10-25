# Phase 12: Gas Sensor Intelligence Report

**Date:** 2026-10-25  
**Project:** SaveBite AI — Grocery Intelligence and Food-Waste Management System  
**Module:** `ai/`  
**Phase status:** **PASS**

---

## 1. Executive Summary

Phase 12 extends the SaveBite AI sensor subsystem with **Gas/VOC Sensor Intelligence**. Three optional, sensor-type-specific gas measurement fields (`gas_ppm`, `voc_index`, `ethylene_ppm`) were added to the existing `SensorReading` Pydantic model. Point-in-time threshold analysis was added to `check_individual_reading`. Sustained-anomaly detection across consecutive readings was added to `check_sequential_anomalies`, following the exact pattern already used for temperature. A `POST /sensors/analyze` API endpoint was added to expose the sensor pipeline over HTTP.

All 59 new Phase 12 tests passed. The full regression suite spanning Phases 1 through 12 passed with **312 passed tests, 0 failures, 0 regressions**. No files outside `ai/` were modified. Phase 13 integration was not started.

---

## 2. Initial Audit Findings

### 2a. Repository structure at phase start

```
ai/
├── app/
│   ├── main.py                          # FastAPI application
│   ├── data/                            # Training/acquisition scripts
│   ├── models/freshness/                # Trained freshness classifier
│   └── services/
│       ├── sensor_service.py            # Phase 5 temperature/humidity engine (808 lines)
│       ├── grocery_orchestration_service.py
│       ├── duplicate_purchase_service.py
│       ├── freshness_assessment_service.py
│       ├── image_identification_service.py
│       ├── priority_scoring.py
│       ├── product_catalog.py
│       ├── recipe_recommendation_service.py
│       └── shelf_life_service.py
├── tests/
│   ├── test_sensor_service.py           # 28 existing sensor tests
│   └── [9 other test files]
└── reports/
    └── [phase9–11 reports]
```

### 2b. What was already present

The following gas/VOC infrastructure was already in place before any Phase 12 changes (likely scaffolded during earlier phases):

| Item | Status |
|:---|:---|
| `AlertType` literal union already included `high_gas_ppm`, `sustained_high_gas_ppm`, `high_voc_index`, `sustained_high_voc_index`, `high_ethylene_ppm` | ✅ Present |
| `ZoneThresholdConfig` already had `max_gas_ppm`, `max_voc_index`, `max_ethylene_ppm` optional float fields with validation in `__post_init__` | ✅ Present |
| `DEFAULT_ZONE_CONFIGS` already populated all three gas thresholds for refrigerator, freezer, pantry | ✅ Present |
| `SensorReading` model had gas fields | ❌ Missing |
| Gas analysis logic in `check_individual_reading` | ❌ Missing |
| Sustained gas anomaly tracking in `check_sequential_anomalies` | ❌ Missing |
| `POST /sensors/analyze` API endpoint | ❌ Missing |
| Gas/VOC tests | ❌ Missing |

### 2c. What was missing (implementation checklist)

- [x] Add `gas_ppm`, `voc_index`, `ethylene_ppm` optional fields to `SensorReading` with validators
- [x] Add point-in-time gas threshold checks (items 6a/6b/6c) to `check_individual_reading`
- [x] Add sustained `gas_ppm` and `voc_index` anomaly counters to `check_sequential_anomalies`
- [x] Add `POST /sensors/analyze` endpoint to `app/main.py`
- [x] Create `tests/test_gas_sensor_service.py` (59 tests)
- [x] Create `reports/phase12_report.md`

### 2d. Orchestration compatibility

`grocery_orchestration_service.py` already collects `SensorBatchAnalysisResponse.active_alerts` into the unified orchestration result. Because the gas alert types extend the same `SensorAlert` model and flow through the same `active_alerts` list and `results_by_reading` structure, they are automatically available to the orchestration layer without modifying that service. No change to Use-First scoring was made.

---

## 3. Files Created and Modified

### Modified

| File | Change |
|:---|:---|
| `app/services/sensor_service.py` | Extended `SensorReading` with 3 gas fields + validator; added gas checks to `check_individual_reading`; added sustained gas/VOC counters to `check_sequential_anomalies` |
| `app/main.py` | Added `SensorBatchRequest` model and `POST /sensors/analyze` endpoint |

### Created

| File | Purpose |
|:---|:---|
| `tests/test_gas_sensor_service.py` | 59 focused Phase 12 tests |
| `reports/phase12_report.md` | This report |

**No files outside `ai/` were modified.**

---

## 4. Gas/VOC Measurements Supported and Their Units

| Field | Type | Unit | Sensor class | When to populate |
|:---|:---|:---|:---|:---|
| `gas_ppm` | `Optional[float]` | ppm (parts-per-million) | Calibrated multi-gas or VOC sensors (e.g. MQ-series, SGP30 in ppm mode) | When the sensor reports a calibrated ppm concentration |
| `voc_index` | `Optional[float]` | Dimensionless index, 0–500 | Sensirion SGP40, SGP41 | When the sensor reports a VOC index, **not** a ppm value |
| `ethylene_ppm` | `Optional[float]` | ppm C2H4 | Dedicated electrochemical ethylene sensors | **Only** when the sensor explicitly measures calibrated ethylene |

### Critical non-interchangeability rules

- `voc_index` is a dimensionless index — it must never be compared against ppm thresholds.
- `ethylene_ppm` must not be estimated from a generic VOC sensor; it requires a dedicated ethylene-selective sensor.
- `gas_ppm` threshold meaning depends on sensor calibration — the sensor model must be documented in production integrations.

All three fields default to `None`. A reading without any gas fields is fully valid.

---

## 5. Threshold Configuration

### ZoneThresholdConfig gas fields

```python
@dataclass(frozen=True)
class ZoneThresholdConfig:
    ...
    max_gas_ppm:      Optional[float] = None   # ppm upper limit; None = no threshold configured
    max_voc_index:    Optional[float] = None   # VOC index upper limit
    max_ethylene_ppm: Optional[float] = None   # ppm C2H4 upper limit
```

`__post_init__` rejects negative, NaN, and infinite threshold values. `None` is explicitly permitted (means "not configured — no gas check performed").

### Development defaults (illustrative only)

| Zone | `max_gas_ppm` | `max_voc_index` | `max_ethylene_ppm` |
|:---|:---|:---|:---|
| `refrigerator` | 100 ppm | 250 | 5.0 ppm C2H4 |
| `freezer` | 50 ppm | 150 | 1.0 ppm C2H4 |
| `pantry` | 150 ppm | 300 | 10.0 ppm C2H4 |

**These are labelled development defaults only.** They were not derived from calibrated sensor datasheets or validated food-safety authority guidance. Cold zones (refrigerator, freezer) are set more conservatively than pantry because organic off-gassing under normal operation is lower in cold environments. Operators must replace these values with readings calibrated to their actual sensor hardware and deployment environment.

Thresholds can be overridden per-call by passing a custom `zone_configs` dict to `analyze_sensor_readings` or `analyze_sensor_reading`.

---

## 6. Detection and Alert Logic

### Point-in-time checks (`check_individual_reading`)

Added as checks 6a, 6b, 6c after the existing power-interruption check:

| Condition | Alert type | Severity |
|:---|:---|:---|
| `gas_ppm > config.max_gas_ppm` (and both are not None) | `high_gas_ppm` | `warning` |
| `voc_index > config.max_voc_index` (and both are not None) | `high_voc_index` | `warning` |
| `ethylene_ppm > config.max_ethylene_ppm` (and both are not None) | `high_ethylene_ppm` | `warning` |

Each alert includes:
- `alert_id` — deterministic identifier (`ALT-{rid}-GAS-HIGH`, etc.)
- `sensor_id`, `storage_zone`
- `alert_type`
- `severity` — always `warning` (gas readings are environmental signals, not confirmed spoilage)
- `message` — human-readable, explicitly stating "environmental warning signal"
- `observed_value` — the measured quantity
- `threshold` — the configured limit
- `triggered_conditions` — list explaining exactly why the alert fired
- `timestamp` — from the source reading
- `simulated` — `True` in all current readings

All three measurement types are checked **independently**. A reading that is elevated on all three will generate three separate alerts.

If `config.max_gas_ppm` is `None`, the gas_ppm check is skipped entirely (threshold not configured).

### Sustained anomaly detection (`check_sequential_anomalies`)

Two new counters mirror the existing temperature sustained-anomaly logic:

```
consecutive_gas_abnormal: List[SensorReading]   → triggers sustained_high_gas_ppm
consecutive_voc_abnormal: List[SensorReading]   → triggers sustained_high_voc_index
```

**Trigger condition:** `≥ sustained_consecutive_readings` (default 3) consecutive readings above threshold, without a gap exceeding `max_consecutive_gap_hours` (default 2h).

**Reset conditions (either):**
- A reading within normal bounds (recovery) — counter cleared to `[]`
- Gap between consecutive readings > `max_consecutive_gap_hours` — all sustained counters cleared

Sustained ethylene tracking is **not implemented** in Phase 12. A dedicated electrochemical ethylene sensor producing continuous readings is required before sustained ethylene detection would be meaningful; no such hardware is simulated in this phase.

### Safety language

All gas alert messages:
- Explicitly use the phrase "environmental warning signal" or "does not confirm food spoilage"
- Do not instruct users to discard food
- For ethylene: note elevated levels "may accelerate ripening/spoilage of nearby produce — inspect storage zone"

---

## 7. Stale-Reading and Recovery Behaviour

### Stale readings

The existing stale-reading check in `check_individual_reading` (check 1, using `config.max_reading_age_hours`) is unchanged. It applies to every reading regardless of whether gas fields are present. A gas reading in a stale payload will generate both a `stale_reading` alert and any applicable gas alert.

### Recovery

When a gas or VOC reading returns to normal (at or below threshold), the corresponding sustained counter is cleared. No `sustained_high_gas_ppm` or `sustained_high_voc_index` alert is generated for subsequent readings until the counter reaches `sustained_consecutive_readings` again. This matches existing temperature recovery behavior exactly.

### Missing gas fields

If a reading does not include `gas_ppm`, `voc_index`, or `ethylene_ppm`, no gas alert is generated. Existing temperature/humidity analysis proceeds normally. This is confirmed by `test_gas_fields_absent_backward_compatible` and the batch compatibility tests.

---

## 8. API Request/Response Example

### Endpoint

```
POST /sensors/analyze
Content-Type: application/json
Tag: Sensors
```

### Request model

```python
class SensorBatchRequest(BaseModel):
    readings: List[Dict[str, Any]]
```

### Request example

```json
{
  "readings": [
    {
      "reading_id": "R-2026-001",
      "sensor_id": "SIM-GAS-FRIDGE-01",
      "storage_zone": "refrigerator",
      "timestamp": "2026-10-25T08:00:00Z",
      "temperature_c": 3.5,
      "humidity_percent": 62.0,
      "gas_ppm": 140.0,
      "voc_index": 180.0,
      "ethylene_ppm": 2.1,
      "simulated": true
    }
  ]
}
```

### Response example (gas_ppm above threshold)

```json
{
  "as_of": "2026-10-25T08:05:00Z",
  "total_readings": 1,
  "valid_readings": 1,
  "invalid_readings": 0,
  "overall_status": "warning",
  "active_alerts": [
    {
      "alert_id": "ALT-R-2026-001-GAS-HIGH",
      "sensor_id": "SIM-GAS-FRIDGE-01",
      "storage_zone": "refrigerator",
      "alert_type": "high_gas_ppm",
      "severity": "warning",
      "message": "Observed gas concentration (140.0 ppm) exceeded configured maximum (100.0 ppm). This is an environmental warning signal — it does not confirm food spoilage.",
      "observed_value": 140.0,
      "threshold": 100.0,
      "triggered_conditions": [
        "gas_ppm 140.0 ppm exceeds zone 'refrigerator' threshold of 100.0 ppm."
      ],
      "timestamp": "2026-10-25T08:00:00Z",
      "simulated": true
    }
  ],
  "results_by_reading": [...],
  "simulated": true,
  "caveat": "Phase 5 synthetic sensor intelligence identifies environmental deviations using rule-based heuristics. It does not prove food spoilage and does not calculate empirical shelf-life reduction."
}
```

### Error cases

| Scenario | HTTP status |
|:---|:---|
| Missing `readings` field | 422 Unprocessable Entity |
| Empty `readings` list | 200 OK (normal/insufficient_data status) |
| Invalid gas value in a reading (e.g. `gas_ppm: -50`) | 200 OK; that reading `is_valid=False`, `invalid_readings` incremented |

---

## 9. Simulation Method and Limitations

All test readings use explicit, fixed values rather than random generation. Every reading carries `simulated=True`. The `_make_reading()` helper in the test file creates deterministic fixtures with configurable gas fields.

**What is simulated:**

| Field | Assumed physical sensor | Assumed range in fixtures |
|:---|:---|:---|
| `gas_ppm` | MQ-series resistive VOC sensor in calibrated ppm mode | 0–500 ppm |
| `voc_index` | Sensirion SGP41 VOC index output | 0–500 |
| `ethylene_ppm` | Electrochemical ethylene sensor (e.g. Pewatron EC-C2H4) | 0–50 ppm |

Test values that exceed thresholds (e.g. `gas_ppm=150.0` against a 100 ppm fridge limit) are chosen to be clearly and deterministically above the limit.

**Simulation is production-independent.** The production service (`sensor_service.py`) does not import from or depend on any test fixture or simulation utility.

---

## 10. Tests Executed — Exact Commands and Actual Results

### Phase 11 baseline (before any Phase 12 changes)

```
.\.venv\Scripts\pytest.exe tests/ -q
```
**Result:** 253 passed, 1 warning

### Focused Phase 12 tests

```
.\.venv\Scripts\pytest.exe tests/test_gas_sensor_service.py -v
```
**Result: 59 passed, 1 warning in 2.64s**

| Test class | Count | All pass? |
|:---|:---|:---|
| `TestGasFieldValidation` | 11 | ✅ |
| `TestGasThresholdConfig` | 6 | ✅ |
| `TestPointInTimeGasAlerts` | 16 | ✅ |
| `TestSustainedGasAlerts` | 8 | ✅ |
| `TestBatchPipelineWithGas` | 7 | ✅ |
| `TestSensorApiEndpoint` | 9 | ✅ |
| `TestPhase12Regression` | 3 | ✅ |

### Existing sensor regression tests

```
.\.venv\Scripts\pytest.exe tests/test_sensor_service.py -v
```
**Result:** 28 passed (all Phase 5 sensor tests unchanged and passing)

---

## 11. Full Regression Results

```
.\.venv\Scripts\pytest.exe tests/ -v --tb=short -q
```

```
collected 312 items

tests\test_duplicate_purchase_service.py ...........................     [  8%]
tests\test_freshness_assessment_service.py ..................            [ 14%]
tests\test_gas_sensor_service.py .......................................
....................                                                     [ 33%]
tests\test_grocery_orchestration_service.py ...........                  [ 36%]
tests\test_health.py ......                                              [ 38%]
tests\test_image_identification_service.py ...................           [ 44%]
tests\test_priority_scoring.py .........................................
.............................                                            [ 67%]
tests\test_product_catalog.py ...........................                [ 75%]
tests\test_recipe_recommendation_service.py ..................           [ 81%]
tests\test_sensor_service.py ............................                [ 90%]
tests\test_shelf_life_service.py .............................           [100%]

312 passed, 1 warning in 4.14s
```

**Warning:** `StarletteDeprecationWarning` about `httpx` in `fastapi.testclient`. This is a pre-existing dependency version mismatch, not introduced by Phase 12, and does not cause any test failure.

| Test file | Tests | Phase |
|:---|:---|:---|
| `test_duplicate_purchase_service.py` | 27 | 6 |
| `test_freshness_assessment_service.py` | 18 | 11 |
| `test_gas_sensor_service.py` | 59 | **12 (new)** |
| `test_grocery_orchestration_service.py` | 11 | 8 |
| `test_health.py` | 6 | 1 |
| `test_image_identification_service.py` | 19 | 10 |
| `test_priority_scoring.py` | 68 | 4 |
| `test_product_catalog.py` | 25 | 2 |
| `test_recipe_recommendation_service.py` | 18 | 7 |
| `test_sensor_service.py` | 28 | 5 |
| `test_shelf_life_service.py` | 29 | 3 |
| **Total** | **312** | |

---

## 12. Known Limitations and Future Hardware Integration

### Known limitations

1. **No sustained ethylene tracking.** `sustained_high_ethylene_ppm` exists in `AlertType` but is not triggered. Sustained ethylene detection requires a continuous data stream from a dedicated ethylene sensor, which is not simulated.

2. **Development-only gas thresholds.** `DEFAULT_ZONE_CONFIGS` gas limits are illustrative. They must be validated against real sensor datasheets and deployment baselines before any production use.

3. **No rolling-baseline deviation.** Only fixed-threshold checks are implemented. Rolling-window deviation (±N sigma from a historical baseline) would require persisted time-series storage not present in the current architecture.

4. **No sensor model tagging.** `gas_ppm` interpretation varies by sensor model. Production integrations should add a `sensor_model: Optional[str]` field to document hardware provenance.

5. **`simulated=True` enforced.** `SensorReading.simulated` defaults to `True`. For real hardware integration, this default should be removed or made configurable.

6. **VOC index is sensor-family-specific.** A Sensirion SGP40 index of 200 and a Bosch BME688 reading of 200 may represent different physical conditions. The `voc_index` field has no sensor-family annotation.

### Replacing simulated readings with real sensor telemetry

1. **Keep `SensorReading` as the ingestion contract.** Add `sensor_model: Optional[str]` to document hardware.
2. **Remove `simulated=True` as a forced default** once real hardware is confirmed operational.
3. **Collect a two-week baseline** of readings from each sensor under normal operation. Set `max_gas_ppm` to `baseline_mean + 3 × baseline_std` (or a percentile-based equivalent).
4. **For `gas_ppm`:** Confirm sensor is calibrated to a known reference standard. Raw resistance values must not be passed as ppm without calibration.
5. **For `voc_index`:** Use Sensirion's published index interpretation table when setting `max_voc_index`.
6. **For `ethylene_ppm`:** Only populate when hardware is a dedicated ethylene-selective electrochemical sensor. Do not infer from MQ-3 or similar broad-spectrum sensors.
7. **Synchronize hardware clocks to UTC** to avoid spurious stale-reading alerts.
8. **Feed real readings via `POST /sensors/analyze`** or directly into `analyze_sensor_readings`.

---

## 13. Confirmations

- **No files outside `ai/` were modified.** All changes are confined to `app/services/sensor_service.py`, `app/main.py`, `tests/test_gas_sensor_service.py`, and this report.
- **Phase 13 integration was not started.**
- **Existing endpoints verified functional:** `GET /health`, `POST /grocery/analyze`, `POST /vision/identify`, `POST /vision/assess-freshness`, `POST /recipes/recommend`, `POST /priority/score`, `POST /shelf-life/estimate` — all covered by existing passing tests.
- **Use-First scoring formula unchanged** — `priority_scoring.py` was not touched.
- **No food-safety guarantee** is inferred from any gas/VOC measurement in the implementation or tests.
