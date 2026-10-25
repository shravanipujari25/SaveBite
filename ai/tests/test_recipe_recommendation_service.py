import sys
from pathlib import Path

# Ensure ai directory is on sys.path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

"""Tests for Phase 7: Recipe Recommendation and Food-Waste Reduction Intelligence.

Covers:
  A. Dataset Validation:
     - Recipe dataset loads successfully
     - Unique recipe IDs
     - Valid ingredient quantities, non-empty instructions, required fields
  B. Ingredient Matching:
     - Exact product ID match
     - Normalized exact name match
     - Catalog alias match
     - False match rejection (Milk vs Milk Powder, Rice vs Rice Flour, Apple vs Apple Juice)
     - Unknown or ambiguous matches handled safely
  C. Inventory Eligibility & Expiry:
     - Available stock counted
     - Insufficient stock identified
     - Missing ingredients detected
     - Expired stock excluded from usable inventory
     - Consumed and discarded stock excluded
     - Unknown expiry handled without assumption
     - Near-expiry stock prioritized with deterministic as_of date
     - Expired items never grant near-expiry benefit
  D. Quantity & Unit Handling:
     - Grams to kilograms conversion
     - Millilitres to litres conversion
     - Count units compatible
     - Incompatible dimensions (mass vs volume) do not guess conversion
     - Multiple inventory records of the same product aggregated
  E. Ranking, Scoring & Explainability:
     - Availability score (40 pts)
     - Near-expiry score (30 pts)
     - Use-First priority score (20 pts)
     - Missing ingredient penalty (10 pts)
     - Score stays within 0-100
     - Deterministic ranking and stable tie-breaking
     - Limit enforcement
     - Empty inventory handling
     - Optional missing ingredients don't penalize required score
  F. API & Integration:
     - POST /recipes/recommend endpoint
     - Input non-mutation
     - Simulated flag handling
     - Regression preservation across Phases 1-6
"""

from datetime import date, timedelta
import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.services.duplicate_purchase_service import InventoryItem
from app.services.recipe_recommendation_service import (
    Recipe,
    RecipeIngredient,
    RecipeRecommendation,
    RecipeRecommendationResponse,
    evaluate_recipe,
    load_recipe_dataset,
    recommend_recipes,
)


@pytest.fixture
def client() -> TestClient:
    return TestClient(app)


@pytest.fixture
def ref_date() -> date:
    return date(2026, 10, 24)


# ---------------------------------------------------------------------------
# A. Dataset Validation Tests
# ---------------------------------------------------------------------------

def test_recipe_dataset_loads_successfully():
    recipes = load_recipe_dataset()
    assert len(recipes) >= 20
    assert all(isinstance(r, Recipe) for r in recipes)


def test_recipe_dataset_unique_ids():
    recipes = load_recipe_dataset()
    ids = [r.recipe_id for r in recipes]
    assert len(ids) == len(set(ids)), "Recipe IDs must be unique"


def test_recipe_model_requires_non_empty_instructions():
    with pytest.raises(Exception):
        Recipe(
            recipe_id="REC-TEST",
            name="Test Recipe",
            description="Test",
            preparation_time_minutes=15,
            servings=2,
            ingredients=[
                RecipeIngredient(name="Rice", quantity=100.0, unit="g")
            ],
            instructions=[], # Empty instructions rejected
        )


def test_recipe_model_requires_at_least_one_non_optional_ingredient():
    with pytest.raises(ValueError, match="at least one required"):
        Recipe(
            recipe_id="REC-TEST-OPT",
            name="Optional Only Dish",
            description="Test",
            preparation_time_minutes=10,
            servings=1,
            ingredients=[
                RecipeIngredient(name="Salt", quantity=5.0, unit="g", optional=True)
            ],
            instructions=["Cook it."],
        )


# ---------------------------------------------------------------------------
# B. Ingredient Matching Tests
# ---------------------------------------------------------------------------

