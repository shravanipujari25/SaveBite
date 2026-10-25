"""Automated tests for SaveBite Grocery Product Knowledge Base service and API endpoints."""

import sys
from pathlib import Path

# Ensure ai directory is on sys.path for test imports
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.services.product_catalog import (
    ALLOWED_SENSITIVITIES,
    ALLOWED_STORAGE_ZONES,
    DEFAULT_CSV_PATH,
    REQUIRED_COLUMNS,
    CatalogValidationError,
    ProductCatalog,
    get_default_catalog,
    load_product_catalog,
    lookup_product,
    normalize_product_name,
    validate_product_catalog,
)


@pytest.fixture
def client():
    """Create FastAPI test client."""
    return TestClient(app)


@pytest.fixture
def default_catalog():
    """Return default loaded catalog."""
    return get_default_catalog()


# ============================================================================
# 1. Catalog Loading and Schema Tests
# ============================================================================


def test_default_csv_exists_and_loads(default_catalog: ProductCatalog):
    """Verify that the production CSV file exists and loads successfully."""
    assert DEFAULT_CSV_PATH.exists()
    assert len(default_catalog) >= 25
    assert len(default_catalog) == 36


def test_catalog_contains_required_columns(default_catalog: ProductCatalog):
    """Verify that all products contain the exact 8 required schema fields."""
    for product in default_catalog.products:
        for col in REQUIRED_COLUMNS:
            assert col in product, f"Missing column '{col}' in product {product.get('product_id')}"


def test_catalog_unique_identifiers(default_catalog: ProductCatalog):
    """Verify that all product IDs and canonical names are distinct."""
    ids = [p["product_id"] for p in default_catalog.products]
    assert len(ids) == len(set(ids)), "Found duplicate product IDs in catalog"

    names = [p["product_name"].lower() for p in default_catalog.products]
    assert len(names) == len(set(names)), "Found duplicate product names in catalog"


def test_catalog_category_representation(default_catalog: ProductCatalog):
    """Verify that all required core categories are represented in catalog."""
    categories = {p["category"] for p in default_catalog.products}
    expected_categories = {"Fruit", "Vegetable", "Dairy", "Grain", "Packaged Food", "Protein Food"}
    for cat in expected_categories:
        assert cat in categories, f"Expected category '{cat}' missing from catalog"


def test_catalog_valid_enums(default_catalog: ProductCatalog):
    """Verify storage zones and sensitivities conform to allowed sets."""
    for p in default_catalog.products:
        assert p["storage_zone"] in ALLOWED_STORAGE_ZONES
        assert p["sensitivity"] in ALLOWED_SENSITIVITIES
        assert p["base_shelf_life_days"] > 0
        if p["opened_shelf_life_days"] is not None:
            assert p["opened_shelf_life_days"] > 0
        assert p["source"].startswith("http")


# ============================================================================
# 2. Product Name Normalization and Lookup Tests
# ============================================================================


def test_normalize_product_name_basic():
    """Verify whitespace stripping, lowercasing, and whitespace collapsing."""
    assert normalize_product_name("Tomato") == "tomato"
    assert normalize_product_name("  Tomato   ") == "tomato"
    assert normalize_product_name("MILK") == "milk"
    assert normalize_product_name("fresh   tomato") == "tomato"


def test_normalize_product_name_plurals():
    """Verify simple and irregular singular/plural variations."""
    assert normalize_product_name("tomatoes") == "tomato"
    assert normalize_product_name("potatoes") == "potato"
    assert normalize_product_name("onions") == "onion"
    assert normalize_product_name("apples") == "apple"
    assert normalize_product_name("carrots") == "carrot"
    assert normalize_product_name("bananas") == "banana"
    assert normalize_product_name("strawberries") == "strawberry"


def test_normalize_product_name_protected_words():
    """Verify words ending in 's' are not corrupted by depluralization."""
    # rice must not become ric, cheese must not become chees
    assert normalize_product_name("rice") == "white rice"
    assert normalize_product_name("cheese") == "cheese"
    assert normalize_product_name("glass") == "glass"
    assert normalize_product_name("hummus") == "hummus"
    assert normalize_product_name("lettuce") == "lettuce"


