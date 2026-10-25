import sys
from pathlib import Path

# Ensure ai directory is on sys.path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

"""Tests for Phase 6: Duplicate-Purchase Detection Intelligence.

Covers:
  - InventoryItem model validation (quantities, non-finite, units)
  - ProposedPurchaseItem model validation
  - Conservative product matching:
      * exact match
      * case-insensitive and whitespace
      * catalog aliases (e.g. tomatoes -> tomato)
      * product_id match
      * non-equivalent distinct words rejected (Milk vs Milk Powder, Rice vs Rice Flour)
  - Safe dimensional unit normalization (g to kg, ml to l, incompatible mass vs volume)
  - Inventory status filtering (consumed, discarded, expired excluded from usable stock)
  - Near-expiry prioritization ("use_existing_stock_first")
  - Quantity comparisons and recommendations:
      * avoid_purchase
      * reduce_quantity
      * use_existing_stock_first
      * purchase_may_be_needed
      * review_inventory
  - Dataset loading and simulated flag verification
  - Batch duplicate checking with synthetic inventory
  - Full regression preservation (Phases 1-5 unaffected)
"""

from datetime import date, timedelta
import pytest

from app.services.duplicate_purchase_service import (
    DuplicateBatchCheckResponse,
    DuplicateCheckResult,
    InventoryItem,
    ProposedPurchaseItem,
    check_duplicate_item,
    check_duplicate_purchases,
    convert_units,
    is_inventory_usable,
    load_sample_inventory_data,
    match_products,
)


@pytest.fixture
def ref_date() -> date:
    """Fixed evaluation date for deterministic testing."""
    return date(2026, 10, 24)


# ---------------------------------------------------------------------------
# 1. Model Validation Tests
# ---------------------------------------------------------------------------

def test_inventory_item_valid(ref_date):
    item = InventoryItem(
        inventory_item_id="INV-001",
        product_name="White Rice",
        quantity=2.0,
        unit="kg",
        purchase_date=ref_date - timedelta(days=5),
        expiry_date=ref_date + timedelta(days=365),
    )
    assert item.inventory_item_id == "INV-001"
    assert item.quantity == 2.0
    assert item.unit == "kg"
    assert item.status == "available"


def test_inventory_item_invalid_quantity():
    with pytest.raises(ValueError, match="Quantity must be greater than zero"):
        InventoryItem(inventory_item_id="INV-1", product_name="Rice", quantity=0.0, unit="kg")

    with pytest.raises(ValueError, match="Quantity must be greater than zero"):
        InventoryItem(inventory_item_id="INV-1", product_name="Rice", quantity=-2.0, unit="kg")

    with pytest.raises(ValueError, match="Quantity must be a finite number"):
        InventoryItem(inventory_item_id="INV-1", product_name="Rice", quantity=float("nan"), unit="kg")


def test_proposed_purchase_valid():
    purchase = ProposedPurchaseItem(product_name="Milk", requested_quantity=1.0, unit="l")
    assert purchase.product_name == "Milk"
    assert purchase.requested_quantity == 1.0
    assert purchase.unit == "l"


def test_proposed_purchase_invalid_quantity():
    with pytest.raises(ValueError, match="Requested quantity must be greater than zero"):
        ProposedPurchaseItem(product_name="Milk", requested_quantity=-1.0, unit="l")


# ---------------------------------------------------------------------------
# 2. Product Matching Tests
# ---------------------------------------------------------------------------

def test_match_exact_and_casing():
    p = ProposedPurchaseItem(product_name="  white rice  ", requested_quantity=1.0, unit="kg")
    inv = InventoryItem(inventory_item_id="I1", product_name="White Rice", quantity=2.0, unit="kg")
    matched, method, canonical = match_products(p, inv)
    assert matched is True
    assert method == "normalized_exact_name"


def test_match_catalog_alias():
    p = ProposedPurchaseItem(product_name="Tomatoes", requested_quantity=3.0, unit="unit")
    inv = InventoryItem(inventory_item_id="I1", product_name="Tomato", quantity=5.0, unit="unit")
    matched, method, canonical = match_products(p, inv)
    assert matched is True
    assert method in ("normalized_exact_name", "catalog_alias")
    assert canonical.lower() == "tomato"


