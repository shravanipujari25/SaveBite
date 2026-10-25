"""SaveBite Use-First Priority Scoring Engine.

Ranks a collection of grocery items by which should be consumed first, based on:
  - Expiry urgency (remaining shelf-life days vs reference life)
  - Perishability (product sensitivity from catalog)
  - Storage-condition warnings (zone mismatch, temperature anomaly)
  - Optional freshness override (e.g. known spoilage signal)

The scoring is fully deterministic and rule-based — no ML model is trained.
Weights are configurable via ScoringConfig to allow downstream tuning.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, timedelta
from typing import Any, Dict, List, Literal, Optional, Union

from pydantic import BaseModel, Field, field_validator, model_validator

from app.services.product_catalog import lookup_product
from app.services.shelf_life_service import (
    ShelfLifeEstimateRequest,
    estimate_shelf_life,
)

# ---------------------------------------------------------------------------
# Priority categories
# ---------------------------------------------------------------------------

# ---------------------------------------------------------------------------
# Priority categories
# ---------------------------------------------------------------------------

PriorityCategory = Literal["Red", "Orange", "Yellow", "Green", "Black"]

_SENSITIVITY_SCORE: Dict[str, float] = {
    "high": 1.0,
    "medium": 0.5,
    "low": 0.0,
}


# ---------------------------------------------------------------------------
# Scoring configuration
# ---------------------------------------------------------------------------


@dataclass
class ScoringConfig:
    """Weights and thresholds for the priority scoring engine.

    All weight values must be non-negative and sum to exactly 100.0%. They are
    applied additively to produce a score in the range [0.0, 100.0].

    Attributes:
        weight_urgency: Weight given to shelf-life expiry urgency (55.0%).
        weight_sensitivity: Weight given to category perishability (20.0%).
        weight_warnings: Weight given to storage concerns (15.0%).
        weight_freshness_penalty: Weight given to freshness information (10.0%).
        red_threshold: Score >= this -> 'Red' priority (default: 80.0).
        orange_threshold: Score >= this and < red_threshold -> 'Orange' priority (default: 60.0).
        yellow_threshold: Score >= this and < orange_threshold -> 'Yellow' priority (default: 35.0).
        urgency_critical_days: Items with remaining_days <= this always get max urgency score.
        max_reference_days_cap: Cap applied to reference_shelf_life when computing ratio.
            Prevents very long-lived items from dominating the denominator.
    """

    weight_urgency: float = 55.0
    weight_sensitivity: float = 20.0
    weight_warnings: float = 15.0
    weight_freshness_penalty: float = 10.0

    red_threshold: float = 80.0
    orange_threshold: float = 60.0
    yellow_threshold: float = 35.0

    urgency_critical_days: int = 3
    max_reference_days_cap: int = 365

    def __init__(
        self,
        weight_urgency: float = 55.0,
        weight_sensitivity: float = 20.0,
        weight_warnings: float = 15.0,
        weight_freshness_penalty: float = 10.0,
        red_threshold: Optional[float] = None,
        orange_threshold: Optional[float] = None,
        yellow_threshold: Optional[float] = None,
        urgency_critical_days: int = 3,
        max_reference_days_cap: int = 365,
        critical_threshold: Optional[float] = None,
        high_threshold: Optional[float] = None,
        medium_threshold: Optional[float] = None,
    ) -> None:
        self.weight_urgency = weight_urgency
        self.weight_sensitivity = weight_sensitivity
        self.weight_warnings = weight_warnings
        self.weight_freshness_penalty = weight_freshness_penalty

        # Support both confirmed names and legacy names
        if red_threshold is not None:
            self.red_threshold = red_threshold
        elif critical_threshold is not None:
            self.red_threshold = critical_threshold
        else:
            self.red_threshold = 80.0

        if orange_threshold is not None:
            self.orange_threshold = orange_threshold
        elif high_threshold is not None:
            self.orange_threshold = high_threshold
        else:
            self.orange_threshold = 60.0

        if yellow_threshold is not None:
            self.yellow_threshold = yellow_threshold
        elif medium_threshold is not None:
            self.yellow_threshold = medium_threshold
        else:
            self.yellow_threshold = 35.0

        self.urgency_critical_days = urgency_critical_days
        self.max_reference_days_cap = max_reference_days_cap

        self.__post_init__()

    # Backward-compatibility properties
    @property
    def critical_threshold(self) -> float:
        return self.red_threshold

    @property
    def high_threshold(self) -> float:
        return self.orange_threshold

    @property
    def medium_threshold(self) -> float:
        return self.yellow_threshold

    def __post_init__(self) -> None:
        for attr in (
            "weight_urgency",
            "weight_sensitivity",
            "weight_warnings",
            "weight_freshness_penalty",
        ):
            val = getattr(self, attr)
            if val < 0:
                raise ValueError(f"ScoringConfig.{attr} must be >= 0, got {val}.")

        total = (
            self.weight_urgency
            + self.weight_sensitivity
            + self.weight_warnings
            + self.weight_freshness_penalty
        )
        if abs(total - 100.0) > 1e-6:
            raise ValueError(f"Weights must sum to 100.0, got {total}.")

        if not (0 <= self.red_threshold <= 100):
            raise ValueError("red_threshold must be in [0, 100].")
        if not (0 <= self.orange_threshold <= self.red_threshold):
            raise ValueError("orange_threshold must be in [0, red_threshold].")
        if not (0 <= self.yellow_threshold <= self.orange_threshold):
            raise ValueError("yellow_threshold must be in [0, orange_threshold].")


DEFAULT_SCORING_CONFIG: ScoringConfig = ScoringConfig()


# ---------------------------------------------------------------------------
# Request / Response models
# ---------------------------------------------------------------------------


class GroceryItem(BaseModel):
    """A single grocery item to be scored.

    Attributes:
        item_id: Caller-supplied identifier for the item (e.g. database row ID).
        product_name: Name of the grocery product (resolved via catalog).
        purchase_date: Date the item was purchased.
        opened: Whether the package has been opened.
        storage_zone: Actual storage location of the item (optional).
        storage_temperature_c: Observed temperature in Celsius (optional).
        package_use_by_date: Manufacturer use-by date from packaging (optional).
        as_of_date: Evaluation date; defaults to today if omitted.
        freshness_override: If True, the item is flagged as showing visible
            spoilage signs, triggering a freshness penalty in scoring.
    """

    item_id: str = Field(..., description="Caller-supplied unique identifier for this grocery item.")
    product_name: str = Field(..., description="Name of the grocery product.")
    purchase_date: date = Field(..., description="Date the item was purchased (YYYY-MM-DD).")
    opened: bool = Field(..., description="Whether the package has been opened.")
    storage_zone: Optional[str] = Field(None, description="Actual storage location.")
    storage_temperature_c: Optional[float] = Field(
        None, description="Observed storage temperature in Celsius."
    )
    package_use_by_date: Optional[date] = Field(
        None, description="Manufacturer use-by date from packaging."
    )
    as_of_date: Optional[date] = Field(
        None, description="Evaluation date; defaults to today."
    )
    freshness_override: bool = Field(
        False,
        description="Set to True if the item shows visible spoilage signs.",
    )

    @field_validator("product_name")
    @classmethod
    def validate_product_name(cls, v: str) -> str:
        if not isinstance(v, str) or not v.strip():
            raise ValueError("product_name cannot be empty or whitespace-only.")
        return v.strip()

    @field_validator("item_id")
    @classmethod
    def validate_item_id(cls, v: str) -> str:
        if not isinstance(v, str) or not v.strip():
            raise ValueError("item_id cannot be empty or whitespace-only.")
        return v.strip()


class PriorityScoreRequest(BaseModel):
    """Request payload containing the list of items to score and rank."""

    items: List[GroceryItem] = Field(
        ..., min_length=1, description="List of grocery items to prioritize (at least 1)."
    )

    @field_validator("items")
    @classmethod
    def validate_unique_item_ids(cls, v: List[GroceryItem]) -> List[GroceryItem]:
        ids = [item.item_id for item in v]
        seen: set = set()
        duplicates: List[str] = []
        for iid in ids:
            if iid in seen:
                duplicates.append(iid)
            seen.add(iid)
        if duplicates:
            raise ValueError(f"Duplicate item_id(s) found: {duplicates}")
        return v


import math

class ScoredItem(BaseModel):
    """Scoring result for a single grocery item."""

    item_id: str
    product_name: str
    product_found: bool
    rank: int
    score: Optional[float] = Field(None, ge=0.0, le=100.0, description="Priority score in [0, 100], or None if unscoreable.")
    priority_category: PriorityCategory
    estimated_remaining_days: Optional[int]
    reference_shelf_life_days: Optional[int]
    urgency_ratio: Optional[float] = Field(
        None,
        description=(
            "Fraction of shelf life elapsed: 0.0 = just purchased, "
            "1.0 = at estimated end date, >1.0 = past estimated end."
        ),
    )
    warnings: List[str]
    explanation: str
    shelf_life_reliability: Optional[str] = Field(
        None,
        description="Phase 3 shelf-life estimate reliability ('high', 'medium', 'low', 'unavailable')."
    )
    unavailability_reason: Optional[str] = Field(
        None,
        description="Reason code if score is unavailable (e.g. 'unknown_product')."
    )


class PriorityScoreResponse(BaseModel):
    """Response containing all scored and ranked items."""

    as_of_date: date
    total_items: int
    scored_items: List[ScoredItem]


# ---------------------------------------------------------------------------
# Internal scoring helpers
# ---------------------------------------------------------------------------


def _compute_urgency_ratio(
    remaining_days: int,
    reference_days: int,
    cap: int,
) -> float:
    """Compute how much of the reference shelf life has elapsed.

    Returns a value in [0.0, ∞) where:
      - 0.0 means just purchased (full shelf life ahead)
      - 1.0 means at estimated end date
      - > 1.0 means past estimated end date

    The denominator is capped at `cap` so that very long-lived products (e.g.
    dried pasta with 730-day shelf life) are evaluated against a bounded scale.
    """
    effective_ref = min(reference_days, cap)
    if effective_ref <= 0:
        return 1.0
    elapsed = effective_ref - remaining_days
    return elapsed / effective_ref


def _urgency_score(
    remaining_days: Optional[int],
    reference_days: Optional[int],
    config: ScoringConfig,
) -> tuple[float, Optional[float]]:
    """Compute the urgency sub-score and urgency ratio.

    Returns:
        (urgency_sub_score, urgency_ratio)
    """
    if remaining_days is None or reference_days is None:
        return 0.0, None

    # Items past their estimated end date or within critical window get full score
    if remaining_days <= config.urgency_critical_days:
        ratio = _compute_urgency_ratio(remaining_days, reference_days, config.max_reference_days_cap)
        return config.weight_urgency, ratio

    ratio = _compute_urgency_ratio(remaining_days, reference_days, config.max_reference_days_cap)
    # Clamp ratio to [0, 1] for scoring; beyond 1 is already handled above
    clamped = min(max(ratio, 0.0), 1.0)
    return config.weight_urgency * clamped, ratio


def _sensitivity_score(
    product: Optional[Dict[str, Any]],
    config: ScoringConfig,
) -> float:
    """Compute the perishability sub-score from catalog sensitivity."""
    if product is None:
        return 0.0
    raw_sens = product.get("sensitivity", "low")
    factor = _SENSITIVITY_SCORE.get(str(raw_sens).strip().lower(), 0.0)
    return config.weight_sensitivity * factor


def _warnings_score(
    warnings: List[str],
    config: ScoringConfig,
) -> float:
    """Compute an additive score based on the count of active storage warnings."""
    # Scale storage warnings up to the allocated weight_warnings
    # Each warning gives weight_warnings / 2, capped at weight_warnings
    contribution = min(len(warnings) * (config.weight_warnings / 2.0), config.weight_warnings)
    return contribution


def _freshness_score(freshness_override: bool, config: ScoringConfig) -> float:
    """Return freshness penalty score if caller reports visible spoilage."""
    return config.weight_freshness_penalty if freshness_override else 0.0


def _categorize(score: Optional[float], config: ScoringConfig) -> PriorityCategory:
    """Map a numeric score to a confirmed PriorityCategory label.

    Boundaries:
      - 80 to 100 -> 'Red'
      - 60 to <80 -> 'Orange'
      - 35 to <60 -> 'Yellow'
      - 0 to <35  -> 'Green'
      - None / unscoreable -> 'Black'
    """
    if score is None:
        return "Black"
    if not isinstance(score, (int, float)) or math.isnan(score) or math.isinf(score):
        raise ValueError(f"Invalid non-finite or non-numeric score: {score}")

    if score >= config.red_threshold:
        return "Red"
    if score >= config.orange_threshold:
        return "Orange"
    if score >= config.yellow_threshold:
        return "Yellow"
    return "Green"


def _build_explanation(
    item: GroceryItem,
    product_found: bool,
    remaining_days: Optional[int],
    urgency_ratio: Optional[float],
    priority: PriorityCategory,
    score: Optional[float],
    freshness_override: bool,
    warnings: List[str],
    unavailability_reason: Optional[str] = None,
) -> str:
    """Build a concise human-readable explanation for the scored item."""
    parts: List[str] = []

    if not product_found or priority == "Black":
        reason = unavailability_reason or "unknown_product"
        parts.append(
            f"'{item.product_name}' cannot be reliably scored ({reason}): product not found in catalog."
        )
        parts.append(f"Priority category: '{priority}' (score unavailable).")
        return " ".join(parts)

    if remaining_days is not None:
        if remaining_days <= 0:
            parts.append(
                f"Reference estimate has elapsed ({abs(remaining_days)} day(s) past estimated end date)."
            )
        else:
            parts.append(f"{remaining_days} day(s) of estimated storage life remaining.")

    if urgency_ratio is not None:
        pct = min(int(urgency_ratio * 100), 100)
        parts.append(f"Approximately {pct}% of reference shelf life elapsed.")

    if freshness_override:
        parts.append("Marked with visible spoilage signal — consume or discard immediately.")

    if warnings:
        parts.append(f"{len(warnings)} storage warning(s) active.")

    parts.append(
        f"Priority category: '{priority}' (score {score:.1f}/100)."
    )

    return " ".join(parts)


# ---------------------------------------------------------------------------
# Public scoring function
# ---------------------------------------------------------------------------


def score_items(
    items: List[GroceryItem],
    config: Optional[ScoringConfig] = None,
) -> List[ScoredItem]:
    """Score and rank a list of grocery items by use-first priority.

    Args:
        items: List of GroceryItem instances to evaluate.
        config: Optional ScoringConfig; uses DEFAULT_SCORING_CONFIG if omitted.

    Returns:
        List of ScoredItem, sorted descending by score with Black/unscoreable items
        placed deterministically after scored items (rank 1 = highest priority).

    Raises:
        ValueError: If items is empty.
    """
    if not items:
        raise ValueError("items list must not be empty.")

    cfg = config if config is not None else DEFAULT_SCORING_CONFIG
    intermediate: List[Dict[str, Any]] = []

    for item in items:
        effective_as_of = item.as_of_date or date.today()

        # Build shelf-life estimate request
        sl_request = ShelfLifeEstimateRequest(
            product_name=item.product_name,
            storage_zone=item.storage_zone,
            purchase_date=item.purchase_date,
            opened=item.opened,
            storage_temperature_c=item.storage_temperature_c,
            package_use_by_date=item.package_use_by_date,
            as_of_date=effective_as_of,
        )
        sl_result = estimate_shelf_life(sl_request)

        # Propagate Phase 3 reliability
        reliability = sl_result.reliability

        if not sl_result.product_found:
            # Task D: Unknown product -> Black category, score=None, explicit reason
            unavailability_reason = "unknown_product"
            priority = "Black"
            explanation = _build_explanation(
                item=item,
                product_found=False,
                remaining_days=None,
                urgency_ratio=None,
                priority=priority,
                score=None,
                freshness_override=item.freshness_override,
                warnings=sl_result.warnings,
                unavailability_reason=unavailability_reason,
            )
            intermediate.append(
                {
                    "item_id": item.item_id,
                    "product_name": sl_result.product_name,
                    "product_found": False,
                    "score": None,
                    "priority_category": priority,
                    "estimated_remaining_days": None,
                    "reference_shelf_life_days": None,
                    "urgency_ratio": None,
                    "warnings": sl_result.warnings,
                    "explanation": explanation,
                    "shelf_life_reliability": reliability,
                    "unavailability_reason": unavailability_reason,
                }
            )
            continue

        product = lookup_product(item.product_name)
        remaining = sl_result.estimated_remaining_days
        reference = sl_result.reference_shelf_life_days

        # Sub-scores using confirmed weights (55/20/15/10)
        urgency_sub, urgency_ratio = _urgency_score(remaining, reference, cfg)
        sensitivity_sub = _sensitivity_score(product, cfg)
        warnings_sub = _warnings_score(sl_result.warnings, cfg)
        freshness_sub = _freshness_score(item.freshness_override, cfg)

        raw_score = urgency_sub + sensitivity_sub + warnings_sub + freshness_sub
        final_score = round(min(max(raw_score, 0.0), 100.0), 2)
        priority = _categorize(final_score, cfg)

        explanation = _build_explanation(
            item=item,
            product_found=True,
            remaining_days=remaining,
            urgency_ratio=urgency_ratio,
            priority=priority,
            score=final_score,
            freshness_override=item.freshness_override,
            warnings=sl_result.warnings,
        )

        intermediate.append(
            {
                "item_id": item.item_id,
                "product_name": sl_result.product_name,
                "product_found": True,
                "score": final_score,
                "priority_category": priority,
                "estimated_remaining_days": remaining,
                "reference_shelf_life_days": reference,
                "urgency_ratio": round(urgency_ratio, 4) if urgency_ratio is not None else None,
                "warnings": sl_result.warnings,
                "explanation": explanation,
                "shelf_life_reliability": reliability,
                "unavailability_reason": None,
            }
        )

    # Sort: scored items first (descending by score), Black/None items last, tie-breaking by item_id
    intermediate.sort(
        key=lambda x: (
            0 if x["score"] is not None else 1,
            -(x["score"]) if x["score"] is not None else 0.0,
            x["item_id"],
        )
    )

    scored: List[ScoredItem] = []
    for rank, rec in enumerate(intermediate, start=1):
        scored.append(
            ScoredItem(
                item_id=rec["item_id"],
                product_name=rec["product_name"],
                product_found=rec["product_found"],
                rank=rank,
                score=rec["score"],
                priority_category=rec["priority_category"],
                estimated_remaining_days=rec["estimated_remaining_days"],
                reference_shelf_life_days=rec["reference_shelf_life_days"],
                urgency_ratio=rec["urgency_ratio"],
                warnings=rec["warnings"],
                explanation=rec["explanation"],
                shelf_life_reliability=rec["shelf_life_reliability"],
                unavailability_reason=rec["unavailability_reason"],
            )
        )

    return scored


def prioritize_items(
    request: Union[PriorityScoreRequest, Dict[str, Any]],
    config: Optional[ScoringConfig] = None,
) -> PriorityScoreResponse:
    """Entry point for the priority scoring engine.

    Args:
        request: PriorityScoreRequest or equivalent dict.
        config: Optional ScoringConfig; uses DEFAULT_SCORING_CONFIG if omitted.

    Returns:
        PriorityScoreResponse with all scored and ranked items.
    """
    if not isinstance(request, PriorityScoreRequest):
        request = PriorityScoreRequest(**request)

    effective_as_of = (
        request.items[0].as_of_date or date.today() if request.items else date.today()
    )
    scored = score_items(request.items, config=config)

    return PriorityScoreResponse(
        as_of_date=effective_as_of,
        total_items=len(scored),
        scored_items=scored,
    )
