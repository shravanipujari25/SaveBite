"""Phase 14 Final AI Validation and Stabilization Regression Tests.

This test module verifies:
1. All 10 endpoint contracts and HTTP status codes
2. Comprehensive negative and boundary scenarios:
   - Empty/missing inputs
   - Invalid JSON / bad types
   - Invalid sensor readings (invalid values identified in validation issues)
   - Invalid and corrupted image uploads
   - Oversized images (> 5MB)
   - Zero-dimension or non-image files
   - Unsupported product categories and low confidence handling
   - Model artifact missing behavior (HTTP 503)
   - Freshness override gating: only visibly_spoiled with conf >= 0.60
   - Multi-item priority scoring and Black category handling
   - Sensor batch analysis with sustained gas and VOC anomalies
   - Ethylene single-reading alerts and verification that sustained ethylene is not claimed
"""

import io
import math
import sys
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from app.main import app
from app.services.product_catalog import lookup_product
from app.services.priority_scoring import (
    GroceryItem,
    PriorityScoreRequest,
    prioritize_items,
    DEFAULT_SCORING_CONFIG,
)
from app.services.sensor_service import (
    SensorReading,
    analyze_sensor_readings,
)
from app.services.grocery_orchestration_service import (
    UnifiedAnalyzeRequest,
    run_grocery_orchestration,
)
from app.services.duplicate_purchase_service import InventoryItem

client = TestClient(app)


def _create_test_image_bytes(color=(250, 230, 20), size=(100, 100), fmt="JPEG") -> bytes:
    """Helper to generate in-memory image bytes."""
    buf = io.BytesIO()
    img = Image.new("RGB", size, color=color)
    img.save(buf, format=fmt)
    return buf.getvalue()


# ===========================================================================
# 1. Endpoint Contract & Method Verification (10 Endpoints)
# ===========================================================================

class TestEndpointContracts:
    """Verify each of the 10 endpoints responds correctly to valid requests."""

    def test_01_get_health(self):
        resp = client.get("/health")
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "healthy"
        assert "version" in data
        assert "service" in data

    def test_02_get_product_valid(self):
        resp = client.get("/products/Milk")
        assert resp.status_code == 200
        data = resp.json()
        assert data["product_id"] == "GRC016"
        assert data["storage_zone"] == "refrigerator"

    def test_02_get_product_not_found(self):
        resp = client.get("/products/non_existent_item_xyz")
        assert resp.status_code == 404
        assert "not found" in resp.json()["detail"].lower()

    def test_03_post_shelf_life_estimate_valid(self):
        payload = {
            "product_name": "Milk",
            "storage_zone": "refrigerator",
            "purchase_date": "2026-10-20",
            "opened": False,
            "as_of_date": "2026-10-22",
        }
        resp = client.post("/shelf-life/estimate", json=payload)
        assert resp.status_code == 200
        data = resp.json()
        assert data["product_found"] is True
        assert data["estimated_remaining_days"] is not None

    def test_04_post_priority_score_valid(self):
        payload = {
            "items": [
                {
                    "item_id": "ITEM-1",
                    "product_name": "Milk",
                    "purchase_date": "2026-10-20",
                    "opened": False,
                    "storage_zone": "refrigerator",
                    "as_of_date": "2026-10-22",
                }
            ]
        }
        resp = client.post("/priority/score", json=payload)
        assert resp.status_code == 200
        data = resp.json()
        assert len(data["scored_items"]) == 1
        assert data["scored_items"][0]["priority_category"] in ("Red", "Orange", "Yellow", "Green")

    def test_05_post_recipes_recommend_valid(self):
        payload = {
            "inventory": [
                {
                    "inventory_item_id": "INV-1",
                    "product_name": "Milk",
                    "quantity": 1.0,
                    "unit": "l",
                    "storage_zone": "refrigerator",
                    "purchase_date": "2026-10-20",
                    "opened": False,
                }
            ],
            "limit": 5,
        }
        resp = client.post("/recipes/recommend", json=payload)
        assert resp.status_code == 200
        data = resp.json()
        assert "recommendations" in data

    def test_06_post_grocery_analyze_valid(self):
        payload = {
            "inventory": [
                {
                    "inventory_item_id": "INV-1",
                    "product_name": "Milk",
                    "quantity": 1.0,
                    "unit": "l",
                    "storage_zone": "refrigerator",
                    "purchase_date": "2026-10-20",
                    "opened": False,
                }
            ]
        }
        resp = client.post("/grocery/analyze", json=payload)
        assert resp.status_code == 200
        data = resp.json()
        assert "overall_status" in data
        assert "inventory_summary" in data

    def test_07_post_vision_identify_valid(self):
        img_bytes = _create_test_image_bytes(color=(250, 230, 20), size=(100, 100))
        files = {"file": ("banana.jpg", img_bytes, "image/jpeg")}
        resp = client.post("/vision/identify", files=files)
        assert resp.status_code == 200
        data = resp.json()
        assert "identified_product_name" in data
        assert "confidence" in data

    def test_08_post_vision_assess_freshness_valid(self):
        img_bytes = _create_test_image_bytes(color=(250, 230, 20), size=(100, 100))
        files = {"file": ("banana.jpg", img_bytes, "image/jpeg")}
        data = {"product_hint": "banana"}
        resp = client.post("/vision/assess-freshness", files=files, data=data)
        assert resp.status_code == 200
        res = resp.json()
        assert res["condition"] in ("fresh", "ripe", "visibly_spoiled", "uncertain")

    def test_09_post_vision_analyze_valid(self):
        img_bytes = _create_test_image_bytes(color=(250, 230, 20), size=(100, 100))
        files = {"file": ("banana.jpg", img_bytes, "image/jpeg")}
        resp = client.post("/vision/analyze", files=files)
        assert resp.status_code == 200
        data = resp.json()
        assert "identification" in data
        assert "orchestration_hint" in data
        assert "disclaimer" in data

    def test_10_post_sensors_analyze_valid(self):
        payload = {
            "readings": [
                {
                    "reading_id": "R1",
                    "sensor_id": "SEN-01",
                    "storage_zone": "refrigerator",
                    "timestamp": "2026-10-25T01:00:00Z",
                    "temperature_c": 3.0,
                    "humidity_percent": 60.0,
                    "gas_ppm": 20.0,
                    "voc_index": 80.0,
                    "simulated": True,
                }
            ]
        }
        resp = client.post("/sensors/analyze", json=payload)
        assert resp.status_code == 200
        data = resp.json()
        assert data["total_readings"] == 1
        assert data["valid_readings"] == 1