def test_match_product_id():
    p = ProposedPurchaseItem(product_id="GRC016", product_name="Brand X Cow Milk", requested_quantity=1.0, unit="l")
    inv = InventoryItem(inventory_item_id="I1", product_id="GRC016", product_name="Whole Milk", quantity=1.0, unit="l")
    matched, method, canonical = match_products(p, inv)
    assert matched is True
    assert method == "product_id"


def test_do_not_match_distinct_qualifiers():
    # Milk vs Milk Powder
    p = ProposedPurchaseItem(product_name="Milk Powder", requested_quantity=1.0, unit="kg")
    inv = InventoryItem(inventory_item_id="I1", product_name="Milk", quantity=1.0, unit="l")
    matched, method, _ = match_products(p, inv)
    assert matched is False

    # Rice vs Rice Flour
    p2 = ProposedPurchaseItem(product_name="Rice Flour", requested_quantity=1.0, unit="kg")
    inv2 = InventoryItem(inventory_item_id="I2", product_name="Rice", quantity=2.0, unit="kg")
    matched2, _, _ = match_products(p2, inv2)
    assert matched2 is False

    # Apple vs Apple Juice
    p3 = ProposedPurchaseItem(product_name="Apple Juice", requested_quantity=1.0, unit="l")
    inv3 = InventoryItem(inventory_item_id="I3", product_name="Apple", quantity=4.0, unit="unit")
    matched3, _, _ = match_products(p3, inv3)
    assert matched3 is False


# ---------------------------------------------------------------------------
# 3. Safe Unit Normalization Tests
# ---------------------------------------------------------------------------

def test_unit_conversion_mass():
    assert convert_units(500.0, "g", "kg") == 0.5
    assert convert_units(2.5, "kg", "g") == 2500.0


def test_unit_conversion_volume():
    assert convert_units(500.0, "ml", "l") == 0.5
    assert convert_units(1.0, "l", "ml") == 1000.0


def test_incompatible_unit_conversion_returns_none():
    assert convert_units(1.0, "kg", "l") is None
    assert convert_units(2.0, "unit", "kg") is None
    assert convert_units(500.0, "ml", "g") is None


# ---------------------------------------------------------------------------
# 4. Inventory Usability & Expiry Filtering Tests
# ---------------------------------------------------------------------------

def test_usable_stock_available(ref_date):
    item = InventoryItem(
        inventory_item_id="I1",
        product_name="Rice",
        quantity=2.0,
        unit="kg",
        status="available",
        expiry_date=ref_date + timedelta(days=30),
    )
    usable, near_expiry, reason = is_inventory_usable(item, ref_date)
    assert usable is True
    assert near_expiry is False
    assert reason is None


def test_consumed_or_discarded_stock_unusable(ref_date):
    item_consumed = InventoryItem(
        inventory_item_id="I1",
        product_name="Rice",
        quantity=2.0,
        unit="kg",
        status="consumed",
    )
    usable, _, reason = is_inventory_usable(item_consumed, ref_date)
    assert usable is False
    assert "consumed" in reason

    item_discarded = InventoryItem(
        inventory_item_id="I2",
        product_name="Rice",
        quantity=2.0,
        unit="kg",
        status="discarded",
    )
    usable_d, _, reason_d = is_inventory_usable(item_discarded, ref_date)
    assert usable_d is False
    assert "discarded" in reason_d


def test_expired_stock_unusable(ref_date):
    # Past expiry date
    item = InventoryItem(
        inventory_item_id="I1",
        product_name="Milk",
        quantity=1.0,
        unit="l",
        status="available",
        expiry_date=ref_date - timedelta(days=1),
    )
    usable, _, reason = is_inventory_usable(item, ref_date)
    assert usable is False
    assert "expired" in reason

    # Explicit expired status
    item_status = InventoryItem(
        inventory_item_id="I2",
        product_name="Milk",
        quantity=1.0,
        unit="l",
        status="expired",
        expiry_date=ref_date + timedelta(days=5),
    )
    usable_s, _, reason_s = is_inventory_usable(item_status, ref_date)
    assert usable_s is False
    assert "expired" in reason_s


