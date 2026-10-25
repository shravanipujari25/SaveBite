"""SaveBite Duplicate-Purchase Detection Intelligence Service.

Phase 6: Rule-based evaluation comparing a proposed grocery purchase against
current household inventory.

Features:
  - Inventory item and proposed purchase modeling and validation
  - Conservative product matching (product_id, canonical catalog names, catalog aliases)
  - Strict rejection of false merges (e.g. Milk vs Milk Powder, Rice vs Rice Flour)
  - Safe dimensional unit normalization (mass: g/kg, volume: ml/l, count: unit)
  - Expiry and inventory status classification (filtering expired, consumed, discarded)
  - Near-expiry prioritization ("use_existing_stock_first")
  - Structured, explainable recommendations:
      * avoid_purchase: sufficient usable stock exists
      * reduce_quantity: partial stock exists
      * use_existing_stock_first: existing stock near expiry
      * purchase_may_be_needed: no usable stock or insufficient quantity
      * review_inventory: unit mismatch, ambiguous match, or conflicting data
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, datetime
import json
import math
from pathlib import Path
import re
from typing import Any, Dict, List, Literal, Optional, Set, Tuple, Union

from pydantic import BaseModel, Field, field_validator

from app.services.product_catalog import (
    ProductCatalog,
    get_default_catalog,
    lookup_product,
    normalize_product_name,
)

# ---------------------------------------------------------------------------
# Enums and Types
# ---------------------------------------------------------------------------

InventoryStatus = Literal["available", "consumed", "discarded", "expired"]

RecommendationCategory = Literal[
    "avoid_purchase",
    "reduce_quantity",
    "use_existing_stock_first",
    "purchase_may_be_needed",
    "review_inventory",
]

MatchMethod = Literal[
    "product_id",
    "normalized_exact_name",
    "catalog_alias",
    "no_match",
    "uncertain_match",
]

# Supported unit conversion families
MASS_CONVERSIONS: Dict[str, float] = {
    "g": 0.001,
    "kg": 1.0,
}

VOLUME_CONVERSIONS: Dict[str, float] = {
    "ml": 0.001,
    "l": 1.0,
}

COUNT_UNITS: Set[str] = {"unit", "piece", "pieces", "item", "items", "count", "pack", "can", "bottle"}

# Threshold in days to consider existing stock "near expiry"
DEFAULT_NEAR_EXPIRY_DAYS: int = 2

# Distinct non-equivalent product words that should NEVER match base products
DISTINCT_QUALIFIERS: Set[str] = {
    "powder",
    "flour",
    "condensed",
    "evaporated",
    "paste",
    "sauce",
    "juice",
    "chips",
    "crisps",
    "syrup",
    "oil",
    "extract",
}


# ---------------------------------------------------------------------------
# Data Models
# ---------------------------------------------------------------------------

class InventoryItem(BaseModel):
    """An item currently recorded in the user's household inventory."""

    inventory_item_id: str = Field(..., description="Unique inventory record identifier.")
    product_id: Optional[str] = Field(None, description="Catalog identifier if available.")
    product_name: str = Field(..., description="User-facing product name.")
    quantity: float = Field(..., description="Numeric quantity recorded.")
    unit: str = Field(..., description="Unit of measurement (e.g. 'kg', 'g', 'l', 'ml', 'unit').")
    purchase_date: Optional[date] = Field(None, description="Date item was purchased.")
    expiry_date: Optional[date] = Field(None, description="Explicit manufacturer expiry date.")
    estimated_expiry_date: Optional[date] = Field(None, description="Estimated expiry date from shelf life.")
    opened: bool = Field(False, description="Whether package has been opened.")
    status: InventoryStatus = Field("available", description="Inventory state.")
    simulated: bool = Field(True, description="True for synthetic/simulated inventory records.")

    @field_validator("inventory_item_id", "product_name", "unit")
    @classmethod
    def validate_non_empty_strings(cls, v: str) -> str:
        if not isinstance(v, str) or not v.strip():
            raise ValueError("Field cannot be empty or whitespace-only.")
        return v.strip()

    @field_validator("quantity")
    @classmethod
    def validate_quantity(cls, v: float) -> float:
        if not isinstance(v, (int, float)) or math.isnan(v) or math.isinf(v):
            raise ValueError(f"Quantity must be a finite number, got {v}")
        if v <= 0:
            raise ValueError(f"Quantity must be greater than zero, got {v}")
        return float(v)

    @field_validator("unit")
    @classmethod
    def normalize_unit_str(cls, v: str) -> str:
        return v.strip().lower()


