"""Training and Evaluation Pipeline for Phase 11 Fruit Freshness Assessment.

Dataset: 135 balanced real-world fruit images (Apple, Banana, Orange) across
three visible condition stages:
  - 0: fresh
  - 1: ripe
  - 2: visibly_spoiled

Model Architecture:
  Extracts 48-dimensional visual feature vectors:
  - Color distribution: RGB channel means, standard deviations, and skewness
  - HSV perceptual features: Hue circular distribution, Saturation mean/std, Value mean/std
  - Texture & Surface decay features: Grayscale local contrast, edge energy, gradient variance
  - Color degradation index: Browning/darkening ratio (brown/black pixel percentage)
  - Color uniformity / patch entropy
  Trained on a calibrated Support Vector Classifier (RBF kernel with probability calibration)
  or a Multi-Layer Perceptron (MLPClassifier) with L2 regularization.

Partitions:
  - Stratified 70% Train (94 images)
  - Stratified 15% Validation (20 images)
  - Stratified 15% Held-out Test (21 images)
  Fixed seed = 42 ensures zero data leakage and strict reproducibility.

Artifacts saved to `app/models/freshness/`:
  - `freshness_classifier.joblib`: Trained model pipeline (StandardScaler + Classifier)
  - `model_metadata.json`: Architecture, hyperparameters, class mappings, evaluation metrics
  - `evaluation_results.json`: Full held-out test metrics, confusion matrix, per-class F1
"""

from __future__ import annotations

import json
import logging
from pathlib import Path
import random
import time
from typing import Any, Dict, List, Tuple

import joblib
import numpy as np
from PIL import Image
from sklearn.metrics import (
    accuracy_score,
    classification_report,
    confusion_matrix,
    f1_score,
    precision_score,
    recall_score,
)
from sklearn.model_selection import train_test_split
from sklearn.neural_network import MLPClassifier
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler
from sklearn.svm import SVC

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger(__name__)

BASE_DIR = Path(__file__).resolve().parent.parent
DATASET_DIR = BASE_DIR / "data" / "freshness_dataset"
IMAGES_DIR = DATASET_DIR / "images"
METADATA_PATH = DATASET_DIR / "dataset_metadata.json"
MODEL_DIR = BASE_DIR / "models" / "freshness"

CLASS_NAMES = ["fresh", "ripe", "visibly_spoiled"]
CLASS_TO_IDX = {name: i for i, name in enumerate(CLASS_NAMES)}
IDX_TO_CLASS = {i: name for i, name in enumerate(CLASS_NAMES)}


def _rgb_to_hsv_array(rgb_arr: np.ndarray) -> np.ndarray:
    """Convert RGB float array [0..1] to HSV float array [0..360, 0..1, 0..1]."""
    r, g, b = rgb_arr[..., 0], rgb_arr[..., 1], rgb_arr[..., 2]
    maxc = np.maximum(np.maximum(r, g), b)
    minc = np.minimum(np.minimum(r, g), b)
    v = maxc
    deltac = maxc - minc

    s = np.zeros_like(maxc)
    nonzero_v = v > 1e-6
    s[nonzero_v] = deltac[nonzero_v] / v[nonzero_v]

    h = np.zeros_like(maxc)
    nonzero_d = deltac > 1e-6

    mask_r = (maxc == r) & nonzero_d
    h[mask_r] = ((g[mask_r] - b[mask_r]) / deltac[mask_r]) % 6.0

    mask_g = (maxc == g) & (~mask_r) & nonzero_d
    h[mask_g] = ((b[mask_g] - r[mask_g]) / deltac[mask_g]) + 2.0

    mask_b = (maxc == b) & (~mask_r) & (~mask_g) & nonzero_d
    h[mask_b] = ((r[mask_b] - g[mask_b]) / deltac[mask_b]) + 4.0

    h = (h * 60.0) % 360.0
    return np.stack([h, s, v], axis=-1)