def test_normalize_product_name_invalid_types():
    """Verify TypeError is raised for non-string inputs."""
    with pytest.raises(TypeError):
        normalize_product_name(123)  # type: ignore

    with pytest.raises(TypeError):
        normalize_product_name(None)  # type: ignore

    with pytest.raises(TypeError):
        normalize_product_name(["tomato"])  # type: ignore


def test_lookup_product_exact_and_variations():
    """Verify lookup with canonical names, plurals, aliases, and case variations."""
    # Exact canonical
    prod_tomato = lookup_product("Tomato")
    assert prod_tomato is not None
    assert prod_tomato["product_name"] == "Tomato"
    assert prod_tomato["storage_zone"] == "pantry"
    assert prod_tomato["base_shelf_life_days"] == 7
    assert prod_tomato["opened_shelf_life_days"] == 2

    # Plural variation
    prod_tomatoes = lookup_product("tomatoes")
    assert prod_tomatoes is not None
    assert prod_tomatoes["product_name"] == "Tomato"

    # Case insensitive and alias with spaces
    prod_milk = lookup_product("MILK")
    assert prod_milk is not None
    assert prod_milk["product_name"] == "Milk"
    assert prod_milk["storage_zone"] == "refrigerator"

    prod_whole_milk = lookup_product("  whole milk  ")
    assert prod_whole_milk is not None
    assert prod_whole_milk["product_name"] == "Milk"

    # Potatoes and singular potato
    prod_potatoes = lookup_product("potatoes")
    assert prod_potatoes is not None
    assert prod_potatoes["product_name"] == "Potato"
    assert prod_potatoes["opened_shelf_life_days"] is None

    prod_potato = lookup_product("potato")
    assert prod_potato is not None
    assert prod_potato["product_name"] == "Potato"

    # Aliases
    prod_chicken = lookup_product("chicken")
    assert prod_chicken is not None
    assert prod_chicken["product_name"] == "Fresh Chicken Breast"

    prod_beef = lookup_product("ground meat")
    assert prod_beef is not None
    assert prod_beef["product_name"] == "Ground Beef"

    prod_tuna = lookup_product("tuna")
    assert prod_tuna is not None
    assert prod_tuna["product_name"] == "Canned Tuna"


def test_lookup_product_unknown():
    """Verify unknown products return None."""
    assert lookup_product("dragon_fruit_xyz") is None
    assert lookup_product("synthetic_nutrition_cube") is None


def test_lookup_product_empty_and_whitespace():
    """Verify empty or whitespace-only inputs return None."""
    assert lookup_product("") is None
    assert lookup_product("   ") is None


def test_lookup_product_invalid_types():
    """Verify non-string inputs raise TypeError."""
    with pytest.raises(TypeError):
        lookup_product(12345)  # type: ignore

    with pytest.raises(TypeError):
        lookup_product(None)  # type: ignore


# ============================================================================
# 3. Catalog Validation and Error Rejection Tests (using temporary CSVs)
# ============================================================================


def test_validation_rejects_empty_csv(tmp_path: Path):
    """Verify empty CSV file raises CatalogValidationError."""
    bad_csv = tmp_path / "empty.csv"
    bad_csv.write_text("", encoding="utf-8")
    with pytest.raises(CatalogValidationError, match="Catalog file is empty"):
        validate_product_catalog(bad_csv)


def test_validation_rejects_missing_columns(tmp_path: Path):
    """Verify CSV with missing columns raises CatalogValidationError."""
    bad_csv = tmp_path / "missing_cols.csv"
    bad_csv.write_text(
        "product_id,product_name,category\n"
        "GRC001,Apple,Fruit\n",
        encoding="utf-8",
    )
    with pytest.raises(CatalogValidationError, match="missing required columns"):
        validate_product_catalog(bad_csv)


