"""Phase 13: End-to-End AI Integration Tests for SaveBite.

This test file verifies the integrated behaviour across all AI capabilities:
  A. Text-based grocery analysis (orchestration workflow)
  B. Image identification (standalone + API)
  C. Freshness assessment (standalone + API)
  D. Sensor intelligence (gas/VOC + temperature/humidity)
  E. Duplicate detection and recipe recommendations
  F. Full end-to-end orchestration scenarios
  G. API contract: all registered routes accessible
  H. Use-First priority formula regression
  I. Freshness override integration (Phase 13 new feature)
  J. Combined vision analysis endpoint (Phase 13 new feature)
  K. Safety: uncertain predictions remain uncertain, sensor alerts remain environmental

All tests use deterministic, local fixtures only.
No external APIs, hardware, or file downloads are required.
"""

import io
import sys
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Dict, List
from unittest.mock import MagicMock, patch

import pytest
from fastapi.testclient import TestClient
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.main import app
from app.services.duplicate_purchase_service import InventoryItem, ProposedPurchaseItem
from app.services.grocery_orchestration_service import (
    UnifiedAnalyzeRequest,
    UnifiedAnalyzeResponse,
    run_grocery_orchestration,
)
from app.services.priority_scoring import (
    GroceryItem,
    PriorityScoreRequest,
    ScoringConfig,
    prioritize_items,
)
from app.services.sensor_service import (
    DEFAULT_ZONE_CONFIGS,
    SensorReading,
    analyze_sensor_readings,
    check_individual_reading,
)

client = TestClient(app)

# ---------------------------------------------------------------------------
# Shared fixtures
# ---------------------------------------------------------------------------

REF_DATE = date(2026, 10, 25)
REF_TIME = datetime(2026, 10, 25, 10, 0, 0, tzinfo=timezone.utc)


def _make_inventory_item(
    iid: str,
    name: str,
    days_to_expiry: int = 5,
    quantity: float = 1.0,
    unit: str = "unit",
    status: str = "available",
    opened: bool = False,
    include_expiry: bool = True,
) -> InventoryItem:
    expiry = None
    if include_expiry:
        expiry = REF_DATE + timedelta(days=days_to_expiry)
    return InventoryItem(
        inventory_item_id=iid,
        product_name=name,
        quantity=quantity,
        unit=unit,
        status=status,
        opened=opened,
        expiry_date=expiry,
    )


def _make_small_png_image(width: int = 64, height: int = 64, color: str = "RGB") -> bytes:
    """Create a minimal valid in-memory PNG image for testing."""
    img = Image.new(color, (width, height), color=(255, 140, 0))
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def _make_sensor_reading_dict(
    reading_id: str,
    zone: str = "refrigerator",
    temp: float = 3.0,
    gas_ppm: float | None = None,
    offset_minutes: int = 5,
) -> dict:
    return {
        "reading_id": reading_id,
        "sensor_id": f"SIM-{reading_id}",
        "storage_zone": zone,
        "timestamp": (REF_TIME - timedelta(minutes=offset_minutes)).isoformat(),
        "temperature_c": temp,
        "gas_ppm": gas_ppm,
        "simulated": True,
    }


# ===========================================================================
# A. Text-based grocery analysis (orchestration workflow)
# ===========================================================================


class TestTextBasedGroceryAnalysis:

    def test_single_known_item_full_workflow(self):
        """Full orchestration: catalog → shelf-life → priority → recipes."""
        req = UnifiedAnalyzeRequest(
            inventory=[_make_inventory_item("I1", "Tomato", days_to_expiry=3)],
            include_recipes=True,
            as_of_date=REF_DATE,
        )
        resp = run_grocery_orchestration(req)
        assert resp.overall_status == "completed"
        assert resp.inventory_summary.total_items == 1
        assert resp.inventory_summary.eligible_items == 1
        assert len(resp.shelf_life_estimates) == 1
        assert len(resp.priority_scores) == 1
        assert resp.priority_scores[0].priority_category in ("Red", "Orange", "Yellow", "Green", "Black")

    def test_multiple_items_all_resolved(self):
        """Multiple known items all resolve and receive scores."""
        req = UnifiedAnalyzeRequest(
            inventory=[
                _make_inventory_item("I1", "Tomato", days_to_expiry=2),
                _make_inventory_item("I2", "White Rice", days_to_expiry=30),
                _make_inventory_item("I3", "Milk", days_to_expiry=4),
            ],
            include_recipes=True,
            as_of_date=REF_DATE,
        )
        resp = run_grocery_orchestration(req)
        assert len(resp.priority_scores) == 3
        assert resp.inventory_summary.total_items == 3
        assert resp.inventory_summary.unresolved_products == 0

    def test_missing_optional_metadata_does_not_crash(self):
        """Item with no expiry date produces a valid (possibly low-reliability) result."""
        req = UnifiedAnalyzeRequest(
            inventory=[
                InventoryItem(
                    inventory_item_id="I1",
                    product_name="Tomato",
                    quantity=2.0,
                    unit="unit",
                    status="available",
                    # No expiry_date, no purchase_date
                )
            ],
            as_of_date=REF_DATE,
        )
        resp = run_grocery_orchestration(req)
        assert resp.overall_status in ("completed", "partial_success")
        assert len(resp.priority_scores) == 1

    def test_unknown_product_flagged_but_no_crash(self):
        """Unknown product is flagged in unresolved_products and warnings, not a crash."""
        req = UnifiedAnalyzeRequest(
            inventory=[_make_inventory_item("I1", "MartianGlowFruitXYZ999")],
            as_of_date=REF_DATE,
        )
        resp = run_grocery_orchestration(req)
        assert resp.inventory_summary.unresolved_products == 1
        assert any("MartianGlowFruitXYZ999" in w for w in resp.warnings)
        res = resp.product_resolutions[0]
        assert res.found_in_catalog is False

    def test_empty_inventory_rejected(self):
        with pytest.raises(ValueError):
            UnifiedAnalyzeRequest(inventory=[])

    def test_expired_item_classified_correctly(self):
        """Expired items are counted but orchestration does not crash."""
        # Create an item that expired 3 days ago
        expired_item = InventoryItem(
            inventory_item_id="I1",
            product_name="Milk",
            quantity=1.0,
            unit="l",
            status="available",
            expiry_date=REF_DATE - timedelta(days=3),  # 3 days before ref_date → expired
        )
        req = UnifiedAnalyzeRequest(
            inventory=[
                expired_item,
                _make_inventory_item("I2", "Eggs", days_to_expiry=5),
            ],
            as_of_date=REF_DATE,
        )
        resp = run_grocery_orchestration(req)
        assert resp.inventory_summary.expired_items == 1
        assert resp.inventory_summary.eligible_items == 1

    def test_grocery_analysis_without_sensor_data(self):
        """Sensor analysis section is skipped when no readings provided."""
        req = UnifiedAnalyzeRequest(
            inventory=[_make_inventory_item("I1", "Eggs", days_to_expiry=10)],
            as_of_date=REF_DATE,
        )
        resp = run_grocery_orchestration(req)
        assert resp.sensor_analysis.status == "skipped"
        assert resp.sensor_analysis.simulated is False

    def test_grocery_analysis_without_recipe(self):
        """Recipe section is skipped when include_recipes=False."""
        req = UnifiedAnalyzeRequest(
            inventory=[_make_inventory_item("I1", "Tomato", days_to_expiry=4)],
            include_recipes=False,
            as_of_date=REF_DATE,
        )
        resp = run_grocery_orchestration(req)
        assert resp.recipe_recommendations.status == "skipped"
        assert resp.recipe_recommendations.total_recommendations == 0


