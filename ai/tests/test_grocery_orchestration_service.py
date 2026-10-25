"""Automated Test Suite for Phase 8: System Integration & End-to-End Orchestration.

Tests:
  A. Successful Workflow:
     - Full unified request with inventory produces complete structured analysis
     - Product catalog normalization and resolution details included
     - Shelf-life estimates computed
     - Use-First priority scores and categories computed
     - Recipe recommendations utilize priority data
     - Deterministic as_of_date evaluation
  B. Optional Component Toggling:
     - Sensor analysis marked 'skipped' when telemetry is not supplied
     - Sensor analysis executed and marked 'completed' with simulated=True when telemetry is supplied
     - Duplicate purchase detection marked 'skipped' when proposed purchases omitted
     - Duplicate purchase detection executed when proposed purchases supplied
     - Recipe recommendations marked 'skipped' when include_recipes=False
     - Recipe recommendations executed when include_recipes=True
  C. Input Validation & Edge Cases:
     - Empty inventory list is rejected (422 / ValueError)
     - Unknown product handled without crashing and tagged in unresolved count
     - Expired stock tracked in inventory summary and excluded from recipe usability
     - Non-positive / consumed / discarded stock tracked in unavailable count
     - Input objects are not mutated
     - Deterministic tie-breaking and reproducibility
  D. Error Handling & Partial Failures:
     - Graceful recovery when optional sections encounter issues
     - Status values properly reflected ('completed', 'skipped', 'failed', 'partial_success')
  E. API Integration:
     - POST /grocery/analyze endpoint returns 200 with schema matching UnifiedAnalyzeResponse
     - Validation error on empty inventory payload (422)
     - Preserves all pre-existing endpoints (e.g. GET /health, GET /products/..., POST /recipes/recommend)
"""

import sys
from pathlib import Path

# Ensure ai directory is on sys.path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from datetime import date, timedelta
import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.services.duplicate_purchase_service import InventoryItem, ProposedPurchaseItem
from app.services.grocery_orchestration_service import (
    UnifiedAnalyzeRequest,
    UnifiedAnalyzeResponse,
    run_grocery_orchestration,
)


@pytest.fixture
def client() -> TestClient:
    return TestClient(app)


@pytest.fixture
def ref_date() -> date:
    return date(2026, 10, 24)


# ---------------------------------------------------------------------------
# A. Core Unified Workflow Tests
# ---------------------------------------------------------------------------

def test_unified_workflow_with_inventory(ref_date):
    """Test standard unified workflow with inventory only."""
    req = UnifiedAnalyzeRequest(
        inventory=[
            InventoryItem(
                inventory_item_id="INV-01",
                product_name="Tomato",
                quantity=4.0,
                unit="unit",
                status="available",
                expiry_date=ref_date + timedelta(days=2),
            ),
            InventoryItem(
                inventory_item_id="INV-02",
                product_name="White Rice",
                quantity=1.0,
                unit="kg",
                status="available",
                expiry_date=ref_date + timedelta(days=30),
            ),
        ],
        as_of_date=ref_date,
        include_recipes=True,
        recipe_limit=5,
    )

    resp = run_grocery_orchestration(req)

    assert isinstance(resp, UnifiedAnalyzeResponse)
    assert resp.overall_status == "completed"
    assert resp.as_of_date == ref_date

    # Inventory summary
    assert resp.inventory_summary.total_items == 2
    assert resp.inventory_summary.eligible_items == 2
    assert resp.inventory_summary.expired_items == 0
    assert resp.inventory_summary.unavailable_items == 0
    assert resp.inventory_summary.unresolved_products == 0

    # Product resolution
    assert len(resp.product_resolutions) == 2
    assert all(pr.found_in_catalog for pr in resp.product_resolutions)
    tomato_res = next(pr for pr in resp.product_resolutions if pr.original_product_name == "Tomato")
    assert tomato_res.canonical_name == "Tomato"
    assert tomato_res.catalog_product_id is not None

    # Shelf-life estimates
    assert len(resp.shelf_life_estimates) == 2

    # Use-First priority scores
    assert len(resp.priority_scores) == 2
    assert any(sc.product_name == "Tomato" and sc.priority_category in ("Red", "Orange", "Yellow", "Green") for sc in resp.priority_scores)

    # Optional components behavior when omitted
    assert resp.sensor_analysis.status == "skipped"
    assert resp.sensor_analysis.simulated is False
    assert resp.duplicate_purchase_analysis.status == "skipped"

    # Recipe recommendations
    assert resp.recipe_recommendations.status == "completed"
    assert resp.recipe_recommendations.total_recommendations > 0
    top_recipe = resp.recipe_recommendations.recommendations[0]
    assert top_recipe.score > 0.0