class ProposedPurchaseItem(BaseModel):
    """A single product line the user is considering buying."""

    product_id: Optional[str] = Field(None, description="Catalog identifier if known.")
    product_name: str = Field(..., description="Name of the product to purchase.")
    requested_quantity: float = Field(..., description="Quantity to purchase.")
    unit: str = Field(..., description="Unit of measurement.")

    @field_validator("product_name", "unit")
    @classmethod
    def validate_strings(cls, v: str) -> str:
        if not isinstance(v, str) or not v.strip():
            raise ValueError("Field cannot be empty or whitespace-only.")
        return v.strip()

    @field_validator("requested_quantity")
    @classmethod
    def validate_quantity(cls, v: float) -> float:
        if not isinstance(v, (int, float)) or math.isnan(v) or math.isinf(v):
            raise ValueError(f"Requested quantity must be a finite number, got {v}")
        if v <= 0:
            raise ValueError(f"Requested quantity must be greater than zero, got {v}")
        return float(v)

    @field_validator("unit")
    @classmethod
    def normalize_unit_str(cls, v: str) -> str:
        return v.strip().lower()


class DuplicateCheckResult(BaseModel):
    """Evaluation result and recommendation for a proposed purchase line."""

    requested_product_name: str
    matched_product_id: Optional[str] = None
    matched_product_name: Optional[str] = None
    match_method: MatchMethod
    recommendation: RecommendationCategory
    requested_quantity: float
    requested_unit: str
    available_quantity: Optional[float] = None
    available_unit: Optional[str] = None
    quantity_shortfall: Optional[float] = None
    projected_quantity_after_purchase: Optional[float] = None
    inventory_item_ids: List[str] = Field(default_factory=list)
    expiry_concern: bool = False
    reasons: List[str]
    message: str
    simulated: bool = True


class DuplicateBatchCheckResponse(BaseModel):
    """Batch response reviewing a proposed shopping list against inventory."""

    as_of_date: date
    total_items_reviewed: int
    recommendations_summary: Dict[str, int]
    results: List[DuplicateCheckResult]
    simulated: bool = True
    caveat: str = (
        "Duplicate purchase detection relies on current inventory records and unit compatibility. "
        "It does not claim real-time household physical sensor verification."
    )


# ---------------------------------------------------------------------------
# Unit Conversion Utilities
# ---------------------------------------------------------------------------

def convert_units(
    from_quantity: float,
    from_unit: str,
    to_unit: str,
) -> Optional[float]:
    """Convert between compatible mass or volume units.

    Returns None if units belong to different dimensions or are unsupported.
    """
    u_from = from_unit.strip().lower()
    u_to = to_unit.strip().lower()

    if u_from == u_to:
        return from_quantity

    # Mass conversion
    if u_from in MASS_CONVERSIONS and u_to in MASS_CONVERSIONS:
        base_kg = from_quantity * MASS_CONVERSIONS[u_from]
        return base_kg / MASS_CONVERSIONS[u_to]

    # Volume conversion
    if u_from in VOLUME_CONVERSIONS and u_to in VOLUME_CONVERSIONS:
        base_l = from_quantity * VOLUME_CONVERSIONS[u_from]
        return base_l / VOLUME_CONVERSIONS[u_to]

    # Counts
    if u_from in COUNT_UNITS and u_to in COUNT_UNITS:
        return from_quantity

    return None


