"""SaveBite Grocery Intelligence & Food-Waste Management Orchestration Service.

Phase 8: System Integration & End-to-End Orchestration.

Coordinates:
  - Phase 2: Product catalog lookup and name normalization
  - Phase 3: Shelf-life estimation
  - Phase 4: Use-First priority scoring (Red, Orange, Yellow, Green, Black)
  - Phase 5: Synthetic IoT sensor intelligence (optional)
  - Phase 6: Duplicate-purchase detection (optional)
  - Phase 7: Recipe recommendation & waste-reduction intelligence (optional)

Features & Design Principles:
  1. Clean, decoupled orchestration reusing existing service contracts without rewriting algorithms.
  2. Inventory normalization and safety classification (excluding expired/consumed/discarded stock).
  3. Structured partial-failure and skip semantics (distinguishing completed, skipped, unavailable, failed).
  4. Explicit simulation transparency (marking synthetic sensor readings / simulated inventory).
  5. Deterministic tie-breaking and evaluation dates for reproducible testing.
"""

from __future__ import annotations

from datetime import date, datetime, timezone
import logging
from typing import Any, Dict, List, Literal, Optional, Union

from pydantic import BaseModel, Field, field_validator

from app.services.product_catalog import (
    ProductCatalog,
    get_default_catalog,
    lookup_product,
    normalize_product_name,
)
from app.services.shelf_life_service import (
    ShelfLifeEstimateRequest,
    ShelfLifeEstimateResponse,
    estimate_shelf_life,
)
from app.services.priority_scoring import (
    GroceryItem,
    PriorityScoreRequest,
    PriorityScoreResponse,
    ScoredItem,
    prioritize_items,
)
from app.services.sensor_service import (
    SensorAlert,
    SensorBatchAnalysisResponse,
    SensorReading,
    analyze_sensor_readings,
)
from app.services.duplicate_purchase_service import (
    DuplicateBatchCheckResponse,
    DuplicateCheckResult,
    InventoryItem,
    ProposedPurchaseItem,
    check_duplicate_purchases,
    is_inventory_usable,
)
from app.services.recipe_recommendation_service import (
    RecipeRecommendation,
    RecipeRecommendationResponse,
    recommend_recipes,
)

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Enums and Status Literals
# ---------------------------------------------------------------------------

ComponentStatus = Literal["completed", "skipped", "unavailable", "failed"]
OrchestrationOverallStatus = Literal["completed", "partial_success", "failed"]


# ---------------------------------------------------------------------------
# Request Models
# ---------------------------------------------------------------------------

class UnifiedAnalyzeRequest(BaseModel):
    """Input request contract for unified grocery intelligence analysis."""

    inventory: List[InventoryItem] = Field(
        ..., min_length=1, description="List of household inventory items (at least 1 required)."
    )
    proposed_purchases: Optional[List[ProposedPurchaseItem]] = Field(
        default=None, description="Optional shopping list of proposed purchases to check for duplicates."
    )
    sensor_readings: Optional[List[Union[SensorReading, Dict[str, Any]]]] = Field(
        default=None, description="Optional telemetry readings from household storage sensors (simulated)."
    )
    include_recipes: bool = Field(
        default=True, description="Whether to compute recipe recommendations using available inventory."
    )
    recipe_limit: int = Field(
        default=5, ge=1, le=50, description="Maximum number of recipe recommendations to return."
    )
    as_of_date: Optional[date] = Field(
        default=None, description="Reference date for deterministic calculations; defaults to today."
    )
    freshness_overrides: Optional[Dict[str, str]] = Field(
        default=None,
        description=(
            "Optional mapping of inventory_item_id -> freshness condition string "
            "(e.g. 'fresh', 'ripe', 'visibly_spoiled', 'uncertain'). "
            "When provided for a given item, and when the condition is 'visibly_spoiled' "
            "AND is_confident=True (caller responsibility), the priority scorer's "
            "freshness_override flag is set to True for that item. "
            "Uncertain or low-confidence conditions must NOT be passed here as 'visibly_spoiled'. "
            "Conditions do not override expiry dates or shelf-life estimates."
        ),
    )
    freshness_confidence: Optional[Dict[str, float]] = Field(
        default=None,
        description=(
            "Optional mapping of inventory_item_id -> freshness confidence [0.0, 1.0]. "
            "Used together with freshness_overrides: the freshness_override scoring flag "
            "is only activated when confidence >= 0.60 (the model's reliability threshold). "
            "Absent confidence defaults to 0.0 (override not applied)."
        ),
    )

    @field_validator("inventory")
    @classmethod
    def validate_inventory_non_empty(cls, v: List[InventoryItem]) -> List[InventoryItem]:
        if not v:
            raise ValueError("inventory list must contain at least 1 item.")
        return v


