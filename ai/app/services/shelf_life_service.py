"""SaveBite Rule-Based Shelf-Life Estimation Service.

Calculates estimated end date and remaining storage days for grocery items
using reference knowledge base baselines, actual storage zones, temperature checks,
package use-by constraints, and opened/unopened states.
"""

from __future__ import annotations

from datetime import date, timedelta
import math
from typing import Any, Dict, List, Literal, Optional, Union

from pydantic import BaseModel, Field, field_validator, model_validator

from app.services.product_catalog import (
    ProductCatalog,
    get_default_catalog,
    lookup_product,
)

ReliabilityLevel = Literal["high", "medium", "low", "unavailable"]


class ShelfLifeEstimateRequest(BaseModel):
    """Input request contract for rule-based shelf-life estimation."""

    product_name: str = Field(..., description="Name of the grocery item.")
    storage_zone: Optional[str] = Field(
        None,
        description="Actual storage location (e.g. 'refrigerator', 'pantry', 'freezer').",
    )
    purchase_date: date = Field(..., description="Date the item was purchased (YYYY-MM-DD).")
    opened: bool = Field(..., description="Whether the package has been opened.")
    storage_temperature_c: Optional[float] = Field(
        None, description="Observed storage temperature in Celsius, if known."
    )
    package_use_by_date: Optional[date] = Field(
        None, description="Manufacturer/package use-by date, if available."
    )
    as_of_date: Optional[date] = Field(
        None,
        description="Evaluation date for remaining shelf life; defaults to current date if omitted.",
    )

    @field_validator("product_name")
    @classmethod
    def validate_product_name(cls, v: str) -> str:
        if not isinstance(v, str) or not v.strip():
            raise ValueError("product_name cannot be empty or whitespace-only.")
        return v.strip()

    @field_validator("opened", mode="before")
    @classmethod
    def validate_opened_boolean(cls, v: Any) -> bool:
        if not isinstance(v, bool):
            raise ValueError("opened must be a strict boolean (True or False).")
        return v

    @field_validator("storage_temperature_c")
    @classmethod
    def validate_temperature(cls, v: Optional[float]) -> Optional[float]:
        if v is not None:
            if math.isnan(v) or math.isinf(v):
                raise ValueError("storage_temperature_c must be a finite number.")
            if not (-50.0 <= v <= 70.0):
                raise ValueError("storage_temperature_c must be between -50°C and 70°C.")
        return v

    @model_validator(mode="after")
    def validate_date_coherence(self) -> "ShelfLifeEstimateRequest":
        ref_as_of = self.as_of_date or date.today()
        if self.purchase_date > ref_as_of:
            raise ValueError(
                f"purchase_date ({self.purchase_date}) cannot be in the future relative to as_of_date ({ref_as_of})."
            )
        return self


class ShelfLifeEstimateResponse(BaseModel):
    """Output structured response for shelf-life estimation."""

    product_name: str
    product_found: bool
    purchase_date: date
    as_of_date: date
    opened: bool
    reference_shelf_life_days: Optional[int] = None
    estimated_end_date: Optional[date] = None
    estimated_remaining_days: Optional[int] = None
    estimated_days_remaining_nonnegative: Optional[int] = None
    storage_zone_used: Optional[str] = None
    catalog_storage_zone: Optional[str] = None
    storage_assumption: Optional[str] = None
    storage_temperature_c: Optional[float] = None
    temperature_adjustment_applied: bool = False
    package_use_by_date: Optional[date] = None
    package_date_warning: Optional[str] = None
    reliability: ReliabilityLevel
    warnings: List[str] = Field(default_factory=list)
    explanation: str


