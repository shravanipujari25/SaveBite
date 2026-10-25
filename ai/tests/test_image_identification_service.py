"""Comprehensive automated test suite for Phase 10: Image-Based Grocery Identification.

Covers:
- Valid image uploads (JPEG, PNG, WEBP)
- High-confidence predictions and candidate generation
- Catalog mapping to canonical products (product_id, shelf life, storage zone)
- Low-confidence and unsupported product detection with user confirmation request
- Non-claim verification: explicitly confirms no freshness/spoilage claim
- Validation: rejection of empty files, corrupted images, unsupported MIME types
- Validation: rejection of oversized images (>5MB) and out-of-bounds dimensions
- FastAPI route testing via POST /vision/identify
- Regression verification: existing text entry, health, and /grocery/analyze untouched
"""

from __future__ import annotations

import io
from pathlib import Path
import sys
from typing import Tuple

# Ensure ai directory is on sys.path when pytest runs from ai/
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from fastapi.testclient import TestClient
from PIL import Image
import pytest

from app.main import app
from app.services.image_identification_service import (
    CONFIDENCE_THRESHOLD_RELIABLE,
    GroceryImageIdentificationService,
    GroceryImageIdentifyResponse,
    MAX_IMAGE_SIZE_BYTES,
    get_image_identification_service,
)
from app.services.product_catalog import get_default_catalog


# ---------------------------------------------------------------------------
# Test Helpers & Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture(scope="module")
def client() -> TestClient:
    return TestClient(app)


@pytest.fixture(scope="module")
def service() -> GroceryImageIdentificationService:
    return get_image_identification_service()


def create_test_image_bytes(
    color: Tuple[int, int, int] = (220, 20, 30),
    size: Tuple[int, int] = (100, 100),
    image_format: str = "JPEG",
) -> bytes:
    """Helper to synthesize test image bytes in memory."""
    im = Image.new("RGB", size, color)
    buf = io.BytesIO()
    im.save(buf, format=image_format)
    return buf.getvalue()


# ---------------------------------------------------------------------------
# 1. Service Layer Tests: Feature Extraction & Classification
# ---------------------------------------------------------------------------

def test_high_confidence_tomato_identification(service):
    """Test that a vibrant red image identifies as Tomato with high confidence and catalog mapping."""
    img_bytes = create_test_image_bytes(color=(225, 25, 25), image_format="JPEG")
    res = service.identify_grocery_image(img_bytes, content_type="image/jpeg", filename="tomato.jpg")

    assert isinstance(res, GroceryImageIdentifyResponse)
    assert res.identified_product_name == "Tomato"
    assert res.category == "Vegetable"
    assert res.confidence >= CONFIDENCE_THRESHOLD_RELIABLE
    assert res.is_confident is True
    assert res.catalog_match is not None
    assert res.catalog_match.product_id == "GRC008"
    assert res.catalog_match.canonical_name == "Tomato"
    assert res.catalog_match.default_storage_zone == "pantry"
    assert "freshness" in res.disclaimer.lower()


def test_high_confidence_banana_identification(service):
    """Test that a yellow image identifies as Banana with high confidence."""
    img_bytes = create_test_image_bytes(color=(245, 215, 30), image_format="PNG")
    res = service.identify_grocery_image(img_bytes, content_type="image/png", filename="banana.png")

    assert res.identified_product_name == "Banana"
    assert res.category == "Fruit"
    assert res.confidence >= CONFIDENCE_THRESHOLD_RELIABLE
    assert res.is_confident is True
    assert res.catalog_match is not None
    assert res.catalog_match.product_id == "GRC002"


def test_high_confidence_broccoli_identification(service):
    """Test that a green image identifies as Broccoli with high confidence."""
    img_bytes = create_test_image_bytes(color=(35, 115, 45), image_format="JPEG")
    res = service.identify_grocery_image(img_bytes, content_type="image/jpeg", filename="broccoli.jpg")

    assert res.identified_product_name == "Broccoli"
    assert res.category == "Vegetable"
    assert res.confidence >= CONFIDENCE_THRESHOLD_RELIABLE
    assert res.is_confident is True
    assert res.catalog_match is not None
    assert res.catalog_match.product_id == "GRC013"


def test_high_confidence_milk_identification(service):
    """Test that an achromatic high-value white image identifies as Milk."""
    img_bytes = create_test_image_bytes(color=(245, 245, 245), image_format="WEBP")
    res = service.identify_grocery_image(img_bytes, content_type="image/webp", filename="milk.webp")

    assert res.identified_product_name == "Milk"
    assert res.category == "Dairy"
    assert res.confidence >= CONFIDENCE_THRESHOLD_RELIABLE
    assert res.catalog_match is not None
    assert res.catalog_match.product_id == "GRC016"


def test_low_confidence_unsupported_gray_image(service):
    """Test that an ambiguous or unsupported gray image requests user confirmation."""
    img_bytes = create_test_image_bytes(color=(80, 80, 80), image_format="JPEG")
    res = service.identify_grocery_image(img_bytes, content_type="image/jpeg", filename="random_gray.jpg")

    assert res.confidence < CONFIDENCE_THRESHOLD_RELIABLE
    assert res.is_confident is False
    assert res.requires_confirmation is True
    assert "user confirmation" in res.message.lower() or "unable" in res.message.lower()


