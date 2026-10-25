import sys
from pathlib import Path

# Ensure ai directory is on sys.path when pytest runs from ai/
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

"""Tests for Phase 4: Use-First Priority Scoring Engine.

Covers:
- ScoringConfig construction and validation
- GroceryItem and PriorityScoreRequest model validation
- score_items() logic: urgency, sensitivity, warnings, freshness
- Ranking correctness (descending score, stable tie-breaking)
- Priority category assignment with default and custom configs
- Unknown product handling
- ScoredItem structure and field semantics
- prioritize_items() integration
- POST /priority/score API endpoint (happy path, validation errors, unknown products)
- All existing Phase 1-3 endpoints remain unaffected
"""

import pytest
from datetime import date, timedelta
from fastapi.testclient import TestClient

from app.main import app
from app.services.priority_scoring import (
    DEFAULT_SCORING_CONFIG,
    GroceryItem,
    PriorityScoreRequest,
    PriorityScoreResponse,
    ScoredItem,
    ScoringConfig,
    _categorize,
    _compute_urgency_ratio,
    _urgency_score,
    _sensitivity_score,
    _warnings_score,
    _freshness_score,
    score_items,
    prioritize_items,
)
from app.services.product_catalog import lookup_product


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def client():
    """FastAPI test client."""
    return TestClient(app)


@pytest.fixture
def today() -> date:
    return date(2025, 6, 15)  # Fixed evaluation date for deterministic tests


@pytest.fixture
def default_config() -> ScoringConfig:
    return ScoringConfig()


# ---------------------------------------------------------------------------
# ScoringConfig tests
# ---------------------------------------------------------------------------


def test_default_scoring_config_values():
    cfg = ScoringConfig()
    assert cfg.weight_urgency == 55.0
    assert cfg.weight_sensitivity == 20.0
    assert cfg.weight_warnings == 15.0
    assert cfg.weight_freshness_penalty == 10.0
    assert cfg.red_threshold == 80.0
    assert cfg.orange_threshold == 60.0
    assert cfg.yellow_threshold == 35.0
    assert cfg.critical_threshold == 80.0
    assert cfg.high_threshold == 60.0
    assert cfg.medium_threshold == 35.0
    assert cfg.urgency_critical_days == 3
    assert cfg.max_reference_days_cap == 365


def test_scoring_config_weights_sum_to_100():
    cfg = ScoringConfig()
    total = cfg.weight_urgency + cfg.weight_sensitivity + cfg.weight_warnings + cfg.weight_freshness_penalty
    assert total == 100.0


def test_scoring_config_invalid_weight_sum_rejected():
    with pytest.raises(ValueError, match="Weights must sum to 100.0"):
        ScoringConfig(weight_urgency=50.0, weight_sensitivity=20.0, weight_warnings=15.0, weight_freshness_penalty=10.0)


def test_scoring_config_negative_weight_rejected():
    with pytest.raises(ValueError, match="weight_urgency must be >= 0"):
        ScoringConfig(weight_urgency=-1.0, weight_sensitivity=50.0, weight_warnings=25.0, weight_freshness_penalty=26.0)


def test_scoring_config_invalid_thresholds_rejected():
    with pytest.raises(ValueError, match="orange_threshold"):
        ScoringConfig(red_threshold=40.0, orange_threshold=60.0)


def test_scoring_config_custom_values():
    cfg = ScoringConfig(
        weight_urgency=60.0,
        weight_sensitivity=20.0,
        weight_warnings=10.0,
        weight_freshness_penalty=10.0,
        red_threshold=85.0,
        orange_threshold=65.0,
        yellow_threshold=40.0,
    )
    assert cfg.weight_urgency == 60.0
    assert cfg.red_threshold == 85.0


# ---------------------------------------------------------------------------
# GroceryItem validation tests
# ---------------------------------------------------------------------------


def test_grocery_item_valid():
    item = GroceryItem(
        item_id="item-1",
        product_name="milk",
        purchase_date=date(2025, 6, 10),
        opened=False,
    )
    assert item.item_id == "item-1"
    assert item.product_name == "milk"
    assert item.freshness_override is False