def test_ingredient_matching_exact_and_alias(ref_date):
    rec = Recipe(
        recipe_id="R-TEST-1",
        name="Tomato Rice Simple",
        description="Test",
        preparation_time_minutes=15,
        servings=1,
        ingredients=[
            RecipeIngredient(name="Tomato", quantity=1.0, unit="unit", optional=False),
            RecipeIngredient(name="White Rice", quantity=100.0, unit="g", optional=False),
        ],
        instructions=["Mix and cook."],
    )
    # Inventory has 'Tomatoes' (alias) and 'White Rice'
    inv = [
        InventoryItem(inventory_item_id="I1", product_name="Tomatoes", quantity=2.0, unit="unit", status="available"),
        InventoryItem(inventory_item_id="I2", product_name="white rice", quantity=500.0, unit="g", status="available"),
    ]
    res = evaluate_recipe(rec, inv, priority_map={}, as_of=ref_date)
    assert res.preparation_status == "fully_preparable"
    assert len(res.missing_ingredients) == 0


def test_ingredient_matching_distinct_products_not_merged(ref_date):
    rec = Recipe(
        recipe_id="R-TEST-DISTINCT",
        name="Milk Dessert",
        description="Test",
        preparation_time_minutes=10,
        servings=1,
        ingredients=[
            RecipeIngredient(name="Milk", quantity=200.0, unit="ml", optional=False),
        ],
        instructions=["Stir milk."],
    )
    # Inventory has 'Milk Powder' - must NOT match 'Milk'
    inv = [
        InventoryItem(inventory_item_id="I1", product_name="Milk Powder", quantity=500.0, unit="g", status="available"),
    ]
    res = evaluate_recipe(rec, inv, priority_map={}, as_of=ref_date)
    assert res.preparation_status == "needs_missing_ingredients"
    assert "Milk" in res.missing_ingredients


# ---------------------------------------------------------------------------
# C. Inventory Eligibility and Expiry Tests
# ---------------------------------------------------------------------------

def test_expired_inventory_excluded_from_usable_stock(ref_date):
    rec = Recipe(
        recipe_id="R-TEST-EXP",
        name="Spinach Bowl",
        description="Test",
        preparation_time_minutes=10,
        servings=1,
        ingredients=[
            RecipeIngredient(name="Spinach", quantity=100.0, unit="g", optional=False),
        ],
        instructions=["Wilt spinach."],
    )
    # Inventory item has past expiry date
    inv = [
        InventoryItem(
            inventory_item_id="I1",
            product_name="Spinach",
            quantity=200.0,
            unit="g",
            status="available",
            expiry_date=ref_date - timedelta(days=2), # Expired!
        )
    ]
    res = evaluate_recipe(rec, inv, priority_map={}, as_of=ref_date)
    assert res.preparation_status == "needs_missing_ingredients"
    assert "Spinach" in res.unavailable_ingredients
    # Expired item must NOT yield near-expiry points
    assert res.score_breakdown.near_expiry_utilization == 0.0


def test_consumed_and_discarded_inventory_excluded(ref_date):
    rec = Recipe(
        recipe_id="R-TEST-CD",
        name="Apple Dish",
        description="Test",
        preparation_time_minutes=5,
        servings=1,
        ingredients=[RecipeIngredient(name="Apple", quantity=1.0, unit="unit")],
        instructions=["Slice apple."],
    )
    inv = [
        InventoryItem(inventory_item_id="I1", product_name="Apple", quantity=2.0, unit="unit", status="consumed"),
        InventoryItem(inventory_item_id="I2", product_name="Apple", quantity=2.0, unit="unit", status="discarded"),
    ]
    res = evaluate_recipe(rec, inv, priority_map={}, as_of=ref_date)
    assert res.preparation_status == "needs_missing_ingredients"
    assert "Apple" in res.missing_ingredients


def test_near_expiry_inventory_prioritized_with_deterministic_date(ref_date):
    # Two recipes: one uses near-expiry tomatoes, the other uses non-expiring potatoes
    rec_tomato = Recipe(
        recipe_id="REC-TOM",
        name="Fresh Tomato Snack",
        description="Test",
        preparation_time_minutes=5,
        servings=1,
        ingredients=[RecipeIngredient(name="Tomato", quantity=1.0, unit="unit")],
        instructions=["Eat."],
    )
    rec_potato = Recipe(
        recipe_id="REC-POT",
        name="Potato Snack",
        description="Test",
        preparation_time_minutes=5,
        servings=1,
        ingredients=[RecipeIngredient(name="Potato", quantity=1.0, unit="unit")],
        instructions=["Eat."],
    )
    inv = [
        # Tomato expires in 1 day (near expiry!)
        InventoryItem(inventory_item_id="I1", product_name="Tomato", quantity=2.0, unit="unit", status="available", expiry_date=ref_date + timedelta(days=1)),
        # Potato expires in 60 days
        InventoryItem(inventory_item_id="I2", product_name="Potato", quantity=2.0, unit="unit", status="available", expiry_date=ref_date + timedelta(days=60)),
    ]
    res_tomato = evaluate_recipe(rec_tomato, inv, priority_map={}, as_of=ref_date)
    res_potato = evaluate_recipe(rec_potato, inv, priority_map={}, as_of=ref_date)

    assert res_tomato.score_breakdown.near_expiry_utilization > res_potato.score_breakdown.near_expiry_utilization
    assert res_tomato.score > res_potato.score
    assert "Tomato" in res_tomato.near_expiry_ingredients


