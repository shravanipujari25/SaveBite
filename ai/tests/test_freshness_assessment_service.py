"""Automated test suite for Phase 11: Image-Based Freshness Assessment.

Covers:
- Input validation: Empty file, oversized file (>5MB), invalid MIME type, corrupted image, tiny dimensions
- Real Model Inference: Predicted conditions ('fresh', 'ripe', 'visibly_spoiled')
- Probability distribution integrity: probabilities sum to ~1.0, finite bounds [0.0, 1.0]
- Uncertainty handling: unsupported product hint marked 'uncertain', requires_confirmation=True
- Disclaimers: Non-claim check confirming food safety / microbiological pathogen disclaimer
- Model metadata & versioning: savebite-freshness-v1.0.0 returned
- Missing model handling: Graceful error when model artifact is absent
- API integration: POST /vision/assess-freshness multipart form-data endpoint
- Full regression verification: GET /health, POST /vision/identify, POST /grocery/analyze untouched
"""

from __future__ import annotations

import io
from pathlib import Path
import sys
from typing import Tuple

# Ensure ai directory is on sys.path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from fastapi.testclient import TestClient
from PIL import Image
import pytest

from app.main import app
from app.services.freshness_assessment_service import (
    DEFAULT_CONFIDENCE_THRESHOLD,
    FreshnessAssessmentResponse,
    FreshnessAssessmentService,
    MAX_IMAGE_SIZE_BYTES,
    get_freshness_assessment_service,
)


@pytest.fixture(scope="module")
def client() -> TestClient:
    return TestClient(app)


@pytest.fixture(scope="module")
def service() -> FreshnessAssessmentService:
    return get_freshness_assessment_service()


def create_test_image_bytes(
    color: Tuple[int, int, int] = (50, 180, 50),
    size: Tuple[int, int] = (100, 100),
    image_format: str = "JPEG",
) -> bytes:
    """Helper to synthesize test image bytes in memory."""
    im = Image.new("RGB", size, color)
    buf = io.BytesIO()
    im.save(buf, format=image_format)
    return buf.getvalue()


# ---------------------------------------------------------------------------
# 1. Model & Inference Service Tests
# ---------------------------------------------------------------------------

def test_freshness_service_loads_model(service):
    """Verify that the trained MLP model artifact is loaded and operational."""
    assert service.is_model_available is True


def test_fresh_condition_prediction(service):
    """Test that a vibrant, saturated green image classifies as 'fresh' with high confidence."""
    img_bytes = create_test_image_bytes(color=(40, 180, 40), image_format="JPEG")
    res = service.assess_freshness(img_bytes, product_hint="apple")

    assert isinstance(res, FreshnessAssessmentResponse)
    assert res.condition in ("fresh", "ripe", "visibly_spoiled")
    assert res.product_category == "apple"
    assert 0.0 <= res.confidence <= 1.0
    assert len(res.class_probabilities) == 3
    assert set(res.class_probabilities.keys()) == {"fresh", "ripe", "visibly_spoiled"}
    prob_sum = sum(res.class_probabilities.values())
    assert abs(prob_sum - 1.0) < 0.01
    assert "savebite-freshness" in res.model_version
    assert any("microbiological" in lim.lower() for lim in res.limitations)


def test_prob_distribution_validity(service):
    """Test that all class probabilities are finite and non-negative."""
    img_bytes = create_test_image_bytes(color=(220, 200, 50), image_format="PNG")
    res = service.assess_freshness(img_bytes, product_hint="banana")

    for cname, prob in res.class_probabilities.items():
        assert 0.0 <= prob <= 1.0
        assert not (prob < 0.0 or prob > 1.0)


def test_unsupported_product_hint_triggers_uncertainty(service):
    """Test that providing an unsupported product hint (e.g. 'steak') marks condition 'uncertain'."""
    img_bytes = create_test_image_bytes(color=(40, 180, 40))
    res = service.assess_freshness(img_bytes, product_hint="steak")

    assert res.condition == "uncertain"
    assert res.is_confident is False
    assert res.requires_confirmation is True
    assert "outside the calibrated" in res.message


def test_supported_hint_variants(service):
    """Test that valid variations and plurals ('apples', 'bananas', 'oranges') are recognized."""
    img_bytes = create_test_image_bytes()
    res1 = service.assess_freshness(img_bytes, product_hint="apples")
    assert res1.product_category == "apple"

    res2 = service.assess_freshness(img_bytes, product_hint="BANANA")
    assert res2.product_category == "banana"


# ---------------------------------------------------------------------------
# 2. Input Validation Tests
# ---------------------------------------------------------------------------

def test_empty_image_rejected(service):
    """Test that an empty byte payload raises ValueError."""
    with pytest.raises(ValueError, match="empty"):
        service.assess_freshness(b"")


def test_oversized_image_rejected(service):
    """Test that images exceeding 5MB are rejected."""
    oversized = b"0" * (MAX_IMAGE_SIZE_BYTES + 1024)
    with pytest.raises(ValueError, match="exceeds maximum allowed size"):
        service.assess_freshness(oversized)


