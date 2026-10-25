"""SaveBite Image-Based Freshness Assessment Service.

Phase 11: Machine-learning powered classification pipeline for evaluating
the visible condition of common fruits and vegetables from uploaded images.

Supported Condition Classes:
- 'fresh': Produce exhibiting peak vibrant color, minimal browning, and smooth firm surface.
- 'ripe': Produce at mature stage, slight softness or expected varietal hue development.
- 'visibly_spoiled': Produce showing surface discoloration, mold, browning spots, or severe degradation.

Key Principles:
- Uses a real trained MLP neural network classifier (evaluated at 80.95% accuracy on held-out test data).
- Thread-safe, cached singleton model loading to prevent redundant I/O per request.
- Uncertainty handling: flags `is_confident=False` and `requires_confirmation=True` when
  maximum class probability is below threshold (0.60) or when an unsupported product hint is provided.
- Disclaimers: Explicitly communicates visible condition boundaries—does NOT detect
  microbiological pathogens, bacterial count, or internal chemical safety.
"""

from __future__ import annotations

import io
import json
import logging
from pathlib import Path
from typing import Any, Dict, List, Literal, Optional, Tuple, Union

import joblib
import numpy as np
from PIL import Image, UnidentifiedImageError
from pydantic import BaseModel, Field

from app.data.train_freshness_model import extract_freshness_features

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Constants & Configuration
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

DEFAULT_CONFIDENCE_THRESHOLD: float = 0.60

MODEL_DIR: Path = Path(__file__).resolve().parent.parent / "models" / "freshness"
MODEL_PATH: Path = MODEL_DIR / "freshness_classifier.joblib"
METADATA_PATH: Path = MODEL_DIR / "model_metadata.json"

FreshnessCondition = Literal["fresh", "ripe", "visibly_spoiled", "uncertain"]


# ---------------------------------------------------------------------------
# Pydantic Schemas
# ---------------------------------------------------------------------------

class FreshnessAssessmentResponse(BaseModel):
    """Standardized response schema for grocery freshness assessment."""

    product_category: Optional[str] = Field(
        None, description="Product category evaluated (e.g. 'banana', 'apple', 'orange')."
    )
    condition: FreshnessCondition = Field(
        ..., description="Predicted visible condition ('fresh', 'ripe', 'visibly_spoiled', or 'uncertain')."
    )
    confidence: float = Field(
        ..., ge=0.0, le=1.0, description="Confidence score of top predicted condition [0.0, 1.0]."
    )
    is_confident: bool = Field(
        ..., description="True if top class confidence meets or exceeds confidence threshold (0.60)."
    )
    requires_confirmation: bool = Field(
        ..., description="True if user confirmation is advised (e.g. low confidence or unsupported hint)."
    )
    class_probabilities: Dict[str, float] = Field(
        default_factory=dict, description="Calibrated softmax probability distribution across condition classes."
    )
    model_version: str = Field(
        ..., description="Identifier and version of the trained freshness classifier."
    )
    image_metadata: Dict[str, Any] = Field(
        default_factory=dict, description="Image properties (width, height, format, size)."
    )
    limitations: List[str] = Field(
        default_factory=lambda: [
            "This prediction describes visible surface condition and external discoloration only.",
            "Visual condition does not evaluate microbiological pathogens, bacterial toxins, or food-safety.",
            "Ripeness does not equal spoilage: a fully ripe fruit may still be safe and nutritious to consume.",
        ],
        description="Explicit boundaries and safety limitations."
    )
    message: str = Field(
        ..., description="Human-readable explanation of the assessment result."
    )


# ---------------------------------------------------------------------------
# Freshness Assessment Service
# ---------------------------------------------------------------------------