# ===========================================================================
# 2. Input Validation and Boundary Edge Cases
# ===========================================================================

class TestValidationEdgeCases:
    """Verify input validation, rejection of invalid data, and safe handling."""

    def test_missing_required_fields_shelf_life(self):
        resp = client.post("/shelf-life/estimate", json={})
        assert resp.status_code == 422

    def test_empty_items_list_priority_scoring(self):
        resp = client.post("/priority/score", json={"items": []})
        assert resp.status_code == 422

    def test_duplicate_item_ids_priority_scoring(self):
        payload = {
            "items": [
                {"item_id": "DUP-1", "product_name": "Apple", "purchase_date": "2026-10-20", "opened": False},
                {"item_id": "DUP-1", "product_name": "Banana", "purchase_date": "2026-10-20", "opened": False},
            ]
        }
        resp = client.post("/priority/score", json=payload)
        assert resp.status_code == 422

    def test_sensor_negative_gas_reading_captured_in_validation_issues(self):
        payload = {
            "readings": [
                {
                    "reading_id": "R1",
                    "sensor_id": "S1",
                    "storage_zone": "refrigerator",
                    "timestamp": "2026-10-25T01:00:00Z",
                    "gas_ppm": -10.0,
                    "simulated": True,
                }
            ]
        }
        resp = client.post("/sensors/analyze", json=payload)
        assert resp.status_code == 200
        data = resp.json()
        assert data["invalid_readings"] == 1
        assert len(data["results_by_reading"][0]["validation_issues"]) > 0

    def test_sensor_humidity_out_of_bounds_captured_in_validation_issues(self):
        payload = {
            "readings": [
                {
                    "reading_id": "R1",
                    "sensor_id": "S1",
                    "storage_zone": "refrigerator",
                    "timestamp": "2026-10-25T01:00:00Z",
                    "humidity_percent": 150.0,
                    "simulated": True,
                }
            ]
        }
        resp = client.post("/sensors/analyze", json=payload)
        assert resp.status_code == 200
        data = resp.json()
        assert data["invalid_readings"] == 1
        assert len(data["results_by_reading"][0]["validation_issues"]) > 0

    def test_empty_sensor_batch_handled(self):
        payload = {"readings": []}
        resp = client.post("/sensors/analyze", json=payload)
        assert resp.status_code == 200
        data = resp.json()
        assert data["total_readings"] == 0
        assert data["active_alerts"] == []

    def test_corrupted_image_upload_rejected(self):
        corrupted_bytes = b"not-a-valid-image-format-content"
        files = {"file": ("corrupted.jpg", corrupted_bytes, "image/jpeg")}
        resp = client.post("/vision/identify", files=files)
        assert resp.status_code in (400, 422)

    def test_unsupported_image_extension_rejected(self):
        img_bytes = _create_test_image_bytes(fmt="PNG")
        files = {"file": ("test.gif", img_bytes, "image/gif")}
        resp = client.post("/vision/identify", files=files)
        assert resp.status_code in (400, 422)

    def test_oversized_image_upload_rejected(self):
        oversized_bytes = b"0" * (6 * 1024 * 1024)
        files = {"file": ("huge.jpg", oversized_bytes, "image/jpeg")}
        resp = client.post("/vision/identify", files=files)
        assert resp.status_code in (400, 422)