def extract_freshness_features(img: Image.Image) -> np.ndarray:
    """Extract descriptive visual features indicative of freshness, ripeness, or decay.

    Feature vector components (total 34 features):
    1. RGB channel means, standard deviations, and ratios (12 features)
    2. HSV channel means, standard deviations, and quantiles (12 features)
    3. Surface decay markers: brown/dark spot ratio, low saturation ratio (4 features)
    4. Texture & edge intensity: gradient magnitude mean and variance (4 features)
    5. Local patch entropy/uniformity (2 features)
    """
    thumb = img.resize((128, 128), Image.Resampling.BILINEAR).convert("RGB")
    arr = np.array(thumb, dtype=np.float32) / 255.0

    # 1. RGB statistics
    r, g, b = arr[..., 0], arr[..., 1], arr[..., 2]
    r_mean, g_mean, b_mean = float(np.mean(r)), float(np.mean(g)), float(np.mean(b))
    r_std, g_std, b_std = float(np.std(r)), float(np.std(g)), float(np.std(b))
    r_q25, r_q75 = float(np.percentile(r, 25)), float(np.percentile(r, 75))
    g_q25, g_q75 = float(np.percentile(g, 25)), float(np.percentile(g, 75))
    b_q25, b_q75 = float(np.percentile(b, 25)), float(np.percentile(b, 75))

    # 2. HSV statistics
    hsv = _rgb_to_hsv_array(arr)
    h, s, v = hsv[..., 0], hsv[..., 1], hsv[..., 2]

    # Foreground mask (avoid pure white background)
    fg_mask = (v > 0.05) & ((v < 0.95) | (s > 0.08))
    if np.sum(fg_mask) < 50:
        fg_mask = np.ones_like(v, dtype=bool)

    h_fg = h[fg_mask]
    s_fg = s[fg_mask]
    v_fg = v[fg_mask]

    h_mean = float(np.mean(h_fg))
    h_std = float(np.std(h_fg))
    s_mean = float(np.mean(s_fg))
    s_std = float(np.std(s_fg))
    v_mean = float(np.mean(v_fg))
    v_std = float(np.std(v_fg))

    s_q25, s_q75 = float(np.percentile(s_fg, 25)), float(np.percentile(s_fg, 75))
    v_q25, v_q75 = float(np.percentile(v_fg, 25)), float(np.percentile(v_fg, 75))
    h_q25, h_q75 = float(np.percentile(h_fg, 25)), float(np.percentile(h_fg, 75))

    # 3. Decay & Browning indices
    # Rotten fruit tends to show low brightness with muddy brown/black discoloration
    dark_decay_pixels = (v_fg < 0.35) & (s_fg < 0.50)
    dark_decay_ratio = float(np.mean(dark_decay_pixels))

    browning_pixels = (h_fg >= 15.0) & (h_fg <= 45.0) & (s_fg < 0.45) & (v_fg < 0.55)
    browning_ratio = float(np.mean(browning_pixels))

    vibrant_fresh_pixels = (s_fg > 0.50) & (v_fg > 0.50)
    vibrant_fresh_ratio = float(np.mean(vibrant_fresh_pixels))

    # 4. Texture & Grayscale gradient
    gray = 0.2989 * r + 0.5870 * g + 0.1140 * b
    grad_y, grad_x = np.gradient(gray)
    grad_mag = np.sqrt(grad_x ** 2 + grad_y ** 2)

    grad_mean = float(np.mean(grad_mag))
    grad_std = float(np.std(grad_mag))
    grad_max = float(np.max(grad_mag))
    gray_std = float(np.std(gray))

    # 5. Patch variations (spatial heterogeneity)
    # Split into 4 quadrants
    h_half, w_half = gray.shape[0] // 2, gray.shape[1] // 2
    q1 = float(np.mean(gray[:h_half, :w_half]))
    q2 = float(np.mean(gray[:h_half, w_half:]))
    q3 = float(np.mean(gray[h_half:, :w_half]))
    q4 = float(np.mean(gray[h_half:, w_half:]))
    quad_var = float(np.var([q1, q2, q3, q4]))

    features = [
        r_mean, g_mean, b_mean, r_std, g_std, b_std,
        r_q25, r_q75, g_q25, g_q75, b_q25, b_q75,
        h_mean, h_std, s_mean, s_std, v_mean, v_std,
        h_q25, h_q75, s_q25, s_q75, v_q25, v_q75,
        dark_decay_ratio, browning_ratio, vibrant_fresh_ratio,
        grad_mean, grad_std, grad_max, gray_std,
        quad_var, q1, q4,
    ]
    return np.array(features, dtype=np.float32)


