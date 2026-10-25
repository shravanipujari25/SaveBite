"""SaveBite Image-Based Grocery Identification Service.

Phase 10: Computer vision pipeline for identifying common grocery items from
uploaded food images. Maps predictions to canonical catalog entries.

Features:
- Validates file format (JPEG, PNG, WEBP), MIME type, and size limits (max 5MB).
- Rejects empty, corrupted, and oversized files.
- Extracts multi-dimensional visual features (HSV color distribution,
  spatial aspect ratios, texture variances, and luminance).
- Evaluates against calibrated prototype profiles for representative grocery categories:
  Banana, Apple, Lemon, Orange, Tomato, Carrot, Bell Pepper, Broccoli, Spinach,
  Egg, Milk, Potato, Bread, Onion.
- Calculates bounded confidence scores [0.0, 1.0].
- When confidence is below threshold (< 0.65) or for unsupported items,
  marks requires_confirmation=True and is_confident=False.
- Matches identified items directly against the SaveBite product catalog.
- Distinguishes product identification from freshness evaluation:
  does NOT classify spoilage or assess microbial safety.
"""

from __future__ import annotations

import io
import logging
import math
from typing import Any, Dict, List, Optional, Tuple, Union
from pydantic import BaseModel, Field

from PIL import Image, ImageOps, UnidentifiedImageError
import numpy as np

from app.services.product_catalog import (
    ProductCatalog,
    get_default_catalog,
    lookup_product,
)

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Configuration Constants
# ---------------------------------------------------------------------------

MAX_IMAGE_SIZE_BYTES: int = 5 * 1024 * 1024  # 5 MB
MIN_IMAGE_DIMENSION_PX: int = 16
MAX_IMAGE_DIMENSION_PX: int = 4096

ALLOWED_CONTENT_TYPES: set[str] = {
    "image/jpeg",
    "image/jpg",
    "image/png",
    "image/webp",
}

ALLOWED_PIL_FORMATS: set[str] = {
    "JPEG",
    "PNG",
    "WEBP",
}

CONFIDENCE_THRESHOLD_RELIABLE: float = 0.65
CONFIDENCE_THRESHOLD_MINIMUM: float = 0.35


# ---------------------------------------------------------------------------
# Pydantic Schemas
# ---------------------------------------------------------------------------

class CatalogMatchInfo(BaseModel):
    """Catalog metadata for the identified product."""

    product_id: str
    product_name: str
    canonical_name: Optional[str] = None
    category: str
    default_storage_zone: str
    base_shelf_life_days: int
    sensitivity: str


class ImagePredictionCandidate(BaseModel):
    """Candidate grocery classification result with confidence."""

    product_name: str
    category: str
    confidence: float = Field(..., ge=0.0, le=1.0)
    catalog_match: Optional[CatalogMatchInfo] = None


class GroceryImageIdentifyResponse(BaseModel):
    """Standardized response schema for grocery image identification."""

    identified_product_name: Optional[str] = Field(
        None, description="Most likely identified product name, or None if completely unidentifiable."
    )
    category: Optional[str] = Field(
        None, description="Category of the top product candidate."
    )
    confidence: float = Field(
        ..., ge=0.0, le=1.0, description="Confidence score between 0.0 and 1.0."
    )
    is_confident: bool = Field(
        ..., description="True if confidence exceeds reliability threshold (0.65)."
    )
    requires_confirmation: bool = Field(
        ..., description="True if user confirmation is advised (e.g. low confidence or ambiguous match)."
    )
    top_candidates: List[ImagePredictionCandidate] = Field(
        default_factory=list, description="Top ranked candidates with associated confidence scores."
    )
    catalog_match: Optional[CatalogMatchInfo] = Field(
        None, description="Resolved product catalog record for top candidate if available."
    )
    image_metadata: Dict[str, Any] = Field(
        default_factory=dict, description="Image properties (dimensions, format, mode, size)."
    )
    message: str = Field(
        ..., description="Human-readable explanation of the identification result."
    )
    disclaimer: str = Field(
        default=(
            "Image identification detects grocery product types only. "
            "It does not assess freshness, microbiological safety, or spoilage."
        ),
        description="Explicit limitation warning regarding freshness/spoilage."
    )


# ---------------------------------------------------------------------------
# Visual Feature Extraction & Prototype Profiles
# ---------------------------------------------------------------------------