# ---------------------------------------------------------------------------
# Component Response Models
# ---------------------------------------------------------------------------

class InventorySummary(BaseModel):
    """Aggregate statistics for household inventory."""

    total_items: int = Field(..., ge=0)
    eligible_items: int = Field(..., ge=0, description="Items with status 'available' and non-expired.")
    expired_items: int = Field(..., ge=0, description="Items identified as expired relative to as_of_date.")
    unavailable_items: int = Field(..., ge=0, description="Items marked consumed, discarded, or non-positive quantity.")
    unresolved_products: int = Field(..., ge=0, description="Items that could not be mapped to catalog.")


class ProductResolutionItem(BaseModel):
    """Catalog normalization details for a single inventory item."""

    inventory_item_id: str
    original_product_name: str
    catalog_product_id: Optional[str] = None
    canonical_name: Optional[str] = None
    category: Optional[str] = None
    default_storage_zone: Optional[str] = None
    found_in_catalog: bool


class SensorAnalysisSection(BaseModel):
    """Result section for synthetic IoT telemetry analysis."""

    status: ComponentStatus
    simulated: bool = False
    total_readings_analyzed: int = 0
    anomalies_detected: int = 0
    alerts: List[SensorAlert] = Field(default_factory=list)
    message: Optional[str] = None


class DuplicatePurchaseSection(BaseModel):
    """Result section for duplicate-purchase intelligence."""

    status: ComponentStatus
    total_proposed: int = 0
    results: List[DuplicateCheckResult] = Field(default_factory=list)
    message: Optional[str] = None


class RecipeRecommendationsSection(BaseModel):
    """Result section for recipe recommendations."""

    status: ComponentStatus
    total_recommendations: int = 0
    recommendations: List[RecipeRecommendation] = Field(default_factory=list)
    message: Optional[str] = None


# ---------------------------------------------------------------------------
# Master Unified Response Model
# ---------------------------------------------------------------------------

class UnifiedAnalyzeResponse(BaseModel):
    """Master response schema aggregating intelligence across all SaveBite modules."""

    as_of_date: date
    overall_status: OrchestrationOverallStatus
    inventory_summary: InventorySummary
    product_resolutions: List[ProductResolutionItem] = Field(default_factory=list)
    shelf_life_estimates: List[ShelfLifeEstimateResponse] = Field(default_factory=list)
    priority_scores: List[ScoredItem] = Field(default_factory=list)
    sensor_analysis: SensorAnalysisSection
    duplicate_purchase_analysis: DuplicatePurchaseSection
    recipe_recommendations: RecipeRecommendationsSection
    warnings: List[str] = Field(default_factory=list)
    errors: List[str] = Field(default_factory=list)
    simulated_data_used: bool = False


# ---------------------------------------------------------------------------
# Orchestration Logic
# ---------------------------------------------------------------------------