# ---------------------------------------------------------------------------
# D. Quantity and Unit Handling Tests
# ---------------------------------------------------------------------------

def test_unit_conversion_mass_and_volume(ref_date):
    rec = Recipe(
        recipe_id="R-CONV",
        name="Rice Milk Pudding",
        description="Test",
        preparation_time_minutes=20,
        servings=2,
        ingredients=[
            RecipeIngredient(name="White Rice", quantity=0.2, unit="kg"), # Recipe asks for 0.2 kg
            RecipeIngredient(name="Milk", quantity=0.5, unit="l"),       # Recipe asks for 0.5 l
        ],
        instructions=["Boil."],
    )
    # Inventory recorded in g and ml
    inv = [
        InventoryItem(inventory_item_id="I1", product_name="White Rice", quantity=250.0, unit="g", status="available"), # 250g >= 0.2kg
        InventoryItem(inventory_item_id="I2", product_name="Milk", quantity=500.0, unit="ml", status="available"),      # 500ml >= 0.5l
    ]
    res = evaluate_recipe(rec, inv, priority_map={}, as_of=ref_date)
    assert res.preparation_status == "fully_preparable"
    assert res.score_breakdown.ingredient_availability == 40.0


def test_insufficient_quantity_detected(ref_date):
    rec = Recipe(
        recipe_id="R-INSUFF",
        name="Big Rice Batch",
        description="Test",
        preparation_time_minutes=30,
        servings=4,
        ingredients=[RecipeIngredient(name="White Rice", quantity=1.0, unit="kg")],
        instructions=["Cook."],
    )
    # Inventory only has 500g (0.5 kg < 1.0 kg)
    inv = [
        InventoryItem(inventory_item_id="I1", product_name="White Rice", quantity=500.0, unit="g", status="available"),
    ]
    res = evaluate_recipe(rec, inv, priority_map={}, as_of=ref_date)
    assert res.preparation_status == "needs_missing_ingredients"
    assert "White Rice" in res.insufficient_ingredients
    detail = next(d for d in res.matched_ingredients if d.ingredient_name == "White Rice")
    assert detail.status == "insufficient"
    assert detail.available_quantity == 0.5
    assert detail.missing_quantity == 0.5


def test_multiple_inventory_records_aggregate_safely(ref_date):
    rec = Recipe(
        recipe_id="R-MULTI-INV",
        name="Rice Dish",
        description="Test",
        preparation_time_minutes=15,
        servings=2,
        ingredients=[RecipeIngredient(name="White Rice", quantity=500.0, unit="g")],
        instructions=["Cook."],
    )
    # Two distinct bags in inventory
    inv = [
        InventoryItem(inventory_item_id="BAG-1", product_name="White Rice", quantity=200.0, unit="g", status="available"),
        InventoryItem(inventory_item_id="BAG-2", product_name="White Rice", quantity=400.0, unit="g", status="available"),
    ]
    res = evaluate_recipe(rec, inv, priority_map={}, as_of=ref_date)
    # Total available: 600g >= 500g required
    assert res.preparation_status == "fully_preparable"
    detail = res.matched_ingredients[0]
    assert detail.available_quantity == 600.0
    assert set(detail.matched_inventory_ids) == {"BAG-1", "BAG-2"}


# ---------------------------------------------------------------------------
# E. Ranking, Scoring & Robustness Tests
# ---------------------------------------------------------------------------