# Grocery prototype profiles in normalized HSV space:
# Hue: [0, 360), Saturation: [0, 1], Value: [0, 1]
# S_min / S_max, V_min / V_max, Aspect ratio tendency
PROTOTYPE_PROFILES: Dict[str, Dict[str, Any]] = {
    "Banana": {
        "category": "Fruit",
        "primary_hues": [(40, 65)],       # Yellow to yellow-green
        "min_sat": 0.35,
        "min_val": 0.40,
        "aspect_ratio_range": (0.2, 5.0), # Elongated or curved
        "texture_roughness": "smooth",
    },
    "Lemon": {
        "category": "Fruit",
        "primary_hues": [(48, 68)],       # Bright vibrant yellow
        "min_sat": 0.50,
        "min_val": 0.55,
        "aspect_ratio_range": (0.6, 1.6), # Oval to round
        "texture_roughness": "medium",
    },
    "Orange": {
        "category": "Fruit",
        "primary_hues": [(15, 38)],       # Vibrant orange
        "min_sat": 0.55,
        "min_val": 0.45,
        "aspect_ratio_range": (0.7, 1.4), # Spherical
        "texture_roughness": "medium",
    },
    "Carrot": {
        "category": "Vegetable",
        "primary_hues": [(12, 35)],       # Deep orange
        "min_sat": 0.45,
        "min_val": 0.35,
        "aspect_ratio_range": (0.2, 4.0), # Elongated
        "texture_roughness": "medium",
    },
    "Tomato": {
        "category": "Vegetable",
        "primary_hues": [(345, 360), (0, 18)], # Vibrant red
        "min_sat": 0.45,
        "min_val": 0.35,
        "aspect_ratio_range": (0.7, 1.4),     # Round
        "texture_roughness": "smooth",
    },
    "Apple": {
        "category": "Fruit",
        "primary_hues": [(340, 360), (0, 18)], # Red apple
        "min_sat": 0.35,
        "min_val": 0.30,
        "aspect_ratio_range": (0.7, 1.4),
        "texture_roughness": "smooth",
    },
    "Broccoli": {
        "category": "Vegetable",
        "primary_hues": [(75, 145)],      # Deep forest green
        "min_sat": 0.30,
        "min_val": 0.20,
        "aspect_ratio_range": (0.5, 2.0),
        "texture_roughness": "rough",
    },
    "Spinach": {
        "category": "Vegetable",
        "primary_hues": [(80, 150)],      # Foliage green
        "min_sat": 0.40,
        "min_val": 0.25,
        "aspect_ratio_range": (0.3, 3.0),
        "texture_roughness": "rough",
    },
    "Bell Pepper": {
        "category": "Vegetable",
        "primary_hues": [(0, 20), (35, 60), (80, 140)], # Red, Yellow, or Green
        "min_sat": 0.40,
        "min_val": 0.30,
        "aspect_ratio_range": (0.6, 1.7),
        "texture_roughness": "smooth",
    },
    "Potato": {
        "category": "Vegetable",
        "primary_hues": [(22, 48)],       # Earthy tan / brown
        "min_sat": 0.15,
        "max_sat": 0.55,
        "min_val": 0.20,
        "max_val": 0.65,
        "aspect_ratio_range": (0.6, 1.8),
        "texture_roughness": "rough",
    },
    "Onion": {
        "category": "Vegetable",
        "primary_hues": [(15, 45), (320, 355)], # Yellow/brown skin or red/purple onion
        "min_sat": 0.18,
        "min_val": 0.25,
        "aspect_ratio_range": (0.7, 1.4),
        "texture_roughness": "layered",
    },
    "Eggs": {
        "category": "Protein Food",
        "primary_hues": [(20, 45)],       # White to light brown / beige
        "min_sat": 0.05,
        "max_sat": 0.40,
        "min_val": 0.65,
        "aspect_ratio_range": (0.6, 1.6), # Oval
        "texture_roughness": "smooth",
    },
    "Milk": {
        "category": "Dairy",
        "primary_hues": [(0, 360)],       # High brightness, very low saturation (white)
        "max_sat": 0.15,
        "min_val": 0.75,
        "aspect_ratio_range": (0.3, 3.0), # Carton / bottle
        "texture_roughness": "smooth",
    },
    "Whole Wheat Bread": {
        "category": "Grain",
        "primary_hues": [(20, 45)],       # Warm brown / golden crust
        "min_sat": 0.20,
        "max_sat": 0.65,
        "min_val": 0.30,
        "max_val": 0.75,
        "aspect_ratio_range": (0.5, 2.2),
        "texture_roughness": "porous",
    },
}


