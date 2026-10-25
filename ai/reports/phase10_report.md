# Phase 10: Image-Based Grocery Identification Report

**Date:** 2026-10-25  
**Project:** SaveBite AI — Grocery Intelligence and Food-Waste Management System  
**Module:** `ai/`  
**Verdict:** **PASS**

---

## 1. Executive Summary

Phase 10 implements the **Image-Based Grocery Identification Service** within the SaveBite AI subsystem. This service provides a fast, deterministic, explainable computer vision pipeline capable of classifying common grocery items from user-uploaded images and automatically resolving them against the canonical SaveBite grocery product catalog (`app/data/products.csv`).

Key architectural principles maintained during Phase 10:
- **Preserved Existing Text Entry:** Traditional text-based inventory input and the master orchestration endpoint (`POST /grocery/analyze`) remain completely operational without schema mutations.
- **Strict Separation of Identification vs. Freshness:** Image identification solely classifies product type; it explicitly issues a disclaimer that it does **not** assess food spoilage, microbiological status, or pathogen presence.
- **Honest Model Representation:** The service utilizes an explainable multi-dimensional feature extraction and prototype matching pipeline (color space histograms, aspect ratios, luminance, and texture variance) rather than falsely claiming a newly trained deep learning model.
- **Safe Confidence Thresholds:** High-confidence detections ($\ge 0.65$) are matched to catalog records; low-confidence ($< 0.65$) or unsupported items return `is_confident: false` and `requires_confirmation: true`, requesting user validation rather than hallucinating an identity.

---

## 2. Baseline & Test Results

| Stage | Command Executed | Tests Collected | Passed | Failed | Warnings | Status |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Pre-Phase 10 Baseline** | `pytest -v` | 216 | 216 | 0 | 1 | PASS |
| **Phase 10 Focused Suite** | `pytest tests/test_image_identification_service.py -v` | 19 | 19 | 0 | 1 | PASS |
| **Full Regression (Phases 1–10)**| `pytest -v` | 235 | 235 | 0 | 1 | PASS |

*Note on warning: Starlette/httpx testclient deprecation notice standard in FastAPI testing environments.*

---

## 3. Files Created and Modified

### Files Created
1. `app/services/image_identification_service.py` — Visual feature extraction, prototype matching, candidate ranking, catalog resolution, and Pydantic schemas (`GroceryImageIdentifyResponse`, `ImagePredictionCandidate`, `CatalogMatchInfo`).
2. `tests/test_image_identification_service.py` — Automated integration tests covering high-confidence matching, candidate ranking, validation rejections (empty, corrupted, oversized, tiny dimensions, invalid MIME), FastAPI endpoint testing, and regression safety.
3. `reports/phase10_report.md` — This report.

### Files Modified
1. `app/main.py` — Added `POST /vision/identify` multipart form-data endpoint with file validation and status mapping.
2. `requirements.txt` — Added `pillow>=10.0.0` and `python-multipart>=0.0.9`.

*Confirmation: Zero files outside `ai/` were modified.*

---

## 4. Architecture & Vision Pipeline

```
+---------------------------------------------------------------------------------------------+
|                                    POST /vision/identify                                    |
|                       (multipart/form-data: file: UploadFile)                              |
+---------------------------------------------------------------------------------------------+
                                              |
                                              v
+---------------------------------------------------------------------------------------------+
|                                File Validation & Decoding                                   |
|       - File presence & non-empty (>0 bytes)                                                |
|       - Max file size limit: 5 MB                                                           |
|       - Allowed formats: JPEG, PNG, WEBP                                                    |
|       - Allowed dimensions: 16x16 px to 4096x4096 px                                        |
|       - Integrity check: PIL Image.open() & image.load()                                    |
+---------------------------------------------------------------------------------------------+
                                              |
                                              v
+---------------------------------------------------------------------------------------------+
|                                Feature Extraction Engine                                    |
|       - Standardized spatial downsampling (128x128 bilinear)                                |
|       - Normalized RGB -> HSV transformation                                                |
|       - Foreground mask extraction (background luminance/saturation filtering)             |
|       - Dominant hue angle (circular histogram peak)                                        |
|       - Mean saturation and value                                                           |
|       - Grayscale standard deviation (texture variance)                                     |
|       - Bounding aspect ratio                                                               |
+---------------------------------------------------------------------------------------------+
                                              |
                                              v
+---------------------------------------------------------------------------------------------+
|                                Calibrated Prototype Matching                                |
|       - Multiplicative similarity across Hue, Saturation, Value, and Aspect Ratio           |
|       - Achromatic filtering (distinguishes milk/eggs from colorful produce)               |
|       - Candidate ranking across 14 supported grocery staples                               |
+---------------------------------------------------------------------------------------------+
                                              |
                                              v
+---------------------------------------------------------------------------------------------+
|                                  Catalog Resolution & Output                                |
|       - Resolves top candidates via lookup_product() (Phase 2 catalog)                      |
|       - High Confidence (>= 0.65): is_confident=True, catalog_match populated               |
|       - Low Confidence (< 0.65): requires_confirmation=True, prompts user confirmation       |
|       - Safety Disclaimer: confirms no freshness/safety assessment performed                |
+---------------------------------------------------------------------------------------------+
```