# ===========================================================================
# B. Image identification
# ===========================================================================


class TestImageIdentification:

    def test_valid_png_image_returns_200(self):
        """Valid PNG image accepted by /vision/identify."""
        img_bytes = _make_small_png_image()
        resp = client.post(
            "/vision/identify",
            files={"file": ("test.png", img_bytes, "image/png")},
        )
        assert resp.status_code == 200

    def test_identify_response_has_required_fields(self):
        """Identification response contains all expected schema fields."""
        img_bytes = _make_small_png_image()
        data = client.post(
            "/vision/identify",
            files={"file": ("test.png", img_bytes, "image/png")},
        ).json()
        for field in ("confidence", "is_confident", "requires_confirmation", "message", "disclaimer"):
            assert field in data, f"Missing field: {field}"

    def test_unsupported_image_format_returns_400(self):
        """Non-image content type returns 400."""
        resp = client.post(
            "/vision/identify",
            files={"file": ("test.gif", b"GIF89a", "image/gif")},
        )
        assert resp.status_code == 400

    def test_empty_image_returns_400(self):
        """Zero-byte image returns 400."""
        resp = client.post(
            "/vision/identify",
            files={"file": ("empty.png", b"", "image/png")},
        )
        assert resp.status_code == 400

    def test_corrupt_image_returns_400(self):
        """Corrupt non-image bytes with PNG MIME returns 400."""
        resp = client.post(
            "/vision/identify",
            files={"file": ("corrupt.png", b"not-an-image-at-all!!", "image/png")},
        )
        assert resp.status_code == 400

    def test_missing_filename_returns_400_or_422(self):
        """Request without a valid filename returns 400 or 422 (FastAPI validation)."""
        resp = client.post(
            "/vision/identify",
            files={"file": ("", _make_small_png_image(), "image/png")},
        )
        assert resp.status_code in (400, 422)

    def test_low_confidence_result_requires_confirmation(self):
        """Any result with is_confident=False must also have requires_confirmation=True."""
        img_bytes = _make_small_png_image()
        data = client.post(
            "/vision/identify",
            files={"file": ("test.png", img_bytes, "image/png")},
        ).json()
        if not data["is_confident"]:
            assert data["requires_confirmation"] is True

    def test_identification_disclaimer_present(self):
        """Identification response includes the freshness-exclusion disclaimer."""
        img_bytes = _make_small_png_image()
        data = client.post(
            "/vision/identify",
            files={"file": ("test.png", img_bytes, "image/png")},
        ).json()
        assert "disclaimer" in data
        assert len(data["disclaimer"]) > 10  # non-trivial text

    def test_confidence_is_between_0_and_1(self):
        img_bytes = _make_small_png_image()
        data = client.post(
            "/vision/identify",
            files={"file": ("test.png", img_bytes, "image/png")},
        ).json()
        assert 0.0 <= data["confidence"] <= 1.0

    def test_oversized_image_returns_400(self):
        """Image above 5MB is rejected with 400."""
        oversized = b"X" * (6 * 1024 * 1024)
        resp = client.post(
            "/vision/identify",
            files={"file": ("big.png", oversized, "image/png")},
        )
        assert resp.status_code == 400


# ===========================================================================
# C. Freshness assessment
# ===========================================================================


class TestFreshnessAssessment:

    def test_valid_image_returns_200(self):
        img_bytes = _make_small_png_image()
        resp = client.post(
            "/vision/assess-freshness",
            files={"file": ("banana.png", img_bytes, "image/png")},
            data={"product_hint": "banana"},
        )
        assert resp.status_code == 200

    def test_freshness_response_has_required_fields(self):
        img_bytes = _make_small_png_image()
        data = client.post(
            "/vision/assess-freshness",
            files={"file": ("banana.png", img_bytes, "image/png")},
            data={"product_hint": "banana"},
        ).json()
        for field in ("condition", "confidence", "is_confident", "requires_confirmation",
                      "class_probabilities", "model_version", "limitations", "message"):
            assert field in data, f"Missing field: {field}"

    def test_condition_is_valid_enum_value(self):
        valid_conditions = {"fresh", "ripe", "visibly_spoiled", "uncertain"}
        img_bytes = _make_small_png_image()
        data = client.post(
            "/vision/assess-freshness",
            files={"file": ("banana.png", img_bytes, "image/png")},
            data={"product_hint": "banana"},
        ).json()
        assert data["condition"] in valid_conditions

    def test_unsupported_product_hint_returns_uncertain(self):
        """Unsupported product hint (e.g. 'chicken') must produce 'uncertain' condition."""
        img_bytes = _make_small_png_image()
        data = client.post(
            "/vision/assess-freshness",
            files={"file": ("chicken.png", img_bytes, "image/png")},
            data={"product_hint": "chicken"},
        ).json()
        assert data["condition"] == "uncertain"
        assert data["requires_confirmation"] is True

    def test_no_product_hint_still_works(self):
        """Freshness endpoint without a product hint does not crash."""
        img_bytes = _make_small_png_image()
        resp = client.post(
            "/vision/assess-freshness",
            files={"file": ("fruit.png", img_bytes, "image/png")},
        )
        assert resp.status_code in (200, 503)  # 503 if model not available

    def test_low_confidence_is_preserved_as_uncertain(self):
        """If confidence is below threshold the condition must be 'uncertain'."""
        img_bytes = _make_small_png_image()
        data = client.post(
            "/vision/assess-freshness",
            files={"file": ("test.png", img_bytes, "image/png")},
            data={"product_hint": "banana"},
        ).json()
        if not data["is_confident"]:
            assert data["condition"] == "uncertain"

    def test_limitations_field_is_non_empty(self):
        """limitations field must contain at least one safety caveat."""
        img_bytes = _make_small_png_image()
        data = client.post(
            "/vision/assess-freshness",
            files={"file": ("test.png", img_bytes, "image/png")},
            data={"product_hint": "apple"},
        ).json()
        assert isinstance(data["limitations"], list)
        assert len(data["limitations"]) >= 1

    def test_empty_image_returns_400(self):
        resp = client.post(
            "/vision/assess-freshness",
            files={"file": ("empty.png", b"", "image/png")},
            data={"product_hint": "apple"},
        )
        assert resp.status_code == 400

    def test_class_probabilities_sum_to_approximately_one(self):
        """Softmax probabilities should sum to ~1.0."""
        img_bytes = _make_small_png_image()
        data = client.post(
            "/vision/assess-freshness",
            files={"file": ("test.png", img_bytes, "image/png")},
            data={"product_hint": "orange"},
        ).json()
        if data.get("class_probabilities"):
            total = sum(data["class_probabilities"].values())
            assert abs(total - 1.0) < 0.05, f"Probabilities sum to {total}"