def estimate_shelf_life(
    request: Union[ShelfLifeEstimateRequest, Dict[str, Any]],
    catalog: Optional[ProductCatalog] = None,
) -> ShelfLifeEstimateResponse:
    """Calculate rule-based shelf life estimate for a grocery item.

    Args:
        request: Validated ShelfLifeEstimateRequest or dictionary matching its contract.
        catalog: Optional ProductCatalog instance. Uses default catalog if omitted.

    Returns:
        ShelfLifeEstimateResponse with complete calculation details, warnings, and reliability label.
    """
    if not isinstance(request, ShelfLifeEstimateRequest):
        request = ShelfLifeEstimateRequest(**request)

    effective_as_of: date = request.as_of_date or date.today()
    product = lookup_product(request.product_name, catalog=catalog)

    warnings: List[str] = []

    # Rule: Unknown product handling
    if product is None:
        raw_zone = request.storage_zone.strip().lower() if request.storage_zone else None
        return ShelfLifeEstimateResponse(
            product_name=request.product_name,
            product_found=False,
            purchase_date=request.purchase_date,
            as_of_date=effective_as_of,
            opened=request.opened,
            reference_shelf_life_days=None,
            estimated_end_date=None,
            estimated_remaining_days=None,
            estimated_days_remaining_nonnegative=None,
            storage_zone_used=raw_zone,
            catalog_storage_zone=None,
            storage_assumption="Product not found in knowledge base.",
            storage_temperature_c=request.storage_temperature_c,
            temperature_adjustment_applied=False,
            package_use_by_date=request.package_use_by_date,
            package_date_warning=None,
            reliability="unavailable",
            warnings=[
                f"Product '{request.product_name}' not found in knowledge base. "
                "No shelf-life estimate can be produced."
            ],
            explanation=(
                f"Product '{request.product_name}' was not found in the SaveBite grocery catalog. "
                "A reliable shelf-life estimate cannot be produced without catalog baseline data."
            ),
        )

    canonical_name: str = product["product_name"]
    catalog_zone: str = product["storage_zone"]
    actual_zone: str = (
        request.storage_zone.strip().lower() if request.storage_zone else catalog_zone
    )

    # Rule D: Storage zone assumptions
    zone_mismatch = False
    if not request.storage_zone:
        storage_assumption = (
            f"Storage zone defaulted to catalog recommendation: '{catalog_zone}'."
        )
    elif actual_zone == catalog_zone:
        storage_assumption = f"Stored in catalog recommended zone: '{catalog_zone}'."
    else:
        zone_mismatch = True
        storage_assumption = (
            f"Actual storage zone '{actual_zone}' differs from recommended zone '{catalog_zone}'. "
            "No empirical mathematical correction applied."
        )
        warnings.append(
            f"Storage zone mismatch: item stored in '{actual_zone}', but catalog reference condition is '{catalog_zone}'."
        )

    # Rule A: Reference duration determination
    opened_fallback = False
    if not request.opened:
        ref_days: int = int(product["base_shelf_life_days"])
    else:
        opened_days = product.get("opened_shelf_life_days")
        if opened_days is not None and opened_days > 0:
            ref_days = int(opened_days)
        else:
            opened_fallback = True
            ref_days = int(product["base_shelf_life_days"])
            warnings.append(
                "No opened shelf-life baseline in catalog; provisional fallback to unopened base shelf life."
            )

    # Rules B & C: Calculation of estimated end date and remaining days
    estimated_end_date: date = request.purchase_date + timedelta(days=ref_days)
    estimated_remaining_days: int = (estimated_end_date - effective_as_of).days
    estimated_remaining_nonneg: int = max(0, estimated_remaining_days)

    # Rule E: Storage temperature evaluation
    temp_c = request.storage_temperature_c
    temp_abnormal = False
    if temp_c is not None:
        if actual_zone == "refrigerator":
            if temp_c > 4.0:
                temp_abnormal = True
                warnings.append(
                    f"Refrigerator temperature {temp_c}°C exceeds recommended threshold (<= 4°C). Spoilage may accelerate; no temperature multiplier applied."
                )
            elif temp_c < 0.0:
                temp_abnormal = True
                warnings.append(
                    f"Refrigerator temperature {temp_c}°C is below freezing point (0°C). Product may freeze or degrade in texture."
                )
        elif actual_zone == "freezer":
            if temp_c > -18.0:
                temp_abnormal = True
                warnings.append(
                    f"Freezer temperature {temp_c}°C is above recommended freezing threshold (<= -18°C)."
                )
        elif actual_zone == "pantry":
            if temp_c > 25.0:
                temp_abnormal = True
                warnings.append(
                    f"Pantry temperature {temp_c}°C is warmer than recommended room storage (10°C - 25°C)."
                )

    # Rule F: Package use-by date comparison
    package_warning: Optional[str] = None
    if request.package_use_by_date is not None:
        if request.package_use_by_date < request.purchase_date:
            package_warning = (
                f"Package use-by date ({request.package_use_by_date}) is earlier than purchase date ({request.purchase_date}). Check package label."
            )
            warnings.append(package_warning)
        elif request.package_use_by_date < estimated_end_date:
            package_warning = (
                f"Package use-by date ({request.package_use_by_date}) is earlier than catalog estimated end date ({estimated_end_date}). Follow package manufacturer date."
            )
            warnings.append(package_warning)

    # Rule G: Deterministic reliability classification
    if zone_mismatch or opened_fallback:
        reliability: ReliabilityLevel = "low"
    elif temp_abnormal or (package_warning and "earlier than catalog" in package_warning):
        reliability = "medium"
    else:
        reliability = "high"

    # Narrative explanation
    if estimated_remaining_days > 0:
        time_status = f"{estimated_remaining_days} day(s) remaining"
    elif estimated_remaining_days == 0:
        time_status = "estimated end date is today"
    else:
        time_status = f"reference estimate elapsed {abs(estimated_remaining_days)} day(s) ago"

    explanation = (
        f"Item '{canonical_name}' has an estimated storage life of {ref_days} day(s) based on catalog reference data. "
        f"Calculated end date is {estimated_end_date} ({time_status} as of {effective_as_of}). "
        f"Reliability is assessed as '{reliability}'."
    )

    return ShelfLifeEstimateResponse(
        product_name=canonical_name,
        product_found=True,
        purchase_date=request.purchase_date,
        as_of_date=effective_as_of,
        opened=request.opened,
        reference_shelf_life_days=ref_days,
        estimated_end_date=estimated_end_date,
        estimated_remaining_days=estimated_remaining_days,
        estimated_days_remaining_nonnegative=estimated_remaining_nonneg,
        storage_zone_used=actual_zone,
        catalog_storage_zone=catalog_zone,
        storage_assumption=storage_assumption,
        storage_temperature_c=temp_c,
        temperature_adjustment_applied=False,
        package_use_by_date=request.package_use_by_date,
        package_date_warning=package_warning,
        reliability=reliability,
        warnings=warnings,
        explanation=explanation,
    )