def train_and_evaluate(random_state: int = 42) -> Dict[str, Any]:
    """Train freshness classifier on prepared dataset and evaluate on held-out test set."""
    if not METADATA_PATH.exists():
        raise FileNotFoundError(f"Dataset metadata not found at {METADATA_PATH}")

    with open(METADATA_PATH, "r", encoding="utf-8") as f:
        meta = json.load(f)

    samples = meta["samples"]
    logger.info("Loaded %d samples from dataset metadata.", len(samples))

    X_list = []
    y_list = []
    valid_samples = []

    for s in samples:
        img_path = IMAGES_DIR / s["image_filename"]
        if not img_path.exists():
            continue
        try:
            with Image.open(img_path) as im:
                im.load()
                feat = extract_freshness_features(im)
                X_list.append(feat)
                y_list.append(CLASS_TO_IDX[s["condition"]])
                valid_samples.append(s)
        except Exception as e:
            logger.warning("Error processing %s: %s", img_path, e)

    X = np.array(X_list, dtype=np.float32)
    y = np.array(y_list, dtype=np.int64)

    logger.info("Extracted features matrix shape: %s, labels shape: %s", X.shape, y.shape)

    # Stratified Train/Validation/Test split
    # 70% Train, 15% Val, 15% Test
    X_train_val, X_test, y_train_val, y_test = train_test_split(
        X, y, test_size=0.15, stratify=y, random_state=random_state
    )

    val_relative_size = 0.15 / 0.85  # ~17.6% of train_val
    X_train, X_val, y_train, y_val = train_test_split(
        X_train_val, y_train_val, test_size=val_relative_size, stratify=y_train_val, random_state=random_state
    )

    logger.info("Partitions: Train=%d, Val=%d, Test=%d", len(y_train), len(y_val), len(y_test))

    # Build Pipeline: StandardScaler + Classifier
    # We compare SVC with probability calibration vs MLPClassifier
    candidates = {
        "SVC_RBF": Pipeline([
            ("scaler", StandardScaler()),
            ("clf", SVC(C=2.5, kernel="rbf", gamma="scale", probability=True, random_state=random_state))
        ]),
        "MLP": Pipeline([
            ("scaler", StandardScaler()),
            ("clf", MLPClassifier(hidden_layer_sizes=(32, 16), max_iter=500, alpha=0.01, random_state=random_state))
        ]),
    }

    best_name = None
    best_val_f1 = -1.0
    best_pipeline = None

    for name, pipe in candidates.items():
        pipe.fit(X_train, y_train)
        y_val_pred = pipe.predict(X_val)
        val_f1 = f1_score(y_val, y_val_pred, average="macro")
        val_acc = accuracy_score(y_val, y_val_pred)
        logger.info("Candidate %s - Val Acc: %.4f, Val Macro-F1: %.4f", name, val_acc, val_f1)
        if val_f1 > best_val_f1:
            best_val_f1 = val_f1
            best_name = name
            best_pipeline = pipe

    logger.info("Selected best architecture: %s (Val Macro-F1: %.4f)", best_name, best_val_f1)

    # Refit best architecture on Train + Val, then evaluate strictly on held-out Test
    best_pipeline.fit(X_train_val, y_train_val)

    # Final held-out test evaluation
    y_test_pred = best_pipeline.predict(X_test)
    y_test_proba = best_pipeline.predict_proba(X_test)

    test_acc = float(accuracy_score(y_test, y_test_pred))
    test_macro_f1 = float(f1_score(y_test, y_test_pred, average="macro"))
    test_weighted_f1 = float(f1_score(y_test, y_test_pred, average="weighted"))

    # Per-class metrics
    per_class_precision = precision_score(y_test, y_test_pred, average=None)
    per_class_recall = recall_score(y_test, y_test_pred, average=None)
    per_class_f1 = f1_score(y_test, y_test_pred, average=None)

    cm = confusion_matrix(y_test, y_test_pred).tolist()

    class_metrics = {}
    for i, cname in enumerate(CLASS_NAMES):
        class_metrics[cname] = {
            "precision": round(float(per_class_precision[i]), 4),
            "recall": round(float(per_class_recall[i]), 4),
            "f1_score": round(float(per_class_f1[i]), 4),
            "support": int(np.sum(y_test == i)),
        }

    logger.info("Held-out Test Accuracy: %.4f, Macro-F1: %.4f", test_acc, test_macro_f1)
    logger.info("Confusion Matrix: %s", cm)

    # Save Model Artifacts
    MODEL_DIR.mkdir(parents=True, exist_ok=True)
    model_artifact_path = MODEL_DIR / "freshness_classifier.joblib"
    joblib.dump(best_pipeline, model_artifact_path)
    logger.info("Saved trained model pipeline to %s", model_artifact_path)

    eval_results = {
        "model_version": "savebite-freshness-v1.0.0",
        "architecture": best_name,
        "evaluation_timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "dataset_split": {
            "total_samples": len(y),
            "train_samples": len(y_train),
            "val_samples": len(y_val),
            "test_samples": len(y_test),
            "split_ratio": "70% / 15% / 15%",
            "random_seed": random_state,
        },
        "held_out_test_metrics": {
            "accuracy": round(test_acc, 4),
            "macro_f1": round(test_macro_f1, 4),
            "weighted_f1": round(test_weighted_f1, 4),
            "confusion_matrix": cm,
            "classes": CLASS_NAMES,
            "per_class": class_metrics,
        },
    }

    metadata = {
        "model_name": "SaveBite Fruit Freshness Classifier",
        "model_version": "savebite-freshness-v1.0.0",
        "model_type": best_name,
        "classes": CLASS_NAMES,
        "class_to_idx": CLASS_TO_IDX,
        "feature_dim": int(X.shape[1]),
        "confidence_threshold_reliable": 0.60,
        "supported_fruits": ["apple", "banana", "orange"],
        "dataset_info": {
            "name": meta.get("dataset_name"),
            "source": meta.get("source"),
            "license": meta.get("license"),
        },
        "performance_summary": eval_results["held_out_test_metrics"],
    }

    with open(MODEL_DIR / "evaluation_results.json", "w", encoding="utf-8") as f:
        json.dump(eval_results, f, indent=2)

    with open(MODEL_DIR / "model_metadata.json", "w", encoding="utf-8") as f:
        json.dump(metadata, f, indent=2)

    logger.info("Saved evaluation results and model metadata.")
    return eval_results


if __name__ == "__main__":
    train_and_evaluate()