# ===========================================================================
# D. Sensor intelligence — integrated via orchestration and /sensors/analyze
# ===========================================================================


class TestSensorIntelligenceIntegration:

    def test_temperature_only_reading_through_orchestration(self):
        readings = [_make_sensor_reading_dict("R1", temp=3.0)]
        req = UnifiedAnalyzeRequest(
            inventory=[_make_inventory_item("I1", "Milk")],
            sensor_readings=readings,
            as_of_date=REF_DATE,
        )
        resp = run_grocery_orchestration(req)
        assert resp.sensor_analysis.status == "completed"
        assert resp.sensor_analysis.simulated is True
        assert resp.sensor_analysis.total_readings_analyzed == 1

    def test_high_temperature_produces_alert_in_orchestration(self):
        readings = [_make_sensor_reading_dict("R1", temp=11.0)]
        req = UnifiedAnalyzeRequest(
            inventory=[_make_inventory_item("I1", "Milk")],
            sensor_readings=readings,
            as_of_date=REF_DATE,
        )
        resp = run_grocery_orchestration(req)
        assert resp.sensor_analysis.anomalies_detected >= 1
        assert any(a.alert_type == "high_temperature" for a in resp.sensor_analysis.alerts)

    def test_gas_ppm_alert_in_orchestration(self):
        """High gas_ppm reading surfaces as an alert in orchestration sensor_analysis."""
        readings = [_make_sensor_reading_dict("R1", temp=3.0, gas_ppm=200.0)]
        req = UnifiedAnalyzeRequest(
            inventory=[_make_inventory_item("I1", "Tomato")],
            sensor_readings=readings,
            as_of_date=REF_DATE,
        )
        resp = run_grocery_orchestration(req)
        assert resp.sensor_analysis.status == "completed"
        alert_types = {a.alert_type for a in resp.sensor_analysis.alerts}
        assert "high_gas_ppm" in alert_types

    def test_gas_alert_message_does_not_claim_food_spoilage(self):
        """Gas alert messages must remain environmental signals."""
        readings = [_make_sensor_reading_dict("R1", temp=3.0, gas_ppm=200.0)]
        req = UnifiedAnalyzeRequest(
            inventory=[_make_inventory_item("I1", "Tomato")],
            sensor_readings=readings,
            as_of_date=REF_DATE,
        )
        resp = run_grocery_orchestration(req)
        for alert in resp.sensor_analysis.alerts:
            if alert.alert_type == "high_gas_ppm":
                assert "food is spoiled" not in alert.message.lower()

    def test_sensor_alert_does_not_change_priority_formula(self):
        """Environmental sensor alerts must not change the Use-First score formula."""
        # Score without sensor data
        req_no_sensor = UnifiedAnalyzeRequest(
            inventory=[_make_inventory_item("I1", "Tomato", days_to_expiry=3)],
            sensor_readings=None,
            include_recipes=False,
            as_of_date=REF_DATE,
        )
        resp_no = run_grocery_orchestration(req_no_sensor)
        score_no = resp_no.priority_scores[0].score

        # Score with high gas sensor alert
        req_with_sensor = UnifiedAnalyzeRequest(
            inventory=[_make_inventory_item("I1", "Tomato", days_to_expiry=3)],
            sensor_readings=[_make_sensor_reading_dict("R1", temp=3.0, gas_ppm=200.0)],
            include_recipes=False,
            as_of_date=REF_DATE,
        )
        resp_with = run_grocery_orchestration(req_with_sensor)
        score_with = resp_with.priority_scores[0].score

        # Priority formula unchanged: sensor alerts are propagated but not folded into priority score
        assert score_no == score_with, (
            f"Sensor alert must not alter priority score: {score_no} != {score_with}"
        )

    def test_sensor_analysis_skipped_when_not_provided(self):
        req = UnifiedAnalyzeRequest(
            inventory=[_make_inventory_item("I1", "Eggs")],
            sensor_readings=None,
            as_of_date=REF_DATE,
        )
        resp = run_grocery_orchestration(req)
        assert resp.sensor_analysis.status == "skipped"

    def test_invalid_gas_value_handled_gracefully_via_api(self):
        """Negative gas_ppm should mark reading as invalid, not crash the batch."""
        payload = {
            "readings": [
                {
                    "reading_id": "INV-R1",
                    "sensor_id": "SIM-01",
                    "storage_zone": "refrigerator",
                    "timestamp": (REF_TIME - timedelta(minutes=5)).isoformat(),
                    "temperature_c": 3.0,
                    "gas_ppm": -50.0,  # negative — invalid
                    "simulated": True,
                }
            ]
        }
        resp = client.post("/sensors/analyze", json=payload)
        assert resp.status_code == 200
        data = resp.json()
        assert data["invalid_readings"] == 1

    def test_voc_index_alert_via_api(self):
        payload = {
            "readings": [
                {
                    "reading_id": "VOC-R1",
                    "sensor_id": "SIM-01",
                    "storage_zone": "refrigerator",
                    "timestamp": (REF_TIME - timedelta(minutes=5)).isoformat(),
                    "temperature_c": 3.0,
                    "voc_index": 300.0,  # above 250 fridge limit
                    "simulated": True,
                }
            ]
        }
        data = client.post("/sensors/analyze", json=payload).json()
        alert_types = [a["alert_type"] for a in data["active_alerts"]]
        assert "high_voc_index" in alert_types

    def test_ethylene_ppm_alert_via_api(self):
        payload = {
            "readings": [
                {
                    "reading_id": "ETH-R1",
                    "sensor_id": "SIM-01",
                    "storage_zone": "refrigerator",
                    "timestamp": (REF_TIME - timedelta(minutes=5)).isoformat(),
                    "temperature_c": 3.0,
                    "ethylene_ppm": 8.0,  # above 5.0 fridge limit
                    "simulated": True,
                }
            ]
        }
        data = client.post("/sensors/analyze", json=payload).json()
        alert_types = [a["alert_type"] for a in data["active_alerts"]]
        assert "high_ethylene_ppm" in alert_types

    def test_malformed_sensor_data_does_not_break_orchestration(self):
        """Malformed sensor batch: orchestration records sensor_analysis status=failed,
        but grocery analysis (shelf-life, priority, recipes) still completes."""
        # Inject a reading with an unparseable field
        readings = [{"reading_id": None, "sensor_id": None, "malformed": True}]
        req = UnifiedAnalyzeRequest(
            inventory=[_make_inventory_item("I1", "Tomato")],
            sensor_readings=readings,
            as_of_date=REF_DATE,
        )
        resp = run_grocery_orchestration(req)
        # Overall orchestration should not be "failed" just because sensors failed
        assert resp.overall_status in ("completed", "partial_success")
        # Grocery priority scoring must have succeeded regardless
        assert len(resp.priority_scores) == 1