---

## 5. Supported Grocery Staples & Calibrated Profiles

The vision pipeline includes calibrated baseline profiles for common grocery items:
1. **Produce - Fruits:**
   - **Banana:** Yellow/yellow-green hues, high saturation, elongated aspect ratio.
   - **Lemon:** Bright yellow hue, high saturation/value, oval shape.
   - **Orange:** Vibrant orange hue, spherical profile.
   - **Apple:** Red hues, smooth surface, spherical profile.
2. **Produce - Vegetables:**
   - **Tomato:** Red hues, high saturation/value, spherical profile.
   - **Carrot:** Deep orange, elongated profile.
   - **Broccoli:** Forest green hues, rough texture.
   - **Spinach:** Foliage green hues, layered foliage texture.
   - **Bell Pepper:** Multi-color support (red, yellow, green).
   - **Potato:** Earthy tan/brown hues, moderate saturation.
   - **Onion:** Yellow/brown skin and red/purple onion profiles.
3. **Dairy & Protein Staples:**
   - **Milk:** High value, very low saturation (achromatic white).
   - **Eggs:** High value, beige/white hues, oval aspect ratio.
   - **Whole Wheat Bread:** Golden-brown hues, porous texture variance.

---

## 6. API Endpoint Specifications

### Endpoint Definition
- **Route:** `POST /vision/identify`
- **Content-Type:** `multipart/form-data`
- **Form Field:** `file` (UploadFile)

### Example Response (High Confidence)
```json
{
  "identified_product_name": "Tomato",
  "category": "Vegetable",
  "confidence": 0.95,
  "is_confident": true,
  "requires_confirmation": false,
  "top_candidates": [
    {
      "product_name": "Tomato",
      "category": "Vegetable",
      "confidence": 0.95,
      "catalog_match": {
        "product_id": "GRC008",
        "product_name": "Tomato",
        "canonical_name": "Tomato",
        "category": "Vegetable",
        "default_storage_zone": "pantry",
        "base_shelf_life_days": 7,
        "sensitivity": "medium"
      }
    },
    {
      "product_name": "Apple",
      "category": "Fruit",
      "confidence": 0.58,
      "catalog_match": {
        "product_id": "GRC001",
        "product_name": "Apple",
        "canonical_name": "Apple",
        "category": "Fruit",
        "default_storage_zone": "refrigerator",
        "base_shelf_life_days": 30,
        "sensitivity": "low"
      }
    }
  ],
  "catalog_match": {
    "product_id": "GRC008",
    "product_name": "Tomato",
    "canonical_name": "Tomato",
    "category": "Vegetable",
    "default_storage_zone": "pantry",
    "base_shelf_life_days": 7,
    "sensitivity": "medium"
  },
  "image_metadata": {
    "format": "JPEG",
    "width": 640,
    "height": 480,
    "mode": "RGB",
    "file_size_bytes": 48210,
    "filename": "tomato_sample.jpg"
  },
  "message": "Identified product 'Tomato' with 95.0% confidence. Matched against canonical product catalog.",
  "disclaimer": "Image identification detects grocery product types only. It does not assess freshness, microbiological safety, or spoilage."
}
```

### Example Response (Low Confidence / Unsupported Item)
```json
{
  "identified_product_name": null,
  "category": null,
  "confidence": 0.15,
  "is_confident": false,
  "requires_confirmation": true,
  "top_candidates": [
    {
      "product_name": "Apple",
      "category": "Fruit",
      "confidence": 0.15,
      "catalog_match": { ... }
    }
  ],
  "catalog_match": null,
  "image_metadata": {
    "format": "JPEG",
    "width": 100,
    "height": 100,
    "mode": "RGB",
    "file_size_bytes": 1024,
    "filename": "unknown_item.jpg"
  },
  "message": "Unable to identify grocery item with high confidence. The image may contain an unsupported product or non-standard lighting.",
  "disclaimer": "Image identification detects grocery product types only. It does not assess freshness, microbiological safety, or spoilage."
}
```

---

## 7. Limitations & Honest Scope

1. **Product Scope:** The visual feature extractor is calibrated for 14 prominent household grocery categories. Exotic, multi-ingredient, or packaged goods with dense text labels fall into low-confidence predictions and prompt user confirmation.
2. **Lighting and Cluttered Backgrounds:** While foreground masking reduces background noise, images with extreme backlighting or high color interference will have reduced confidence scores.
3. **Food Safety & Freshness Boundary:** This service detects **item type** only. Freshness classification, microbial safety, or mold detection are not performed here.

---

## 8. Conclusion

Phase 10 successfully introduces image-based grocery identification to SaveBite AI. The implementation is lightweight, deterministic, completely decoupled from heavy GPU hardware, and fully regression-tested against all prior phases (235 passed tests).
