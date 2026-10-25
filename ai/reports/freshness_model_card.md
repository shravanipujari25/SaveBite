# Model Card: SaveBite Fruit Freshness Classifier

## 1. Model Details

- **Model Name:** SaveBite Fruit Freshness Classifier
- **Model Version:** `savebite-freshness-v1.0.0`
- **Architecture:** Multi-Layer Perceptron (`MLPClassifier`), 2 hidden layers `(32, 16)`, ReLU activation, Adam optimizer, L2 regularization $\alpha=0.01$.
- **Input:** 34-dimensional visual feature vector extracted from standard RGB grocery images (color distribution, HSV perceptual channels, browning indices, gradient energy, spatial entropy).
- **Output:** Calibrated probability distribution across 3 condition states: `fresh`, `ripe`, `visibly_spoiled`.
- **Framework:** scikit-learn 1.9.1, Pillow 13.0.0, NumPy 2.5.4.
- **License:** Apache License 2.0.

---

## 2. Intended Use

### Primary Intended Uses
- Assisting household consumers in recognizing when fruits (apples, bananas, oranges) are approaching peak ripeness or exhibiting visible exterior decay.
- Providing an objective visual input to inform the SaveBite Use-First priority scoring and recipe recommendation engines.

### Out-of-Scope & Unintended Uses
- **Food Safety Testing:** This model must **never** be used as a microbiological safety test or pathogen detector. Normal RGB imagery cannot detect Salmonella, E. coli, Listeria, nor botulinum toxins.
- **Commercial Automated Sorting:** The model is trained on household consumer fruit images and is not calibrated for industrial sorting conveyor belts.
- **Non-Supported Produce:** The model is calibrated on fruits (apple, banana, orange). Evaluating meat, dairy, or leafy greens with this classifier will yield invalid results; such items are flagged as `uncertain`.

---

## 3. Training & Evaluation Data

- **Source Dataset:** Fruit Freshness Detection Dataset (`zijianchen98/Fruit-freshness-detection-dataset`), Apache License 2.0.
- **Total Dataset Size:** 135 balanced real-world fruit images.
- **Condition Distribution:**
  - `fresh`: 45 images (33.3%)
  - `ripe`: 45 images (33.3%)
  - `visibly_spoiled`: 45 images (33.3%)
- **Data Partitions:**
  - Stratified Training Set: 93 images (70%)
  - Stratified Validation Set: 21 images (15%)
  - Held-out Test Set: 21 images (15%)
  - Random Seed: 42 (reproducible split, strict zero data leakage).

---

## 4. Quantitative Performance Metrics

Evaluated on the isolated held-out test partition (21 images):
- **Overall Accuracy:** **80.95%**
- **Macro-Averaged F1-Score:** **0.8125**
- **Weighted F1-Score:** **0.8125**

### Per-Class Performance
| Class | Precision | Recall | F1-Score | Support |
| :--- | :--- | :--- | :--- | :--- |
| `fresh` | 0.7143 | 0.7143 | 0.7143 | 7 |
| `ripe` | 1.0000 | 0.8571 | 0.9231 | 7 |
| `visibly_spoiled` | 0.7500 | 0.8571 | 0.8000 | 7 |

### Confusion Matrix
```
Predicted ->   fresh   ripe   visibly_spoiled
Actual:
fresh            5       0           2
ripe             1       6           0
visibly_spoiled  1       0           6
```

---

## 5. Confidence & Uncertainty Handling

- **Decision Threshold:** A minimum confidence threshold of $0.60$ ($60\%$) is enforced.
- **Uncertainty Fallback:** When top class probability is $< 0.60$ or an uncalibrated product category hint is provided, the condition is returned as `"uncertain"` with `requires_confirmation: true`.
- **User Agency:** The system asks for user confirmation whenever condition ambiguity exists, rather than making automated disposal assumptions.

---

## 6. Safety, Ethical & Environmental Considerations

- **Food Waste Prevention:** By distinguishing `ripe` from `visibly_spoiled`, the model actively avoids prompting unnecessary food disposal for produce that is perfectly safe, mature, and flavorful.
- **Compute Efficiency:** The feature extraction and MLP inference pipeline requires negligible CPU compute (~15ms per image), ensuring suitability for low-cost household devices without GPU hardware.
- **Explicit Limitations:** The model explicitly disclaims food safety guarantees on every response.