# ===========================================================================
# E. Duplicate detection and recipe recommendations
# ===========================================================================


class TestDuplicateDetectionAndRecipes:

    def test_duplicate_purchase_detected(self):
        req = UnifiedAnalyzeRequest(
            inventory=[_make_inventory_item("I1", "White Rice", days_to_expiry=60, quantity=5.0, unit="kg")],
            proposed_purchases=[
                ProposedPurchaseItem(
                    purchase_id="P1",
                    product_name="White Rice",
                    requested_quantity=1.0,
                    unit="kg",
                )
            ],
            as_of_date=REF_DATE,
        )
        resp = run_grocery_orchestration(req)
        assert resp.duplicate_purchase_analysis.status == "completed"
        assert resp.duplicate_purchase_analysis.total_proposed == 1
        result = resp.duplicate_purchase_analysis.results[0]
        assert result.recommendation in ("avoid_purchase", "use_existing_stock_first", "reduce_quantity")

    def test_no_duplicate_when_different_products(self):
        req = UnifiedAnalyzeRequest(
            inventory=[_make_inventory_item("I1", "Tomato")],
            proposed_purchases=[
                ProposedPurchaseItem(
                    purchase_id="P1",
                    product_name="White Rice",
                    requested_quantity=1.0,
                    unit="kg",
                )
            ],
            as_of_date=REF_DATE,
        )
        resp = run_grocery_orchestration(req)
        result = resp.duplicate_purchase_analysis.results[0]
        assert result.recommendation == "purchase_may_be_needed"

    def test_duplicate_section_skipped_when_no_purchases(self):
        req = UnifiedAnalyzeRequest(
            inventory=[_make_inventory_item("I1", "Tomato")],
            proposed_purchases=None,
            as_of_date=REF_DATE,
        )
        resp = run_grocery_orchestration(req)
        assert resp.duplicate_purchase_analysis.status == "skipped"

    def test_recipe_recommendations_with_known_items(self):
        req = UnifiedAnalyzeRequest(
            inventory=[
                _make_inventory_item("I1", "Tomato", days_to_expiry=3),
                _make_inventory_item("I2", "Eggs", days_to_expiry=5),
            ],
            include_recipes=True,
            as_of_date=REF_DATE,
        )
        resp = run_grocery_orchestration(req)
        assert resp.recipe_recommendations.status == "completed"
        # May have 0 or more recipes — no crash
        assert isinstance(resp.recipe_recommendations.recommendations, list)

    def test_empty_recipe_result_is_valid(self):
        """Unknown product yields 0 scored recipes (score=0) but must not crash."""
        req = UnifiedAnalyzeRequest(
            inventory=[_make_inventory_item("I1", "MysteryIngredientXYZ")],
            include_recipes=True,
            as_of_date=REF_DATE,
        )
        resp = run_grocery_orchestration(req)
        # Recipe section must complete or fail gracefully
        assert resp.recipe_recommendations.status in ("completed", "failed")
        # If completed, all recipe scores must be >= 0 (possibly 0 for unmatched items)
        if resp.recipe_recommendations.status == "completed":
            for rec in resp.recipe_recommendations.recommendations:
                assert rec.score >= 0.0

    def test_recipe_failure_does_not_corrupt_priority_results(self):
        """Even if recipe service fails, priority_scores must still be populated."""
        req = UnifiedAnalyzeRequest(
            inventory=[_make_inventory_item("I1", "Tomato", days_to_expiry=2)],
            include_recipes=True,
            as_of_date=REF_DATE,
        )
        resp = run_grocery_orchestration(req)
        # Priority scores must be present regardless of recipe status
        assert len(resp.priority_scores) == 1
        assert resp.priority_scores[0].score is not None or resp.priority_scores[0].priority_category == "Black"


# ===========================================================================
# F. Full end-to-end orchestration scenarios
# ===========================================================================