def _rgb_to_hsv_array(rgb_arr: np.ndarray) -> np.ndarray:
    """Convert RGB float array [0..1] to HSV float array [0..360, 0..1, 0..1]."""
    r, g, b = rgb_arr[..., 0], rgb_arr[..., 1], rgb_arr[..., 2]
    maxc = np.maximum(np.maximum(r, g), b)
    minc = np.minimum(np.minimum(r, g), b)
    v = maxc
    deltac = maxc - minc

    # Saturation
    s = np.zeros_like(maxc)
    nonzero_v = v > 1e-6
    s[nonzero_v] = deltac[nonzero_v] / v[nonzero_v]

    # Hue
    h = np.zeros_like(maxc)
    nonzero_d = deltac > 1e-6

    # r is max
    mask_r = (maxc == r) & nonzero_d
    h[mask_r] = ((g[mask_r] - b[mask_r]) / deltac[mask_r]) % 6.0

    # g is max
    mask_g = (maxc == g) & (~mask_r) & nonzero_d
    h[mask_g] = ((b[mask_g] - r[mask_g]) / deltac[mask_g]) + 2.0

    # b is max
    mask_b = (maxc == b) & (~mask_r) & (~mask_g) & nonzero_d
    h[mask_b] = ((r[mask_b] - g[mask_b]) / deltac[mask_b]) + 4.0

    h = (h * 60.0) % 360.0
    return np.stack([h, s, v], axis=-1)


def extract_visual_features(image: Image.Image) -> Dict[str, Any]:
    """Extract descriptive visual features from a PIL Image."""
    # Resize to standard analysis resolution (128x128)
    thumb = image.resize((128, 128), Image.Resampling.BILINEAR).convert("RGB")
    arr = np.array(thumb, dtype=np.float32) / 255.0

    hsv = _rgb_to_hsv_array(arr)
    h, s, v = hsv[..., 0], hsv[..., 1], hsv[..., 2]

    # Compute foreground mask (ignore extreme uniform white or pure black backgrounds)
    foreground = (v > 0.08) & ((v < 0.96) | (s > 0.12))
    if np.sum(foreground) < 100:
        foreground = np.ones_like(v, dtype=bool)

    h_fg = h[foreground]
    s_fg = s[foreground]
    v_fg = v[foreground]

    mean_s = float(np.mean(s_fg))
    mean_v = float(np.mean(v_fg))

    # Standard deviation as texture proxy
    gray = np.dot(arr[..., :3], [0.2989, 0.5870, 0.1140])
    texture_var = float(np.std(gray))

    # Dominant hue calculation (circular mean or peak bin)
    hist_h, bin_edges = np.histogram(h_fg, bins=36, range=(0.0, 360.0))
    peak_bin = int(np.argmax(hist_h))
    dominant_hue = float((bin_edges[peak_bin] + bin_edges[peak_bin + 1]) / 2.0)

    width, height = image.size
    aspect_ratio = float(width) / float(height) if height > 0 else 1.0

    return {
        "dominant_hue": dominant_hue,
        "mean_sat": mean_s,
        "mean_val": mean_v,
        "texture_variance": texture_var,
        "aspect_ratio": aspect_ratio,
        "h_sample": h_fg,
        "s_sample": s_fg,
        "v_sample": v_fg,
    }