# ---------------------------------------------------------------------------
# Product Matching Logic
# ---------------------------------------------------------------------------

def _has_distinct_qualifier(name_a: str, name_b: str) -> bool:
    """Check if one name has a distinct qualifier word (like powder, flour, sauce, juice)
    that the other does not have."""
    words_a = set(re.findall(r"\b\w+\b", name_a.lower()))
    words_b = set(re.findall(r"\b\w+\b", name_b.lower()))

    qualifiers_in_a = words_a.intersection(DISTINCT_QUALIFIERS)
    qualifiers_in_b = words_b.intersection(DISTINCT_QUALIFIERS)

    return qualifiers_in_a != qualifiers_in_b


def match_products(
    purchase_item: ProposedPurchaseItem,
    inventory_item: InventoryItem,
    catalog: Optional[ProductCatalog] = None,
) -> Tuple[bool, MatchMethod, Optional[str]]:
    """Determine whether a proposed purchase matches an inventory item conservatively.

    Returns:
        (is_match, match_method, matched_canonical_name)
    """
    cat = catalog if catalog is not None else get_default_catalog()

    # 1. Product ID match
    if purchase_item.product_id and inventory_item.product_id:
        if purchase_item.product_id.strip() == inventory_item.product_id.strip():
            prod = getattr(cat, "_products_by_id", {}).get(purchase_item.product_id.strip())
            canonical = prod["product_name"] if prod else inventory_item.product_name
            return True, "product_id", canonical

    p_raw = purchase_item.product_name
    i_raw = inventory_item.product_name

    # Check distinct qualifiers (e.g. Milk vs Milk Powder, Rice vs Rice Flour)
    if _has_distinct_qualifier(p_raw, i_raw):
        return False, "no_match", None

    # 2. Normalized exact name match
    p_norm = normalize_product_name(p_raw)
    i_norm = normalize_product_name(i_raw)

    if p_norm and i_norm and p_norm == i_norm:
        # Check if normalized name maps to a catalog product
        prod = lookup_product(p_norm, catalog=cat)
        canonical = prod["product_name"] if prod else i_raw
        return True, "normalized_exact_name", canonical

    # 3. Catalog lookup equivalence
    prod_p = lookup_product(p_raw, catalog=cat)
    prod_i = lookup_product(i_raw, catalog=cat)

    if prod_p and prod_i and prod_p["product_id"] == prod_i["product_id"]:
        return True, "catalog_alias", prod_p["product_name"]

    return False, "no_match", None


# ---------------------------------------------------------------------------
# Inventory Availability & Expiry Classification
# ---------------------------------------------------------------------------

def is_inventory_usable(
    item: InventoryItem,
    as_of: date,
) -> Tuple[bool, bool, Optional[str]]:
    """Determine whether an inventory record represents usable, non-expired stock.

    Returns:
        (is_usable, is_near_expiry, reason_if_unusable)
    """
    # Exclude consumed or discarded items
    if item.status in ("consumed", "discarded"):
        return False, False, f"item status is '{item.status}'"

    # Explicit expired status
    if item.status == "expired":
        return False, False, "item is marked expired"

    # Date-based expiry checks
    effective_expiry = item.expiry_date or item.estimated_expiry_date

    if effective_expiry is not None:
        if effective_expiry < as_of:
            return False, False, f"item expired on {effective_expiry} (evaluated as of {as_of})"

        days_remaining = (effective_expiry - as_of).days
        is_near_expiry = (0 <= days_remaining <= DEFAULT_NEAR_EXPIRY_DAYS)
        return True, is_near_expiry, None

    # Expiry unknown -> usable, but not flagged as near expiry
    return True, False, None


# ---------------------------------------------------------------------------
# Core Service Logic
# ---------------------------------------------------------------------------

