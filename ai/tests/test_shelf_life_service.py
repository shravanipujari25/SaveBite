"""Comprehensive unit and API integration tests for SaveBite Shelf-Life Estimation Service."""

from datetime import date
import sys
from pathlib import Path

# Ensure ai directory is on sys.path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.main import app
from app.services.shelf_life_service import (
    ShelfLifeEstimateRequest,
    ShelfLifeEstimateResponse,
    estimate_shelf_life,
)


@pytest.fixture
def client():
    """Create FastAPI test client."""
    return TestClient(app)


# ============================================================================
# 1. Basic Calculation Tests
# ============================================================================


def test_basic_unopened_matching_storage_zone():
    """Verify fresh, unopened item with matching storage zone."""
    req = ShelfLifeEstimateRequest(
        product_name="Tomato",
        storage_zone="pantry",
        purchase_date=date(2026, 10, 20),
        opened=False,
        as_of_date=date(2026, 10, 20),
    )
    res = estimate_shelf_life(req)

    assert res.product_found is True
    assert res.product_name == "Tomato"
    assert res.reference_shelf_life_days == 7
    assert res.estimated_end_date == date(2026, 10, 27)
    assert res.estimated_remaining_days == 7
    assert res.estimated_days_remaining_nonnegative == 7
    assert res.reliability == "high"
    assert len(res.warnings) == 0


def test_item_several_days_remaining():
    """Verify item evaluated mid-way through shelf life."""
    req = ShelfLifeEstimateRequest(
        product_name="Tomato",
        storage_zone="pantry",
        purchase_date=date(2026, 10, 20),
        opened=False,
        as_of_date=date(2026, 10, 24),
    )
    res = estimate_shelf_life(req)

    assert res.estimated_end_date == date(2026, 10, 27)
    assert res.estimated_remaining_days == 3
    assert res.estimated_days_remaining_nonnegative == 3


def test_item_estimated_end_date_today():
    """Verify item evaluated exactly on its estimated end date."""
    req = ShelfLifeEstimateRequest(
        product_name="Tomato",
        storage_zone="pantry",
        purchase_date=date(2026, 10, 17),
        opened=False,
        as_of_date=date(2026, 10, 24),
    )
    res = estimate_shelf_life(req)

    assert res.estimated_end_date == date(2026, 10, 24)
    assert res.estimated_remaining_days == 0
    assert res.estimated_days_remaining_nonnegative == 0
    assert "today" in res.explanation.lower()


def test_item_reference_estimate_expired():
    """Verify item whose reference shelf life has elapsed (signed negative days)."""
    req = ShelfLifeEstimateRequest(
        product_name="Tomato",
        storage_zone="pantry",
        purchase_date=date(2026, 10, 10),
        opened=False,
        as_of_date=date(2026, 10, 24),
    )
    res = estimate_shelf_life(req)

    assert res.estimated_end_date == date(2026, 10, 17)
    assert res.estimated_remaining_days == -7
    assert res.estimated_days_remaining_nonnegative == 0
    assert "elapsed" in res.explanation.lower() or "ago" in res.explanation.lower()


def test_exact_date_arithmetic_fixed_as_of_date():
    """Verify calendar date math remains exact across different time intervals."""
    req = ShelfLifeEstimateRequest(
        product_name="White Rice",
        purchase_date=date(2026, 1, 1),
        opened=False,
        as_of_date=date(2026, 6, 1),
    )
    res = estimate_shelf_life(req)

    assert res.reference_shelf_life_days == 730
    assert res.estimated_end_date == date(2028, 1, 1)
    assert res.estimated_remaining_days == (date(2028, 1, 1) - date(2026, 6, 1)).days


# ============================================================================
# 2. Opened Products Tests
# ============================================================================


def test_opened_item_with_catalog_opened_days():
    """Verify opened item uses catalog opened_shelf_life_days."""
    # Tomato opened shelf life is 2 days in catalog
    req = ShelfLifeEstimateRequest(
        product_name="Tomato",
        storage_zone="pantry",
        purchase_date=date(2026, 10, 20),
        opened=True,
        as_of_date=date(2026, 10, 21),
    )
    res = estimate_shelf_life(req)

    assert res.opened is True
    assert res.reference_shelf_life_days == 2
    assert res.estimated_end_date == date(2026, 10, 22)
    assert res.estimated_remaining_days == 1
    assert res.reliability == "high"