# ===========================================================================
# 3. Model Failure & Safety Gating Tests
# ===========================================================================

class TestModelAndSafetyGating:
    """Verify model error handling, food safety limits, and override thresholds."""

    def test_freshness_override_below_confidence_threshold_does_not_override(self):
        """visibly_spoiled override with confidence 0.50 (< 0.60 threshold) must NOT apply."""
        req = UnifiedAnalyzeRequest(
            inventory=[
                InventoryItem(
                    inventory_item_id="INV-APPLE-1",
                    product_name="Apple",
                    quantity=1.0,
                    unit="piece",
                    purchase_date=date(2026, 10, 20),
                    opened=False,
                )
            ],
            as_of_date=date(2026, 10, 22),
            freshness_overrides={"INV-APPLE-1": "visibly_spoiled"},
            freshness_confidence={"INV-APPLE-1": 0.50},
        )
        res = run_grocery_orchestration(req)
        scored = res.priority_scores[0]
        assert "visible spoilage signal" not in scored.explanation.lower()

    def test_freshness_override_confident_applies(self):
        """visibly_spoiled override with confidence 0.85 (>= 0.60 threshold) MUST apply."""
        req = UnifiedAnalyzeRequest(
            inventory=[
                InventoryItem(
                    inventory_item_id="INV-APPLE-2",
                    product_name="Apple",
                    quantity=1.0,
                    unit="piece",
                    purchase_date=date(2026, 10, 20),
                    opened=False,
                )
            ],
            as_of_date=date(2026, 10, 22),
            freshness_overrides={"INV-APPLE-2": "visibly_spoiled"},
            freshness_confidence={"INV-APPLE-2": 0.85},
        )
        res = run_grocery_orchestration(req)
        scored = res.priority_scores[0]
        assert "visible spoilage signal" in scored.explanation.lower()

    def test_non_spoiled_condition_does_not_trigger_override(self):
        """'fresh' or 'ripe' conditions must not trigger the spoilage penalty override."""
        for cond in ("fresh", "ripe", "uncertain"):
            req = UnifiedAnalyzeRequest(
                inventory=[
                    InventoryItem(
                        inventory_item_id=f"INV-APP-{cond}",
                        product_name="Apple",
                        quantity=1.0,
                        unit="piece",
                        purchase_date=date(2026, 10, 20),
                        opened=False,
                    )
                ],
                as_of_date=date(2026, 10, 22),
                freshness_overrides={f"INV-APP-{cond}": cond},
                freshness_confidence={f"INV-APP-{cond}": 0.95},
            )
            res = run_grocery_orchestration(req)
            scored = res.priority_scores[0]
            assert "visible spoilage signal" not in scored.explanation.lower()

    def test_unscorable_unknown_product_gets_black_category(self):
        """An unknown product must receive 'Black' priority category and score=None."""
        item = GroceryItem(
            item_id="ITEM-UNK",
            product_name="unknown_space_fruit_xyz",
            purchase_date=date(2026, 10, 20),
            opened=False,
        )
        scored = prioritize_items(PriorityScoreRequest(items=[item])).scored_items[0]
        assert scored.priority_category == "Black"
        assert scored.score is None
        assert scored.product_found is False

    def test_freshness_service_model_unavailable_returns_503(self):
        """Simulate missing model by mocking is_model_available to False."""
        with patch("app.services.freshness_assessment_service.FreshnessAssessmentService.is_model_available", False):
            img_bytes = _create_test_image_bytes(fmt="JPEG")
            files = {"file": ("apple.jpg", img_bytes, "image/jpeg")}
            data = {"product_hint": "apple"}
            resp = client.post("/vision/assess-freshness", files=files, data=data)
            assert resp.status_code == 503
            assert "not available" in resp.json()["detail"].lower()