def test_grocery_item_empty_product_name_rejected():
    with pytest.raises(Exception):
        GroceryItem(
            item_id="item-1",
            product_name="   ",
            purchase_date=date(2025, 6, 10),
            opened=False,
        )


def test_grocery_item_empty_item_id_rejected():
    with pytest.raises(Exception):
        GroceryItem(
            item_id="",
            product_name="milk",
            purchase_date=date(2025, 6, 10),
            opened=False,
        )


def test_grocery_item_product_name_stripped():
    item = GroceryItem(
        item_id="i1",
        product_name="  spinach  ",
        purchase_date=date(2025, 6, 1),
        opened=False,
    )
    assert item.product_name == "spinach"


# ---------------------------------------------------------------------------
# PriorityScoreRequest validation tests
# ---------------------------------------------------------------------------


def test_priority_score_request_valid():
    req = PriorityScoreRequest(
        items=[
            GroceryItem(item_id="a", product_name="milk", purchase_date=date(2025, 6, 10), opened=False),
        ]
    )
    assert len(req.items) == 1


def test_priority_score_request_empty_items_rejected():
    with pytest.raises(Exception):
        PriorityScoreRequest(items=[])


def test_priority_score_request_duplicate_item_ids_rejected():
    with pytest.raises(Exception, match="Duplicate item_id"):
        PriorityScoreRequest(
            items=[
                GroceryItem(item_id="dup", product_name="milk", purchase_date=date(2025, 6, 10), opened=False),
                GroceryItem(item_id="dup", product_name="spinach", purchase_date=date(2025, 6, 10), opened=False),
            ]
        )


# ---------------------------------------------------------------------------
# Urgency ratio helper tests
# ---------------------------------------------------------------------------


def test_compute_urgency_ratio_full_remaining():
    # 7 days remaining out of 7-day reference → ratio = 0 (just purchased)
    ratio = _compute_urgency_ratio(remaining_days=7, reference_days=7, cap=365)
    assert ratio == 0.0


def test_compute_urgency_ratio_at_end_date():
    # 0 days remaining → ratio = 1.0
    ratio = _compute_urgency_ratio(remaining_days=0, reference_days=7, cap=365)
    assert ratio == 1.0


def test_compute_urgency_ratio_past_end_date():
    # -3 remaining → past end date → ratio > 1.0
    ratio = _compute_urgency_ratio(remaining_days=-3, reference_days=7, cap=365)
    assert ratio > 1.0


def test_compute_urgency_ratio_cap_applied():
    # Reference 730 days, cap 365 → denominator uses 365
    ratio = _compute_urgency_ratio(remaining_days=182, reference_days=730, cap=365)
    expected = (365 - 182) / 365
    assert abs(ratio - expected) < 0.001


def test_compute_urgency_ratio_zero_reference():
    # Should not divide by zero
    ratio = _compute_urgency_ratio(remaining_days=0, reference_days=0, cap=365)
    assert ratio == 1.0


# ---------------------------------------------------------------------------
# Sub-score helper tests
# ---------------------------------------------------------------------------


def test_urgency_score_critical_items_get_max(default_config):
    score, ratio = _urgency_score(remaining_days=1, reference_days=7, config=default_config)
    assert score == default_config.weight_urgency


def test_urgency_score_expired_items_get_max(default_config):
    score, ratio = _urgency_score(remaining_days=-5, reference_days=7, config=default_config)
    assert score == default_config.weight_urgency


def test_urgency_score_full_life_remaining_near_zero(default_config):
    # 10 days remaining, 10-day reference → 0% elapsed → near-zero urgency
    score, ratio = _urgency_score(remaining_days=10, reference_days=10, config=default_config)
    assert score == pytest.approx(0.0, abs=1.0)


def test_urgency_score_unknown_product_uses_zero(default_config):
    score, ratio = _urgency_score(remaining_days=None, reference_days=None, config=default_config)
    assert score == 0.0
    assert ratio is None


def test_sensitivity_score_high_sensitivity(default_config):
    product = {"sensitivity": "high"}
    score = _sensitivity_score(product, default_config)
    assert score == default_config.weight_sensitivity * 1.0


def test_sensitivity_score_medium_sensitivity(default_config):
    product = {"sensitivity": "medium"}
    score = _sensitivity_score(product, default_config)
    assert score == default_config.weight_sensitivity * 0.5