def test_opened_item_missing_opened_days_in_catalog():
    """Verify opened item with missing opened baseline falls back with warning and low reliability."""
    # Potato has opened_shelf_life_days = None in catalog
    req = ShelfLifeEstimateRequest(
        product_name="Potato",
        storage_zone="pantry",
        purchase_date=date(2026, 10, 1),
        opened=True,
        as_of_date=date(2026, 10, 10),
    )
    res = estimate_shelf_life(req)

    assert res.opened is True
    assert res.reference_shelf_life_days == 30  # Base shelf life fallback
    assert res.reliability == "low"
    assert any("No opened shelf-life baseline in catalog" in w for w in res.warnings)


def test_opened_item_custom_catalog_invalid_opened_days():
    """Verify fallback behavior if opened shelf life is not positive."""
    # Dict request directly tested with fallback
    req = ShelfLifeEstimateRequest(
        product_name="Eggs",
        purchase_date=date(2026, 10, 1),
        opened=True,
        as_of_date=date(2026, 10, 5),
    )
    res = estimate_shelf_life(req)

    assert res.opened is True
    assert res.reference_shelf_life_days == 28
    assert res.reliability == "low"


# ============================================================================
# 3. Product Lookup & Aliasing Tests
# ============================================================================


def test_product_lookup_capitalization():
    """Verify case-insensitive lookup in shelf-life service."""
    req = ShelfLifeEstimateRequest(
        product_name="TOMATO",
        purchase_date=date(2026, 10, 20),
        opened=False,
        as_of_date=date(2026, 10, 20),
    )
    res = estimate_shelf_life(req)

    assert res.product_found is True
    assert res.product_name == "Tomato"


def test_product_lookup_alias_and_plurals():
    """Verify plural forms and colloquial aliases resolve to canonical item."""
    for query in ["tomatoes", " fresh tomato ", "whole milk", "chicken breast"]:
        req = ShelfLifeEstimateRequest(
            product_name=query,
            purchase_date=date(2026, 10, 20),
            opened=False,
            as_of_date=date(2026, 10, 20),
        )
        res = estimate_shelf_life(req)
        assert res.product_found is True
        assert res.reference_shelf_life_days is not None


def test_unknown_product_returns_unavailable():
    """Verify unknown product returns product_found=False, unavailable reliability, and null estimates."""
    req = ShelfLifeEstimateRequest(
        product_name="dragon_fruit_xyz",
        purchase_date=date(2026, 10, 20),
        opened=False,
        as_of_date=date(2026, 10, 20),
    )
    res = estimate_shelf_life(req)

    assert res.product_found is False
    assert res.reliability == "unavailable"
    assert res.reference_shelf_life_days is None
    assert res.estimated_end_date is None
    assert res.estimated_remaining_days is None
    assert any("not found in knowledge base" in w for w in res.warnings)


def test_empty_product_name_rejected():
    """Verify empty or whitespace-only product name raises validation error."""
    with pytest.raises(ValidationError):
        ShelfLifeEstimateRequest(
            product_name="   ",
            purchase_date=date(2026, 10, 20),
            opened=False,
        )


# ============================================================================
# 4. Storage Conditions and Temperature Tests
# ============================================================================


def test_missing_storage_zone_uses_catalog_default():
    """Verify omitted storage_zone adopts catalog recommendation."""
    req = ShelfLifeEstimateRequest(
        product_name="Milk",
        storage_zone=None,
        purchase_date=date(2026, 10, 20),
        opened=False,
        as_of_date=date(2026, 10, 20),
    )
    res = estimate_shelf_life(req)

    assert res.storage_zone_used == "refrigerator"
    assert res.catalog_storage_zone == "refrigerator"
    assert "defaulted" in res.storage_assumption.lower()
    assert res.reliability == "high"