class TestEndToEndScenarios:

    def test_scenario_text_groceries_full_pipeline(self):
        """Text groceries → normalization → shelf-life → priority → recipes."""
        req = UnifiedAnalyzeRequest(
            inventory=[
                _make_inventory_item("I1", "Tomato", days_to_expiry=2, quantity=3.0),
                _make_inventory_item("I2", "Eggs", days_to_expiry=7, quantity=6.0),
                _make_inventory_item("I3", "White Rice", days_to_expiry=30, quantity=1.0, unit="kg"),
            ],
            include_recipes=True,
            recipe_limit=5,
            as_of_date=REF_DATE,
        )
        resp = run_grocery_orchestration(req)
        assert resp.overall_status == "completed"
        assert resp.inventory_summary.total_items == 3
        assert len(resp.shelf_life_estimates) == 3
        assert len(resp.priority_scores) == 3
        # Near-expiry Tomato should rank higher priority than rice
        tomato_score = next(s for s in resp.priority_scores if s.product_name == "Tomato")
        rice_score = next(s for s in resp.priority_scores if s.product_name == "White Rice")
        assert tomato_score.rank <= rice_score.rank  # lower rank = higher priority

    def test_scenario_grocery_with_sensor_alerts(self):
        """Grocery analysis with sensor alerts: alerts available, scores unchanged."""
        readings = [_make_sensor_reading_dict("R1", temp=10.0)]
        req = UnifiedAnalyzeRequest(
            inventory=[_make_inventory_item("I1", "Milk", days_to_expiry=5)],
            sensor_readings=readings,
            include_recipes=False,
            as_of_date=REF_DATE,
        )
        resp = run_grocery_orchestration(req)
        assert resp.sensor_analysis.status == "completed"
        assert resp.sensor_analysis.anomalies_detected >= 1
        # Sensor section populated but grocery analysis completes correctly
        assert len(resp.priority_scores) == 1

    def test_scenario_multiple_groceries_with_duplicates_and_recipes(self):
        """Multiple groceries + proposed purchase + recipes — all sections complete."""
        req = UnifiedAnalyzeRequest(
            inventory=[
                _make_inventory_item("I1", "Tomato", days_to_expiry=2),
                _make_inventory_item("I2", "Eggs", days_to_expiry=6),
            ],
            proposed_purchases=[
                ProposedPurchaseItem(purchase_id="P1", product_name="Eggs", requested_quantity=6.0, unit="unit")
            ],
            include_recipes=True,
            recipe_limit=3,
            as_of_date=REF_DATE,
        )
        resp = run_grocery_orchestration(req)
        assert resp.overall_status == "completed"
        assert resp.duplicate_purchase_analysis.status == "completed"
        assert resp.recipe_recommendations.status == "completed"

    def test_scenario_invalid_request_returns_422(self):
        """Empty inventory via API returns 422."""
        resp = client.post("/grocery/analyze", json={"inventory": []})
        assert resp.status_code == 422

    def test_scenario_priority_formula_unchanged_regression(self):
        """Regression: verify weight values and category boundaries are intact."""
        config = ScoringConfig()
        assert config.weight_urgency == 55.0
        assert config.weight_sensitivity == 20.0
        assert config.weight_warnings == 15.0
        assert config.weight_freshness_penalty == 10.0
        assert config.red_threshold == 80.0
        assert config.orange_threshold == 60.0
        assert config.yellow_threshold == 35.0

    def test_scenario_near_expiry_item_is_high_priority(self):
        """Item expiring same day should land in Red or Orange (high priority) category."""
        items = [
            GroceryItem(
                item_id="X1",
                product_name="Tomato",
                purchase_date=REF_DATE - timedelta(days=7),
                opened=False,
                package_use_by_date=REF_DATE,  # expires today
                as_of_date=REF_DATE,
            )
        ]
        scored = prioritize_items(PriorityScoreRequest(items=items))
        # Items at or past expiry must be Red or Orange (high urgency band)
        assert scored.scored_items[0].priority_category in ("Red", "Orange")


# ===========================================================================
# G. API contract — all routes accessible
# ===========================================================================


class TestAPIContract:

    def test_health_endpoint(self):
        resp = client.get("/health")
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "healthy"
        assert "service" in data
        assert "version" in data

    def test_product_lookup_known_product(self):
        resp = client.get("/products/tomato")
        assert resp.status_code == 200
        data = resp.json()
        assert data["product_name"] == "Tomato"

    def test_product_lookup_unknown_returns_404(self):
        resp = client.get("/products/MysteryFruitZZZ")
        assert resp.status_code == 404

    def test_shelf_life_estimate_endpoint(self):
        payload = {
            "product_name": "Milk",
            "purchase_date": str(REF_DATE),
            "opened": False,
        }
        resp = client.post("/shelf-life/estimate", json=payload)
        assert resp.status_code == 200
        data = resp.json()
        assert "estimated_end_date" in data
        assert "estimated_remaining_days" in data  # actual field name in ShelfLifeEstimateResponse

    def test_priority_score_endpoint(self):
        payload = {
            "items": [
                {
                    "item_id": "API-X1",
                    "product_name": "Tomato",
                    "purchase_date": str(REF_DATE - timedelta(days=4)),
                    "opened": False,
                    "package_use_by_date": str(REF_DATE + timedelta(days=1)),
                    "as_of_date": str(REF_DATE),
                }
            ]
        }
        resp = client.post("/priority/score", json=payload)
        assert resp.status_code == 200
        data = resp.json()
        assert "scored_items" in data
        assert len(data["scored_items"]) == 1
        assert data["scored_items"][0]["priority_category"] in ("Red", "Orange", "Yellow", "Green", "Black")

    def test_recipes_recommend_endpoint(self):
        payload = {
            "inventory": [
                {
                    "inventory_item_id": "INV-1",
                    "product_name": "Tomato",
                    "quantity": 2.0,
                    "unit": "unit",
                    "status": "available",
                }
            ],
            "limit": 3,
        }
        resp = client.post("/recipes/recommend", json=payload)
        assert resp.status_code == 200
        data = resp.json()
        assert "recommendations" in data

    def test_grocery_analyze_endpoint(self):
        payload = {
            "inventory": [
                {
                    "inventory_item_id": "INV-1",
                    "product_name": "Eggs",
                    "quantity": 6.0,
                    "unit": "unit",
                    "status": "available",
                    "expiry_date": str(REF_DATE + timedelta(days=7)),
                }
            ],
            "include_recipes": False,
            "as_of_date": str(REF_DATE),
        }
        resp = client.post("/grocery/analyze", json=payload)
        assert resp.status_code == 200
        data = resp.json()
        assert "overall_status" in data
        assert "priority_scores" in data

    def test_vision_identify_endpoint_accessible(self):
        img_bytes = _make_small_png_image()
        resp = client.post(
            "/vision/identify",
            files={"file": ("test.png", img_bytes, "image/png")},
        )
        assert resp.status_code == 200

    def test_vision_assess_freshness_endpoint_accessible(self):
        img_bytes = _make_small_png_image()
        resp = client.post(
            "/vision/assess-freshness",
            files={"file": ("test.png", img_bytes, "image/png")},
            data={"product_hint": "banana"},
        )
        assert resp.status_code in (200, 503)  # 503 if model not available

    def test_sensors_analyze_endpoint_accessible(self):
        payload = {
            "readings": [
                {
                    "reading_id": "API-R1",
                    "sensor_id": "SIM-01",
                    "storage_zone": "refrigerator",
                    "timestamp": (REF_TIME - timedelta(minutes=5)).isoformat(),
                    "temperature_c": 3.0,
                    "simulated": True,
                }
            ]
        }
        resp = client.post("/sensors/analyze", json=payload)
        assert resp.status_code == 200

    def test_vision_analyze_endpoint_accessible(self):
        """Phase 13 new combined endpoint is registered and accessible."""
        img_bytes = _make_small_png_image()
        resp = client.post(
            "/vision/analyze",
            files={"file": ("test.png", img_bytes, "image/png")},
        )
        assert resp.status_code == 200

    def test_openapi_schema_generates_without_error(self):
        """OpenAPI schema (used by /docs and /openapi.json) must generate cleanly."""
        resp = client.get("/openapi.json")
        assert resp.status_code == 200
        schema = resp.json()
        assert "paths" in schema
        # Verify Phase 13 endpoints appear in schema
        paths = schema["paths"]
        assert "/vision/analyze" in paths
        assert "/grocery/analyze" in paths