def test_sensitivity_score_low_sensitivity(default_config):
    product = {"sensitivity": "low"}
    score = _sensitivity_score(product, default_config)
    assert score == 0.0


def test_sensitivity_score_unknown_product_zero(default_config):
    score = _sensitivity_score(None, default_config)
    assert score == 0.0


def test_warnings_score_no_warnings(default_config):
    assert _warnings_score([], default_config) == 0.0


def test_warnings_score_two_warnings(default_config):
    # Two warnings reach the full weight_warnings
    assert _warnings_score(["w1", "w2"], default_config) == default_config.weight_warnings


def test_warnings_score_capped(default_config):
    # Many warnings capped at weight_warnings
    score = _warnings_score(["w"] * 10, default_config)
    assert score == default_config.weight_warnings


def test_freshness_score_override_true(default_config):
    assert _freshness_score(True, default_config) == default_config.weight_freshness_penalty


def test_freshness_score_override_false(default_config):
    assert _freshness_score(False, default_config) == 0.0


# ---------------------------------------------------------------------------
# Priority category tests
# ---------------------------------------------------------------------------


def test_categorize_red(default_config):
    assert _categorize(85.0, default_config) == "Red"


def test_categorize_orange(default_config):
    assert _categorize(70.0, default_config) == "Orange"


def test_categorize_yellow(default_config):
    assert _categorize(45.0, default_config) == "Yellow"


def test_categorize_green(default_config):
    assert _categorize(20.0, default_config) == "Green"


def test_categorize_black_for_none(default_config):
    assert _categorize(None, default_config) == "Black"


def test_categorize_at_confirmed_boundaries(default_config):
    # Confirmed boundaries:
    # 0 -> Green
    # 34.99 -> Green
    # 35 -> Yellow
    # 59.99 -> Yellow
    # 60 -> Orange
    # 79.99 -> Orange
    # 80 -> Red
    # 100 -> Red
    assert _categorize(0.0, default_config) == "Green"
    assert _categorize(34.99, default_config) == "Green"
    assert _categorize(35.0, default_config) == "Yellow"
    assert _categorize(59.99, default_config) == "Yellow"
    assert _categorize(60.0, default_config) == "Orange"
    assert _categorize(79.99, default_config) == "Orange"
    assert _categorize(80.0, default_config) == "Red"
    assert _categorize(100.0, default_config) == "Red"


def test_categorize_non_finite_rejected(default_config):
    import math
    with pytest.raises(ValueError, match="Invalid non-finite or non-numeric"):
        _categorize(float("nan"), default_config)
    with pytest.raises(ValueError, match="Invalid non-finite or non-numeric"):
        _categorize(float("inf"), default_config)
    with pytest.raises(ValueError, match="Invalid non-finite or non-numeric"):
        _categorize(-float("inf"), default_config)


# ---------------------------------------------------------------------------
# score_items() integration tests
# ---------------------------------------------------------------------------


def test_score_items_single_known_product(today):
    items = [
        GroceryItem(
            item_id="item-milk",
            product_name="milk",
            purchase_date=today - timedelta(days=5),
            opened=False,
            as_of_date=today,
        )
    ]
    results = score_items(items)
    assert len(results) == 1
    result = results[0]
    assert result.item_id == "item-milk"
    assert result.rank == 1
    assert result.product_found is True
    assert 0.0 <= result.score <= 100.0
    assert result.priority_category in ("Red", "Orange", "Yellow", "Green")
    assert isinstance(result.estimated_remaining_days, int)
    assert isinstance(result.reference_shelf_life_days, int)
    assert result.shelf_life_reliability is not None
    assert result.explanation


def test_score_items_empty_raises():
    with pytest.raises(ValueError, match="empty"):
        score_items([])


def test_score_items_unknown_product_handled(today):
    items = [
        GroceryItem(
            item_id="item-xyz",
            product_name="dragonfruit_rare_variety",
            purchase_date=today - timedelta(days=2),
            opened=False,
            as_of_date=today,
        )
    ]
    results = score_items(items)
    assert len(results) == 1
    result = results[0]
    assert result.product_found is False
    assert result.estimated_remaining_days is None
    assert result.rank == 1
    assert result.score is None
    assert result.priority_category == "Black"
    assert result.unavailability_reason == "unknown_product"
    assert result.shelf_life_reliability == "unavailable"