def test_near_expiry_flagged(ref_date):
    # 1 day remaining -> near expiry
    item = InventoryItem(
        inventory_item_id="I1",
        product_name="Spinach",
        quantity=200.0,
        unit="g",
        status="available",
        expiry_date=ref_date + timedelta(days=1),
    )
    usable, near_expiry, _ = is_inventory_usable(item, ref_date)
    assert usable is True
    assert near_expiry is True


# ---------------------------------------------------------------------------
# 5. Recommendation Category Tests
# ---------------------------------------------------------------------------

def test_recommendation_avoid_purchase(ref_date):
    # User wants 1 kg of rice, inventory has 2 kg available
    p = ProposedPurchaseItem(product_name="White Rice", requested_quantity=1.0, unit="kg")
    inv = [
        InventoryItem(
            inventory_item_id="I1",
            product_name="White Rice",
            quantity=2.0,
            unit="kg",
            expiry_date=ref_date + timedelta(days=100),
            status="available",
        )
    ]
    res = check_duplicate_item(p, inv, as_of=ref_date)
    assert res.recommendation == "avoid_purchase"
    assert res.available_quantity == 2.0
    assert res.quantity_shortfall == 0.0
    assert res.projected_quantity_after_purchase == 3.0
    assert "White Rice" in res.message


def test_recommendation_reduce_quantity(ref_date):
    # User wants 1 litre of milk, inventory has 500 ml available
    p = ProposedPurchaseItem(product_name="Milk", requested_quantity=1.0, unit="l")
    inv = [
        InventoryItem(
            inventory_item_id="I1",
            product_name="Milk",
            quantity=500.0,
            unit="ml",
            expiry_date=ref_date + timedelta(days=5),
            status="available",
        )
    ]
    res = check_duplicate_item(p, inv, as_of=ref_date)
    assert res.recommendation == "reduce_quantity"
    assert res.available_quantity == 0.5
    assert res.quantity_shortfall == 0.5
    assert res.projected_quantity_after_purchase == 1.5


def test_recommendation_use_existing_stock_first_on_near_expiry(ref_date):
    # User wants 1 kg tomatoes, existing 2 kg tomatoes expires tomorrow
    p = ProposedPurchaseItem(product_name="Tomato", requested_quantity=1.0, unit="kg")
    inv = [
        InventoryItem(
            inventory_item_id="I1",
            product_name="Tomato",
            quantity=2.0,
            unit="kg",
            expiry_date=ref_date + timedelta(days=1), # Near expiry!
            status="available",
        )
    ]
    res = check_duplicate_item(p, inv, as_of=ref_date)
    assert res.recommendation == "use_existing_stock_first"
    assert res.expiry_concern is True


def test_recommendation_purchase_may_be_needed_when_no_stock(ref_date):
    p = ProposedPurchaseItem(product_name="Tofu", requested_quantity=2.0, unit="unit")
    inv = [
        InventoryItem(
            inventory_item_id="I1",
            product_name="Milk",
            quantity=1.0,
            unit="l",
            status="available",
        )
    ]
    res = check_duplicate_item(p, inv, as_of=ref_date)
    assert res.recommendation == "purchase_may_be_needed"
    assert res.match_method == "no_match"


def test_recommendation_review_inventory_on_unit_mismatch(ref_date):
    # User wants 1 kg of tomatoes, inventory records 3 units (count vs mass)
    p = ProposedPurchaseItem(product_name="Tomato", requested_quantity=1.0, unit="kg")
    inv = [
        InventoryItem(
            inventory_item_id="I1",
            product_name="Tomato",
            quantity=3.0,
            unit="unit",
            status="available",
        )
    ]
    res = check_duplicate_item(p, inv, as_of=ref_date)
    assert res.recommendation == "review_inventory"
    assert res.available_quantity is None
    assert "cannot be safely converted" in res.reasons[0]


# ---------------------------------------------------------------------------
# 6. Dataset Loading and Batch Evaluation Tests
# ---------------------------------------------------------------------------