def test_matching_actual_and_catalog_storage_zone():
    """Verify matching storage zone keeps high reliability."""
    req = ShelfLifeEstimateRequest(
        product_name="Milk",
        storage_zone="Refrigerator",
        purchase_date=date(2026, 10, 20),
        opened=False,
        as_of_date=date(2026, 10, 20),
    )
    res = estimate_shelf_life(req)

    assert res.storage_zone_used == "refrigerator"
    assert res.reliability == "high"
    assert "recommended zone" in res.storage_assumption.lower()


def test_different_actual_and_catalog_storage_zone():
    """Verify storage zone mismatch adds warning and reduces reliability."""
    # Milk stored in pantry instead of refrigerator
    req = ShelfLifeEstimateRequest(
        product_name="Milk",
        storage_zone="pantry",
        purchase_date=date(2026, 10, 20),
        opened=False,
        as_of_date=date(2026, 10, 20),
    )
    res = estimate_shelf_life(req)

    assert res.storage_zone_used == "pantry"
    assert res.catalog_storage_zone == "refrigerator"
    assert res.reliability == "low"
    assert any("mismatch" in w.lower() for w in res.warnings)


def test_missing_temperature():
    """Verify missing temperature does not add temperature warnings."""
    req = ShelfLifeEstimateRequest(
        product_name="Tomato",
        storage_temperature_c=None,
        purchase_date=date(2026, 10, 20),
        opened=False,
        as_of_date=date(2026, 10, 20),
    )
    res = estimate_shelf_life(req)

    assert res.storage_temperature_c is None
    assert res.temperature_adjustment_applied is False
    assert not any("temperature" in w.lower() for w in res.warnings)


def test_supplied_normal_temperature():
    """Verify normal refrigerator temperature is recorded without mathematical multiplier."""
    req = ShelfLifeEstimateRequest(
        product_name="Milk",
        storage_zone="refrigerator",
        storage_temperature_c=3.5,
        purchase_date=date(2026, 10, 20),
        opened=False,
        as_of_date=date(2026, 10, 20),
    )
    res = estimate_shelf_life(req)

    assert res.storage_temperature_c == 3.5
    assert res.temperature_adjustment_applied is False
    assert res.reliability == "high"


def test_supplied_abnormal_refrigerator_temperature():
    """Verify elevated refrigerator temperature triggers warning and downgrades reliability."""
    req = ShelfLifeEstimateRequest(
        product_name="Milk",
        storage_zone="refrigerator",
        storage_temperature_c=10.0,
        purchase_date=date(2026, 10, 20),
        opened=False,
        as_of_date=date(2026, 10, 20),
    )
    res = estimate_shelf_life(req)

    assert res.storage_temperature_c == 10.0
    assert res.temperature_adjustment_applied is False
    assert res.reliability == "medium"
    assert any("exceeds recommended threshold" in w for w in res.warnings)


def test_invalid_temperature_rejected():
    """Verify non-physical or extreme temperatures are rejected by request validator."""
    with pytest.raises(ValidationError):
        ShelfLifeEstimateRequest(
            product_name="Milk",
            storage_temperature_c=100.0,  # > 70°C
            purchase_date=date(2026, 10, 20),
            opened=False,
        )

    with pytest.raises(ValidationError):
        ShelfLifeEstimateRequest(
            product_name="Milk",
            storage_temperature_c=-100.0,  # < -50°C
            purchase_date=date(2026, 10, 20),
            opened=False,
        )


# ============================================================================
# 5. Date Coherence & Package Use-By Date Tests
# ============================================================================


def test_invalid_purchase_date_format():
    """Verify malformed purchase date raises validation error."""
    with pytest.raises(ValidationError):
        ShelfLifeEstimateRequest.model_validate({
            "product_name": "Tomato",
            "purchase_date": "invalid-date",
            "opened": False,
        })


def test_purchase_date_in_future_relative_to_as_of_date():
    """Verify purchase_date cannot be in the future relative to as_of_date."""
    with pytest.raises(ValidationError, match="cannot be in the future"):
        ShelfLifeEstimateRequest(
            product_name="Tomato",
            purchase_date=date(2026, 10, 25),
            as_of_date=date(2026, 10, 20),
            opened=False,
        )