def run_grocery_orchestration(
    request: Union[UnifiedAnalyzeRequest, Dict[str, Any]],
    catalog: Optional[ProductCatalog] = None,
) -> UnifiedAnalyzeResponse:
    """Execute end-to-end grocery intelligence workflow across all modular services.

    Args:
        request: UnifiedAnalyzeRequest or compatible dictionary.
        catalog: Optional ProductCatalog instance (defaults to default catalog).

    Returns:
        UnifiedAnalyzeResponse with complete synchronized analysis results.
    """
    if not isinstance(request, UnifiedAnalyzeRequest):
        request = UnifiedAnalyzeRequest(**request)

    cat = catalog if catalog is not None else get_default_catalog()
    eval_date: date = request.as_of_date or date.today()

    warnings: List[str] = []
    errors: List[str] = []
    any_simulated = False

    # -----------------------------------------------------------------------
    # Step 1: Inventory Parsing, Simulation Audit & Catalog Resolution
    # -----------------------------------------------------------------------
    total_items = len(request.inventory)
    eligible_count = 0
    expired_count = 0
    unavailable_count = 0
    unresolved_count = 0

    resolutions: List[ProductResolutionItem] = []

    for item in request.inventory:
        if item.simulated:
            any_simulated = True

        # Check eligibility and usability using Phase 6 logic
        usable, is_near_expiry, reason = is_inventory_usable(item, as_of=eval_date)
        if usable:
            eligible_count += 1
        elif reason and "expired" in reason:
            expired_count += 1
        else:
            unavailable_count += 1

        # Resolve against catalog
        prod = lookup_product(item.product_name, catalog=cat)
        if prod:
            resolutions.append(
                ProductResolutionItem(
                    inventory_item_id=item.inventory_item_id,
                    original_product_name=item.product_name,
                    catalog_product_id=prod.get("product_id"),
                    canonical_name=prod.get("product_name"),
                    category=prod.get("category"),
                    default_storage_zone=prod.get("storage_zone"),
                    found_in_catalog=True,
                )
            )
        else:
            unresolved_count += 1
            resolutions.append(
                ProductResolutionItem(
                    inventory_item_id=item.inventory_item_id,
                    original_product_name=item.product_name,
                    catalog_product_id=None,
                    canonical_name=None,
                    category=None,
                    default_storage_zone=None,
                    found_in_catalog=False,
                )
            )
            warnings.append(
                f"Product '{item.product_name}' (ID: {item.inventory_item_id}) could not be resolved in the catalog."
            )

    summary = InventorySummary(
        total_items=total_items,
        eligible_items=eligible_count,
        expired_items=expired_count,
        unavailable_items=unavailable_count,
        unresolved_products=unresolved_count,
    )

    # -----------------------------------------------------------------------
    # Step 2: Shelf-Life Estimation (Phase 3)
    # -----------------------------------------------------------------------
    shelf_life_results: List[ShelfLifeEstimateResponse] = []
    for item in request.inventory:
        try:
            sl_req = ShelfLifeEstimateRequest(
                product_name=item.product_name,
                storage_zone=getattr(item, "storage_zone", None),
                purchase_date=item.purchase_date or eval_date,
                opened=item.opened,
                package_use_by_date=item.expiry_date,
                as_of_date=eval_date,
            )
            est = estimate_shelf_life(sl_req, catalog=cat)
            shelf_life_results.append(est)
        except Exception as e:
            logger.warning("Shelf-life estimation failed for %s: %s", item.inventory_item_id, e)
            warnings.append(f"Shelf-life estimation unavailable for '{item.product_name}': {e}")

    # -----------------------------------------------------------------------
    # Step 3: Use-First Priority Scoring (Phase 4)
    # -----------------------------------------------------------------------
    # Phase 13: Resolve freshness overrides for priority scoring.
    # A caller who has run /vision/assess-freshness and received a confident
    # 'visibly_spoiled' prediction may pass it here so the scoring engine's
    # freshness_override flag is populated. We do NOT set freshness_override
    # for uncertain predictions or when confidence is below the model threshold.
    _FRESHNESS_CONFIDENCE_THRESHOLD = 0.60  # Matches FreshnessAssessmentService threshold
    freshness_overrides = request.freshness_overrides or {}
    freshness_confidence = request.freshness_confidence or {}

    priority_results: List[ScoredItem] = []
    priority_category_map: Dict[str, str] = {}
    try:
        grocery_items: List[GroceryItem] = []
        for item in request.inventory:
            iid = item.inventory_item_id
            raw_condition = freshness_overrides.get(iid, "").strip().lower()
            conf = float(freshness_confidence.get(iid, 0.0))
            # Only apply spoilage signal when:
            #  - caller explicitly passes 'visibly_spoiled'
            #  - associated confidence meets or exceeds the model reliability threshold
            apply_freshness_override = (
                raw_condition == "visibly_spoiled"
                and conf >= _FRESHNESS_CONFIDENCE_THRESHOLD
            )
            if raw_condition and raw_condition not in (
                "fresh", "ripe", "visibly_spoiled", "uncertain"
            ):
                warnings.append(
                    f"Unrecognised freshness condition '{raw_condition}' for item "
                    f"'{iid}' — freshness override ignored."
                )
                apply_freshness_override = False

            grocery_items.append(
                GroceryItem(
                    item_id=iid,
                    product_name=item.product_name,
                    purchase_date=item.purchase_date or eval_date,
                    opened=item.opened,
                    storage_zone=getattr(item, "storage_zone", None),
                    package_use_by_date=item.expiry_date,
                    as_of_date=eval_date,
                    freshness_override=apply_freshness_override,
                )
            )
        scored_response = prioritize_items(PriorityScoreRequest(items=grocery_items))
        priority_results = scored_response.scored_items
        for sc in priority_results:
            priority_category_map[sc.item_id] = sc.priority_category
    except Exception as e:
        logger.error("Priority scoring failed during orchestration: %s", e)
        errors.append(f"Use-First priority scoring failed: {e}")

    # -----------------------------------------------------------------------
    # Step 4: Synthetic IoT Sensor Telemetry (Phase 5)
    # -----------------------------------------------------------------------
    if request.sensor_readings is not None and len(request.sensor_readings) > 0:
        try:
            any_simulated = True # Sensor telemetry in Phase 5 is explicitly simulated
            as_of_dt = datetime.combine(eval_date, datetime.min.time(), tzinfo=timezone.utc)
            sensor_batch = analyze_sensor_readings(
                readings_input=request.sensor_readings,
                as_of=as_of_dt,
            )
            sensor_section = SensorAnalysisSection(
                status="completed",
                simulated=True,
                total_readings_analyzed=sensor_batch.total_readings,
                anomalies_detected=len(sensor_batch.active_alerts),
                alerts=sensor_batch.active_alerts,
                message="Telemetry analyzed for environmental storage conditions.",
            )
        except Exception as e:
            logger.warning("Sensor analysis failed: %s", e)
            sensor_section = SensorAnalysisSection(
                status="failed",
                simulated=True,
                message=f"Sensor telemetry analysis encountered an error: {e}",
            )
            warnings.append(f"Sensor analysis failed: {e}")
    else:
        sensor_section = SensorAnalysisSection(
            status="skipped",
            simulated=False,
            total_readings_analyzed=0,
            anomalies_detected=0,
            alerts=[],
            message="No sensor telemetry readings provided in request.",
        )

    # -----------------------------------------------------------------------
    # Step 5: Duplicate-Purchase Detection (Phase 6)
    # -----------------------------------------------------------------------
    if request.proposed_purchases is not None and len(request.proposed_purchases) > 0:
        try:
            dup_resp = check_duplicate_purchases(
                proposed_purchases=request.proposed_purchases,
                inventory=request.inventory,
                as_of=eval_date,
                catalog=cat,
            )
            duplicate_section = DuplicatePurchaseSection(
                status="completed",
                total_proposed=dup_resp.total_items_reviewed,
                results=dup_resp.results,
                message="Proposed purchases evaluated against current usable inventory.",
            )
        except Exception as e:
            logger.warning("Duplicate purchase detection failed: %s", e)
            duplicate_section = DuplicatePurchaseSection(
                status="failed",
                total_proposed=len(request.proposed_purchases),
                results=[],
                message=f"Duplicate purchase analysis failed: {e}",
            )
            warnings.append(f"Duplicate purchase analysis failed: {e}")
    else:
        duplicate_section = DuplicatePurchaseSection(
            status="skipped",
            total_proposed=0,
            results=[],
            message="No proposed purchases provided to analyze.",
        )

    # -----------------------------------------------------------------------
    # Step 6: Recipe Recommendation Intelligence (Phase 7)
    # -----------------------------------------------------------------------
    if request.include_recipes:
        try:
            rec_resp = recommend_recipes(
                inventory=request.inventory,
                priority_data=priority_category_map,
                limit=request.recipe_limit,
                as_of=eval_date,
                catalog=cat,
            )
            if rec_resp.simulated:
                any_simulated = True

            recipe_section = RecipeRecommendationsSection(
                status="completed",
                total_recommendations=rec_resp.total_recommendations,
                recommendations=rec_resp.recommendations,
                message="Recipes recommended utilizing eligible stock, prioritizing near-expiry ingredients.",
            )
        except Exception as e:
            logger.error("Recipe recommendation failed during orchestration: %s", e)
            recipe_section = RecipeRecommendationsSection(
                status="failed",
                total_recommendations=0,
                recommendations=[],
                message=f"Recipe recommendation engine encountered an error: {e}",
            )
            warnings.append(f"Recipe recommendations failed: {e}")
    else:
        recipe_section = RecipeRecommendationsSection(
            status="skipped",
            total_recommendations=0,
            recommendations=[],
            message="Recipe recommendation computation was disabled by caller (include_recipes=False).",
        )

    # -----------------------------------------------------------------------
    # Step 7: Overall Status Determination
    # -----------------------------------------------------------------------
    if errors:
        overall_status: OrchestrationOverallStatus = "partial_success" if (shelf_life_results or priority_results) else "failed"
    elif any(
        sec.status == "failed"
        for sec in (sensor_section, duplicate_section, recipe_section)
    ):
        overall_status = "partial_success"
    else:
        overall_status = "completed"

    return UnifiedAnalyzeResponse(
        as_of_date=eval_date,
        overall_status=overall_status,
        inventory_summary=summary,
        product_resolutions=resolutions,
        shelf_life_estimates=shelf_life_results,
        priority_scores=priority_results,
        sensor_analysis=sensor_section,
        duplicate_purchase_analysis=duplicate_section,
        recipe_recommendations=recipe_section,
        warnings=warnings,
        errors=errors,
        simulated_data_used=any_simulated,
    )