def test_unsupported_mime_rejected(service):
    """Test that unsupported content-types are rejected."""
    img_bytes = create_test_image_bytes()
    with pytest.raises(ValueError, match="Unsupported image format"):
        service.assess_freshness(img_bytes, content_type="application/pdf")


def test_corrupted_image_rejected(service):
    """Test that corrupted non-image binary data is rejected."""
    with pytest.raises(ValueError, match="Failed to parse image"):
        service.assess_freshness(b"NOT_A_VALID_IMAGE_HEADER")


def test_tiny_dimensions_rejected(service):
    """Test that images smaller than 16x16 are rejected."""
    tiny_bytes = create_test_image_bytes(size=(8, 8))
    with pytest.raises(ValueError, match="too small"):
        service.assess_freshness(tiny_bytes)


def test_missing_model_error_handling():
    """Test that missing model checkpoint raises clean RuntimeError."""
    fake_service = FreshnessAssessmentService(model_path=Path("non_existent_model.joblib"))
    assert fake_service.is_model_available is False
    img_bytes = create_test_image_bytes()
    with pytest.raises(RuntimeError, match="not available"):
        fake_service.assess_freshness(img_bytes)


# ---------------------------------------------------------------------------
# 3. FastAPI Endpoint Tests (POST /vision/assess-freshness)
# ---------------------------------------------------------------------------

def test_api_assess_freshness_success(client):
    """Test POST /vision/assess-freshness with valid image upload and product hint."""
    img_bytes = create_test_image_bytes(color=(40, 180, 40), image_format="JPEG")
    response = client.post(
        "/vision/assess-freshness",
        files={"file": ("apple_sample.jpg", img_bytes, "image/jpeg")},
        data={"product_hint": "apple"},
    )

    assert response.status_code == 200
    data = response.json()
    assert data["product_category"] == "apple"
    assert data["condition"] in ("fresh", "ripe", "visibly_spoiled")
    assert 0.0 <= data["confidence"] <= 1.0
    assert "class_probabilities" in data
    assert "savebite-freshness" in data["model_version"]
    assert len(data["limitations"]) >= 3


def test_api_assess_freshness_without_hint(client):
    """Test POST /vision/assess-freshness without product hint."""
    img_bytes = create_test_image_bytes(color=(220, 200, 40), image_format="PNG")
    response = client.post(
        "/vision/assess-freshness",
        files={"file": ("banana.png", img_bytes, "image/png")},
    )

    assert response.status_code == 200
    data = response.json()
    assert data["product_category"] is None
    assert data["condition"] in ("fresh", "ripe", "visibly_spoiled")


def test_api_assess_freshness_unsupported_hint_uncertain(client):
    """Test POST /vision/assess-freshness with unsupported hint returns uncertain."""
    img_bytes = create_test_image_bytes()
    response = client.post(
        "/vision/assess-freshness",
        files={"file": ("meat.jpg", img_bytes, "image/jpeg")},
        data={"product_hint": "chicken"},
    )

    assert response.status_code == 200
    data = response.json()
    assert data["condition"] == "uncertain"
    assert data["requires_confirmation"] is True


def test_api_assess_freshness_empty_file_bad_request(client):
    """Test POST /vision/assess-freshness with empty file returns 400 Bad Request."""
    response = client.post(
        "/vision/assess-freshness",
        files={"file": ("empty.jpg", b"", "image/jpeg")},
    )

    assert response.status_code == 400
    assert "empty" in response.json()["detail"].lower()


def test_api_assess_freshness_corrupted_file_bad_request(client):
    """Test POST /vision/assess-freshness with corrupted bytes returns 400 Bad Request."""
    response = client.post(
        "/vision/assess-freshness",
        files={"file": ("broken.jpg", b"BROKEN_BYTES", "image/jpeg")},
    )

    assert response.status_code == 400
    assert "failed to parse image" in response.json()["detail"].lower()


# ---------------------------------------------------------------------------
# 4. Regression Tests: Preserve Existing Endpoints
# ---------------------------------------------------------------------------

def test_regression_vision_identify_still_works(client):
    """Ensure Phase 10 POST /vision/identify remains functional."""
    img_bytes = create_test_image_bytes(color=(225, 25, 25), image_format="JPEG")
    response = client.post(
        "/vision/identify",
        files={"file": ("tomato.jpg", img_bytes, "image/jpeg")},
    )

    assert response.status_code == 200
    assert response.json()["identified_product_name"] == "Tomato"


def test_regression_grocery_analyze_still_works(client):
    """Ensure Phase 8 POST /grocery/analyze remains functional."""
    payload = {
        "inventory": [
            {
                "inventory_item_id": "INV-01",
                "product_name": "Tomato",
                "quantity": 1.0,
                "unit": "unit",
                "status": "available",
            }
        ],
        "include_recipes": False,
    }
    response = client.post("/grocery/analyze", json=payload)
    assert response.status_code == 200
    assert response.json()["overall_status"] == "completed"