def test_score_items_ranking_order(today):
    """Expiring item should rank above fresh item."""
    items = [
        GroceryItem(
            item_id="fresh",
            product_name="milk",
            purchase_date=today - timedelta(days=1),   # very fresh
            opened=False,
            as_of_date=today,
        ),
        GroceryItem(
            item_id="expiring",
            product_name="milk",
            purchase_date=today - timedelta(days=6),   # near expiry (7-day shelf life)
            opened=False,
            as_of_date=today,
        ),
    ]
    results = score_items(items)
    ranked = {r.item_id: r.rank for r in results}
    assert ranked["expiring"] < ranked["fresh"]


def test_score_items_expiring_is_red_or_orange(today):
    """An item past its estimated end date should receive Red or Orange priority."""
    items = [
        GroceryItem(
            item_id="expired",
            product_name="milk",
            purchase_date=today - timedelta(days=20),  # way past 7-day shelf life
            opened=False,
            as_of_date=today,
        )
    ]
    results = score_items(items)
    assert results[0].priority_category in ("Red", "Orange")


def test_score_items_freshness_override_increases_score(today):
    """Item with freshness_override=True should score higher than same item without it."""
    base = GroceryItem(
        item_id="base",
        product_name="spinach",
        purchase_date=today - timedelta(days=2),
        opened=False,
        as_of_date=today,
    )
    spoiled = GroceryItem(
        item_id="spoiled",
        product_name="spinach",
        purchase_date=today - timedelta(days=2),
        opened=False,
        as_of_date=today,
        freshness_override=True,
    )
    results = score_items([base, spoiled])
    score_map = {r.item_id: r.score for r in results}
    assert score_map["spoiled"] > score_map["base"]


def test_score_items_storage_zone_warning_increases_score(today):
    """Mismatched storage zone should produce a warning and raise the score."""
    items_no_warn = [
        GroceryItem(
            item_id="correct",
            product_name="milk",
            purchase_date=today - timedelta(days=3),
            opened=False,
            storage_zone="refrigerator",  # correct zone
            as_of_date=today,
        )
    ]
    items_warn = [
        GroceryItem(
            item_id="wrong-zone",
            product_name="milk",
            purchase_date=today - timedelta(days=3),
            opened=False,
            storage_zone="pantry",  # incorrect zone for milk
            as_of_date=today,
        )
    ]
    results_no = score_items(items_no_warn)
    results_warn = score_items(items_warn)
    assert results_warn[0].score > results_no[0].score


def test_score_items_multiple_products_all_ranked(today):
    """All items receive a rank; ranks are 1-based and contiguous."""
    items = [
        GroceryItem(item_id=f"item-{i}", product_name="milk",
                    purchase_date=today - timedelta(days=i), opened=False, as_of_date=today)
        for i in range(1, 5)
    ]
    results = score_items(items)
    ranks = sorted(r.rank for r in results)
    assert ranks == [1, 2, 3, 4]


def test_score_items_tie_breaking_by_item_id(today):
    """Items with identical scores should be ranked by item_id lexicographically."""
    items = [
        GroceryItem(
            item_id="z-item",
            product_name="milk",
            purchase_date=today - timedelta(days=3),
            opened=False,
            as_of_date=today,
        ),
        GroceryItem(
            item_id="a-item",
            product_name="milk",
            purchase_date=today - timedelta(days=3),
            opened=False,
            as_of_date=today,
        ),
    ]
    results = score_items(items)
    # Scores should be equal; a-item should rank first due to lexicographic tie-breaking
    assert results[0].item_id == "a-item"
    assert results[1].item_id == "z-item"


def test_score_items_score_clamped_to_100(today):
    """Score must never exceed 100.0 even with all penalty signals active."""
    items = [
        GroceryItem(
            item_id="maxed",
            product_name="milk",
            purchase_date=today - timedelta(days=30),
            opened=True,
            storage_zone="pantry",       # wrong zone → warning
            storage_temperature_c=35.0,  # high temp → another warning
            freshness_override=True,
            as_of_date=today,
        )
    ]
    results = score_items(items)
    assert results[0].score <= 100.0