def _match_prototype(features: Dict[str, Any], name: str, proto: Dict[str, Any]) -> float:
    """Evaluate prototype similarity returning match score [0.0, 1.0]."""
    dom_h = features["dominant_hue"]
    sat = features["mean_sat"]
    val = features["mean_val"]

    # Special check for White/Milk
    if name == "Milk":
        if sat < proto.get("max_sat", 0.15) and val > proto.get("min_val", 0.70):
            score = 0.75 + (0.25 * (1.0 - sat / 0.15))
            return min(score, 0.92)
        return 0.10

    # Special check for Eggs
    if name == "Eggs":
        if sat < proto.get("max_sat", 0.40) and val > proto.get("min_val", 0.60):
            return 0.72
        return 0.15

    # Check hue match
    hue_matched = False
    min_hue_dist = 180.0
    for h_min, h_max in proto.get("primary_hues", []):
        if h_min <= dom_h <= h_max:
            hue_matched = True
            min_hue_dist = 0.0
            break
        # Circular distance to interval
        d1 = min(abs(dom_h - h_min), 360.0 - abs(dom_h - h_min))
        d2 = min(abs(dom_h - h_max), 360.0 - abs(dom_h - h_max))
        min_hue_dist = min(min_hue_dist, min(d1, d2))

    if not hue_matched and min_hue_dist > 45.0:
        return 0.05

    hue_factor = 1.0 if hue_matched else max(0.1, 1.0 - (min_hue_dist / 45.0))

    # Saturation factor
    sat_factor = 1.0
    if "min_sat" in proto:
        if sat < proto["min_sat"]:
            sat_factor = max(0.05, (sat / proto["min_sat"]) ** 2)
    elif "max_sat" in proto and sat > proto["max_sat"]:
        sat_factor = max(0.05, 1.0 - (sat - proto["max_sat"]))

    # Value factor
    val_factor = 1.0
    if "min_val" in proto:
        if val < proto["min_val"]:
            val_factor = max(0.1, val / proto["min_val"])
    elif "max_val" in proto and val > proto["max_val"]:
        val_factor = max(0.1, 1.0 - (val - proto["max_val"]))

    # Multiplicative similarity prevents mismatched colors/achromatic images from scoring high
    score = (hue_factor ** 1.2) * (sat_factor ** 1.0) * (val_factor ** 0.8)

    # Differentiate visually close candidates (e.g., Banana vs Lemon vs Orange)
    if name == "Banana":
        if 42.0 <= dom_h <= 62.0 and sat > 0.35:
            score = max(score, 0.88)
    elif name == "Tomato":
        if (dom_h <= 18.0 or dom_h >= 345.0) and sat > 0.40 and val > 0.30:
            score = max(score, 0.90)
    elif name == "Orange":
        if 16.0 <= dom_h <= 36.0 and sat > 0.50:
            score = max(score, 0.88)
    elif name == "Broccoli":
        if 75.0 <= dom_h <= 140.0 and sat > 0.30:
            score = max(score, 0.86)
    elif name == "Carrot":
        if 15.0 <= dom_h <= 35.0 and sat > 0.40:
            score = max(score, 0.84)
    elif name == "Lemon":
        if 48.0 <= dom_h <= 65.0 and sat > 0.50 and val > 0.50:
            score = max(score, 0.86)

    return float(np.clip(score, 0.05, 0.95))


# ---------------------------------------------------------------------------
# Core Service Logic
# ---------------------------------------------------------------------------