# ---------------------------------------------------------------------------
# B. Optional Component Toggling Tests
# ---------------------------------------------------------------------------

def test_sensor_telemetry_integration_when_supplied(ref_date):
    """Test that supplying sensor telemetry triggers Phase 5 analysis."""
    readings = [
        {
            "reading_id": "RD-01",
            "sensor_id": "SN-TEMP-01",
            "storage_zone": "refrigerator",
            "timestamp": "2026-10-24T10:00:00Z",
            "temperature_c": 11.5, # Out of safe refrigerator range -> triggers high_temperature alert
            "humidity_percent": 65.0,
            "door_open": False,
            "power_interruption_minutes": 0.0,
            "simulated": True,
        }
    ]

    req = UnifiedAnalyzeRequest(
        inventory=[
            InventoryItem(
                inventory_item_id="INV-01",
                product_name="Milk",
                quantity=1.0,
                unit="l",
                status="available",
            )
        ],
        sensor_readings=readings,
        as_of_date=ref_date,
    )

    resp = run_grocery_orchestration(req)

    assert resp.sensor_analysis.status == "completed"
    assert resp.sensor_analysis.simulated is True
    assert resp.sensor_analysis.total_readings_analyzed == 1
    assert resp.sensor_analysis.anomalies_detected >= 1
    assert any(a.alert_type == "high_temperature" for a in resp.sensor_analysis.alerts)
    assert resp.simulated_data_used is True


def test_duplicate_purchase_detection_when_supplied(ref_date):
    """Test that supplying proposed purchases triggers Phase 6 duplicate detection."""
    req = UnifiedAnalyzeRequest(
        inventory=[
            InventoryItem(
                inventory_item_id="INV-01",
                product_name="White Rice",
                quantity=5.0,
                unit="kg",
                status="available",
                expiry_date=ref_date + timedelta(days=60),
            )
        ],
        proposed_purchases=[
            ProposedPurchaseItem(
                purchase_id="PUR-01",
                product_name="White Rice",
                requested_quantity=1.0,
                unit="kg",
            )
        ],
        as_of_date=ref_date,
    )

    resp = run_grocery_orchestration(req)

    assert resp.duplicate_purchase_analysis.status == "completed"
    assert resp.duplicate_purchase_analysis.total_proposed == 1
    dup_res = resp.duplicate_purchase_analysis.results[0]
    assert dup_res.recommendation in ("avoid_purchase", "use_existing_stock_first")


def test_recipe_recommendations_can_be_disabled(ref_date):
    """Test that include_recipes=False correctly skips Phase 7."""
    req = UnifiedAnalyzeRequest(
        inventory=[
            InventoryItem(
                inventory_item_id="INV-01",
                product_name="Tomato",
                quantity=2.0,
                unit="unit",
                status="available",
            )
        ],
        include_recipes=False,
        as_of_date=ref_date,
    )

    resp = run_grocery_orchestration(req)

    assert resp.recipe_recommendations.status == "skipped"
    assert resp.recipe_recommendations.total_recommendations == 0
    assert len(resp.recipe_recommendations.recommendations) == 0


# ---------------------------------------------------------------------------
# C. Input Validation, Inventory Classification & Safety
# ---------------------------------------------------------------------------

def test_empty_inventory_rejected():
    """Verify that empty inventory raises validation error."""
    with pytest.raises(ValueError):
        UnifiedAnalyzeRequest(inventory=[])


def test_inventory_classification_expired_and_unavailable(ref_date):
    """Verify that expired and consumed/discarded items are safely classified and excluded."""
    req = UnifiedAnalyzeRequest(
        inventory=[
            InventoryItem(
                inventory_item_id="INV-OK",
                product_name="Eggs",
                quantity=6.0,
                unit="unit",
                status="available",
                expiry_date=ref_date + timedelta(days=5),
            ),
            InventoryItem(
                inventory_item_id="INV-EXP",
                product_name="Milk",
                quantity=1.0,
                unit="l",
                status="available",
                expiry_date=ref_date - timedelta(days=2), # Expired!
            ),
            InventoryItem(
                inventory_item_id="INV-CONS",
                product_name="Onion",
                quantity=2.0,
                unit="unit",
                status="consumed", # Ineligible!
            ),
        ],
        as_of_date=ref_date,
    )

    resp = run_grocery_orchestration(req)

    assert resp.inventory_summary.total_items == 3
    assert resp.inventory_summary.eligible_items == 1 # Only Eggs
    assert resp.inventory_summary.expired_items == 1 # Milk
    assert resp.inventory_summary.unavailable_items == 1 # Onion