def test_score_items_custom_config(today):
    """Custom ScoringConfig thresholds are applied correctly."""
    cfg = ScoringConfig(
        red_threshold=10.0,
        orange_threshold=5.0,
        yellow_threshold=1.0,
    )
    items = [
        GroceryItem(
            item_id="item-1",
            product_name="milk",
            purchase_date=today - timedelta(days=1),
            opened=False,
            as_of_date=today,
        )
    ]
    results = score_items(items, config=cfg)
    # With very low thresholds, even a fresh item should be Red
    assert results[0].priority_category == "Red"


def test_scored_item_urgency_ratio_present_for_known_product(today):
    """urgency_ratio should be set for known products."""
    items = [
        GroceryItem(
            item_id="milk-1",
            product_name="milk",
            purchase_date=today - timedelta(days=3),
            opened=False,
            as_of_date=today,
        )
    ]
    results = score_items(items)
    assert results[0].urgency_ratio is not None


def test_scored_item_urgency_ratio_none_for_unknown(today):
    """urgency_ratio should be None for unknown products."""
    items = [
        GroceryItem(
            item_id="unk-1",
            product_name="alien_fruit_12345",
            purchase_date=today - timedelta(days=3),
            opened=False,
            as_of_date=today,
        )
    ]
    results = score_items(items)
    assert results[0].urgency_ratio is None


# ---------------------------------------------------------------------------
# prioritize_items() integration tests
# ---------------------------------------------------------------------------


def test_prioritize_items_returns_response_model(today):
    req = PriorityScoreRequest(
        items=[
            GroceryItem(
                item_id="m1",
                product_name="milk",
                purchase_date=today - timedelta(days=4),
                opened=False,
                as_of_date=today,
            )
        ]
    )
    response = prioritize_items(req)
    assert isinstance(response, PriorityScoreResponse)
    assert response.total_items == 1
    assert len(response.scored_items) == 1
    assert response.as_of_date == today


def test_prioritize_items_accepts_dict_input(today):
    req_dict = {
        "items": [
            {
                "item_id": "d1",
                "product_name": "spinach",
                "purchase_date": str(today - timedelta(days=2)),
                "opened": False,
                "as_of_date": str(today),
            }
        ]
    }
    response = prioritize_items(req_dict)
    assert response.total_items == 1


def test_prioritize_items_multiple_items_ordered(today):
    req = PriorityScoreRequest(
        items=[
            GroceryItem(item_id="fresh", product_name="milk",
                        purchase_date=today - timedelta(days=1), opened=False, as_of_date=today),
            GroceryItem(item_id="old", product_name="milk",
                        purchase_date=today - timedelta(days=6), opened=False, as_of_date=today),
        ]
    )
    response = prioritize_items(req)
    assert response.scored_items[0].item_id == "old"
    assert response.scored_items[1].item_id == "fresh"


# ---------------------------------------------------------------------------
# API endpoint tests — POST /priority/score
# ---------------------------------------------------------------------------


def test_api_priority_score_success(client, today):
    payload = {
        "items": [
            {
                "item_id": "api-item-1",
                "product_name": "milk",
                "purchase_date": str(today - timedelta(days=4)),
                "opened": False,
                "as_of_date": str(today),
            }
        ]
    }
    response = client.post("/priority/score", json=payload)
    assert response.status_code == 200
    body = response.json()
    assert body["total_items"] == 1
    assert len(body["scored_items"]) == 1
    item = body["scored_items"][0]
    assert item["item_id"] == "api-item-1"
    assert item["rank"] == 1
    assert "score" in item
    assert "priority_category" in item
    assert "explanation" in item
    assert "shelf_life_reliability" in item


def test_api_priority_score_multiple_items_ranked(client, today):
    payload = {
        "items": [
            {
                "item_id": "fresh",
                "product_name": "milk",
                "purchase_date": str(today - timedelta(days=1)),
                "opened": False,
                "as_of_date": str(today),
            },
            {
                "item_id": "near-expiry",
                "product_name": "milk",
                "purchase_date": str(today - timedelta(days=6)),
                "opened": False,
                "as_of_date": str(today),
            },
        ]
    }
    response = client.post("/priority/score", json=payload)
    assert response.status_code == 200
    body = response.json()
    assert body["total_items"] == 2
    ranks = {item["item_id"]: item["rank"] for item in body["scored_items"]}
    assert ranks["near-expiry"] < ranks["fresh"]


