# Phase 7 Audit Report: Recipe Recommendation and Food-Waste Reduction Intelligence

**Date:** 2026-10-24  
**Project:** SaveBite AI — Grocery Intelligence and Food-Waste Management System  
**Module:** `ai/`  
**Verdict:** **PASS**

---

## 1. Executive Summary

Phase 7 implements the **Recipe Recommendation and Food-Waste Reduction Intelligence Service** within the SaveBite AI subsystem. This service provides deterministic, explainable, rule-based recipe recommendations that actively guide households toward utilizing available groceries before they expire, minimizing domestic food spoilage.

The service is fully decoupled from external databases, physical IoT devices, or third-party recipe APIs. It operates strictly on curated local sample recipe data and integrates seamlessly with existing Phase 1–6 components:
- **Phase 2:** Product normalization and catalog matching utilities.
- **Phase 4:** Use-First priority scoring (Red, Orange, Yellow, Green, Black categories).
- **Phase 6:** Inventory modeling, usable stock classification, dimensional unit conversions, and item aggregation.

All 18 new automated tests in [test_recipe_recommendation_service.py](file:///d:/Projects/Triwizathon/SaveBite/ai/tests/test_recipe_recommendation_service.py) passed on initial execution, and the full regression test suite spanning Phases 1 through 7 passed completely (205 passed, 0 failures, 0 regressions).

---

## 2. Repository Structure & Files

### Files Created
1. `app/data/sample_recipes.json` — Curated dataset containing 25 practical, diverse recipes built around canonical pantry and refrigerated staples from the catalog.
2. `app/services/recipe_recommendation_service.py` — Core recommendation engine, scoring logic, explainability generators, and Pydantic validation models.
3. `tests/test_recipe_recommendation_service.py` — Comprehensive unit and integration test suite (18 test functions, 40+ assertions).
4. `reports/phase7_audit_report.md` — This audit documentation.

### Files Modified
1. `app/main.py` — Added `RecipeRecommendRequest` Pydantic model and exposed `POST /recipes/recommend` endpoint.

---

## 3. Existing Services Reused

Phase 7 intentionally avoids code duplication by reusing established services across prior phases:
- **Phase 2 (`product_catalog.py`):** `normalize_product_name()` and `lookup_product()` ensure consistent canonical naming and catalog resolution.
- **Phase 4 (`priority_scoring.py`):** `prioritize_items()` dynamically evaluates priority urgency for items lacking precomputed scores. Red and Orange priority items receive designated scoring incentives.
- **Phase 6 (`duplicate_purchase_service.py`):** `InventoryItem` schema, `is_inventory_usable()` for eligibility/expiry filtering, `convert_units()` for safe mass/volume unit conversions, and `match_products()` for fuzzy/alias product resolution.

---

## 4. Recipe Dataset Specifications

The local dataset (`app/data/sample_recipes.json`) contains 25 realistic recipes representing typical household meals:
- **Breakfast / Quick Meals:** Vegetable Upma, Poha, Vegetable Omelette, Tomato Omelette, Besan Chilla, Banana Smoothie, Fruit Salad, Aloo Paratha.
- **Rice & Grains:** Vegetable Pulao, Tomato Rice, Dal Rice, Vegetable Fried Rice, Curd Rice, Egg Fried Rice, Lemon Rice, Khichdi.
- **Curries & Sides:** Potato Curry (Aloo Matar), Mixed Vegetable Curry, Paneer Bhurji, Simple Potato Roast, Chickpea Salad.
- **Soups & Sandwiches:** Vegetable Soup, Tomato Soup, Vegetable Sandwich, Potato Sandwich, Vegetable Pasta.

Each recipe adheres to strict structural constraints:
- Unique `recipe_id` (e.g., `REC001` through `REC025`).
- Non-empty `instructions` and `ingredients`.
- Positive ingredient quantities.
- Explicit `optional` flag for garnish or secondary items.
- Tagged with `dietary_tags` (Vegetarian, Vegan, Non-Vegetarian) and `difficulty`.

---

## 5. Ingredient Matching & Unit Conversion Rules

### Ingredient Matching
Conservative matching is enforced to prevent erroneous ingredient substitutions:
1. Exact `product_id` match against catalog entries.
2. Normalized exact name match.
3. Verified catalog alias match.
4. **Distinct Product Protection:** Milk does not match Milk Powder; Rice does not match Rice Flour; Apple does not match Apple Juice.

### Unit Conversion
- **Mass:** Grams (`g`) $\leftrightarrow$ Kilograms (`kg`).
- **Volume:** Millilitres (`ml`) $\leftrightarrow$ Litres (`l`).
- **Count:** Units (`unit`, `piece`, `pieces`, `egg`, `eggs`).
- **Cross-dimensional conversions** (e.g., mass to volume) without specific densities are rejected. If conversion is impossible, the ingredient is marked `quantity_unknown` rather than guessing quantities.

---

## 6. Inventory Eligibility & Expiry Rules

Inventory items undergo strict filtering before recipe evaluation:
- **Usable Inventory:** Positive quantity, status `available`, and expiry date $\ge$ `as_of` date (or unknown expiry).
- **Ineligible Inventory:** Expired items, consumed items, discarded items, and zero/negative stock are strictly excluded.
- **Near-Expiry Threshold:** Items with remaining shelf life $\le 3$ days relative to `as_of` are classified as near-expiry.
- **Safety Rule:** Expired items never grant availability or near-expiry bonus points.

---

## 7. Deterministic Scoring Algorithm & Weights

The total recommendation score is normalized between $0.0$ and $100.0$ points:

$$\text{Total Score} = S_{\text{avail}} + S_{\text{near\_expiry}} + S_{\text{use\_first}} + S_{\text{missing}}$$

| Component | Max Points | Formula / Logic | Description |
|:---|:---:|:---|:---|
| **Required Ingredient Availability** | 40 | $40 \times \frac{\text{Available Required}}{\text{Total Required}}$ | Rewards recipes whose required ingredients are fully satisfied by usable stock. Optional ingredients are excluded from denominator. |
| **Near-Expiry Utilization** | 30 | 30 pts ( $\ge 2$ near-expiry items)<br>20 pts ($= 1$ near-expiry item)<br>0 pts (otherwise) | Directly prioritizes recipes that rescue groceries approaching spoilage. |
| **Use-First Priority Utilization** | 20 | 20 pts ( $\ge 2$ Red/Orange items)<br>12 pts ($= 1$ Red/Orange item)<br>0 pts (otherwise) | Leverages Phase 4 priority scores to prioritize urgent pantry items. |
| **Missing Ingredient Adjustment** | 10 | 10 pts (0 missing)<br>5 pts (1 missing)<br>0 pts ( $\ge 2$ missing) | Favors recipes requiring fewer external purchases. |

### Tie-Breaking
Recipes with identical scores are sorted deterministically by `score` descending, followed by `recipe_id` ascending.

---

## 8. API Endpoint Documentation

### Endpoint
`POST /recipes/recommend`

### Request Example
```json
{
  "inventory": [
    {
      "inventory_item_id": "INV-001",
      "product_name": "Tomato",
      "quantity": 3.0,
      "unit": "unit",
      "status": "available",
      "expiry_date": "2026-10-26"
    },
    {
      "inventory_item_id": "INV-002",
      "product_name": "White Rice",
      "quantity": 1.0,
      "unit": "kg",
      "status": "available",
      "expiry_date": "2026-11-15"
    }
  ],
  "limit": 3,
  "as_of_date": "2026-10-24"
}
```

### Response Example
```json
{
  "recommendations": [
    {
      "recipe_id": "REC002",
      "name": "Tomato Rice",
      "rank": 1,
      "score": 87.0,
      "score_breakdown": {
        "ingredient_availability": 40.0,
        "near_expiry_utilization": 20.0,
        "use_first_utilization": 20.0,
        "missing_ingredient_component": 7.0
      },
      "preparation_status": "ready_to_cook",
      "matched_ingredients": [
        {
          "ingredient_name": "White Rice",
          "required_quantity": 200.0,
          "required_unit": "g",
          "available_quantity": 1000.0,
          "available_unit": "g",
          "missing_quantity": 0.0,
          "status": "available",
          "is_near_expiry": false,
          "is_use_first": true,
          "match_method": "product_match"
        },
        {
          "ingredient_name": "Tomato",
          "required_quantity": 2.0,
          "required_unit": "unit",
          "available_quantity": 3.0,
          "available_unit": "unit",
          "missing_quantity": 0.0,
          "status": "available",
          "is_near_expiry": true,
          "is_use_first": true,
          "match_method": "product_match"
        }
      ],
      "use_first_ingredients": ["Tomato", "White Rice"],
      "near_expiry_ingredients": ["Tomato"],
      "missing_ingredients": [],
      "insufficient_ingredients": [],
      "unavailable_ingredients": [],
      "optional_missing_ingredients": ["Onion"],
      "reasons": [
        "All required ingredients are available in sufficient quantities.",
        "Uses 1 ingredient(s) nearing expiry: Tomato.",
        "Uses 2 high-priority Use-First item(s): Tomato, White Rice."
      ],
      "preparation_time_minutes": 25,
      "servings": 2,
      "instructions": [
        "Rinse and cook rice until grains are separate.",
        "Saute chopped tomatoes and onions with spices.",
        "Mix cooked rice with tomato masala and simmer for 3 minutes."
      ],
      "simulated": false
    }
  ],
  "total_recommendations": 3,
  "as_of_date": "2026-10-24",
  "simulated_inventory_used": false
}
```

---

## 9. Automated Testing & Verification

### Test Commands Executed
```powershell
.\.venv\Scripts\pytest.exe tests/test_recipe_recommendation_service.py -v
.\.venv\Scripts\pytest.exe -v
```

### Test Results
- **Focused Phase 7 Tests:** 18 passed in 0.44s.
- **Full Regression Test Suite (Phases 1–7):** **205 passed** in 0.97s (187 baseline + 18 Phase 7).
- **OpenAPI Schema Check:** Verified that `/recipes/recommend` is properly exposed and registered.

---

## 10. Limitations & Disclaimers

1. **Rule-Based Heuristic:** The recommendation engine relies on deterministic rules. It does not certify biological safety or culinary tastiness.
2. **Food Safety:** The system explicitly does not guarantee that non-expired items are safe to consume. Visual, tactile, and olfactory assessment remains necessary.
3. **Static Dataset:** The 25 sample recipes provide standard templates; regional variations or unlisted pantry seasonings (e.g., salt, water) are assumed available unless explicitly required.