def test_sample_inventory_data_loads():
    data = load_sample_inventory_data()
    assert len(data) >= 8
    assert all(d.get("simulated") is True for d in data)


def test_batch_duplicate_checking(ref_date):
    inv_data = load_sample_inventory_data()
    shopping_list = [
        {"product_name": "White Rice", "requested_quantity": 1.0, "unit": "kg"}, # In stock (2kg) -> avoid_purchase
        {"product_name": "Milk", "requested_quantity": 1.0, "unit": "l"},        # In stock (500ml) -> reduce_quantity
        {"product_name": "Fresh Salmon Fillet", "requested_quantity": 1.0, "unit": "kg"}, # Not in sample inventory -> purchase_may_be_needed
        {"product_name": "Spinach", "requested_quantity": 250.0, "unit": "g"},   # In inventory but expired -> purchase_may_be_needed
    ]
    response = check_duplicate_purchases(shopping_list, inv_data, as_of=ref_date)
    assert isinstance(response, DuplicateBatchCheckResponse)
    assert response.total_items_reviewed == 4
    assert response.simulated is True
    assert "avoid_purchase" in response.recommendations_summary
    assert response.recommendations_summary["avoid_purchase"] >= 1


# ---------------------------------------------------------------------------
# 7. Additional Robustness & Edge Case Tests
# ---------------------------------------------------------------------------

def test_multiple_inventory_records_aggregate(ref_date):
    """Multiple available records of the same product should aggregate their quantities."""
    p = ProposedPurchaseItem(product_name="White Rice", requested_quantity=3.0, unit="kg")
    inv = [
        InventoryItem(inventory_item_id="R1", product_name="White Rice", quantity=1.5, unit="kg", status="available"),
        InventoryItem(inventory_item_id="R2", product_name="White Rice", quantity=2.0, unit="kg", status="available"),
    ]
    res = check_duplicate_item(p, inv, as_of=ref_date)
    # Total available: 3.5 kg >= 3.0 kg requested -> avoid_purchase
    assert res.recommendation == "avoid_purchase"
    assert res.available_quantity == 3.5
    assert res.quantity_shortfall == 0.0
    assert len(res.inventory_item_ids) == 2


def test_empty_inventory_returns_purchase_needed(ref_date):
    p = ProposedPurchaseItem(product_name="Eggs", requested_quantity=12.0, unit="unit")
    res = check_duplicate_item(p, [], as_of=ref_date)
    assert res.recommendation == "purchase_may_be_needed"
    assert res.available_quantity == 0.0


def test_empty_proposed_purchases_returns_empty_batch(ref_date):
    res = check_duplicate_purchases([], load_sample_inventory_data(), as_of=ref_date)
    assert res.total_items_reviewed == 0
    assert len(res.results) == 0


def test_malformed_inventory_record_ignored_safely(ref_date):
    """Malformed inventory items should not crash batch duplicate checks."""
    p_list = [{"product_name": "White Rice", "requested_quantity": 1.0, "unit": "kg"}]
    inv_list = [
        {"inventory_item_id": "BAD", "product_name": "White Rice", "quantity": -5.0, "unit": "kg"}, # Invalid!
        {"inventory_item_id": "GOOD", "product_name": "White Rice", "quantity": 2.0, "unit": "kg", "status": "available"},
    ]
    res = check_duplicate_purchases(p_list, inv_list, as_of=ref_date)
    assert res.total_items_reviewed == 1
    assert res.results[0].recommendation == "avoid_purchase"
    assert res.results[0].available_quantity == 2.0


def test_no_mutation_of_caller_inputs(ref_date):
    p_dict = {"product_name": "Milk", "requested_quantity": 1.0, "unit": "l"}
    inv_dict = {"inventory_item_id": "I1", "product_name": "Milk", "quantity": 1.0, "unit": "l", "status": "available"}
    p_copy = dict(p_dict)
    inv_copy = dict(inv_dict)

    check_duplicate_purchases([p_dict], [inv_dict], as_of=ref_date)
    assert p_dict == p_copy
    assert inv_dict == inv_copy
