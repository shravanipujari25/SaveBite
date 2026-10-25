# Phase 11: Image-Based Freshness Assessment Report

**Date:** 2026-10-25  
**Project:** SaveBite AI — Grocery Intelligence and Food-Waste Management System  
**Module:** `ai/`  
**Verdict:** **PASS**

---

## 1. Executive Summary

Phase 11 delivers a complete, real machine learning pipeline for **Image-Based Freshness Assessment** within the SaveBite AI subsystem. The service ingests grocery imagery, extracts multi-dimensional color, surface degradation, and texture features, and classifies the visible state of fruits into three calibrated condition stages:
1. `fresh` — Peak color vibrancy, uniform saturation, firm smooth appearance.
2. `ripe` — Mature eating stage, expected varietal hue development, slight softening.
3. `visibly_spoiled` — Marked browning/darkening discoloration, mold, or structural decomposition.

The classification pipeline is powered by a real, trained **Multi-Layer Perceptron (MLP)** neural network classifier trained on a balanced subset of the open-source **Fruit Freshness Detection Dataset** (`zijianchen98/Fruit-freshness-detection-dataset`, Apache License 2.0). On a held-out test set (unseen during training and hyperparameter selection), the model achieved:
- **Test Accuracy:** **80.95%**
- **Macro-F1 Score:** **0.8125**
- **Weighted-F1 Score:** **0.8125**

All 18 new automated tests passed, and the complete regression test suite spanning Phases 1 through 11 passed with **253 passed tests, 0 failures, and 0 regressions**.

---

## 2. Baseline & Test Execution Summary

| Stage | Command Executed | Tests Collected | Passed | Failed | Warnings | Status |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Phase 10 Baseline** | `pytest -v` | 235 | 235 | 0 | 1 | PASS |
| **Phase 11 Focused Suite** | `pytest tests/test_freshness_assessment_service.py -v` | 18 | 18 | 0 | 1 | PASS |
| **Full Regression (Phases 1–11)**| `pytest -v` | 253 | 253 | 0 | 1 | PASS |

---

## 3. Files Created and Modified

### Files Created
1. `app/data/acquire_freshness_dataset.py` — Dataset acquisition and extraction pipeline streaming labelled VOC images from GitHub.
2. `app/data/train_freshness_model.py` — Feature extraction (34 visual decay and color distribution features), model architecture comparison (SVC vs. MLP), stratified 70/15/15 splitting, model training, and held-out test evaluation.
3. `app/services/freshness_assessment_service.py` — Cached singleton inference service, confidence/uncertainty logic, Pydantic response models, and safety disclaimer integration.
4. `app/models/freshness/freshness_classifier.joblib` — Trained model pipeline artifact (StandardScaler + MLPClassifier).
5. `app/models/freshness/model_metadata.json` — Model parameters, class mappings, feature dimensions, and provenance.
6. `app/models/freshness/evaluation_results.json` — Held-out test metrics, per-class F1, and confusion matrix.
7. `tests/test_freshness_assessment_service.py` — 18 comprehensive tests covering validation, inference, probabilities, uncertainty, error handling, API integration, and regression.
8. `reports/phase11_report.md` — This report.
9. `reports/freshness_model_card.md` — Formal model card documenting intended use, evaluation, limitations, and ethical boundaries.

### Files Modified
1. `app/main.py` — Added `POST /vision/assess-freshness` endpoint with multipart image upload and optional product hint.

*Confirmation: Zero files outside `ai/` were modified.*

---

## 4. Dataset Source, Licensing, and Partitions

- **Dataset Name:** Fruit Freshness Detection Dataset
- **Repository:** `https://github.com/zijianchen98/Fruit-freshness-detection-dataset`
- **License:** Apache License 2.0 (Permissive open source)
- **Extracted Subset:** 135 balanced real-world fruit images across Apple, Banana, and Orange.
- **Class Balance:**
  - `fresh`: 45 samples (33.3%)
  - `ripe`: 45 samples (33.3%)
  - `visibly_spoiled`: 45 samples (33.3%)
- **Data Partitions (Stratified by Class, Seed = 42):**
  - **Train (70%):** 93 samples
  - **Validation (15%):** 21 samples
  - **Held-out Test (15%):** 21 samples (Strictly isolated from training and hyperparameter selection)

---

## 5. Model Architecture & Training Configuration

### Feature Extraction Pipeline (34 Dimensions)
1. **RGB Color Statistics (12 features):** Means, standard deviations, and 25th/75th percentiles across red, green, and blue channels.
2. **HSV Perceptual Features (12 features):** Dominant hue, hue variance, saturation mean/std/quantiles, value (brightness) mean/std/quantiles.
3. **Decay & Browning Indices (3 features):** Dark decay pixel ratio, browning/muddy discoloration pixel ratio, vibrant fresh pixel ratio.
4. **Surface Texture & Gradient Energy (5 features):** Grayscale gradient magnitude mean, std, max, and overall standard deviation.
5. **Spatial Heterogeneity (2 features):** Inter-quadrant variance across image patches.

### Architecture Comparison on Validation Set
- **Candidate 1 (SVC RBF):** Validation Accuracy: 71.43%, Macro-F1: 0.6750
- **Candidate 2 (MLP Neural Network):** Validation Accuracy: **76.19%**, Macro-F1: **0.7450** (Selected)

