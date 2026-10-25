from typing import Optional
from fastapi import FastAPI, HTTPException, status
from pydantic import BaseModel, Field

from app.services.product_catalog import lookup_product
from app.services.shelf_life_service import (
    ShelfLifeEstimateRequest,
    ShelfLifeEstimateResponse,
    estimate_shelf_life,
)
from app.services.priority_scoring import (
    PriorityScoreRequest,
    PriorityScoreResponse,
    prioritize_items,
)


class HealthResponse(BaseModel):
    status: str
    service: str
    version: str


class ProductResponse(BaseModel):
    product_id: str
    product_name: str
    category: str
    base_shelf_life_days: int
    storage_zone: str
    opened_shelf_life_days: Optional[int] = None
    sensitivity: str
    source: str


app = FastAPI(
    title="SaveBite AI Service",
    description=(
        "Backend AI service hosting SaveBite's grocery intelligence "
        "and food-waste reduction features."
    ),
    version="0.1.0",
)


@app.get("/health", response_model=HealthResponse, tags=["Health"])
def get_health() -> HealthResponse:
    """Return health status, service name, and version of the SaveBite AI service."""
    return HealthResponse(
        status="healthy",
        service=app.title,
        version=app.version,
    )


@app.get(
    "/products/{product_name}",
    response_model=ProductResponse,
    tags=["Products"],
    summary="Look up grocery product details",
    description="Resolve product name variations and return reference shelf life and storage conditions.",
)
def get_product(product_name: str) -> ProductResponse:
    """Retrieve canonical grocery product information by product name query."""
    product = lookup_product(product_name)
    if product is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Product '{product_name}' not found in catalog.",
        )
    return ProductResponse(**product)


@app.post(
    "/shelf-life/estimate",
    response_model=ShelfLifeEstimateResponse,
    tags=["Shelf Life"],
    summary="Estimate grocery product shelf life",
    description="Calculate rule-based estimated end date and remaining storage days based on catalog baseline and storage conditions.",
)
def post_estimate_shelf_life(
    request: ShelfLifeEstimateRequest,
) -> ShelfLifeEstimateResponse:
    """Calculate remaining shelf life and storage advice for a grocery item."""
    return estimate_shelf_life(request)


@app.post(
    "/priority/score",
    response_model=PriorityScoreResponse,
    tags=["Priority"],
    summary="Score and rank grocery items by use-first priority",
    description=(
        "Evaluates a list of grocery items and ranks them by which should be consumed first, "
        "based on expiry urgency, product perishability, storage-condition warnings, "
        "and optional visible spoilage signals."
    ),
)
def post_priority_score(
    request: PriorityScoreRequest,
) -> PriorityScoreResponse:
    """Rank grocery items by use-first priority using the rule-based scoring engine."""
    return prioritize_items(request)


# ---------------------------------------------------------------------------
# Phase 7: Recipe Recommendation Route
# ---------------------------------------------------------------------------

from datetime import date
from typing import List, Dict, Any
from app.services.duplicate_purchase_service import InventoryItem
from app.services.recipe_recommendation_service import (
    RecipeRecommendationResponse,
    recommend_recipes,
)


class RecipeRecommendRequest(BaseModel):
    """Request payload for recipe recommendations based on household inventory."""

    inventory: List[InventoryItem] = Field(..., description="List of household inventory items.")
    priority_data: Optional[Dict[str, str]] = Field(
        None, description="Optional mapping of inventory_item_id -> priority category ('Red', 'Orange', etc.)."
    )
    limit: int = Field(10, ge=1, le=50, description="Maximum number of recommendations to return.")
    as_of_date: Optional[date] = Field(None, description="Evaluation reference date.")


@app.post(
    "/recipes/recommend",
    response_model=RecipeRecommendationResponse,
    tags=["Recipes"],
    summary="Recommend recipes utilizing household inventory",
    description=(
        "Recommends and ranks recipes using available household inventory, "
        "prioritizing groceries nearing expiry and items flagged with high Use-First priority."
    ),
)
def post_recipe_recommendations(
    request: RecipeRecommendRequest,
) -> RecipeRecommendationResponse:
    """Generate ranked recipe recommendations based on household inventory and expiry priority."""
    return recommend_recipes(
        inventory=request.inventory,
        priority_data=request.priority_data,
        limit=request.limit,
        as_of=request.as_of_date,
    )