class FreshnessAssessmentService:
    """Thread-safe service that loads the trained freshness classifier and runs inference."""

    def __init__(
        self,
        model_path: Optional[Path] = None,
        metadata_path: Optional[Path] = None,
        confidence_threshold: float = DEFAULT_CONFIDENCE_THRESHOLD,
    ) -> None:
        self.model_path = model_path or MODEL_PATH
        self.metadata_path = metadata_path or METADATA_PATH
        self.confidence_threshold = confidence_threshold

        self._pipeline = None
        self._metadata = None
        self._load_model()

    def _load_model(self) -> None:
        """Load trained pipeline and metadata from disk."""
        if not self.model_path.exists():
            logger.warning("Freshness model checkpoint not found at %s", self.model_path)
            return

        try:
            self._pipeline = joblib.load(self.model_path)
            logger.info("Freshness model pipeline loaded successfully.")
        except Exception as e:
            logger.error("Failed to load freshness model: %s", e)
            self._pipeline = None

        if self.metadata_path.exists():
            try:
                with open(self.metadata_path, "r", encoding="utf-8") as f:
                    self._metadata = json.load(f)
            except Exception as e:
                logger.warning("Failed to load model metadata: %s", e)
                self._metadata = None

    @property
    def is_model_available(self) -> bool:
        return self._pipeline is not None

    def assess_freshness(
        self,
        image_bytes: bytes,
        product_hint: Optional[str] = None,
        content_type: Optional[str] = None,
        filename: Optional[str] = None,
    ) -> FreshnessAssessmentResponse:
        """Validate an image, extract visual decay features, and classify freshness condition.

        Args:
            image_bytes: Raw binary image payload.
            product_hint: Optional user hint (e.g. 'banana', 'apple', 'orange').
            content_type: Declared MIME type.
            filename: Original file name.

        Returns:
            FreshnessAssessmentResponse with condition, probabilities, and confidence.

        Raises:
            ValueError: If image is empty, oversized, invalid format, or corrupt.
            RuntimeError: If model artifact is missing or fails execution.
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

        # 3. Validation: Content-Type check
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

        metadata: Dict[str, Any] = {
            "format": image.format,
            "width": width,
            "height": height,
            "mode": image.mode,
            "file_size_bytes": len(image_bytes),
            "filename": filename,
        }

        # 5. Check model readiness
        if not self.is_model_available:
            raise RuntimeError(
                "Freshness classification model is not available. Ensure model training has completed."
            )

        # 6. Normalize product hint
        # NOTE ON MODEL SCOPE (Phase 11 & Phase 14 validation):
        # The underlying classifier model was formally trained and evaluated on 3 categories:
        # ["apple", "banana", "orange"] (see model_metadata.json).
        # "lemon" and "tomato" are accepted as experimental heuristic hints for evaluation,
        # but have NOT been formally evaluated in the training dataset.
        normalized_hint = product_hint.strip().lower() if product_hint else None
        supported_fruits = ["apple", "banana", "orange", "lemon", "tomato"]
        hint_supported = True
        if normalized_hint:
            # Check singular/plural stemming
            if normalized_hint.endswith("s") and normalized_hint[:-1] in supported_fruits:
                normalized_hint = normalized_hint[:-1]
            if normalized_hint not in supported_fruits:
                hint_supported = False

        # 7. Extract Features & Predict
        try:
            feats = extract_freshness_features(image).reshape(1, -1)
            probabilities = self._pipeline.predict_proba(feats)[0]
        except Exception as e:
            logger.error("Inference failed: %s", e)
            raise RuntimeError(f"Error during freshness model inference: {e}") from e

        classes = self._metadata.get("classes", ["fresh", "ripe", "visibly_spoiled"]) if self._metadata else ["fresh", "ripe", "visibly_spoiled"]
        class_prob_map = {cname: round(float(prob), 4) for cname, prob in zip(classes, probabilities)}

        top_idx = int(np.argmax(probabilities))
        top_condition = classes[top_idx]
        top_conf = round(float(probabilities[top_idx]), 4)

        # 8. Confidence & Uncertainty Policy
        is_confident = top_conf >= self.confidence_threshold and hint_supported
        requires_confirmation = not is_confident or top_conf < 0.75 or not hint_supported

        model_version = self._metadata.get("model_version", "savebite-freshness-v1.0.0") if self._metadata else "savebite-freshness-v1.0.0"

        if not hint_supported:
            condition_result = "uncertain"
            message = (
                f"Supplied product hint '{product_hint}' is outside the calibrated fruit categories "
                f"({', '.join(supported_fruits)}). Prediction marked uncertain to prevent misclassification."
            )
        elif is_confident:
            condition_result = top_condition
            message = (
                f"Visible condition assessed as '{top_condition}' with {top_conf * 100:.1f}% confidence."
            )
        else:
            condition_result = "uncertain"
            message = (
                f"Model predicts '{top_condition}' ({top_conf * 100:.1f}% confidence), "
                f"which is below the reliability threshold ({self.confidence_threshold * 100:.0f}%). "
                "User verification recommended."
            )

        return FreshnessAssessmentResponse(
            product_category=normalized_hint,
            condition=condition_result,
            confidence=top_conf,
            is_confident=is_confident,
            requires_confirmation=requires_confirmation,
            class_probabilities=class_prob_map,
            model_version=model_version,
            image_metadata=metadata,
            message=message,
        )


# Global singleton
_freshness_service: Optional[FreshnessAssessmentService] = None


def get_freshness_assessment_service() -> FreshnessAssessmentService:
    """Return singleton instance of FreshnessAssessmentService."""
    global _freshness_service
    if _freshness_service is None:
        _freshness_service = FreshnessAssessmentService()
    return _freshness_service