def check_duplicate_item(
    purchase: ProposedPurchaseItem,
    inventory: List[InventoryItem],
    as_of: date,
    catalog: Optional[ProductCatalog] = None,
) -> DuplicateCheckResult:
    """Evaluate a single proposed purchase item against the inventory."""
    cat = catalog if catalog is not None else get_default_catalog()

    # Step 1: Match inventory records
    matched_records: List[Tuple[InventoryItem, MatchMethod, str]] = []

    for inv in inventory:
        matched, method, canonical_name = match_products(purchase, inv, catalog=cat)
        if matched:
            matched_records.append((inv, method, canonical_name or inv.product_name))

    if not matched_records:
        return DuplicateCheckResult(
            requested_product_name=purchase.product_name,
            match_method="no_match",
            recommendation="purchase_may_be_needed",
            requested_quantity=purchase.requested_quantity,
            requested_unit=purchase.unit,
            available_quantity=0.0,
            available_unit=purchase.unit,
            quantity_shortfall=purchase.requested_quantity,
            projected_quantity_after_purchase=purchase.requested_quantity,
            inventory_item_ids=[],
            expiry_concern=False,
            reasons=["No matching items found in household inventory."],
            message=f"No existing stock of '{purchase.product_name}' found. Purchase may be needed.",
            simulated=True,
        )

    # Use first match's metadata for canonical representation
    _, primary_method, canonical_prod_name = matched_records[0]
    matched_prod_id = matched_records[0][0].product_id

    # Step 2: Filter usable stock and track near-expiry
    usable_items: List[InventoryItem] = []
    near_expiry_items: List[InventoryItem] = []
    unusable_reasons: List[str] = []

    for inv, _, _ in matched_records:
        usable, near_expiry, reason = is_inventory_usable(inv, as_of)
        if usable:
            usable_items.append(inv)
            if near_expiry:
                near_expiry_items.append(inv)
        else:
            unusable_reasons.append(f"{inv.inventory_item_id}: {reason}")

    if not usable_items:
        return DuplicateCheckResult(
            requested_product_name=purchase.product_name,
            matched_product_id=matched_prod_id,
            matched_product_name=canonical_prod_name,
            match_method=primary_method,
            recommendation="purchase_may_be_needed",
            requested_quantity=purchase.requested_quantity,
            requested_unit=purchase.unit,
            available_quantity=0.0,
            available_unit=purchase.unit,
            quantity_shortfall=purchase.requested_quantity,
            projected_quantity_after_purchase=purchase.requested_quantity,
            inventory_item_ids=[inv.inventory_item_id for inv, _, _ in matched_records],
            expiry_concern=False,
            reasons=[
                "Matching inventory items exist but are not usable:",
                *unusable_reasons,
            ],
            message=(
                f"Existing inventory for '{canonical_prod_name}' was found but is not usable "
                f"({len(unusable_reasons)} item(s) consumed, discarded, or expired). Purchase may be needed."
            ),
            simulated=True,
        )

    # Step 3: Unit conversion & quantity aggregation
    total_available = 0.0
    unit_mismatch_occurred = False

    for inv in usable_items:
        converted = convert_units(inv.quantity, inv.unit, purchase.unit)
        if converted is not None:
            total_available += converted
        else:
            unit_mismatch_occurred = True

    # If all items failed unit conversion
    if unit_mismatch_occurred and total_available == 0.0:
        inv_units = list({inv.unit for inv in usable_items})
        return DuplicateCheckResult(
            requested_product_name=purchase.product_name,
            matched_product_id=matched_prod_id,
            matched_product_name=canonical_prod_name,
            match_method=primary_method,
            recommendation="review_inventory",
            requested_quantity=purchase.requested_quantity,
            requested_unit=purchase.unit,
            available_quantity=None,
            available_unit=None,
            quantity_shortfall=None,
            projected_quantity_after_purchase=None,
            inventory_item_ids=[inv.inventory_item_id for inv in usable_items],
            expiry_concern=bool(near_expiry_items),
            reasons=[
                f"Found matching inventory, but units '{inv_units}' cannot be safely converted to requested unit '{purchase.unit}'."
            ],
            message=(
                f"You have existing stock of '{canonical_prod_name}', but the units cannot be directly compared "
                f"({purchase.requested_quantity} {purchase.unit} vs existing {inv_units}). Please review inventory."
            ),
            simulated=True,
        )

    # Step 4: Decision Precedence
    total_available = round(total_available, 4)
    shortfall = max(0.0, round(purchase.requested_quantity - total_available, 4))
    projected = round(total_available + purchase.requested_quantity, 4)
    item_ids = [inv.inventory_item_id for inv in usable_items]

    # Precedence Rule 1: Existing stock is near expiry
    if near_expiry_items:
        return DuplicateCheckResult(
            requested_product_name=purchase.product_name,
            matched_product_id=matched_prod_id,
            matched_product_name=canonical_prod_name,
            match_method=primary_method,
            recommendation="use_existing_stock_first",
            requested_quantity=purchase.requested_quantity,
            requested_unit=purchase.unit,
            available_quantity=total_available,
            available_unit=purchase.unit,
            quantity_shortfall=shortfall,
            projected_quantity_after_purchase=projected,
            inventory_item_ids=item_ids,
            expiry_concern=True,
            reasons=[
                f"Matching stock of {total_available} {purchase.unit} is available.",
                f"{len(near_expiry_items)} item(s) are nearing expiry.",
                "Recommend consuming existing stock first before buying new items.",
            ],
            message=(
                f"You have {total_available} {purchase.unit} of '{canonical_prod_name}' nearing expiry. "
                f"Consider using existing stock first before purchasing more."
            ),
            simulated=True,
        )

    # Precedence Rule 2: Sufficient usable stock (available >= requested)
    if total_available >= purchase.requested_quantity:
        return DuplicateCheckResult(
            requested_product_name=purchase.product_name,
            matched_product_id=matched_prod_id,
            matched_product_name=canonical_prod_name,
            match_method=primary_method,
            recommendation="avoid_purchase",
            requested_quantity=purchase.requested_quantity,
            requested_unit=purchase.unit,
            available_quantity=total_available,
            available_unit=purchase.unit,
            quantity_shortfall=0.0,
            projected_quantity_after_purchase=projected,
            inventory_item_ids=item_ids,
            expiry_concern=False,
            reasons=[
                f"A matching inventory item was found via {primary_method}.",
                f"Existing usable stock ({total_available} {purchase.unit}) meets or exceeds the requested {purchase.requested_quantity} {purchase.unit}.",
            ],
            message=(
                f"You already have {total_available} {purchase.unit} of '{canonical_prod_name}'. "
                f"Check your existing stock before purchasing another {purchase.requested_quantity} {purchase.unit}."
            ),
            simulated=True,
        )

    # Precedence Rule 3: Partial usable stock (0 < available < requested)
    if total_available > 0.0:
        return DuplicateCheckResult(
            requested_product_name=purchase.product_name,
            matched_product_id=matched_prod_id,
            matched_product_name=canonical_prod_name,
            match_method=primary_method,
            recommendation="reduce_quantity",
            requested_quantity=purchase.requested_quantity,
            requested_unit=purchase.unit,
            available_quantity=total_available,
            available_unit=purchase.unit,
            quantity_shortfall=shortfall,
            projected_quantity_after_purchase=projected,
            inventory_item_ids=item_ids,
            expiry_concern=False,
            reasons=[
                f"Matching stock of {total_available} {purchase.unit} exists.",
                f"Requested quantity ({purchase.requested_quantity} {purchase.unit}) exceeds available stock by {shortfall} {purchase.unit}.",
            ],
            message=(
                f"You already have {total_available} {purchase.unit} of '{canonical_prod_name}'. "
                f"Consider whether you need the full additional {purchase.requested_quantity} {purchase.unit} (shortfall is {shortfall} {purchase.unit})."
            ),
            simulated=True,
        )

    # Precedence Rule 4: Fallback
    return DuplicateCheckResult(
        requested_product_name=purchase.product_name,
        matched_product_id=matched_prod_id,
        matched_product_name=canonical_prod_name,
        match_method=primary_method,
        recommendation="purchase_may_be_needed",
        requested_quantity=purchase.requested_quantity,
        requested_unit=purchase.unit,
        available_quantity=0.0,
        available_unit=purchase.unit,
        quantity_shortfall=purchase.requested_quantity,
        projected_quantity_after_purchase=purchase.requested_quantity,
        inventory_item_ids=item_ids,
        expiry_concern=False,
        reasons=["Available quantity is zero or cannot be verified."],
        message=f"No usable stock verified for '{canonical_prod_name}'. Purchase may be needed.",
        simulated=True,
    )