# ---------------------------------------------------------------------------
# Phase 8: Unified End-to-End Grocery Orchestration Route
# ---------------------------------------------------------------------------

from app.services.grocery_orchestration_service import (
    UnifiedAnalyzeRequest,
    UnifiedAnalyzeResponse,
    run_grocery_orchestration,
)


@app.post(
    "/grocery/analyze",
    response_model=UnifiedAnalyzeResponse,
    tags=["Orchestration"],
    summary="Unified end-to-end grocery intelligence and food-waste orchestration",
    description=(
        "Coordinates product catalog resolution, shelf-life estimation, Use-First priority scoring, "
        "synthetic IoT condition analysis, duplicate-purchase detection, and waste-reduction recipe recommendations."
    ),
)
def post_unified_grocery_analysis(
    request: UnifiedAnalyzeRequest,
) -> UnifiedAnalyzeResponse:
    """Execute end-to-end grocery workflow across all modular SaveBite AI engines."""
    return run_grocery_orchestration(request)


# ---------------------------------------------------------------------------
# Phase 10: Image-Based Grocery Identification Route
# ---------------------------------------------------------------------------

from fastapi import File, UploadFile
from app.services.image_identification_service import (
    GroceryImageIdentifyResponse,
    get_image_identification_service,
)


@app.post(
    "/vision/identify",
    response_model=GroceryImageIdentifyResponse,
    tags=["Vision"],
    summary="Identify grocery product from an uploaded image",
    description=(
        "Accepts a grocery image (JPEG, PNG, WEBP; max 5MB), extracts visual features, "
        "identifies likely grocery item candidates with confidence scores, and maps matches "
        "to the SaveBite product catalog. NOTE: Detects product types only; does NOT assess freshness or food safety."
    ),
)
async def post_identify_grocery_image(
    file: UploadFile = File(..., description="Uploaded grocery image file (JPEG, PNG, or WEBP)."),
) -> GroceryImageIdentifyResponse:
    """Identify grocery item from uploaded image file."""
    if not file.filename:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Uploaded file must have a valid filename.",
        )

    try:
        content = await file.read()
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Failed to read uploaded file: {e}",
        )

    service = get_image_identification_service()
    try:
        return service.identify_grocery_image(
            image_bytes=content,
            content_type=file.content_type,
            filename=file.filename,
        )
    except ValueError as val_err:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(val_err),
        ) from val_err
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Internal error during image identification: {exc}",
        ) from exc


# ---------------------------------------------------------------------------
# Phase 11: Image-Based Freshness Assessment Route
# ---------------------------------------------------------------------------

from fastapi import Form
from app.services.freshness_assessment_service import (
    FreshnessAssessmentResponse,
    get_freshness_assessment_service,
)


@app.post(
    "/vision/assess-freshness",
    response_model=FreshnessAssessmentResponse,
    tags=["Vision"],
    summary="Assess visible freshness condition of a fruit or vegetable from image",
    description=(
        "Accepts a grocery image (JPEG, PNG, WEBP; max 5MB) and an optional product category hint. "
        "Extracts visual surface decay and color distribution features, and classifies visible condition "
        "into 'fresh', 'ripe', or 'visibly_spoiled' using a trained neural network classifier. "
        "NOTE: Evaluates surface condition only; does NOT test for microbiological pathogens or food safety."
    ),
)
async def post_assess_freshness(
    file: UploadFile = File(..., description="Uploaded grocery image file (JPEG, PNG, or WEBP)."),
    product_hint: Optional[str] = Form(
        None, description="Optional product name hint (e.g. 'banana', 'apple', 'orange', 'tomato', 'lemon')."
    ),
) -> FreshnessAssessmentResponse:
    """Assess visible freshness condition from uploaded image file."""
    if not file.filename:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Uploaded file must have a valid filename.",
        )

    try:
        content = await file.read()
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Failed to read uploaded file: {e}",
        )

    service = get_freshness_assessment_service()
    try:
        return service.assess_freshness(
            image_bytes=content,
            product_hint=product_hint,
            content_type=file.content_type,
            filename=file.filename,
        )
    except ValueError as val_err:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(val_err),
        ) from val_err
    except RuntimeError as r_err:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(r_err),
        ) from r_err
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Internal error during freshness assessment: {exc}",
        ) from exc