def test_validation_rejects_duplicate_product_id(tmp_path: Path):
    """Verify duplicate product_id values are rejected."""
    bad_csv = tmp_path / "dup_id.csv"
    bad_csv.write_text(
        "product_id,product_name,category,base_shelf_life_days,storage_zone,opened_shelf_life_days,sensitivity,source\n"
        "GRC001,Apple,Fruit,30,refrigerator,2,low,https://example.com\n"
        "GRC001,Banana,Fruit,5,pantry,1,high,https://example.com\n",
        encoding="utf-8",
    )
    with pytest.raises(CatalogValidationError, match="Duplicate 'product_id'"):
        validate_product_catalog(bad_csv)


def test_validation_rejects_duplicate_canonical_name(tmp_path: Path):
    """Verify duplicate canonical names are rejected."""
    bad_csv = tmp_path / "dup_name.csv"
    bad_csv.write_text(
        "product_id,product_name,category,base_shelf_life_days,storage_zone,opened_shelf_life_days,sensitivity,source\n"
        "GRC001,Apple,Fruit,30,refrigerator,2,low,https://example.com\n"
        "GRC002,apple,Fruit,30,refrigerator,2,low,https://example.com\n",
        encoding="utf-8",
    )
    with pytest.raises(CatalogValidationError, match="Duplicate canonical 'product_name'"):
        validate_product_catalog(bad_csv)


def test_validation_rejects_empty_required_fields(tmp_path: Path):
    """Verify empty category, product_id, or product_name are rejected."""
    bad_csv = tmp_path / "empty_fields.csv"
    bad_csv.write_text(
        "product_id,product_name,category,base_shelf_life_days,storage_zone,opened_shelf_life_days,sensitivity,source\n"
        "GRC001,Apple,,30,refrigerator,2,low,https://example.com\n",
        encoding="utf-8",
    )
    with pytest.raises(CatalogValidationError, match="'category' cannot be empty"):
        validate_product_catalog(bad_csv)


def test_validation_rejects_invalid_storage_zone(tmp_path: Path):
    """Verify invalid storage zones outside allowed set are rejected."""
    bad_csv = tmp_path / "bad_zone.csv"
    bad_csv.write_text(
        "product_id,product_name,category,base_shelf_life_days,storage_zone,opened_shelf_life_days,sensitivity,source\n"
        "GRC001,Apple,Fruit,30,countertop,2,low,https://example.com\n",
        encoding="utf-8",
    )
    with pytest.raises(CatalogValidationError, match="Invalid 'storage_zone' 'countertop'"):
        validate_product_catalog(bad_csv)


def test_validation_rejects_invalid_sensitivity(tmp_path: Path):
    """Verify invalid sensitivity values outside low/medium/high are rejected."""
    bad_csv = tmp_path / "bad_sens.csv"
    bad_csv.write_text(
        "product_id,product_name,category,base_shelf_life_days,storage_zone,opened_shelf_life_days,sensitivity,source\n"
        "GRC001,Apple,Fruit,30,refrigerator,2,extreme,https://example.com\n",
        encoding="utf-8",
    )
    with pytest.raises(CatalogValidationError, match="Invalid 'sensitivity' 'extreme'"):
        validate_product_catalog(bad_csv)


def test_validation_rejects_invalid_base_shelf_life(tmp_path: Path):
    """Verify non-numeric, negative, or zero base shelf life is rejected."""
    # Negative shelf life
    bad_csv1 = tmp_path / "negative_base.csv"
    bad_csv1.write_text(
        "product_id,product_name,category,base_shelf_life_days,storage_zone,opened_shelf_life_days,sensitivity,source\n"
        "GRC001,Apple,Fruit,-5,refrigerator,2,low,https://example.com\n",
        encoding="utf-8",
    )
    with pytest.raises(CatalogValidationError, match="must be greater than zero"):
        validate_product_catalog(bad_csv1)

    # Non-numeric shelf life
    bad_csv2 = tmp_path / "text_base.csv"
    bad_csv2.write_text(
        "product_id,product_name,category,base_shelf_life_days,storage_zone,opened_shelf_life_days,sensitivity,source\n"
        "GRC001,Apple,Fruit,five_days,refrigerator,2,low,https://example.com\n",
        encoding="utf-8",
    )
    with pytest.raises(CatalogValidationError, match="is not a valid number"):
        validate_product_catalog(bad_csv2)