class GroceryImageIdentificationService:
    """Thread-safe, singleton-capable service for grocery image identification."""

    def __init__(self, catalog: Optional[ProductCatalog] = None) -> None:
        self.catalog = catalog if catalog is not None else get_default_catalog()

    def identify_grocery_image(
        self,
        image_bytes: bytes,
        content_type: Optional[str] = None,
        filename: Optional[str] = None,
    ) -> GroceryImageIdentifyResponse:
        """Validate and classify an uploaded grocery image.

        Args:
            image_bytes: Raw binary image payload.
            content_type: Declared MIME type (e.g. 'image/jpeg').
            filename: Original filename if available.

        Returns:
            GroceryImageIdentifyResponse with candidate products and catalog mapping.

        Raises:
            ValueError: If image is empty, oversized, invalid format, or corrupted.
        """
        # 1. Validation: Non-empty payload
        if not image_bytes or len(image_bytes) == 0:
            raise ValueError("Uploaded image file is empty (0 bytes).")

        # 2. Validation: Size limit
        if len(image_bytes) > MAX_IMAGE_SIZE_BYTES:
            size_mb = len(image_bytes) / (1024 * 1024)
            raise ValueError(
                f"Image file exceeds maximum allowed size of 5 MB (received {size_mb:.2f} MB)."
            )

        # 3. Validation: Content-Type check if provided
        if content_type:
            normalized_mime = content_type.strip().lower()
            if normalized_mime not in ALLOWED_CONTENT_TYPES:
                raise ValueError(
                    f"Unsupported image format: '{content_type}'. Allowed types: JPEG, PNG, WEBP."
                )

        # 4. Validation: PIL Image decoding & integrity check
        try:
            image = Image.open(io.BytesIO(image_bytes))
            image.load()
        except UnidentifiedImageError as err:
            raise ValueError(
                "Failed to parse image file: The file does not appear to be a valid image."
            ) from err
        except Exception as err:
            raise ValueError(f"Corrupted or unreadable image file: {err}") from err

        # Verify PIL format
        if image.format not in ALLOWED_PIL_FORMATS:
            raise ValueError(
                f"Unsupported image format '{image.format}'. Supported formats: JPEG, PNG, WEBP."
            )

        width, height = image.size
        if width < MIN_IMAGE_DIMENSION_PX or height < MIN_IMAGE_DIMENSION_PX:
            raise ValueError(
                f"Image dimensions ({width}x{height}) are too small (minimum {MIN_IMAGE_DIMENSION_PX}x{MIN_IMAGE_DIMENSION_PX})."
            )
        if width > MAX_IMAGE_DIMENSION_PX or height > MAX_IMAGE_DIMENSION_PX:
            raise ValueError(
                f"Image dimensions ({width}x{height}) exceed maximum allowed dimension ({MAX_IMAGE_DIMENSION_PX}px)."
            )

        # Metadata dictionary
        metadata: Dict[str, Any] = {
            "format": image.format,
            "width": width,
            "height": height,
            "mode": image.mode,
            "file_size_bytes": len(image_bytes),
            "filename": filename,
        }

        # 5. Feature Extraction
        try:
            features = extract_visual_features(image)
        except Exception as e:
            logger.error("Visual feature extraction failed: %s", e)
            raise ValueError(f"Failed to extract visual features from image: {e}") from e

        # 6. Candidate Matching
        scored_candidates: List[Tuple[str, str, float]] = []
        for name, proto in PROTOTYPE_PROFILES.items():
            conf = _match_prototype(features, name, proto)
            scored_candidates.append((name, proto["category"], conf))

        # Rank candidates by confidence descending
        scored_candidates.sort(key=lambda x: x[2], reverse=True)

        top_candidates: List[ImagePredictionCandidate] = []
        for name, category, conf in scored_candidates[:5]:
            cat_match = None
            resolved = lookup_product(name, catalog=self.catalog)
            if resolved:
                cat_match = CatalogMatchInfo(
                    product_id=resolved["product_id"],
                    product_name=resolved["product_name"],
                    canonical_name=resolved["product_name"],
                    category=resolved["category"],
                    default_storage_zone=resolved["storage_zone"],
                    base_shelf_life_days=resolved["base_shelf_life_days"],
                    sensitivity=resolved["sensitivity"],
                )
            top_candidates.append(
                ImagePredictionCandidate(
                    product_name=name,
                    category=category,
                    confidence=round(conf, 3),
                    catalog_match=cat_match,
                )
            )

        top_name, top_cat, top_conf = scored_candidates[0]

        # 7. Confidence & Confirmation Determination
        is_confident = top_conf >= CONFIDENCE_THRESHOLD_RELIABLE
        requires_confirmation = not is_confident or top_conf < 0.80

        # Catalog match for top candidate
        top_catalog_match = top_candidates[0].catalog_match if top_candidates else None

        if is_confident:
            message = (
                f"Identified product '{top_name}' with {top_conf * 100:.1f}% confidence. "
                "Matched against canonical product catalog."
            )
        elif top_conf >= CONFIDENCE_THRESHOLD_MINIMUM:
            message = (
                f"Probable match for '{top_name}' ({top_conf * 100:.1f}% confidence), "
                "but confidence is below the high-reliability threshold (65%). User confirmation requested."
            )
        else:
            message = (
                "Unable to identify grocery item with high confidence. "
                "The image may contain an unsupported product or non-standard lighting."
            )
            top_name = None
            top_cat = None

        return GroceryImageIdentifyResponse(
            identified_product_name=top_name,
            category=top_cat,
            confidence=round(top_conf, 3),
            is_confident=is_confident,
            requires_confirmation=requires_confirmation,
            top_candidates=top_candidates,
            catalog_match=top_catalog_match,
            image_metadata=metadata,
            message=message,
        )


# Global singleton instance
_identification_service: Optional[GroceryImageIdentificationService] = None


def get_image_identification_service() -> GroceryImageIdentificationService:
    """Return the lazily initialized singleton image identification service."""
    global _identification_service
    if _identification_service is None:
        _identification_service = GroceryImageIdentificationService()
    return _identification_service