def test_package_use_by_date_earlier_than_estimated_end_date():
    """Verify warning when manufacturer date is earlier than calculated end date."""
    # Milk base shelf life is 7 days (end date 2026-10-27)
    # Package date is 2026-10-24
    req = ShelfLifeEstimateRequest(
        product_name="Milk",
        purchase_date=date(2026, 10, 20),
        opened=False,
        package_use_by_date=date(2026, 10, 24),
        as_of_date=date(2026, 10, 20),
    )
    res = estimate_shelf_life(req)

    assert res.package_date_warning is not None
    assert "earlier than catalog estimated end date" in res.package_date_warning
    assert res.reliability == "medium"


def test_package_use_by_date_later_than_estimated_end_date():
    """Verify no date-override warning when package date is later than catalog estimate."""
    req = ShelfLifeEstimateRequest(
        product_name="Milk",
        purchase_date=date(2026, 10, 20),
        opened=False,
        package_use_by_date=date(2026, 11, 1),
        as_of_date=date(2026, 10, 20),
    )
    res = estimate_shelf_life(req)

    assert res.package_date_warning is None
    assert res.reliability == "high"


def test_package_use_by_date_earlier_than_purchase_date():
    """Verify conflict warning when package date precedes purchase date."""
    req = ShelfLifeEstimateRequest(
        product_name="Milk",
        purchase_date=date(2026, 10, 20),
        opened=False,
        package_use_by_date=date(2026, 10, 15),
        as_of_date=date(2026, 10, 20),
    )
    res = estimate_shelf_life(req)

    assert res.package_date_warning is not None
    assert "earlier than purchase date" in res.package_date_warning


def test_opened_boolean_strict_validation():
    """Verify opened must be a strict boolean and rejects strings."""
    with pytest.raises(ValidationError):
        ShelfLifeEstimateRequest.model_validate({
            "product_name": "Tomato",
            "purchase_date": "2026-10-20",
            "opened": "yes",  # String instead of boolean
        })


# ============================================================================
# 6. API Endpoint Tests (POST /shelf-life/estimate)
# ============================================================================


def test_api_estimate_shelf_life_success(client: TestClient):
    """Verify POST /shelf-life/estimate returns HTTP 200 with structured payload."""
    payload = {
        "product_name": "Tomato",
        "storage_zone": "Pantry",
        "purchase_date": "2026-10-20",
        "opened": False,
        "storage_temperature_c": 20.0,
        "as_of_date": "2026-10-22",
    }
    resp = client.post("/shelf-life/estimate", json=payload)
    assert resp.status_code == 200

    data = resp.json()
    assert data["product_found"] is True
    assert data["product_name"] == "Tomato"
    assert data["reference_shelf_life_days"] == 7
    assert data["estimated_end_date"] == "2026-10-27"
    assert data["estimated_remaining_days"] == 5
    assert data["estimated_days_remaining_nonnegative"] == 5
    assert data["reliability"] == "high"


def test_api_estimate_shelf_life_unknown_product(client: TestClient):
    """Verify POST /shelf-life/estimate handles unknown product with structured response."""
    payload = {
        "product_name": "unknown_mysterious_berry",
        "purchase_date": "2026-10-20",
        "opened": False,
        "as_of_date": "2026-10-22",
    }
    resp = client.post("/shelf-life/estimate", json=payload)
    assert resp.status_code == 200

    data = resp.json()
    assert data["product_found"] is False
    assert data["reliability"] == "unavailable"
    assert data["estimated_end_date"] is None
    assert data["estimated_remaining_days"] is None


def test_api_estimate_shelf_life_validation_error(client: TestClient):
    """Verify POST /shelf-life/estimate returns HTTP 422 for malformed requests."""
    # Future purchase date relative to as_of_date
    payload = {
        "product_name": "Tomato",
        "purchase_date": "2026-10-25",
        "as_of_date": "2026-10-20",
        "opened": False,
    }
    resp = client.post("/shelf-life/estimate", json=payload)
    assert resp.status_code == 422


def test_existing_endpoints_unaffected(client: TestClient):
    """Verify /health and /products/{product_name} endpoints remain fully functional."""
    # Health check
    resp_health = client.get("/health")
    assert resp_health.status_code == 200
    assert resp_health.json()["status"] == "healthy"

    # Product lookup
    resp_prod = client.get("/products/tomatoes")
    assert resp_prod.status_code == 200
    assert resp_prod.json()["product_name"] == "Tomato"