def test_validation_rejects_unreasonable_shelf_life(tmp_path: Path):
    """Verify shelf life exceeding the 10-year threshold is rejected."""
    bad_csv = tmp_path / "huge_base.csv"
    bad_csv.write_text(
        "product_id,product_name,category,base_shelf_life_days,storage_zone,opened_shelf_life_days,sensitivity,source\n"
        "GRC001,Apple,Fruit,99999,refrigerator,2,low,https://example.com\n",
        encoding="utf-8",
    )
    with pytest.raises(CatalogValidationError, match="exceeds maximum threshold"):
        validate_product_catalog(bad_csv)


def test_validation_rejects_invalid_opened_shelf_life(tmp_path: Path):
    """Verify negative or non-numeric opened shelf life is rejected."""
    bad_csv = tmp_path / "bad_opened.csv"
    bad_csv.write_text(
        "product_id,product_name,category,base_shelf_life_days,storage_zone,opened_shelf_life_days,sensitivity,source\n"
        "GRC001,Apple,Fruit,30,refrigerator,-1,low,https://example.com\n",
        encoding="utf-8",
    )
    with pytest.raises(CatalogValidationError, match="opened_shelf_life_days.*must be greater than zero"):
        validate_product_catalog(bad_csv)


def test_validation_rejects_missing_source(tmp_path: Path):
    """Verify missing source reference is rejected."""
    bad_csv = tmp_path / "missing_source.csv"
    bad_csv.write_text(
        "product_id,product_name,category,base_shelf_life_days,storage_zone,opened_shelf_life_days,sensitivity,source\n"
        "GRC001,Apple,Fruit,30,refrigerator,2,low,\n",
        encoding="utf-8",
    )
    with pytest.raises(CatalogValidationError, match="'source' cannot be empty"):
        validate_product_catalog(bad_csv)


# ============================================================================
# 4. FastAPI Integration Tests (GET /products/{product_name})
# ============================================================================


def test_api_product_lookup_success(client: TestClient):
    """Verify GET /products/{product_name} returns HTTP 200 with complete product data."""
    # Test tomato
    resp = client.get("/products/tomatoes")
    assert resp.status_code == 200
    data = resp.json()
    assert data["product_name"] == "Tomato"
    assert data["category"] == "Vegetable"
    assert data["storage_zone"] == "pantry"
    assert data["base_shelf_life_days"] == 7
    assert data["opened_shelf_life_days"] == 2
    assert data["sensitivity"] == "medium"
    assert "foodsafety.gov" in data["source"]

    # Test milk with uppercase and spaces
    resp_milk = client.get("/products/MILK")
    assert resp_milk.status_code == 200
    data_milk = resp_milk.json()
    assert data_milk["product_name"] == "Milk"
    assert data_milk["storage_zone"] == "refrigerator"


def test_api_product_lookup_not_found(client: TestClient):
    """Verify GET /products/{product_name} returns HTTP 404 for unknown items."""
    resp = client.get("/products/unknown_exotic_fruit_99")
    assert resp.status_code == 404
    data = resp.json()
    assert "detail" in data
    assert "not found in catalog" in data["detail"].lower()


def test_custom_catalog_loader_path(tmp_path: Path):
    """Verify custom catalog loader can load from arbitrary path."""
    custom_csv = tmp_path / "custom.csv"
    custom_csv.write_text(
        "product_id,product_name,category,base_shelf_life_days,storage_zone,opened_shelf_life_days,sensitivity,source\n"
        "CST001,Custom Mango,Fruit,10,pantry,2,medium,https://example.com/mango\n",
        encoding="utf-8",
    )
    custom_cat = load_product_catalog(custom_csv)
    assert len(custom_cat) == 1
    found = custom_cat.lookup("custom mango")
    assert found is not None
    assert found["product_id"] == "CST001"
    assert found["product_name"] == "Custom Mango"