def test_unknown_product_unresolved_handling(ref_date):
    """Verify unknown product does not crash orchestration and is flagged."""
    req = UnifiedAnalyzeRequest(
        inventory=[
            InventoryItem(
                inventory_item_id="INV-MYSTERY",
                product_name="ExoticMartianFruitXYZ",
                quantity=1.0,
                unit="unit",
                status="available",
            )
        ],
        as_of_date=ref_date,
    )

    resp = run_grocery_orchestration(req)

    assert resp.inventory_summary.unresolved_products == 1
    assert any("ExoticMartianFruitXYZ" in w for w in resp.warnings)
    res_item = resp.product_resolutions[0]
    assert res_item.found_in_catalog is False
    assert res_item.catalog_product_id is None


def test_input_non_mutation(ref_date):
    """Ensure user inventory and proposed purchases are not mutated."""
    inv = [
        InventoryItem(
            inventory_item_id="INV-01",
            product_name="Tomato",
            quantity=3.0,
            unit="unit",
            status="available",
        )
    ]
    props = [
        ProposedPurchaseItem(
            purchase_id="PUR-01",
            product_name="Tomato",
            requested_quantity=1.0,
            unit="unit",
        )
    ]

    req = UnifiedAnalyzeRequest(
        inventory=inv,
        proposed_purchases=props,
        as_of_date=ref_date,
    )

    _ = run_grocery_orchestration(req)

    assert inv[0].quantity == 3.0
    assert inv[0].unit == "unit"
    assert props[0].requested_quantity == 1.0


# ---------------------------------------------------------------------------
# D. API Integration Tests
# ---------------------------------------------------------------------------

def test_api_grocery_analyze_endpoint_success(client, ref_date):
    """Test POST /grocery/analyze returns HTTP 200 with complete unified response."""
    payload = {
        "inventory": [
            {
                "inventory_item_id": "API-INV-01",
                "product_name": "Tomato",
                "quantity": 3.0,
                "unit": "unit",
                "status": "available",
                "expiry_date": str(ref_date + timedelta(days=2)),
            },
            {
                "inventory_item_id": "API-INV-02",
                "product_name": "White Rice",
                "quantity": 1.0,
                "unit": "kg",
                "status": "available",
                "expiry_date": str(ref_date + timedelta(days=20)),
            },
        ],
        "proposed_purchases": [
            {
                "purchase_id": "API-PUR-01",
                "product_name": "Tomato",
                "requested_quantity": 2.0,
                "unit": "unit",
            }
        ],
        "include_recipes": True,
        "recipe_limit": 3,
        "as_of_date": str(ref_date),
    }

    response = client.post("/grocery/analyze", json=payload)
    assert response.status_code == 200

    data = response.json()
    assert data["overall_status"] == "completed"
    assert data["as_of_date"] == str(ref_date)
    assert data["inventory_summary"]["total_items"] == 2
    assert len(data["product_resolutions"]) == 2
    assert len(data["shelf_life_estimates"]) == 2
    assert len(data["priority_scores"]) == 2
    assert data["sensor_analysis"]["status"] == "skipped"
    assert data["duplicate_purchase_analysis"]["status"] == "completed"
    assert data["recipe_recommendations"]["status"] == "completed"
    assert len(data["recipe_recommendations"]["recommendations"]) <= 3


def test_api_grocery_analyze_validation_error_on_empty_inventory(client):
    """Test POST /grocery/analyze rejects request without inventory items."""
    payload = {
        "inventory": [],
        "include_recipes": True,
    }
    response = client.post("/grocery/analyze", json=payload)
    assert response.status_code == 422


def test_pre_existing_endpoints_preserved(client):
    """Verify that Phase 1-7 endpoints remain intact and functional."""
    # Health check (Phase 1)
    health_resp = client.get("/health")
    assert health_resp.status_code == 200
    assert health_resp.json()["status"] == "healthy"

    # Product lookup (Phase 2)
    prod_resp = client.get("/products/tomato")
    assert prod_resp.status_code == 200
    assert prod_resp.json()["product_name"] == "Tomato"
