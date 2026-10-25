"""SaveBite Recipe Recommendation and Food-Waste Reduction Intelligence Service.

Phase 7: Deterministic, rule-based recipe recommendation engine that suggests
recipes dynamically using available household inventory, prioritizing near-expiry
groceries and Use-First priority scored items.

Scoring Formula (0-100 scale):
  - Required ingredient availability: 40 points
  - Near-expiry ingredient utilization: 30 points
  - Existing Use-First priority utilization: 20 points
  - Missing ingredient penalty / adjustment: 10 points
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, datetime
import json
import math
from pathlib import Path
from typing import Any, Dict, List, Literal, Optional, Set, Tuple, Union

from pydantic import BaseModel, Field, field_validator

from app.services.product_catalog import (
    ProductCatalog,
    get_default_catalog,
    lookup_product,
    normalize_product_name,
)
from app.services.duplicate_purchase_service import (
    InventoryItem,
    convert_units,
    is_inventory_usable,
    match_products,
    ProposedPurchaseItem,
)
from app.services.priority_scoring import (
    GroceryItem,
    PriorityCategory,
    score_items,
)

# ---------------------------------------------------------------------------
# Enums and Types
# ---------------------------------------------------------------------------

IngredientStatus = Literal[
    "available",
    "insufficient",
    "missing",
    "expired",
    "quantity_unknown",
    "optional_missing",
]

PreparationStatus = Literal[
    "fully_preparable",
    "missing_optional_only",
    "needs_missing_ingredients",
]


# ---------------------------------------------------------------------------
# Recipe Models
# ---------------------------------------------------------------------------

class RecipeIngredient(BaseModel):
    """An ingredient required by a recipe."""

    name: str = Field(..., description="User-facing ingredient name.")
    product_id: Optional[str] = Field(None, description="Catalog identifier if known.")
    quantity: float = Field(..., description="Required quantity.")
    unit: str = Field(..., description="Required unit.")
    optional: bool = Field(False, description="Whether this ingredient is optional.")

    @field_validator("name", "unit")
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


class Recipe(BaseModel):
    """A cooking recipe."""

    recipe_id: str = Field(..., description="Unique recipe identifier.")
    name: str = Field(..., description="Name of the dish.")
    description: str = Field(..., description="Brief culinary description.")
    preparation_time_minutes: int = Field(..., ge=1, description="Estimated prep time in minutes.")
    servings: int = Field(..., ge=1, description="Number of servings.")
    difficulty: Optional[str] = Field("easy", description="Difficulty level.")
    dietary_tags: List[str] = Field(default_factory=list, description="Dietary tags.")
    ingredients: List[RecipeIngredient] = Field(..., min_length=1, description="List of ingredients.")
    instructions: List[str] = Field(..., min_length=1, description="Step-by-step cooking instructions.")

    @field_validator("recipe_id", "name", "description")
    @classmethod
    def validate_strings(cls, v: str) -> str:
        if not isinstance(v, str) or not v.strip():
            raise ValueError("Field cannot be empty or whitespace-only.")
        return v.strip()

    @field_validator("ingredients")
    @classmethod
    def validate_required_ingredients(cls, v: List[RecipeIngredient]) -> List[RecipeIngredient]:
        if not any(not ing.optional for ing in v):
            raise ValueError("Recipe must have at least one required (non-optional) ingredient.")
        return v


# ---------------------------------------------------------------------------
# Recommendation Response Models
# ---------------------------------------------------------------------------

class MatchedIngredientDetail(BaseModel):
    """Evaluation detail for an individual recipe ingredient."""

    ingredient_name: str
    product_id: Optional[str] = None
    required_quantity: float
    required_unit: str
    available_quantity: Optional[float] = None
    available_unit: Optional[str] = None
    missing_quantity: Optional[float] = None
    status: IngredientStatus
    optional: bool
    near_expiry: bool = False
    priority_category: Optional[str] = None
    matched_inventory_ids: List[str] = Field(default_factory=list)


class ScoreBreakdown(BaseModel):
    """Detailed score components summing up to the total score."""

    ingredient_availability: float = Field(..., description="Points from required ingredient availability (max 40).")
    near_expiry_utilization: float = Field(..., description="Points from near-expiry utilization (max 30).")
    use_first_utilization: float = Field(..., description="Points from Use-First priority utilization (max 20).")
    missing_ingredient_component: float = Field(..., description="Points from few or zero missing ingredients (max 10).")


class RecipeRecommendation(BaseModel):
    """A ranked recipe recommendation with full explainability."""

    recipe_id: str
    name: str
    rank: int
    score: float = Field(..., ge=0.0, le=100.0, description="Total recommendation score [0, 100].")
    score_breakdown: ScoreBreakdown
    preparation_status: PreparationStatus
    matched_ingredients: List[MatchedIngredientDetail]
    use_first_ingredients: List[str] = Field(default_factory=list, description="Ingredients with high Use-First priority.")
    near_expiry_ingredients: List[str] = Field(default_factory=list, description="Ingredients nearing expiry.")
    missing_ingredients: List[str] = Field(default_factory=list, description="Required ingredients completely missing.")
    insufficient_ingredients: List[str] = Field(default_factory=list, description="Ingredients with partial stock.")
    unavailable_ingredients: List[str] = Field(default_factory=list, description="Ingredients only matching expired items.")
    optional_missing_ingredients: List[str] = Field(default_factory=list, description="Optional ingredients missing.")
    reasons: List[str] = Field(default_factory=list, description="Explainable reasons for ranking.")
    preparation_time_minutes: int
    servings: int
    instructions: List[str]
    simulated: bool = Field(True, description="True if based on synthetic inputs.")


class RecipeRecommendationResponse(BaseModel):
    """Envelope response for the recipe recommendation endpoint."""

    as_of_date: date
    total_recipes_evaluated: int
    total_recommendations: int
    recommendations: List[RecipeRecommendation]
    simulated: bool = True
    caveat: str = (
        "Recipe recommendations are generated heuristically based on inventory availability "
        "and expiry priority. They do not constitute formal food safety or medical nutrition guarantees."
    )


# ---------------------------------------------------------------------------
# Dataset Loading & Validation
# ---------------------------------------------------------------------------

def load_recipe_dataset(file_path: Optional[Union[str, Path]] = None) -> List[Recipe]:
    """Load and validate the curated recipe dataset from disk."""
    if file_path is None:
        target_path = Path(__file__).resolve().parent.parent / "data" / "sample_recipes.json"
    else:
        target_path = Path(file_path)

    if not target_path.exists():
        raise FileNotFoundError(f"Recipe dataset not found at {target_path}")

    with open(target_path, "r", encoding="utf-8") as f:
        data = json.load(f)

    raw_recipes = data.get("recipes", [])
    recipes: List[Recipe] = []
    seen_ids: Set[str] = set()

    for raw in raw_recipes:
        rec = Recipe(**raw)
        if rec.recipe_id in seen_ids:
            raise ValueError(f"Duplicate recipe_id found in dataset: '{rec.recipe_id}'")
        seen_ids.add(rec.recipe_id)
        recipes.append(rec)

    return recipes


# ---------------------------------------------------------------------------
# Core Matching & Evaluation Helpers
# ---------------------------------------------------------------------------

def _match_recipe_ingredient_to_inventory(
    ingredient: RecipeIngredient,
    usable_inventory: List[InventoryItem],
    catalog: ProductCatalog,
) -> Tuple[List[InventoryItem], bool]:
    """Find all matching usable inventory items for a recipe ingredient."""
    purchase_repr = ProposedPurchaseItem(
        product_id=ingredient.product_id,
        product_name=ingredient.name,
        requested_quantity=ingredient.quantity,
        unit=ingredient.unit,
    )

    matched: List[InventoryItem] = []
    unit_mismatch = False

    for inv in usable_inventory:
        is_m, method, _ = match_products(purchase_repr, inv, catalog=catalog)
        if is_m:
            matched.append(inv)

    return matched, unit_mismatch


def evaluate_recipe(
    recipe: Recipe,
    inventory: List[InventoryItem],
    priority_map: Dict[str, str], # item_id -> priority_category ("Red", "Orange", "Yellow", "Green")
    as_of: date,
    catalog: Optional[ProductCatalog] = None,
    simulated: bool = True,
) -> RecipeRecommendation:
    """Evaluate a single recipe against the household inventory."""
    cat = catalog if catalog is not None else get_default_catalog()

    # Classify inventory into usable vs expired
    usable_inv: List[InventoryItem] = []
    expired_inv: List[InventoryItem] = []
    near_expiry_inv_ids: Set[str] = set()

    for item in inventory:
        is_usable, is_near_exp, _ = is_inventory_usable(item, as_of)
        if is_usable:
            usable_inv.append(item)
            if is_near_exp:
                near_expiry_inv_ids.add(item.inventory_item_id)
        else:
            if item.status == "expired" or (item.expiry_date and item.expiry_date < as_of):
                expired_inv.append(item)

    matched_details: List[MatchedIngredientDetail] = []
    use_first_ingredients: List[str] = []
    near_expiry_ingredients: List[str] = []
    missing_ingredients: List[str] = []
    insufficient_ingredients: List[str] = []
    unavailable_ingredients: List[str] = []
    optional_missing_ingredients: List[str] = []

    required_ingredients_count = 0
    available_required_count = 0

    for ing in recipe.ingredients:
        if not ing.optional:
            required_ingredients_count += 1

        # Match against usable inventory
        matched_items, _ = _match_recipe_ingredient_to_inventory(ing, usable_inv, cat)

        if not matched_items:
            # Check if it matches an expired item
            exp_matches, _ = _match_recipe_ingredient_to_inventory(ing, expired_inv, cat)
            if exp_matches:
                unavailable_ingredients.append(ing.name)
                matched_details.append(
                    MatchedIngredientDetail(
                        ingredient_name=ing.name,
                        product_id=ing.product_id,
                        required_quantity=ing.quantity,
                        required_unit=ing.unit,
                        available_quantity=0.0,
                        available_unit=ing.unit,
                        missing_quantity=ing.quantity,
                        status="expired",
                        optional=ing.optional,
                        matched_inventory_ids=[i.inventory_item_id for i in exp_matches],
                    )
                )
            else:
                if ing.optional:
                    optional_missing_ingredients.append(ing.name)
                    matched_details.append(
                        MatchedIngredientDetail(
                            ingredient_name=ing.name,
                            product_id=ing.product_id,
                            required_quantity=ing.quantity,
                            required_unit=ing.unit,
                            available_quantity=0.0,
                            available_unit=ing.unit,
                            missing_quantity=ing.quantity,
                            status="optional_missing",
                            optional=True,
                        )
                    )
                else:
                    missing_ingredients.append(ing.name)
                    matched_details.append(
                        MatchedIngredientDetail(
                            ingredient_name=ing.name,
                            product_id=ing.product_id,
                            required_quantity=ing.quantity,
                            required_unit=ing.unit,
                            available_quantity=0.0,
                            available_unit=ing.unit,
                            missing_quantity=ing.quantity,
                            status="missing",
                            optional=False,
                        )
                    )
            continue

        # Aggregate quantities across matched usable items
        total_available = 0.0
        conversion_failed = False
        ing_near_expiry = False
        ing_priority_category: Optional[str] = None
        matched_ids: List[str] = []

        for item in matched_items:
            matched_ids.append(item.inventory_item_id)
            if item.inventory_item_id in near_expiry_inv_ids:
                ing_near_expiry = True

            cat_p = priority_map.get(item.inventory_item_id)
            if cat_p in ("Red", "Orange"):
                ing_priority_category = cat_p
            elif cat_p and not ing_priority_category:
                ing_priority_category = cat_p

            converted = convert_units(item.quantity, item.unit, ing.unit)
            if converted is not None:
                total_available += converted
            else:
                conversion_failed = True

        total_available = round(total_available, 4)

        if conversion_failed and total_available == 0.0:
            status: IngredientStatus = "quantity_unknown"
            missing_qty = None
        elif total_available >= ing.quantity:
            status = "available"
            missing_qty = 0.0
            if not ing.optional:
                available_required_count += 1
        else:
            status = "insufficient"
            missing_qty = round(ing.quantity - total_available, 4)
            if not ing.optional:
                insufficient_ingredients.append(ing.name)

        if ing_near_expiry:
            near_expiry_ingredients.append(ing.name)
        if ing_priority_category in ("Red", "Orange"):
            use_first_ingredients.append(ing.name)

        matched_details.append(
            MatchedIngredientDetail(
                ingredient_name=ing.name,
                product_id=ing.product_id,
                required_quantity=ing.quantity,
                required_unit=ing.unit,
                available_quantity=total_available if not conversion_failed else None,
                available_unit=ing.unit if not conversion_failed else None,
                missing_quantity=missing_qty,
                status=status,
                optional=ing.optional,
                near_expiry=ing_near_expiry,
                priority_category=ing_priority_category,
                matched_inventory_ids=matched_ids,
            )
        )

    # -----------------------------------------------------------------------
    # Score Calculation (40 + 30 + 20 + 10 = 100)
    # -----------------------------------------------------------------------

    # A. Ingredient Availability (40 pts)
    if required_ingredients_count > 0:
        availability_ratio = available_required_count / required_ingredients_count
    else:
        availability_ratio = 1.0
    score_availability = round(40.0 * availability_ratio, 2)

    # B. Near-Expiry Utilization (30 pts)
    # Rewards recipes using near-expiry ingredients (max credit when >=2 or 100% of required)
    if near_expiry_ingredients:
        # Scale: 1 near-expiry item = 20 pts, 2+ = 30 pts
        near_expiry_pts = 30.0 if len(near_expiry_ingredients) >= 2 else 20.0
    else:
        near_expiry_pts = 0.0
    score_near_expiry = round(near_expiry_pts, 2)

    # C. Use-First Priority Utilization (20 pts)
    # Rewards recipes utilizing Red/Orange Use-First items
    if use_first_ingredients:
        use_first_pts = 20.0 if len(use_first_ingredients) >= 2 else 12.0
    else:
        use_first_pts = 0.0
    score_use_first = round(use_first_pts, 2)

    # D. Missing Ingredient Penalty / Adjustment (10 pts)
    # 10 pts if 0 missing required ingredients; 5 pts if 1 missing; 0 pts if >= 2 missing
    total_missing_required = len(missing_ingredients) + len(unavailable_ingredients)
    if total_missing_required == 0:
        missing_pts = 10.0
    elif total_missing_required == 1:
        missing_pts = 5.0
    else:
        missing_pts = 0.0
    score_missing = round(missing_pts, 2)

    total_score = round(min(100.0, max(0.0, score_availability + score_near_expiry + score_use_first + score_missing)), 2)

    # Preparation Status
    if total_missing_required == 0 and len(insufficient_ingredients) == 0:
        if len(optional_missing_ingredients) > 0:
            prep_status: PreparationStatus = "missing_optional_only"
        else:
            prep_status = "fully_preparable"
    else:
        prep_status = "needs_missing_ingredients"

    # Explainable Reasons
    reasons: List[str] = []
    if prep_status == "fully_preparable":
        reasons.append("All required ingredients are fully available in your inventory.")
    elif prep_status == "missing_optional_only":
        reasons.append("All required ingredients are available; some optional ingredients are absent.")
    else:
        if missing_ingredients:
            reasons.append(f"Requires missing ingredients: {', '.join(missing_ingredients)}.")
        if insufficient_ingredients:
            reasons.append(f"Requires additional quantity for: {', '.join(insufficient_ingredients)}.")
        if unavailable_ingredients:
            reasons.append(f"Matching stock exists but is expired for: {', '.join(unavailable_ingredients)}.")

    if near_expiry_ingredients:
        reasons.append(f"Prioritizes groceries approaching expiry: {', '.join(near_expiry_ingredients)}.")
    if use_first_ingredients:
        reasons.append(f"Utilizes high Use-First priority groceries: {', '.join(use_first_ingredients)}.")

    return RecipeRecommendation(
        recipe_id=recipe.recipe_id,
        name=recipe.name,
        rank=1, # Updated after sorting
        score=total_score,
        score_breakdown=ScoreBreakdown(
            ingredient_availability=score_availability,
            near_expiry_utilization=score_near_expiry,
            use_first_utilization=score_use_first,
            missing_ingredient_component=score_missing,
        ),
        preparation_status=prep_status,
        matched_ingredients=matched_details,
        use_first_ingredients=use_first_ingredients,
        near_expiry_ingredients=near_expiry_ingredients,
        missing_ingredients=missing_ingredients,
        insufficient_ingredients=insufficient_ingredients,
        unavailable_ingredients=unavailable_ingredients,
        optional_missing_ingredients=optional_missing_ingredients,
        reasons=reasons,
        preparation_time_minutes=recipe.preparation_time_minutes,
        servings=recipe.servings,
        instructions=recipe.instructions,
        simulated=simulated,
    )


# ---------------------------------------------------------------------------
# Public Service API
# ---------------------------------------------------------------------------

def recommend_recipes(
    inventory: List[Union[InventoryItem, Dict[str, Any]]],
    priority_data: Optional[Dict[str, str]] = None,
    recipes: Optional[List[Recipe]] = None,
    limit: int = 10,
    as_of: Optional[date] = None,
    catalog: Optional[ProductCatalog] = None,
) -> RecipeRecommendationResponse:
    """Recommend and rank recipes to maximize utilization of available and near-expiry household groceries.

    Args:
        inventory: Household inventory records (as models or dicts).
        priority_data: Optional mapping of inventory_item_id -> priority category ('Red', 'Orange', etc.).
        recipes: Optional custom recipe dataset; loads default sample dataset if omitted.
        limit: Maximum number of ranked recommendations to return (default: 10, max: 50).
        as_of: Evaluation reference date for deterministic expiry checks (defaults to date.today()).
        catalog: Product catalog instance (defaults to default catalog).

    Returns:
        RecipeRecommendationResponse containing sorted recommendations.
    """
    if limit < 1:
        raise ValueError("limit must be at least 1.")
    effective_limit = min(limit, 50)

    eval_date = as_of if as_of is not None else date.today()
    cat = catalog if catalog is not None else get_default_catalog()

    # Load recipes if not provided
    recipe_list = recipes if recipes is not None else load_recipe_dataset()

    # Parse and validate inventory
    valid_inventory: List[InventoryItem] = []
    is_simulated = False

    for item in inventory:
        if isinstance(item, InventoryItem):
            valid_inventory.append(item)
            if item.simulated:
                is_simulated = True
        elif isinstance(item, dict):
            try:
                inv_obj = InventoryItem(**item)
                valid_inventory.append(inv_obj)
                if inv_obj.simulated:
                    is_simulated = True
            except Exception:
                # Malformed inventory item ignored safely
                continue

    # Priority map
    p_map: Dict[str, str] = priority_data or {}

    # If priority data was not explicitly supplied, derive automatically from Phase 4 scoring if possible
    if not p_map and valid_inventory:
        try:
            grocery_items = []
            for inv in valid_inventory:
                grocery_items.append(
                    GroceryItem(
                        item_id=inv.inventory_item_id,
                        product_name=inv.product_name,
                        purchase_date=inv.purchase_date or eval_date,
                        opened=inv.opened,
                        as_of_date=eval_date,
                    )
                )
            scored = score_items(grocery_items)
            for sc in scored:
                p_map[sc.item_id] = sc.priority_category
        except Exception:
            p_map = {}

    evaluated: List[RecipeRecommendation] = []
    for rec in recipe_list:
        rec_eval = evaluate_recipe(
            recipe=rec,
            inventory=valid_inventory,
            priority_map=p_map,
            as_of=eval_date,
            catalog=cat,
            simulated=is_simulated,
        )
        evaluated.append(rec_eval)

    # Sort descending by score, tie-breaking by recipe_id ascending for stability
    evaluated.sort(key=lambda r: (-r.score, r.recipe_id))

    # Slice to limit and re-index ranks
    recommendations: List[RecipeRecommendation] = []
    for rank_idx, rec_item in enumerate(evaluated[:effective_limit], start=1):
        rec_item.rank = rank_idx
        recommendations.append(rec_item)

    return RecipeRecommendationResponse(
        as_of_date=eval_date,
        total_recipes_evaluated=len(evaluated),
        total_recommendations=len(recommendations),
        recommendations=recommendations,
        simulated=is_simulated,
    )