def test_api_priority_score_with_freshness_override(client, today):
    payload = {
        "items": [
            {
                "item_id": "spoiled",
                "product_name": "spinach",
                "purchase_date": str(today - timedelta(days=2)),
                "opened": False,
                "freshness_override": True,
                "as_of_date": str(today),
            }
        ]
    }
    response = client.post("/priority/score", json=payload)
    assert response.status_code == 200
    body = response.json()
    item = body["scored_items"][0]
    assert item["priority_category"] in ("Red", "Orange", "Yellow", "Green")


def test_api_priority_score_unknown_product(client, today):
    payload = {
        "items": [
            {
                "item_id": "unk",
                "product_name": "mystery_vegetable_xyz",
                "purchase_date": str(today - timedelta(days=2)),
                "opened": False,
                "as_of_date": str(today),
            }
        ]
    }
    response = client.post("/priority/score", json=payload)
    assert response.status_code == 200
    body = response.json()
    item = body["scored_items"][0]
    assert item["product_found"] is False
    assert item["estimated_remaining_days"] is None
    assert item["score"] is None
    assert item["priority_category"] == "Black"
    assert item["unavailability_reason"] == "unknown_product"
    assert item["shelf_life_reliability"] == "unavailable"


def test_api_priority_score_empty_items_rejected(client):
    payload = {"items": []}
    response = client.post("/priority/score", json=payload)
    assert response.status_code == 422


def test_api_priority_score_duplicate_item_ids_rejected(client, today):
    payload = {
        "items": [
            {
                "item_id": "dup",
                "product_name": "milk",
                "purchase_date": str(today - timedelta(days=1)),
                "opened": False,
            },
            {
                "item_id": "dup",
                "product_name": "spinach",
                "purchase_date": str(today - timedelta(days=2)),
                "opened": False,
            },
        ]
    }
    response = client.post("/priority/score", json=payload)
    assert response.status_code == 422


def test_api_priority_score_missing_required_field_rejected(client, today):
    payload = {
        "items": [
            {
                "item_id": "item-1",
                # product_name missing
                "purchase_date": str(today - timedelta(days=1)),
                "opened": False,
            }
        ]
    }
    response = client.post("/priority/score", json=payload)
    assert response.status_code == 422


def test_api_priority_score_response_fields_complete(client, today):
    """Verify all documented fields are present in the API response."""
    payload = {
        "items": [
            {
                "item_id": "full-check",
                "product_name": "milk",
                "purchase_date": str(today - timedelta(days=3)),
                "opened": False,
                "as_of_date": str(today),
            }
        ]
    }
    response = client.post("/priority/score", json=payload)
    assert response.status_code == 200
    body = response.json()
    assert "as_of_date" in body
    assert "total_items" in body
    assert "scored_items" in body

    item = body["scored_items"][0]
    for field in (
        "item_id", "product_name", "product_found", "rank",
        "score", "priority_category", "warnings", "explanation",
    ):
        assert field in item, f"Missing field: {field}"


# ---------------------------------------------------------------------------
# Regression: existing Phase 1-3 endpoints must still work
# ---------------------------------------------------------------------------


def test_existing_health_endpoint_unaffected(client):
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json()["status"] == "healthy"


def test_existing_product_lookup_unaffected(client):
    response = client.get("/products/milk")
    assert response.status_code == 200
    assert response.json()["product_name"].lower() == "milk"



def test_existing_shelf_life_endpoint_unaffected(client, today):
    payload = {
        "product_name": "milk",
        "purchase_date": str(today - timedelta(days=3)),
        "opened": False,
        "as_of_date": str(today),
    }
    response = client.post("/shelf-life/estimate", json=payload)
    assert response.status_code == 200
    assert response.json()["product_found"] is True


# ---------------------------------------------------------------------------
# Additional Confirmed Design Tests: Reliability, Black Handling & Batch Sorting
# ---------------------------------------------------------------------------