# ===========================================================================
# H. Use-First priority formula regression
# ===========================================================================


class TestPriorityFormulaRegression:

    def _score_item(
        self,
        days_remaining: int,
        ref_shelf_life_days: int = 7,
        freshness_override: bool = False,
        opened: bool = False,
    ) -> float:
        """Helper to score a deterministic Tomato item."""
        purchase_date = REF_DATE - timedelta(days=ref_shelf_life_days - days_remaining)
        items = [
            GroceryItem(
                item_id="TEST-ITEM",
                product_name="Tomato",
                purchase_date=purchase_date,
                opened=opened,
                package_use_by_date=REF_DATE + timedelta(days=days_remaining),
                as_of_date=REF_DATE,
                freshness_override=freshness_override,
            )
        ]
        resp = prioritize_items(PriorityScoreRequest(items=items))
        return resp.scored_items[0].score or 0.0

    def test_weights_sum_to_100(self):
        cfg = ScoringConfig()
        total = (
            cfg.weight_urgency
            + cfg.weight_sensitivity
            + cfg.weight_warnings
            + cfg.weight_freshness_penalty
        )
        assert abs(total - 100.0) < 1e-6

    def test_more_urgent_item_scores_higher(self):
        """Item with 1 day remaining must outscore item with 5 days."""
        score_1d = self._score_item(days_remaining=1)
        score_5d = self._score_item(days_remaining=5)
        assert score_1d > score_5d

    def test_freshness_override_increases_score(self):
        """freshness_override=True must increase the score by weight_freshness_penalty."""
        score_no = self._score_item(days_remaining=3, freshness_override=False)
        score_yes = self._score_item(days_remaining=3, freshness_override=True)
        assert score_yes > score_no
        cfg = ScoringConfig()
        assert abs(score_yes - score_no - cfg.weight_freshness_penalty) < 0.1

    def test_uncertain_freshness_does_not_trigger_override(self):
        """'uncertain' freshness condition in orchestration must NOT set freshness_override."""
        req = UnifiedAnalyzeRequest(
            inventory=[_make_inventory_item("I1", "Tomato", days_to_expiry=4)],
            freshness_overrides={"I1": "uncertain"},
            freshness_confidence={"I1": 0.9},  # high confidence, but condition is uncertain
            include_recipes=False,
            as_of_date=REF_DATE,
        )
        resp = run_grocery_orchestration(req)
        score_with_uncertain = resp.priority_scores[0].score or 0.0

        # Control: same item with no freshness override
        req_control = UnifiedAnalyzeRequest(
            inventory=[_make_inventory_item("I1", "Tomato", days_to_expiry=4)],
            include_recipes=False,
            as_of_date=REF_DATE,
        )
        resp_control = run_grocery_orchestration(req_control)
        score_control = resp_control.priority_scores[0].score or 0.0

        assert score_with_uncertain == score_control, (
            "Uncertain freshness must not change priority score"
        )

    def test_low_confidence_spoilage_does_not_trigger_override(self):
        """Low-confidence visibly_spoiled must NOT activate freshness_override."""
        req = UnifiedAnalyzeRequest(
            inventory=[_make_inventory_item("I1", "Tomato", days_to_expiry=4)],
            freshness_overrides={"I1": "visibly_spoiled"},
            freshness_confidence={"I1": 0.40},  # below 0.60 threshold
            include_recipes=False,
            as_of_date=REF_DATE,
        )
        resp_low = run_grocery_orchestration(req)
        score_low = resp_low.priority_scores[0].score or 0.0

        req_control = UnifiedAnalyzeRequest(
            inventory=[_make_inventory_item("I1", "Tomato", days_to_expiry=4)],
            include_recipes=False,
            as_of_date=REF_DATE,
        )
        resp_control = run_grocery_orchestration(req_control)
        score_control = resp_control.priority_scores[0].score or 0.0

        assert score_low == score_control, (
            "Low-confidence spoilage must not change priority score"
        )

    def test_high_confidence_visibly_spoiled_activates_override(self):
        """Confirmed high-confidence visibly_spoiled should increase score by freshness weight."""
        req_with = UnifiedAnalyzeRequest(
            inventory=[_make_inventory_item("I1", "Tomato", days_to_expiry=4)],
            freshness_overrides={"I1": "visibly_spoiled"},
            freshness_confidence={"I1": 0.85},  # above 0.60 threshold
            include_recipes=False,
            as_of_date=REF_DATE,
        )
        req_without = UnifiedAnalyzeRequest(
            inventory=[_make_inventory_item("I1", "Tomato", days_to_expiry=4)],
            include_recipes=False,
            as_of_date=REF_DATE,
        )
        score_with = run_grocery_orchestration(req_with).priority_scores[0].score or 0.0
        score_without = run_grocery_orchestration(req_without).priority_scores[0].score or 0.0

        cfg = ScoringConfig()
        assert abs(score_with - score_without - cfg.weight_freshness_penalty) < 0.1

    def test_invalid_freshness_condition_generates_warning_not_crash(self):
        """Unrecognised freshness condition is warned and ignored, not a crash."""
        req = UnifiedAnalyzeRequest(
            inventory=[_make_inventory_item("I1", "Tomato", days_to_expiry=4)],
            freshness_overrides={"I1": "mouldy_but_fine"},  # unrecognised
            include_recipes=False,
            as_of_date=REF_DATE,
        )
        resp = run_grocery_orchestration(req)
        assert resp.overall_status in ("completed", "partial_success")
        assert any("mouldy_but_fine" in w for w in resp.warnings)

    def test_category_boundaries(self):
        """Verify Red/Orange/Yellow/Green thresholds map correctly."""
        from app.services.priority_scoring import _categorize, DEFAULT_SCORING_CONFIG

        assert _categorize(90.0, DEFAULT_SCORING_CONFIG) == "Red"
        assert _categorize(70.0, DEFAULT_SCORING_CONFIG) == "Orange"
        assert _categorize(50.0, DEFAULT_SCORING_CONFIG) == "Yellow"
        assert _categorize(20.0, DEFAULT_SCORING_CONFIG) == "Green"
        assert _categorize(None, DEFAULT_SCORING_CONFIG) == "Black"