def test_top_candidates_structure_and_ranking(service):
    """Test that top candidates are sorted descending by confidence."""
    img_bytes = create_test_image_bytes(color=(240, 120, 20), image_format="JPEG")
    res = service.identify_grocery_image(img_bytes, content_type="image/jpeg")

    assert len(res.top_candidates) >= 3
    # Confidences must be non-increasing
    confidences = [c.confidence for c in res.top_candidates]
    assert confidences == sorted(confidences, reverse=True)


# ---------------------------------------------------------------------------
# 2. Validation & Edge Cases
# ---------------------------------------------------------------------------

def test_empty_file_rejected(service):
    """Test that an empty byte array raises ValueError."""
    with pytest.raises(ValueError, match="empty"):
        service.identify_grocery_image(b"", content_type="image/jpeg")


def test_unsupported_content_type_rejected(service):
    """Test that unsupported MIME type (e.g. PDF or GIF) is rejected."""
    img_bytes = create_test_image_bytes()
    with pytest.raises(ValueError, match="Unsupported image format"):
        service.identify_grocery_image(img_bytes, content_type="application/pdf")


def test_corrupted_image_rejected(service):
    """Test that corrupted non-image binary data is rejected."""
    corrupted_data = b"NOT_AN_IMAGE_HEADER_RANDOM_GARBAGE_BYTES_12345"
    with pytest.raises(ValueError, match="Failed to parse image file"):
        service.identify_grocery_image(corrupted_data, content_type="image/jpeg")


def test_oversized_image_rejected(service):
    """Test that image exceeding 5MB is rejected."""
    oversized_bytes = b"0" * (MAX_IMAGE_SIZE_BYTES + 1024)
    with pytest.raises(ValueError, match="exceeds maximum allowed size"):
        service.identify_grocery_image(oversized_bytes, content_type="image/jpeg")


def test_too_small_dimensions_rejected(service):
    """Test that images smaller than 16x16 are rejected."""
    tiny_bytes = create_test_image_bytes(size=(8, 8))
    with pytest.raises(ValueError, match="too small"):
        service.identify_grocery_image(tiny_bytes, content_type="image/jpeg")


# ---------------------------------------------------------------------------
# 3. FastAPI Endpoint Tests (POST /vision/identify)
# ---------------------------------------------------------------------------

def test_api_vision_identify_success(client):
    """Test POST /vision/identify with valid JPEG multipart file."""
    img_bytes = create_test_image_bytes(color=(230, 30, 20), image_format="JPEG")
    response = client.post(
        "/vision/identify",
        files={"file": ("test_tomato.jpg", img_bytes, "image/jpeg")},
    )

    assert response.status_code == 200
    data = response.json()
    assert data["identified_product_name"] == "Tomato"
    assert data["is_confident"] is True
    assert data["catalog_match"]["product_id"] == "GRC008"
    assert data["catalog_match"]["category"] == "Vegetable"
    assert "freshness" in data["disclaimer"].lower()


def test_api_vision_identify_png_success(client):
    """Test POST /vision/identify with PNG multipart file."""
    img_bytes = create_test_image_bytes(color=(245, 215, 30), image_format="PNG")
    response = client.post(
        "/vision/identify",
        files={"file": ("test_banana.png", img_bytes, "image/png")},
    )

    assert response.status_code == 200
    data = response.json()
    assert data["identified_product_name"] == "Banana"
    assert data["catalog_match"]["product_id"] == "GRC002"


def test_api_vision_identify_empty_file_error(client):
    """Test POST /vision/identify with empty file returns 400 Bad Request."""
    response = client.post(
        "/vision/identify",
        files={"file": ("empty.jpg", b"", "image/jpeg")},
    )

    assert response.status_code == 400
    assert "empty" in response.json()["detail"].lower()


def test_api_vision_identify_invalid_format_error(client):
    """Test POST /vision/identify with unsupported MIME returns 400 Bad Request."""
    img_bytes = create_test_image_bytes()
    response = client.post(
        "/vision/identify",
        files={"file": ("document.pdf", img_bytes, "application/pdf")},
    )

    assert response.status_code == 400
    assert "unsupported" in response.json()["detail"].lower()


def test_api_vision_identify_corrupted_file_error(client):
    """Test POST /vision/identify with corrupted image data returns 400 Bad Request."""
    response = client.post(
        "/vision/identify",
        files={"file": ("broken.jpg", b"INVALID_BYTES_NOT_AN_IMAGE", "image/jpeg")},
    )

    assert response.status_code == 400
    assert "failed to parse image" in response.json()["detail"].lower()


# ---------------------------------------------------------------------------
# 4. Regression Tests: Preserve Existing Text-Based Workflows
# ---------------------------------------------------------------------------

def test_regression_health_endpoint(client):
    """Ensure GET /health continues to return healthy status."""
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json()["status"] == "healthy"


def test_regression_product_lookup(client):
    """Ensure existing product lookup works without regression."""
    response = client.get("/products/tomato")
    assert response.status_code == 200
    assert response.json()["product_id"] == "GRC008"


def test_regression_grocery_analyze_endpoint(client):
    """Ensure unified orchestration POST /grocery/analyze remains intact."""
    payload = {
        "inventory": [
            {
                "inventory_item_id": "INV-101",
                "product_name": "Tomato",
                "quantity": 2.0,
                "unit": "unit",
                "status": "available",
            }
        ],
        "include_recipes": False,
    }
    response = client.post("/grocery/analyze", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert data["overall_status"] == "completed"
    assert data["inventory_summary"]["total_items"] == 1
    assert data["product_resolutions"][0]["canonical_name"] == "Tomato"