# ---------------------------------------------------------------------------
# Public Batch Service Function
# ---------------------------------------------------------------------------

def check_duplicate_purchases(
    proposed_purchases: List[Union[ProposedPurchaseItem, Dict[str, Any]]],
    inventory: List[Union[InventoryItem, Dict[str, Any]]],
    as_of: Optional[date] = None,
    catalog: Optional[ProductCatalog] = None,
) -> DuplicateBatchCheckResponse:
    """Analyze a proposed shopping list against household inventory.

    Args:
        proposed_purchases: List of items the user considers buying.
        inventory: Household inventory records.
        as_of: Reference date for expiry evaluation (defaults to today).
        catalog: Product catalog instance (defaults to system catalog).

    Returns:
        DuplicateBatchCheckResponse with structured per-item recommendations.
    """
    eval_date = as_of if as_of is not None else date.today()
    cat = catalog if catalog is not None else get_default_catalog()

    # Parse and validate proposed purchases
    valid_purchases: List[ProposedPurchaseItem] = []
    for item in proposed_purchases:
        if isinstance(item, ProposedPurchaseItem):
            valid_purchases.append(item)
        elif isinstance(item, dict):
            valid_purchases.append(ProposedPurchaseItem(**item))

    # Parse and validate inventory items
    valid_inventory: List[InventoryItem] = []
    for inv in inventory:
        if isinstance(inv, InventoryItem):
            valid_inventory.append(inv)
        elif isinstance(inv, dict):
            try:
                valid_inventory.append(InventoryItem(**inv))
            except Exception:
                # Malformed inventory item ignored from available usable pool
                continue

    results: List[DuplicateCheckResult] = []
    summary: Dict[str, int] = {
        "avoid_purchase": 0,
        "reduce_quantity": 0,
        "use_existing_stock_first": 0,
        "purchase_may_be_needed": 0,
        "review_inventory": 0,
    }

    for p in valid_purchases:
        res = check_duplicate_item(p, valid_inventory, as_of=eval_date, catalog=cat)
        results.append(res)
        summary[res.recommendation] = summary.get(res.recommendation, 0) + 1

    return DuplicateBatchCheckResponse(
        as_of_date=eval_date,
        total_items_reviewed=len(results),
        recommendations_summary=summary,
        results=results,
        simulated=True,
    )


def load_sample_inventory_data(file_path: Optional[Union[str, Path]] = None) -> List[Dict[str, Any]]:
    """Load the synthetic household inventory dataset from disk."""
    if file_path is None:
        target_path = Path(__file__).resolve().parent.parent / "data" / "sample_inventory.json"
    else:
        target_path = Path(file_path)

    if not target_path.exists():
        raise FileNotFoundError(f"Synthetic inventory dataset not found at {target_path}")

    with open(target_path, "r", encoding="utf-8") as f:
        data = json.load(f)

    return data.get("inventory", [])