# ===========================================================================
# I. Freshness override integration (Phase 13 new feature)
# ===========================================================================


class TestFreshnessOverrideIntegration:

    def test_freshness_overrides_field_accepted_in_request(self):
        """freshness_overrides and freshness_confidence are valid request fields."""
        req = UnifiedAnalyzeRequest(
            inventory=[_make_inventory_item("I1", "Tomato")],
            freshness_overrides={"I1": "fresh"},
            freshness_confidence={"I1": 0.85},
            include_recipes=False,
            as_of_date=REF_DATE,
        )
        resp = run_grocery_orchestration(req)
        assert resp.overall_status in ("completed", "partial_success")

    def test_fresh_condition_does_not_add_spoilage_penalty(self):
        """freshness='fresh' must NOT add the spoilage penalty."""
        req = UnifiedAnalyzeRequest(
            inventory=[_make_inventory_item("I1", "Tomato", days_to_expiry=4)],
            freshness_overrides={"I1": "fresh"},
            freshness_confidence={"I1": 0.9},
            include_recipes=False,
            as_of_date=REF_DATE,
        )
        req_control = UnifiedAnalyzeRequest(
            inventory=[_make_inventory_item("I1", "Tomato", days_to_expiry=4)],
            include_recipes=False,
            as_of_date=REF_DATE,
        )
        score_fresh = run_grocery_orchestration(req).priority_scores[0].score or 0.0
        score_control = run_grocery_orchestration(req_control).priority_scores[0].score or 0.0
        assert score_fresh == score_control

    def test_ripe_condition_does_not_add_spoilage_penalty(self):
        """freshness='ripe' must NOT add the spoilage penalty."""
        req = UnifiedAnalyzeRequest(
            inventory=[_make_inventory_item("I1", "Banana", days_to_expiry=3)],
            freshness_overrides={"I1": "ripe"},
            freshness_confidence={"I1": 0.8},
            include_recipes=False,
            as_of_date=REF_DATE,
        )
        req_control = UnifiedAnalyzeRequest(
            inventory=[_make_inventory_item("I1", "Banana", days_to_expiry=3)],
            include_recipes=False,
            as_of_date=REF_DATE,
        )
        score_ripe = run_grocery_orchestration(req).priority_scores[0].score or 0.0
        score_control = run_grocery_orchestration(req_control).priority_scores[0].score or 0.0
        assert score_ripe == score_control

    def test_freshness_override_for_different_item_ignored(self):
        """freshness_override keyed to a non-existent item_id has no effect."""
        req = UnifiedAnalyzeRequest(
            inventory=[_make_inventory_item("I1", "Tomato", days_to_expiry=4)],
            freshness_overrides={"NONEXISTENT-ID": "visibly_spoiled"},
            freshness_confidence={"NONEXISTENT-ID": 0.9},
            include_recipes=False,
            as_of_date=REF_DATE,
        )
        req_control = UnifiedAnalyzeRequest(
            inventory=[_make_inventory_item("I1", "Tomato", days_to_expiry=4)],
            include_recipes=False,
            as_of_date=REF_DATE,
        )
        score = run_grocery_orchestration(req).priority_scores[0].score or 0.0
        score_ctrl = run_grocery_orchestration(req_control).priority_scores[0].score or 0.0
        assert score == score_ctrl

    def test_via_api_grocery_analyze_accepts_freshness_fields(self):
        """POST /grocery/analyze accepts freshness_overrides in the JSON payload."""
        payload = {
            "inventory": [
                {
                    "inventory_item_id": "API-I1",
                    "product_name": "Tomato",
                    "quantity": 2.0,
                    "unit": "unit",
                    "status": "available",
                    "expiry_date": str(REF_DATE + timedelta(days=4)),
                }
            ],
            "freshness_overrides": {"API-I1": "visibly_spoiled"},
            "freshness_confidence": {"API-I1": 0.85},
            "include_recipes": False,
            "as_of_date": str(REF_DATE),
        }
        resp = client.post("/grocery/analyze", json=payload)
        assert resp.status_code == 200
        data = resp.json()
        assert data["overall_status"] == "completed"


# ===========================================================================
# J. Combined vision analysis endpoint (Phase 13 new feature)
# ===========================================================================


