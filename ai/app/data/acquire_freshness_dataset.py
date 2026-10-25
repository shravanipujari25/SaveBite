"""Dataset acquisition script for Phase 11 Fruit Freshness Assessment.

Dataset: Fruit Freshness Detection Dataset (zijianchen98/Fruit-freshness-detection-dataset)
License: Apache License 2.0
Description: 1000+ labelled real-world images of fruits (Apple, Banana, Orange) across
three distinct condition stages:
  - fresh  (fresh_apple, fresh_banana, fresh_orange)
  - ripe / normal (normal_apple, normal_banana, normal_orange)
  - visibly_spoiled (rotten_apple, rotten_banana, rotten_orange)

This script downloads and extracts a representative, balanced subset of the images
and their XML VOC annotations into `data/freshness_dataset/`.
"""

from __future__ import annotations

import io
import json
import logging
from pathlib import Path
import random
import sys
import time
import urllib.request
import xml.etree.ElementTree as ET
import zipfile

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger(__name__)

REPO_ZIP_URL = "https://github.com/zijianchen98/Fruit-freshness-detection-dataset/archive/refs/heads/master.zip"
TARGET_DIR = Path(__file__).resolve().parent.parent / "data" / "freshness_dataset"
IMAGES_DIR = TARGET_DIR / "images"
ANNOTATIONS_DIR = TARGET_DIR / "annotations"
METADATA_FILE = TARGET_DIR / "dataset_metadata.json"

CONDITION_MAPPING = {
    "fresh_apple": ("apple", "fresh"),
    "normal_apple": ("apple", "ripe"),
    "rotten_apple": ("apple", "visibly_spoiled"),
    "fresh_banana": ("banana", "fresh"),
    "normal_banana": ("banana", "ripe"),
    "rotten_banana": ("banana", "visibly_spoiled"),
    "fresh_orange": ("orange", "fresh"),
    "normal_orange": ("orange", "ripe"),
    "rotten_orange": ("orange", "visibly_spoiled"),
}

TARGET_PER_CLASS = 45  # 45 per condition -> ~135 images total across fresh/ripe/visibly_spoiled


def download_and_extract(max_samples_per_class: int = TARGET_PER_CLASS) -> Dict[str, Any]:
    """Download dataset from GitHub zip stream and extract target labelled images."""
    TARGET_DIR.mkdir(parents=True, exist_ok=True)
    IMAGES_DIR.mkdir(parents=True, exist_ok=True)
    ANNOTATIONS_DIR.mkdir(parents=True, exist_ok=True)

    logger.info("Downloading dataset archive from %s...", REPO_ZIP_URL)
    req = urllib.request.Request(REPO_ZIP_URL, headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"})
    with urllib.request.urlopen(req, timeout=120) as resp:
        zip_bytes = resp.read()

    logger.info("Archive downloaded (%d bytes). Inspecting files...", len(zip_bytes))
    zf = zipfile.ZipFile(io.BytesIO(zip_bytes))

    # Identify all annotation files
    annotation_files = [f for f in zf.namelist() if "/Annotations/" in f and f.endswith(".xml")]
    logger.info("Found %d annotation files in archive.", len(annotation_files))

    # Parse annotations to find image-to-label mappings
    records = []
    condition_counts = {"fresh": 0, "ripe": 0, "visibly_spoiled": 0}

    # Shuffle for random sampling
    random.seed(42)
    random.shuffle(annotation_files)

    for xml_path in annotation_files:
        try:
            xml_content = zf.read(xml_path)
            tree = ET.fromstring(xml_content)
            objects = tree.findall("object")
            if not objects:
                continue

            raw_label = objects[0].find("name").text.strip().lower()
            if raw_label not in CONDITION_MAPPING:
                continue

            category, condition = CONDITION_MAPPING[raw_label]

            # Enforce balanced per-condition collection
            if condition_counts[condition] >= max_samples_per_class:
                continue

            # Find matching image in zip
            base_id = Path(xml_path).stem
            img_zip_path = None
            for candidate_ext in [".jpg", ".png", ".jpeg", ".JPG"]:
                for name in zf.namelist():
                    if f"/JPEGImages/{base_id}{candidate_ext}" in name:
                        img_zip_path = name
                        break
                if img_zip_path:
                    break

            if not img_zip_path:
                continue

            # Extract image and XML
            img_data = zf.read(img_zip_path)
            local_img_name = f"{base_id}.jpg"
            local_img_path = IMAGES_DIR / local_img_name
            with open(local_img_path, "wb") as f_img:
                f_img.write(img_data)

            local_xml_path = ANNOTATIONS_DIR / f"{base_id}.xml"
            with open(local_xml_path, "wb") as f_xml:
                f_xml.write(xml_content)

            condition_counts[condition] += 1
            records.append({
                "sample_id": base_id,
                "image_filename": local_img_name,
                "product_category": category,
                "raw_label": raw_label,
                "condition": condition,
                "file_size_bytes": len(img_data),
            })

            # Check if all targets met
            if all(count >= max_samples_per_class for count in condition_counts.values()):
                break
        except Exception as e:
            logger.debug("Skipping XML %s due to error: %s", xml_path, e)

    metadata = {
        "dataset_name": "Fruit Freshness Detection Dataset",
        "source": "https://github.com/zijianchen98/Fruit-freshness-detection-dataset",
        "license": "Apache License 2.0",
        "acquired_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "total_samples": len(records),
        "condition_counts": condition_counts,
        "supported_categories": ["apple", "banana", "orange"],
        "condition_classes": ["fresh", "ripe", "visibly_spoiled"],
        "samples": records,
    }

    with open(METADATA_FILE, "w", encoding="utf-8") as f:
        json.dump(metadata, f, indent=2)

    logger.info("Dataset acquisition completed. Total images: %d. Counts: %s", len(records), condition_counts)
    return metadata


if __name__ == "__main__":
    download_and_extract()