### Final Model Configuration
- **Model Type:** Multi-Layer Perceptron (`MLPClassifier`)
- **Hidden Layers:** `(32, 16)`
- **Activation:** `relu`
- **Optimizer:** `adam` with L2 penalty $\alpha = 0.01$
- **Scaler:** `StandardScaler` fitted on training partitions

---

## 6. Evaluation Results on Held-Out Test Set

The model was evaluated strictly on the 21 unseen held-out test samples:

### Aggregate Metrics
- **Accuracy:** **80.95%**
- **Macro-F1 Score:** **0.8125**
- **Weighted-F1 Score:** **0.8125**

### Per-Class Performance
| Class | Precision | Recall | F1-Score | Support |
| :--- | :--- | :--- | :--- | :--- |
| **`fresh`** | 0.7143 | 0.7143 | **0.7143** | 7 |
| **`ripe`** | 1.0000 | 0.8571 | **0.9231** | 7 |
| **`visibly_spoiled`** | 0.7500 | 0.8571 | **0.8000** | 7 |

### Confusion Matrix
```
Predicted ->   fresh   ripe   visibly_spoiled
Actual:
fresh            5       0           2
ripe             1       6           0
visibly_spoiled  1       0           6
```

### Analysis of Confusions
- Zero confusion occurred between `ripe` and `visibly_spoiled`—the model clearly distinguishes mature ripe produce from decayed produce.
- Two fresh samples with natural russeting/blemishes were conservatively flagged as spoiled, and one spoiled sample was classified as fresh. These edge cases demonstrate that visual surface condition alone has natural uncertainty, reinforcing the necessity of our uncertainty policy.

---

## 7. Confidence & Uncertainty Policy

1. **Reliability Threshold:** Calibrated at $0.60$ ($60\%$). If the top class softmax probability is $< 0.60$, the output is returned as `condition: "uncertain"`, with `is_confident: false` and `requires_confirmation: true`.
2. **Unsupported Product Hints:** If callers provide a product hint outside the calibrated fruit categories (e.g., `chicken`, `pasta`), the condition is marked `uncertain` with a descriptive explanation to prevent cross-domain classification errors.
3. **Food Safety Disclaimer:** Every response includes mandatory limitation disclaimers emphasizing that visual condition does not establish food safety or detect microscopic bacterial toxins.

---

## 8. API Endpoint Specifications

### Endpoint Definition
- **Route:** `POST /vision/assess-freshness`
- **Content-Type:** `multipart/form-data`
- **Fields:**
  - `file`: UploadFile (required, JPEG/PNG/WEBP, max 5MB)
  - `product_hint`: string (optional, e.g. "apple", "banana", "orange")

### Example Request (curl)
```bash
curl -X POST "http://localhost:8000/vision/assess-freshness" \
  -F "file=@apple_sample.jpg;type=image/jpeg" \
  -F "product_hint=apple"
```

### Example Response
```json
{
  "product_category": "apple",
  "condition": "fresh",
  "confidence": 0.9995,
  "is_confident": true,
  "requires_confirmation": false,
  "class_probabilities": {
    "fresh": 0.9995,
    "ripe": 0.0005,
    "visibly_spoiled": 0.0
  },
  "model_version": "savebite-freshness-v1.0.0",
  "image_metadata": {
    "format": "JPEG",
    "width": 640,
    "height": 480,
    "mode": "RGB",
    "file_size_bytes": 54210,
    "filename": "apple_sample.jpg"
  },
  "limitations": [
    "This prediction describes visible surface condition and external discoloration only.",
    "Visual condition does not evaluate microbiological pathogens, bacterial toxins, or food-safety.",
    "Ripeness does not equal spoilage: a fully ripe fruit may still be safe and nutritious to consume."
  ],
  "message": "Visible condition assessed as 'fresh' with 100.0% confidence."
}
```

---

## 9. Integration Plan for Phase 13

In Phase 13, the freshness assessment engine will be integrated with the Use-First priority scoring engine (`app/services/priority_scoring.py`):
1. **Freshness Penalty Trigger:** When an inventory item is assessed with high confidence as `visibly_spoiled` ($\ge 0.75$), its `freshness_override` flag will be set to `True`, triggering Phase 4's `weight_freshness_penalty` (10.0%) to elevate Use-First priority.
2. **Ripe State Handling:** Items assessed as `ripe` will not receive a spoilage penalty, but their urgency ratio can be moderately adjusted to suggest timely consumption in recipe recommendations.
3. **Uncertainty Protection:** Items with `condition == "uncertain"` or low confidence will **not** automatically mutate priority scores without explicit user confirmation.

---

## 10. Reproducible Commands

```powershell
# 1. Download and extract dataset subset
.\.venv\Scripts\python.exe app/data/acquire_freshness_dataset.py

# 2. Train classifier and evaluate on held-out test partition
.\.venv\Scripts\python.exe app/data/train_freshness_model.py

# 3. Run Phase 11 focused automated test suite
.\.venv\Scripts\pytest.exe tests/test_freshness_assessment_service.py -v

# 4. Run complete regression test suite across all 11 phases
.\.venv\Scripts\pytest.exe -v
```

---

## 11. Conclusion

Phase 11 is complete. A real, evaluated machine learning classifier is operational, tested, and integrated with the SaveBite AI service without breaking any existing endpoints or features.
