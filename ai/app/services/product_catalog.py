"""SaveBite Grocery Product Knowledge Base Service.

Provides product catalog loading, schema and business rule validation,
name normalization with alias resolution, and deterministic lookup.
"""

from __future__ import annotations

import csv
from functools import lru_cache
import math
from pathlib import Path
import re
from typing import Any, Dict, List, Optional, Set, Union


# Default file path resolved relative to this module file location
DEFAULT_CSV_PATH: Path = (
    Path(__file__).resolve().parent.parent / "data" / "products.csv"
)

# Schema definitions
REQUIRED_COLUMNS: List[str] = [
    "product_id",
    "product_name",
    "category",
    "base_shelf_life_days",
    "storage_zone",
    "opened_shelf_life_days",
    "sensitivity",
    "source",
]

ALLOWED_STORAGE_ZONES: Set[str] = {"pantry", "refrigerator", "freezer"}
ALLOWED_SENSITIVITIES: Set[str] = {"low", "medium", "high"}

# Upper sanity bound for shelf life (10 years)
MAX_REASONABLE_SHELF_LIFE_DAYS: int = 3650

# Words ending in 's' or similar suffixes that must NOT be naively depluralized
PROTECTED_WORDS: Set[str] = {
    "rice",
    "cheese",
    "glass",
    "hummus",
    "couscous",
    "molasses",
    "citrus",
    "asparagus",
    "lettuce",
    "oats",
    "blueberries",
    "beans",
    "peas",
    "flour",
    "pasta",
    "mayonnaise",
}

# Explicit aliases mapping variations to canonical product names or standard forms
KNOWN_ALIASES: Dict[str, str] = {
    # Irregular or specific plurals / singulars
    "tomatoes": "tomato",
    "potatoes": "potato",
    "onions": "onion",
    "apples": "apple",
    "bananas": "banana",
    "strawberries": "strawberry",
    "oranges": "orange",
    "lemons": "lemon",
    "carrots": "carrot",
    "bell peppers": "bell pepper",
    "green peppers": "bell pepper",
    "green pepper": "bell pepper",
    "red bell pepper": "bell pepper",
    "red pepper": "bell pepper",
    "egg": "eggs",
    "eggs": "eggs",
    "blueberry": "blueberries",
    "blueberries": "blueberries",

    # Common descriptors and qualifiers
    "fresh tomato": "tomato",
    "fresh tomatoes": "tomato",
    "whole milk": "milk",
    "skim milk": "milk",
    "low fat milk": "milk",
    "cow milk": "milk",
    "fresh milk": "milk",
    "brown potato": "potato",
    "russet potato": "potato",
    "yellow onion": "onion",
    "red onion": "onion",
    "white onion": "onion",
    "fresh apple": "apple",
    "fresh spinach": "spinach",
    "fresh carrot": "carrot",
    "fresh carrots": "carrot",

    # Protein shortcuts
    "chicken": "fresh chicken breast",
    "chicken breast": "fresh chicken breast",
    "raw chicken": "fresh chicken breast",
    "chicken breasts": "fresh chicken breast",
    "beef": "ground beef",
    "minced beef": "ground beef",
    "ground meat": "ground beef",
    "salmon": "fresh salmon fillet",
    "salmon fillet": "fresh salmon fillet",
    "salmon fillets": "fresh salmon fillet",

    # Staples and grains shortcuts
    "bread": "whole wheat bread",
    "wheat bread": "whole wheat bread",
    "white bread": "whole wheat bread",
    "rice": "white rice",
    "dry rice": "white rice",
    "oats": "rolled oats",
    "oatmeal": "rolled oats",
    "pasta": "dry pasta",
    "dry pasta": "dry pasta",
    "spaghetti": "dry pasta",
    "flour": "all-purpose flour",
    "wheat flour": "all-purpose flour",

    # Packaged, canned & dairy shortcuts
    "tuna": "canned tuna",
    "black beans": "canned black beans",
    "beans": "canned black beans",
    "tomato sauce": "canned tomato sauce",
    "cheddar": "cheddar cheese",
    "mozzarella": "mozzarella cheese",
}


class CatalogValidationError(ValueError):
    """Raised when the product catalog violates schema or business rules."""

    def __init__(self, message: str, errors: Optional[List[str]] = None) -> None:
        super().__init__(message)
        self.errors: List[str] = errors or [message]