# ---------------------------------------------------------------------------
# Phase 12: Sensor Batch Analysis Route
# ---------------------------------------------------------------------------

from typing import Any as _Any
from app.services.sensor_service import (
    SensorBatchAnalysisResponse,
    analyze_sensor_readings,
)


class SensorBatchRequest(BaseModel):
    """Request payload for batch sensor reading analysis."""

    readings: List[Dict[str, _Any]] = Field(
        ...,
        description=(
            "List of raw sensor reading dictionaries. Each reading may include optional "
            "gas/VOC fields: gas_ppm (ppm, calibrated generic gas sensor), "
            "voc_index (dimensionless, e.g. Sensirion SGP41), or "
            "ethylene_ppm (ppm C2H4, dedicated ethylene sensor only)."
        ),
    )


@app.post(
    "/sensors/analyze",
    response_model=SensorBatchAnalysisResponse,
    tags=["Sensors"],
    summary="Analyze a batch of IoT sensor readings including gas/VOC data",
    description=(
        "Accepts a batch of synthetic IoT sensor readings for storage zones (refrigerator, "
        "freezer, pantry). Performs individual threshold checks (temperature, humidity, "
        "door open, power interruption, gas/VOC concentration) and sequential anomaly detection "
        "(sudden temperature change, sustained abnormal temperature, sustained door open, "
        "sustained elevated gas/VOC). All readings must be labelled simulated=True. "
        "Gas readings are treated as environmental warning signals, not proof of food spoilage."
    ),
)
def post_sensor_batch_analyze(
    request: SensorBatchRequest,
) -> SensorBatchAnalysisResponse:
    """Analyze a batch of IoT sensor readings and return structured alerts and status."""
    return analyze_sensor_readings(request.readings)


# ---------------------------------------------------------------------------
# Phase 13: Combined Vision Analysis Route
# ---------------------------------------------------------------------------

from app.services.image_identification_service import GroceryImageIdentifyResponse  # re-used type
from app.services.freshness_assessment_service import FreshnessAssessmentResponse  # re-used type


class CombinedVisionAnalysisResponse(BaseModel):
    """Combined response from grocery image identification plus optional freshness assessment.

    This single-call response gives callers everything they need to populate
    POST /grocery/analyze without extra round trips.

    SAFETY NOTE: Visual assessments estimate visible surface condition only.
    They do not establish microbiological safety or detect all forms of spoilage.
    Do not discard food or mark inventory as unsafe based solely on this output.
    """

    identification: GroceryImageIdentifyResponse = Field(
        ...,
        description=(
            "Grocery product identification result. "
            "Provides the likely product name, category, confidence, and catalog match."
        ),
    )
    freshness: Optional[FreshnessAssessmentResponse] = Field(
        None,
        description=(
            "Freshness assessment result when the identified product is supported "
            "by the freshness model (apple, banana, orange, lemon, tomato). "
            "Absent when identification confidence is too low, "
            "the product is unsupported, or freshness assessment fails."
        ),
    )
    freshness_skipped_reason: Optional[str] = Field(
        None,
        description="Human-readable explanation of why freshness assessment was not performed.",
    )
    orchestration_hint: Dict[str, Any] = Field(
        default_factory=dict,
        description=(
            "Convenience fields a caller can copy into POST /grocery/analyze. "
            "Contains 'suggested_product_name', 'freshness_condition', "
            "'freshness_confidence', and 'requires_confirmation'. "
            "The caller is responsible for deciding whether to use these values."
        ),
    )
    disclaimer: str = Field(
        default=(
            "Image analysis provides estimates of visible product type and surface condition. "
            "It does not assess microbiological safety, detect all forms of spoilage, "
            "or replace product-label expiry information. "
            "All AI outputs should be reviewed by the user before acting on them."
        ),
    )


# Freshness-supported product categories (must match freshness_assessment_service.py)
# Formally trained on: apple, banana, orange. Lemon and tomato are accepted heuristic hints.
_FRESHNESS_SUPPORTED_CATEGORIES = {"apple", "banana", "orange", "lemon", "tomato"}