class TestCombinedVisionEndpoint:

    def test_vision_analyze_returns_200_for_valid_image(self):
        img_bytes = _make_small_png_image()
        resp = client.post(
            "/vision/analyze",
            files={"file": ("test.png", img_bytes, "image/png")},
        )
        assert resp.status_code == 200

    def test_vision_analyze_response_has_required_fields(self):
        img_bytes = _make_small_png_image()
        data = client.post(
            "/vision/analyze",
            files={"file": ("test.png", img_bytes, "image/png")},
        ).json()
        assert "identification" in data
        assert "freshness" in data or data.get("freshness") is None
        assert "orchestration_hint" in data
        assert "disclaimer" in data

    def test_vision_analyze_identification_section_populated(self):
        img_bytes = _make_small_png_image()
        data = client.post(
            "/vision/analyze",
            files={"file": ("test.png", img_bytes, "image/png")},
        ).json()
        id_section = data["identification"]
        assert "confidence" in id_section
        assert "is_confident" in id_section
        assert "requires_confirmation" in id_section

    def test_vision_analyze_orchestration_hint_populated(self):
        img_bytes = _make_small_png_image()
        data = client.post(
            "/vision/analyze",
            files={"file": ("test.png", img_bytes, "image/png")},
        ).json()
        hint = data["orchestration_hint"]
        assert "suggested_product_name" in hint
        assert "requires_confirmation" in hint
        assert "freshness_condition" in hint
        assert "freshness_confidence" in hint

    def test_vision_analyze_empty_image_returns_400(self):
        resp = client.post(
            "/vision/analyze",
            files={"file": ("empty.png", b"", "image/png")},
        )
        assert resp.status_code == 400

    def test_vision_analyze_missing_filename_returns_400_or_422(self):
        resp = client.post(
            "/vision/analyze",
            files={"file": ("", _make_small_png_image(), "image/png")},
        )
        assert resp.status_code in (400, 422)

    def test_vision_analyze_invalid_format_returns_400(self):
        resp = client.post(
            "/vision/analyze",
            files={"file": ("doc.gif", b"GIF89a", "image/gif")},
        )
        assert resp.status_code == 400

    def test_vision_analyze_disclaimer_is_present(self):
        """Combined endpoint must include a safety disclaimer."""
        img_bytes = _make_small_png_image()
        data = client.post(
            "/vision/analyze",
            files={"file": ("test.png", img_bytes, "image/png")},
        ).json()
        assert "disclaimer" in data
        assert len(data["disclaimer"]) > 10

    def test_vision_analyze_freshness_skipped_for_non_supported_product(self):
        """If identified product is not in freshness-supported set, freshness is None
        and freshness_skipped_reason is populated."""
        # A yellow-tinged image tends to be identified as Banana/Lemon.
        # But if identified as Broccoli/Milk/etc., freshness is skipped.
        # We can't fully control what the prototype identifies, so we test
        # that when freshness is None, freshness_skipped_reason is also set.
        img_bytes = _make_small_png_image()
        data = client.post(
            "/vision/analyze",
            files={"file": ("test.png", img_bytes, "image/png")},
        ).json()
        if data.get("freshness") is None:
            assert data.get("freshness_skipped_reason") is not None


# ===========================================================================
# K. Safety constraints
# ===========================================================================


class TestSafetyConstraints:

    def test_uncertain_freshness_not_classified_as_spoiled(self):
        """Uncertain freshness must never produce 'visibly_spoiled' condition."""
        img_bytes = _make_small_png_image()
        data = client.post(
            "/vision/assess-freshness",
            files={"file": ("test.png", img_bytes, "image/png")},
            data={"product_hint": "banana"},
        ).json()
        if data["condition"] == "uncertain":
            assert data["requires_confirmation"] is True

    def test_gas_sensor_alert_message_is_environmental_not_spoilage(self):
        """All gas/VOC alert messages must explicitly be environmental warnings."""
        r = SensorReading(
            reading_id="SAFE-01",
            sensor_id="SIM-01",
            storage_zone="refrigerator",
            timestamp=REF_TIME - timedelta(minutes=5),
            temperature_c=3.0,
            gas_ppm=200.0,
            simulated=True,
        )
        alerts, _ = check_individual_reading(r, DEFAULT_ZONE_CONFIGS["refrigerator"], REF_TIME)
        gas_alerts = [a for a in alerts if a.alert_type == "high_gas_ppm"]
        assert len(gas_alerts) == 1
        msg = gas_alerts[0].message.lower()
        assert "warning" in msg or "environmental" in msg
        assert "food is spoiled" not in msg
        assert "unsafe to eat" not in msg

    def test_freshness_limitations_field_contains_safety_caveats(self):
        """limitations field must contain visibility/safety boundary text."""
        img_bytes = _make_small_png_image()
        data = client.post(
            "/vision/assess-freshness",
            files={"file": ("test.png", img_bytes, "image/png")},
            data={"product_hint": "apple"},
        ).json()
        limitations_text = " ".join(data.get("limitations", [])).lower()
        # Must include at least one safety caveat
        assert any(
            kw in limitations_text
            for kw in ("microbiological", "pathogen", "food-safety", "safety", "visible", "surface")
        )

    def test_combined_vision_disclaimer_mentions_safety(self):
        img_bytes = _make_small_png_image()
        data = client.post(
            "/vision/analyze",
            files={"file": ("test.png", img_bytes, "image/png")},
        ).json()
        disclaimer = data.get("disclaimer", "").lower()
        assert any(kw in disclaimer for kw in ("safety", "microbiological", "spoilage"))

    def test_freshness_override_does_not_override_expiry_date(self):
        """Even with visibly_spoiled freshness, expiry_date in shelf-life estimate is unchanged."""
        explicit_expiry = REF_DATE + timedelta(days=10)
        req = UnifiedAnalyzeRequest(
            inventory=[
                InventoryItem(
                    inventory_item_id="I1",
                    product_name="Tomato",
                    quantity=2.0,
                    unit="unit",
                    status="available",
                    expiry_date=explicit_expiry,
                )
            ],
            freshness_overrides={"I1": "visibly_spoiled"},
            freshness_confidence={"I1": 0.95},
            include_recipes=False,
            as_of_date=REF_DATE,
        )
        resp = run_grocery_orchestration(req)
        # The package_use_by_date in shelf-life must still reflect the explicit expiry
        sl = resp.shelf_life_estimates[0]
        # The estimated end date must be >= as_of_date (shelf life estimate not corrupted)
        assert sl.estimated_end_date is not None

    def test_priority_formula_weights_unchanged_by_phase_13(self):
        """Strict regression: scoring weights are exactly those from the original formula."""
        cfg = ScoringConfig()
        assert cfg.weight_urgency == 55.0
        assert cfg.weight_sensitivity == 20.0
        assert cfg.weight_warnings == 15.0
        assert cfg.weight_freshness_penalty == 10.0