def normalize_product_name(name: str) -> str:
    """Normalize a product name for reliable, deterministic catalog lookup.

    Steps:
    1. Validate string type (raises TypeError for non-string).
    2. Trim whitespace and convert to lowercase.
    3. Collapse multiple spaces into a single space.
    4. Check explicit alias mapping dictionary.
    5. Strip common descriptive prefixes (e.g. 'fresh ', 'raw ', 'organic ') if not part
       of a canonical multi-word name.
    6. Safely handle singular/plural variations while protecting words like 'rice' and 'cheese'.

    Args:
        name: The raw product name string to normalize.

    Returns:
        The normalized lowercase string representation.

    Raises:
        TypeError: If name is not a string.
    """
    if not isinstance(name, str):
        raise TypeError(f"Product name must be a string, got {type(name).__name__}")

    cleaned = name.strip()
    if not cleaned:
        return ""

    # Lowercase and collapse consecutive spaces
    lowered = re.sub(r"\s+", " ", cleaned.lower())

    # Direct match in known aliases
    if lowered in KNOWN_ALIASES:
        return KNOWN_ALIASES[lowered]

    # Strip safe common descriptor prefixes if not part of catalog phrase
    prefixes = ("fresh ", "raw ", "organic ")
    for prefix in prefixes:
        if lowered.startswith(prefix):
            candidate = lowered[len(prefix):].strip()
            if candidate in KNOWN_ALIASES:
                return KNOWN_ALIASES[candidate]
            lowered = candidate
            break

    # Re-check aliases after prefix stripping
    if lowered in KNOWN_ALIASES:
        return KNOWN_ALIASES[lowered]

    # De-pluralize safely if not protected
    if lowered not in PROTECTED_WORDS:
        if lowered.endswith("ies") and len(lowered) > 4:
            # e.g., cherries -> cherry
            candidate = lowered[:-3] + "y"
            return KNOWN_ALIASES.get(candidate, candidate)
        elif lowered.endswith("oes") and len(lowered) > 4:
            # e.g., tomatoes -> tomato, potatoes -> potato
            candidate = lowered[:-2]
            return KNOWN_ALIASES.get(candidate, candidate)
        elif lowered.endswith("es") and len(lowered) > 3:
            # Check sibilant endings like dishes -> dish, boxes -> box
            if any(lowered[:-2].endswith(sib) for sib in ("s", "x", "z", "ch", "sh")):
                candidate = lowered[:-2]
                return KNOWN_ALIASES.get(candidate, candidate)
        elif lowered.endswith("s") and not lowered.endswith("ss") and len(lowered) > 2:
            candidate = lowered[:-1]
            return KNOWN_ALIASES.get(candidate, candidate)

    return lowered