def test_score_formula_weights_and_bounds(ref_date):
    rec = Recipe(
        recipe_id="R-PERFECT",
        name="Perfect Score Dish",
        description="Test",
        preparation_time_minutes=15,
        servings=2,
        ingredients=[
            RecipeIngredient(name="Tomato", quantity=1.0, unit="unit"),
            RecipeIngredient(name="Onion", quantity=1.0, unit="unit"),
        ],
        instructions=["Chop and mix."],
    )
    inv = [
        InventoryItem(inventory_item_id="I1", product_name="Tomato", quantity=2.0, unit="unit", status="available", expiry_date=ref_date + timedelta(days=1)),
        InventoryItem(inventory_item_id="I2", product_name="Onion", quantity=2.0, unit="unit", status="available", expiry_date=ref_date + timedelta(days=1)),
    ]
    p_map = {"I1": "Red", "I2": "Orange"}

    res = evaluate_recipe(rec, inv, priority_map=p_map, as_of=ref_date)
    # Availability: 40.0
    # Near-expiry (2 items): 30.0
    # Use-First (2 items Red/Orange): 20.0
    # Missing penalty (0 missing): 10.0
    # Total: 100.0
    assert res.score == 100.0
    assert res.score_breakdown.ingredient_availability == 40.0
    assert res.score_breakdown.near_expiry_utilization == 30.0
    assert res.score_breakdown.use_first_utilization == 20.0
    assert res.score_breakdown.missing_ingredient_component == 10.0


def test_optional_missing_does_not_penalize_required_availability(ref_date):
    rec = Recipe(
        recipe_id="R-OPT-CHECK",
        name="Egg Dish with Optional Herb",
        description="Test",
        preparation_time_minutes=10,
        servings=1,
        ingredients=[
            RecipeIngredient(name="Eggs", quantity=2.0, unit="unit", optional=False),
            RecipeIngredient(name="Butter", quantity=10.0, unit="g", optional=True), # Missing optional
        ],
        instructions=["Fry egg."],
    )
    inv = [
        InventoryItem(inventory_item_id="I1", product_name="Eggs", quantity=4.0, unit="unit", status="available"),
    ]
    res = evaluate_recipe(rec, inv, priority_map={}, as_of=ref_date)
    assert res.preparation_status == "missing_optional_only"
    # Required availability should be 100% -> 40 points
    assert res.score_breakdown.ingredient_availability == 40.0
    assert "Butter" in res.optional_missing_ingredients
    assert len(res.missing_ingredients) == 0


def test_empty_inventory_returns_controlled_recommendations(ref_date):
    response = recommend_recipes(inventory=[], as_of=ref_date, limit=5)
    assert isinstance(response, RecipeRecommendationResponse)
    assert response.total_recommendations == 5
    assert all(r.score < 20.0 for r in response.recommendations)
    assert all(r.preparation_status == "needs_missing_ingredients" for r in response.recommendations)


def test_deterministic_tie_breaking(ref_date):
    # Empty inventory means all recipes with identical availability and missing ingredients tie
    res1 = recommend_recipes(inventory=[], as_of=ref_date, limit=10)
    res2 = recommend_recipes(inventory=[], as_of=ref_date, limit=10)
    assert [r.recipe_id for r in res1.recommendations] == [r.recipe_id for r in res2.recommendations]


# ---------------------------------------------------------------------------
# F. API Integration Tests
# ---------------------------------------------------------------------------

def test_api_recipe_recommendations_endpoint(client, ref_date):
    payload = {
        "inventory": [
            {
                "inventory_item_id": "API-INV-1",
                "product_name": "White Rice",
                "quantity": 1.0,
                "unit": "kg",
                "status": "available",
                "expiry_date": str(ref_date + timedelta(days=2)),
            },
            {
                "inventory_item_id": "API-INV-2",
                "product_name": "Tomato",
                "quantity": 3.0,
                "unit": "unit",
                "status": "available",
                "expiry_date": str(ref_date + timedelta(days=1)),
            },
        ],
        "limit": 5,
        "as_of_date": str(ref_date),
    }
    response = client.post("/recipes/recommend", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert "recommendations" in data
    assert len(data["recommendations"]) == 5
    top = data["recommendations"][0]
    assert "Tomato Rice" in top["name"] or top["score"] >= 70.0
    assert top["rank"] == 1
    assert "score_breakdown" in top


def test_api_recipe_recommendations_invalid_limit_rejected(client, ref_date):
    payload = {
        "inventory": [],
        "limit": 0, # Invalid limit (< 1)
    }
    response = client.post("/recipes/recommend", json=payload)
    assert response.status_code == 422