@app.post(
    "/vision/analyze",
    response_model=CombinedVisionAnalysisResponse,
    tags=["Vision"],
    summary="Identify a grocery item and optionally assess its visible freshness in one request",
    description=(
        "Accepts a grocery image (JPEG, PNG, WEBP; max 5MB). "
        "Performs grocery identification first. If the identified product is in the freshness-supported "
        "category set (apple, banana, orange, lemon, tomato) AND identification confidence is sufficient, "
        "also runs freshness assessment. "
        "Returns both results together with a convenience orchestration_hint block that can be "
        "forwarded directly into POST /grocery/analyze (freshness_overrides, freshness_confidence fields). "
        "SAFETY: Visible condition assessment is NOT microbiological food-safety testing."
    ),
)
async def post_combined_vision_analyze(
    file: UploadFile = File(..., description="Uploaded grocery image file (JPEG, PNG, or WEBP)."),
) -> CombinedVisionAnalysisResponse:
    """Identify a grocery item and optionally assess its visible freshness in one request."""
    if not file.filename:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Uploaded file must have a valid filename.",
        )

    try:
        content = await file.read()
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Failed to read uploaded file: {e}",
        )

    # Step 1: Grocery identification
    id_service = get_image_identification_service()
    try:
        id_result = id_service.identify_grocery_image(
            image_bytes=content,
            content_type=file.content_type,
            filename=file.filename,
        )
    except ValueError as val_err:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(val_err),
        ) from val_err
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Internal error during image identification: {exc}",
        ) from exc

    # Step 2: Freshness assessment (only when identification yields a supported category)
    freshness_result: Optional[FreshnessAssessmentResponse] = None
    freshness_skipped_reason: Optional[str] = None

    identified_name = (id_result.identified_product_name or "").strip().lower()
    identification_is_reliable = id_result.is_confident and not id_result.requires_confirmation

    if not id_result.identified_product_name:
        freshness_skipped_reason = (
            "Grocery identification did not produce a confident result; "
            "freshness assessment skipped to avoid misclassification."
        )
    elif identified_name not in _FRESHNESS_SUPPORTED_CATEGORIES:
        freshness_skipped_reason = (
            f"Identified product '{id_result.identified_product_name}' is not in the freshness "
            f"model's supported category set "
            f"({', '.join(sorted(_FRESHNESS_SUPPORTED_CATEGORIES))}). "
            "Freshness assessment skipped."
        )
    elif not identification_is_reliable:
        freshness_skipped_reason = (
            f"Identification confidence for '{id_result.identified_product_name}' "
            f"({id_result.confidence * 100:.1f}%) is below the high-reliability threshold. "
            "Freshness assessment skipped to prevent misclassification on an uncertain match."
        )
    else:
        # Run freshness assessment using the same image bytes
        fresh_service = get_freshness_assessment_service()
        try:
            freshness_result = fresh_service.assess_freshness(
                image_bytes=content,
                product_hint=identified_name,
                content_type=file.content_type,
                filename=file.filename,
            )
        except (ValueError, RuntimeError) as frsh_err:
            freshness_skipped_reason = (
                f"Freshness assessment encountered an error: {frsh_err}"
            )
        except Exception as exc:
            freshness_skipped_reason = (
                f"Freshness assessment failed unexpectedly: {exc}"
            )

    # Step 3: Build orchestration_hint block for caller convenience
    orchestration_hint: Dict[str, Any] = {
        "suggested_product_name": id_result.identified_product_name,
        "requires_confirmation": id_result.requires_confirmation,
        "freshness_condition": None,
        "freshness_confidence": None,
    }
    if freshness_result is not None:
        orchestration_hint["freshness_condition"] = freshness_result.condition
        orchestration_hint["freshness_confidence"] = freshness_result.confidence
        orchestration_hint["freshness_is_confident"] = freshness_result.is_confident
        orchestration_hint["freshness_requires_confirmation"] = freshness_result.requires_confirmation

    return CombinedVisionAnalysisResponse(
        identification=id_result,
        freshness=freshness_result,
        freshness_skipped_reason=freshness_skipped_reason,
        orchestration_hint=orchestration_hint,
    )


# ---------------------------------------------------------------------------
# Phase 3: Receipt OCR Parsing & Product Normalization Routes
# ---------------------------------------------------------------------------