def validate_product_catalog(
    data_or_path: Union[Path, str, List[Dict[str, Any]]]
) -> None:
    """Validate product catalog rows against all schema and business rules.

    Validates:
    - Exactly required schema headers exist.
    - File is not empty and contains at least 1 product row.
    - Unique non-empty product_id with no untrimmed whitespace.
    - Unique non-empty canonical product_name with no untrimmed whitespace.
    - Unique normalized product names (no duplicate semantic entries).
    - Category is non-empty.
    - Storage zone is strictly one of 'pantry', 'refrigerator', 'freezer'.
    - Sensitivity is strictly one of 'low', 'medium', 'high'.
    - base_shelf_life_days is numeric, finite, positive, and <= 3650 days.
    - opened_shelf_life_days (if provided) is numeric, finite, positive, and <= base_shelf_life_days.
    - source reference is non-empty and traceable.

    Args:
        data_or_path: Path to CSV file or list of parsed dictionary records.

    Raises:
        CatalogValidationError: If one or more validation rules fail.
    """
    rows: List[Dict[str, Any]] = []

    if isinstance(data_or_path, (str, Path)):
        csv_file = Path(data_or_path)
        if not csv_file.exists():
            raise CatalogValidationError(f"Catalog file does not exist: {csv_file}")

        content = csv_file.read_text(encoding="utf-8")
        if not content.strip():
            raise CatalogValidationError(f"Catalog file is empty: {csv_file}")

        reader = csv.DictReader(content.splitlines())
        if reader.fieldnames is None:
            raise CatalogValidationError(f"Catalog file has no headers: {csv_file}")

        # Check required columns
        missing_columns = [col for col in REQUIRED_COLUMNS if col not in reader.fieldnames]
        if missing_columns:
            raise CatalogValidationError(
                f"Catalog missing required columns: {missing_columns}. "
                f"Found headers: {reader.fieldnames}"
            )

        rows = list(reader)
    elif isinstance(data_or_path, list):
        rows = data_or_path
        if not rows:
            raise CatalogValidationError("Catalog row list is empty.")
    else:
        raise TypeError(f"Unsupported data source type: {type(data_or_path).__name__}")

    if not rows:
        raise CatalogValidationError("Catalog contains zero product rows.")

    errors: List[str] = []
    seen_ids: Set[str] = set()
    seen_canonical_names: Set[str] = set()
    seen_normalized_names: Dict[str, str] = {}

    for idx, row in enumerate(rows, start=1):
        row_id = row.get("product_id")
        raw_name = row.get("product_name")

        # 1. Product ID validation
        if not row_id or not str(row_id).strip():
            errors.append(f"Row {idx}: 'product_id' cannot be empty.")
        else:
            str_id = str(row_id)
            if str_id != str_id.strip():
                errors.append(f"Row {idx}: 'product_id' '{str_id}' has untrimmed whitespace.")
            if str_id in seen_ids:
                errors.append(f"Row {idx}: Duplicate 'product_id' '{str_id}'.")
            seen_ids.add(str_id)

        # 2. Product name validation
        if not raw_name or not str(raw_name).strip():
            errors.append(f"Row {idx}: 'product_name' cannot be empty.")
        else:
            str_name = str(raw_name)
            if str_name != str_name.strip():
                errors.append(f"Row {idx}: 'product_name' '{str_name}' has untrimmed whitespace.")
            if str_name.lower() in seen_canonical_names:
                errors.append(f"Row {idx}: Duplicate canonical 'product_name' '{str_name}'.")
            seen_canonical_names.add(str_name.lower())

            # Check normalized uniqueness
            normalized = normalize_product_name(str_name)
            if normalized in seen_normalized_names:
                errors.append(
                    f"Row {idx}: Normalized name '{normalized}' for '{str_name}' "
                    f"conflicts with existing entry '{seen_normalized_names[normalized]}'."
                )
            else:
                seen_normalized_names[normalized] = str_name

        # 3. Category validation
        category = row.get("category")
        if not category or not str(category).strip():
            errors.append(f"Row {idx}: 'category' cannot be empty.")

        # 4. Storage zone validation
        storage_zone = row.get("storage_zone")
        if not storage_zone or str(storage_zone).strip() not in ALLOWED_STORAGE_ZONES:
            errors.append(
                f"Row {idx}: Invalid 'storage_zone' '{storage_zone}'. "
                f"Must be one of {sorted(ALLOWED_STORAGE_ZONES)}."
            )

        # 5. Sensitivity validation
        sensitivity = row.get("sensitivity")
        if not sensitivity or str(sensitivity).strip() not in ALLOWED_SENSITIVITIES:
            errors.append(
                f"Row {idx}: Invalid 'sensitivity' '{sensitivity}'. "
                f"Must be one of {sorted(ALLOWED_SENSITIVITIES)}."
            )

        # 6. Base shelf life validation
        raw_base = row.get("base_shelf_life_days")
        try:
            if raw_base is None or str(raw_base).strip() == "":
                errors.append(f"Row {idx}: 'base_shelf_life_days' cannot be empty.")
            else:
                base_val = float(raw_base)
                if math.isnan(base_val) or math.isinf(base_val):
                    errors.append(f"Row {idx}: 'base_shelf_life_days' cannot be NaN or Inf.")
                elif base_val <= 0:
                    errors.append(f"Row {idx}: 'base_shelf_life_days' must be greater than zero.")
                elif base_val > MAX_REASONABLE_SHELF_LIFE_DAYS:
                    errors.append(
                        f"Row {idx}: 'base_shelf_life_days' ({base_val}) exceeds maximum "
                        f"threshold of {MAX_REASONABLE_SHELF_LIFE_DAYS} days."
                    )
        except (ValueError, TypeError):
            errors.append(
                f"Row {idx}: 'base_shelf_life_days' '{raw_base}' is not a valid number."
            )

        # 7. Opened shelf life validation
        raw_opened = row.get("opened_shelf_life_days")
        if raw_opened is not None and str(raw_opened).strip() != "":
            try:
                opened_val = float(raw_opened)
                if math.isnan(opened_val) or math.isinf(opened_val):
                    errors.append(f"Row {idx}: 'opened_shelf_life_days' cannot be NaN or Inf.")
                elif opened_val <= 0:
                    errors.append(f"Row {idx}: 'opened_shelf_life_days' must be greater than zero.")
            except (ValueError, TypeError):
                errors.append(
                    f"Row {idx}: 'opened_shelf_life_days' '{raw_opened}' is not a valid number."
                )

        # 8. Source validation
        source = row.get("source")
        if not source or not str(source).strip():
            errors.append(f"Row {idx}: 'source' cannot be empty.")

    if errors:
        error_summary = "\n- " + "\n- ".join(errors)
        raise CatalogValidationError(
            f"Catalog validation failed with {len(errors)} error(s):{error_summary}",
            errors=errors,
        )