def test_reliability_propagated_high_for_normal_estimate(today):
    items = [
        GroceryItem(
            item_id="item-milk",
            product_name="milk",
            purchase_date=today - timedelta(days=2),
            opened=False,
            storage_zone="refrigerator",
            as_of_date=today,
        )
    ]
    results = score_items(items)
    assert len(results) == 1
    assert results[0].shelf_life_reliability == "high"


def test_reliability_propagated_low_for_zone_mismatch(today):
    items = [
        GroceryItem(
            item_id="item-mismatch",
            product_name="milk",
            purchase_date=today - timedelta(days=2),
            opened=False,
            storage_zone="pantry",  # Milk should be in refrigerator -> low reliability in Phase 3
            as_of_date=today,
        )
    ]
    results = score_items(items)
    assert len(results) == 1
    assert results[0].shelf_life_reliability == "low"


def test_reliability_propagated_unavailable_for_unknown_product(today):
    items = [
        GroceryItem(
            item_id="item-unknown",
            product_name="totally_unknown_exotic_fruit_999",
            purchase_date=today - timedelta(days=2),
            opened=False,
            as_of_date=today,
        )
    ]
    results = score_items(items)
    assert len(results) == 1
    assert results[0].priority_category == "Black"
    assert results[0].score is None
    assert results[0].unavailability_reason == "unknown_product"
    assert results[0].shelf_life_reliability == "unavailable"


def test_batch_sorting_places_black_items_after_scored_items(today):
    """Black / unscorable items must be placed after all numeric-scored items."""
    items = [
        GroceryItem(
            item_id="unk-item-1",
            product_name="non_existent_product_1",
            purchase_date=today - timedelta(days=1),
            opened=False,
            as_of_date=today,
        ),
        GroceryItem(
            item_id="fresh-item",
            product_name="milk",
            purchase_date=today - timedelta(days=1),  # fresh -> lower score
            opened=False,
            as_of_date=today,
        ),
        GroceryItem(
            item_id="urgent-item",
            product_name="spinach",
            purchase_date=today - timedelta(days=5),  # very urgent -> high score
            opened=False,
            as_of_date=today,
        ),
        GroceryItem(
            item_id="unk-item-2",
            product_name="non_existent_product_2",
            purchase_date=today - timedelta(days=1),
            opened=False,
            as_of_date=today,
        ),
    ]
    results = score_items(items)
    assert len(results) == 4
    # Top ranks should be scored items, ranked descending by score
    assert results[0].item_id == "urgent-item"
    assert results[0].score is not None
    assert results[1].item_id == "fresh-item"
    assert results[1].score is not None
    # Bottom ranks should be Black items, tied and sorted by item_id
    assert results[2].item_id == "unk-item-1"
    assert results[2].priority_category == "Black"
    assert results[2].score is None
    assert results[3].item_id == "unk-item-2"
    assert results[3].priority_category == "Black"
    assert results[3].score is None
    assert [r.rank for r in results] == [1, 2, 3, 4]


def test_batch_api_with_mixed_known_and_unknown_items(client, today):
    """API batch endpoint handles mixed items without failing the entire batch."""
    payload = {
        "items": [
            {
                "item_id": "valid-1",
                "product_name": "milk",
                "purchase_date": str(today - timedelta(days=2)),
                "opened": False,
                "as_of_date": str(today),
            },
            {
                "item_id": "unknown-1",
                "product_name": "unknown_vegetable_xyz",
                "purchase_date": str(today - timedelta(days=2)),
                "opened": False,
                "as_of_date": str(today),
            },
        ]
    }
    response = client.post("/priority/score", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert data["total_items"] == 2
    scored = data["scored_items"]
    # Check known item
    valid_res = next(x for x in scored if x["item_id"] == "valid-1")
    assert valid_res["product_found"] is True
    assert valid_res["score"] is not None
    assert valid_res["priority_category"] in ("Red", "Orange", "Yellow", "Green")
    assert valid_res["shelf_life_reliability"] in ("high", "medium", "low")
    # Check unknown item
    unk_res = next(x for x in scored if x["item_id"] == "unknown-1")
    assert unk_res["product_found"] is False
    assert unk_res["score"] is None
    assert unk_res["priority_category"] == "Black"
    assert unk_res["unavailability_reason"] == "unknown_product"
    assert unk_res["shelf_life_reliability"] == "unavailable"