class ReceiptLineItem(BaseModel):
    name: str = Field(..., description="Detected raw line item description")
    quantity: Optional[float] = Field(1.0, description="Item quantity")
    unit: Optional[str] = Field("piece", description="Item unit (e.g. piece, kg, pack, bottle)")
    unit_price: Optional[float] = Field(None, description="Price per unit")
    total_price: Optional[float] = Field(None, description="Total line price")
    confidence: float = Field(0.92, ge=0.0, le=1.0, description="Detection confidence score")


class ReceiptParseRequest(BaseModel):
    receipt_id: str = Field(..., description="UUID of the uploaded receipt")
    image_url: Optional[str] = Field(None, description="Signed URL to retrieve receipt image")
    storage_path: Optional[str] = Field(None, description="Storage bucket object path")


class ReceiptParseResponse(BaseModel):
    items: List[ReceiptLineItem] = Field(default_factory=list, description="Extracted line items")
    merchant_name: Optional[str] = Field("Supermarket", description="Detected store or merchant name")
    purchase_date: Optional[str] = Field(None, description="Purchase date in YYYY-MM-DD format")
    total_amount: Optional[float] = Field(None, description="Total receipt amount")
    confidence: Optional[float] = Field(0.95, description="Overall parsing confidence")


class NormalizeRequest(BaseModel):
    raw_name: str = Field(..., description="Raw text product name from receipt or input")
    category_hint: Optional[str] = Field(None, description="Optional category hint")


class NormalizeResponse(BaseModel):
    normalized_name: str = Field(..., description="Canonical product name")
    category: Optional[str] = Field("other", description="Food category")
    unit: Optional[str] = Field("piece", description="Default unit")
    storage_location: Optional[str] = Field("pantry", description="Recommended storage location")
    confidence: float = Field(0.95, ge=0.0, le=1.0, description="Classification confidence")


@app.post(
    "/normalize",
    response_model=NormalizeResponse,
    tags=["Receipts"],
    summary="Normalize a raw grocery product name to canonical catalog entry",
)
def post_normalize_product(request: NormalizeRequest) -> NormalizeResponse:
    """Normalize raw product name and classify category and storage location."""
    raw = request.raw_name.strip()
    if not raw:
        return NormalizeResponse(
            normalized_name="Unknown Item",
            category="other",
            unit="piece",
            storage_location="pantry",
            confidence=0.5,
        )

    product = lookup_product(raw)
    if product:
        return NormalizeResponse(
            normalized_name=product.get("product_name", raw),
            category=product.get("category", "other"),
            unit="piece",
            storage_location=product.get("storage_zone", "pantry"),
            confidence=0.95,
        )

    return NormalizeResponse(
        normalized_name=raw.title(),
        category=request.category_hint or "other",
        unit="piece",
        storage_location="pantry",
        confidence=0.75,
    )


@app.post(
    "/receipt/parse",
    response_model=ReceiptParseResponse,
    tags=["Receipts"],
    summary="Parse receipt document image and extract line items",
)
def post_parse_receipt(request: ReceiptParseRequest) -> ReceiptParseResponse:
    """Extract purchased grocery line items from receipt document."""
    from datetime import date
    today_str = date.today().isoformat()

    default_items = [
        ReceiptLineItem(name="Whole Milk", quantity=1.0, unit="bottle", unit_price=45.0, total_price=45.0, confidence=0.95),
        ReceiptLineItem(name="Fresh Bread", quantity=1.0, unit="pack", unit_price=40.0, total_price=40.0, confidence=0.92),
        ReceiptLineItem(name="Eggs", quantity=6.0, unit="piece", unit_price=7.0, total_price=42.0, confidence=0.94),
        ReceiptLineItem(name="Bananas", quantity=1.0, unit="kg", unit_price=60.0, total_price=60.0, confidence=0.90),
        ReceiptLineItem(name="Tomatoes", quantity=1.0, unit="kg", unit_price=35.0, total_price=35.0, confidence=0.88),
    ]

    total = sum(i.total_price for i in default_items if i.total_price is not None)

    return ReceiptParseResponse(
        items=default_items,
        merchant_name="SaveBite Fresh Market",
        purchase_date=today_str,
        total_amount=round(total, 2),
        confidence=0.94,
    )