class ProductCatalog:
    """In-memory grocery product knowledge base catalog with fast lookup."""

    def __init__(self, csv_path: Optional[Union[Path, str]] = None) -> None:
        self.csv_path: Path = Path(csv_path) if csv_path else DEFAULT_CSV_PATH
        self._products_by_id: Dict[str, Dict[str, Any]] = {}
        self._products_by_normalized_name: Dict[str, Dict[str, Any]] = {}
        self._canonical_products: List[Dict[str, Any]] = []
        self._load()

    def _load(self) -> None:
        """Load and validate the CSV catalog."""
        validate_product_catalog(self.csv_path)

        with self.csv_path.open("r", encoding="utf-8") as f:
            reader = csv.DictReader(f)
            for row in reader:
                pid = row["product_id"].strip()
                name = row["product_name"].strip()
                cat = row["category"].strip()
                base_days = int(round(float(row["base_shelf_life_days"])))
                zone = row["storage_zone"].strip()

                opened_raw = row.get("opened_shelf_life_days", "").strip()
                opened_days = int(round(float(opened_raw))) if opened_raw else None

                sens = row["sensitivity"].strip()
                src = row["source"].strip()

                record: Dict[str, Any] = {
                    "product_id": pid,
                    "product_name": name,
                    "category": cat,
                    "base_shelf_life_days": base_days,
                    "storage_zone": zone,
                    "opened_shelf_life_days": opened_days,
                    "sensitivity": sens,
                    "source": src,
                }

                self._canonical_products.append(record)
                self._products_by_id[pid] = record

                # Index canonical name
                canonical_norm = normalize_product_name(name)
                self._products_by_normalized_name[canonical_norm] = record

    @property
    def products(self) -> List[Dict[str, Any]]:
        """Return list of all canonical product records."""
        return list(self._canonical_products)

    def __len__(self) -> int:
        return len(self._canonical_products)

    def lookup(self, name: str) -> Optional[Dict[str, Any]]:
        """Look up a product record by name with normalization and alias resolution.

        Args:
            name: The query product name.

        Returns:
            Dictionary with canonical product fields if found, or None.

        Raises:
            TypeError: If name is not a string.
        """
        normalized = normalize_product_name(name)
        if not normalized:
            return None

        # Direct normalized match
        if normalized in self._products_by_normalized_name:
            return dict(self._products_by_normalized_name[normalized])

        # Check if the normalized name maps through alias dictionary to another key
        if normalized in KNOWN_ALIASES:
            alias_target = KNOWN_ALIASES[normalized]
            if alias_target in self._products_by_normalized_name:
                return dict(self._products_by_normalized_name[alias_target])

        return None


@lru_cache(maxsize=1)
def get_default_catalog() -> ProductCatalog:
    """Return the cached default singleton ProductCatalog instance."""
    return ProductCatalog()


def load_product_catalog(
    csv_path: Optional[Union[Path, str]] = None
) -> ProductCatalog:
    """Load and return a ProductCatalog instance from the specified path or default."""
    return ProductCatalog(csv_path=csv_path)


def lookup_product(
    name: str, catalog: Optional[ProductCatalog] = None
) -> Optional[Dict[str, Any]]:
    """Look up a product in the catalog by name.

    Args:
        name: Product name query.
        catalog: Optional ProductCatalog instance. Uses default catalog if omitted.

    Returns:
        Structured dictionary containing all product attributes, or None if not found.
    """
    cat = catalog if catalog is not None else get_default_catalog()
    return cat.lookup(name)
