# SaveBite AI Service

## Project Overview

The **SaveBite AI Service** is the dedicated AI and machine learning microservice for the SaveBite platform. Its mission is to empower households and businesses to eliminate food waste and optimize grocery usage through intelligent prediction, smart inventory management, and personalized culinary recommendations.

---

## Current Implementation

### Phase 1: AI Service Setup
- Asynchronous web service built with **FastAPI**.
- Standardized **GET `/health`** endpoint backed by a Pydantic response model.
- Automated API interactive documentation via **Swagger UI** (`/docs`) and **ReDoc** (`/redoc`).
- Automated test suite using **pytest** and FastAPI's `TestClient`.
- Environment template definitions and clean source-control hygiene.

### Phase 2: Grocery Product Knowledge Base
- Deterministic reference knowledge base containing **36 common grocery products** across all major nutritional and storage categories.
- Built-in schema, enumeration, numeric, and business rule validation (`validate_product_catalog`).
- Robust product name normalization engine handling case variations, whitespace, plural forms, irregular plurals, and explicit alias mapping (`normalize_product_name`).
- Fast in-memory catalog with O(1) indexed lookup (`lookup_product`).
- Integration with FastAPI via **GET `/products/{product_name}`** returning canonical product records or `HTTP 404`.
- Traceable citations linking directly to official food-safety storage guidelines (FoodSafety.gov FoodKeeper App, USDA FSIS, and FDA).

### Phase 3: Shelf-Life Estimation Engine
- Rule-based estimation service calculating remaining storage days and projected end dates based on reference baselines.
- Comprehensive handling of opened vs. unopened package states.
- Storage condition comparison (actual vs. catalog recommended zone) with explicit assumption tracking.
- Non-invasive temperature observation and safety threshold alerts without arbitrary mathematical multipliers.
- Manufacturer package use-by date comparison and override warnings.
- Deterministic 4-tier reliability classification (`high`, `medium`, `low`, `unavailable`).
- Standalone reusable Python service and FastAPI endpoint: **POST `/shelf-life/estimate`**.

---

## Prerequisites

Before setting up the project, ensure your environment meets the following requirements:
- **Python**: Version `3.10` or higher (Python `3.12+` recommended; verified with Python `3.12.4`).
- **Pip**: Latest version of pip (`python -m pip install --upgrade pip`).
- **Terminal / Shell**: PowerShell or Command Prompt (Windows), Bash / Zsh (macOS / Linux).

---

## Setup Instructions

### 1. Navigate to the AI directory
Always perform AI service operations from inside the `ai/` folder:

```bash
cd ai
```

### 2. Create the Virtual Environment
Create a localized Python virtual environment named `.venv`:

- **Windows**:
  ```bash
  python -m venv .venv
  ```
- **macOS / Linux**:
  ```bash
  python3 -m venv .venv
  ```

### 3. Activate the Virtual Environment

- **Windows (PowerShell)**:
  ```powershell
  .\.venv\Scripts\Activate.ps1
  ```
  *(If execution policies restrict script execution, run: `Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope Process`)*

- **Windows (Command Prompt)**:
  ```cmd
  .\.venv\Scripts\activate.bat
  ```

- **macOS / Linux (Bash/Zsh)**:
  ```bash
  source .venv/bin/activate
  ```

### 4. Install Dependencies
Install all direct dependencies into the isolated virtual environment:

```bash
pip install -r requirements.txt
```

---

## Running the Service

Start the local development server with Uvicorn and live hot-reloading:

```bash
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

Once running, access the following endpoints in your browser or via HTTP client:
- **Health Check Endpoint**: [http://127.0.0.1:8000/health](http://127.0.0.1:8000/health)
- **Product Lookup Endpoint**: [http://127.0.0.1:8000/products/tomatoes](http://127.0.0.1:8000/products/tomatoes)
- **Shelf-Life Estimation Endpoint**: [http://127.0.0.1:8000/shelf-life/estimate](http://127.0.0.1:8000/shelf-life/estimate)
- **Interactive Swagger UI**: [http://127.0.0.1:8000/docs](http://127.0.0.1:8000/docs)
- **OpenAPI JSON Schema**: [http://127.0.0.1:8000/openapi.json](http://127.0.0.1:8000/openapi.json)

---

## Phase 3: Shelf-Life Estimation Engine

### 1. Engine Purpose and Scope
The Shelf-Life Estimation Engine calculates the remaining storage window of grocery items. It takes user or inventory inputs (purchase date, package state, storage zone, temperature, use-by date) and calculates estimated consumption end dates based on official foodkeeper reference durations.

### 2. Input and Output Contracts

#### Request Fields (`ShelfLifeEstimateRequest`)
| Field | Type | Required | Description |
| :--- | :--- | :---: | :--- |
| `product_name` | String | Yes | Name of the grocery item (e.g. `"Tomato"`, `"Milk"`) |
| `storage_zone` | String | No | Actual storage location (`"pantry"`, `"refrigerator"`, `"freezer"`). Defaults to catalog recommendation if omitted. |
| `purchase_date` | Date (`YYYY-MM-DD`) | Yes | Date the item was purchased. Must not be in the future relative to `as_of_date`. |
| `opened` | Boolean | Yes | Strict boolean indicating whether packaging has been unsealed. |
| `storage_temperature_c` | Float | No | Observed storage temperature in Celsius (validated between -50°C and 70°C). |
| `package_use_by_date` | Date (`YYYY-MM-DD`) | No | Manufacturer expiration or best-by date on package label. |
| `as_of_date` | Date (`YYYY-MM-DD`) | No | Evaluation anchor date; defaults to current date if omitted. |

#### Response Fields (`ShelfLifeEstimateResponse`)
| Field | Type | Description |
| :--- | :--- | :--- |
| `product_name` | String | Canonical product name from catalog, or query string if unknown |
| `product_found` | Boolean | `true` if item was identified in knowledge base; `false` otherwise |
| `purchase_date` | Date | Purchase date used for calculations |
| `as_of_date` | Date | Reference date used for remaining days evaluation |
| `opened` | Boolean | Item unsealed status |
| `reference_shelf_life_days` | Integer / Null | Base reference days used (unopened base or opened duration) |
| `estimated_end_date` | Date / Null | Projected expiration date based on baseline duration |
| `estimated_remaining_days` | Integer / Null | Signed integer: positive if remaining, `0` if today, negative if elapsed |
| `estimated_days_remaining_nonnegative` | Integer / Null | Nonnegative convenience field: `max(0, estimated_remaining_days)` |
| `storage_zone_used` | String / Null | Effective storage zone evaluated |
| `catalog_storage_zone` | String / Null | Recommended storage zone from knowledge base |
| `storage_assumption` | String / Null | Description of storage assumptions and default behavior |
| `storage_temperature_c` | Float / Null | Recorded storage temperature in Celsius |
| `temperature_adjustment_applied` | Boolean | Explicitly `false` (no unverified empirical multipliers) |
| `package_use_by_date` | Date / Null | Provided manufacturer date |
| `package_date_warning` | String / Null | Warning if manufacturer date precedes catalog estimate or purchase date |
| `reliability` | String | `high`, `medium`, `low`, or `unavailable` |
| `warnings` | List[String] | Specific caveats, mismatches, or quality limitations |
| `explanation` | String | Human-readable narrative summarizing the result |

---

### 3. Calculation Methodology

#### A. Reference Shelf-Life Determination
- **Unopened Items (`opened = False`)**: The reference duration is set to the catalog's `base_shelf_life_days`.
- **Opened Items (`opened = True`)**:
  - If the catalog supplies an `opened_shelf_life_days` value, it is used directly.
  - If the catalog lacks an opened duration (e.g., whole potatoes), the engine falls back provisionally to `base_shelf_life_days`, appends a clear warning, and reduces the reliability rating to `low`.

#### B. Date Arithmetic
$$\text{estimated\_end\_date} = \text{purchase\_date} + \text{reference\_shelf\_life\_days}$$
$$\text{estimated\_remaining\_days} = \text{estimated\_end\_date} - \text{as\_of\_date}$$
$$\text{estimated\_days\_remaining\_nonnegative} = \max(0, \text{estimated\_remaining\_days})$$

#### C. Storage Zone Assumptions & Mismatches
The engine normalizes the user's `storage_zone` and compares it to `catalog_storage_zone`:
- If omitted, the catalog's recommended zone is used as the default assumption.
- If actual storage matches recommended storage, high reliability is maintained.
- If actual storage differs (e.g., milk stored in pantry instead of refrigerator):
  - The engine **never** applies an arbitrary mathematical fudge-factor.
  - An explicit mismatch warning is attached.
  - Reliability is downgraded to `low`.

#### D. Storage Temperature Observation
When temperature is provided:
- Refrigerator: alerts if $> 4.0^\circ\text{C}$ (above safe threshold) or $< 0^\circ\text{C}$ (freezing risk).
- Freezer: alerts if $> -18.0^\circ\text{C}$.
- Pantry: alerts if $> 25.0^\circ\text{C}$ (excessive heat).
- In all cases, `temperature_adjustment_applied = False` is reported to maintain scientific integrity.

#### E. Package Use-By Date Constraints
- If the manufacturer's use-by date is earlier than the catalog-derived `estimated_end_date`, an alert is issued advising users to adhere to the package date.
- The engine **never** extends a manufacturer's stamped expiration date.

#### F. Reliability Classification Criteria
- **`high`**: Known catalog item, storage zone matches recommendation, unopened (or established opened data available), no temperature or date anomalies.
- **`medium`**: Known item with minor caveats (e.g., package date earlier than catalog estimate, or temperature slightly outside optimal bounds).
- **`low`**: Storage zone mismatch (e.g. refrigerated food stored in pantry), or opened item without opened reference data.
- **`unavailable`**: Product is not found in the knowledge base.

---

### 4. Python Usage Example

```python
from datetime import date
from app.services.shelf_life_service import (
    ShelfLifeEstimateRequest,
    estimate_shelf_life,
)

request = ShelfLifeEstimateRequest(
    product_name="Tomato",
    storage_zone="pantry",
    purchase_date=date(2026, 10, 20),
    opened=False,
    storage_temperature_c=20.0,
    as_of_date=date(2026, 10, 24),
)

result = estimate_shelf_life(request)

print("Product:", result.product_name)                  # Tomato
print("Estimated End Date:", result.estimated_end_date) # 2026-10-27
print("Days Remaining:", result.estimated_remaining_days)# 3
print("Reliability:", result.reliability)                # high
print("Explanation:", result.explanation)
```

---

### 5. API Request & Response Example

#### Request: `POST /shelf-life/estimate`
```json
{
  "product_name": "Tomato",
  "storage_zone": "Pantry",
  "purchase_date": "2026-10-20",
  "opened": false,
  "storage_temperature_c": 20.0,
  "package_use_by_date": null,
  "as_of_date": "2026-10-24"
}
```

#### Response: `HTTP 200 OK`
```json
{
  "product_name": "Tomato",
  "product_found": true,
  "purchase_date": "2026-10-20",
  "as_of_date": "2026-10-24",
  "opened": false,
  "reference_shelf_life_days": 7,
  "estimated_end_date": "2026-10-27",
  "estimated_remaining_days": 3,
  "estimated_days_remaining_nonnegative": 3,
  "storage_zone_used": "pantry",
  "catalog_storage_zone": "pantry",
  "storage_assumption": "Stored in catalog recommended zone: 'pantry'.",
  "storage_temperature_c": 20.0,
  "temperature_adjustment_applied": false,
  "package_use_by_date": null,
  "package_date_warning": null,
  "reliability": "high",
  "warnings": [],
  "explanation": "Item 'Tomato' has an estimated storage life of 7 day(s) based on catalog reference data. Calculated end date is 2026-10-27 (3 day(s) remaining as of 2026-10-24). Reliability is assessed as 'high'."
}
```

#### Unknown Product Response: `POST /shelf-life/estimate`
```json
{
  "product_name": "dragon_fruit_xyz",
  "product_found": false,
  "purchase_date": "2026-10-20",
  "as_of_date": "2026-10-24",
  "opened": false,
  "reference_shelf_life_days": null,
  "estimated_end_date": null,
  "estimated_remaining_days": null,
  "estimated_days_remaining_nonnegative": null,
  "storage_zone_used": null,
  "catalog_storage_zone": null,
  "storage_assumption": "Product not found in knowledge base.",
  "storage_temperature_c": null,
  "temperature_adjustment_applied": false,
  "package_use_by_date": null,
  "package_date_warning": null,
  "reliability": "unavailable",
  "warnings": [
    "Product 'dragon_fruit_xyz' not found in knowledge base. No shelf-life estimate can be produced."
  ],
  "explanation": "Product 'dragon_fruit_xyz' was not found in the SaveBite grocery catalog. A reliable shelf-life estimate cannot be produced without catalog baseline data."
}
```

---

### 6. Food Safety & Estimation Disclaimers
> **IMPORTANT SAFETY NOTICE**: The SaveBite Shelf-Life Estimation Engine calculates **approximate storage time estimates** derived from reference guidelines. It is **not** a laboratory microbiological sensor, food-safety detector, or pathogen test. Food freshness varies based on handling, harvest conditions, transit temperature, and hygiene. Users must always inspect visual appearance, odor, and texture, and strictly respect manufacturer "Use By" dates.

---

## Testing

Execute the complete automated test suite using `pytest`:

```bash
pytest -v
```

The test suite covers **62 automated tests**:
- **Health Suite** (`tests/test_health.py`): 6 tests verifying `GET /health`, `/docs`, `/openapi.json`.
- **Product Catalog Suite** (`tests/test_product_catalog.py`): 27 tests verifying CSV schema, name normalization, alias resolution, O(1) lookups, validation rejection, and `GET /products/{product_name}`.
- **Shelf-Life Service Suite** (`tests/test_shelf_life_service.py`): 29 tests verifying:
  - Fresh unopened items, remaining days math, zero days remaining, and expired signed negative days.
  - Opened item logic with established baseline vs. provisional fallback with warnings.
  - Case-insensitive lookups, plurals, and unknown product handling.
  - Storage zone defaulting, matching, and mismatch degradation.
  - Normal vs. abnormal temperature alerts and out-of-range rejection.
  - Date coherence validation (rejecting future purchase dates).
  - Package use-by date comparison and conflict warnings.
  - `POST /shelf-life/estimate` API responses (200 success, structured unknown item, 422 validation errors).
  - Phase 1 & 2 regression verification.

---

## Project Structure

```text
ai/
├── .venv/                     # Isolated Python virtual environment (ignored by git)
├── app/
│   ├── __init__.py            # Package initializer for application modules
│   ├── main.py                # FastAPI app entrypoint, /health, /products, and /shelf-life routes
│   ├── data/
│   │   ├── __init__.py        # Data package initializer
│   │   └── products.csv       # 36-item grocery reference catalog with official citations
│   └── services/
│       ├── __init__.py        # Services package initializer
│       ├── product_catalog.py # Catalog loader, validator, normalizer, and lookup service
│       └── shelf_life_service.py # Rule-based shelf-life estimation engine
├── tests/
│   ├── test_health.py         # Automated tests for health and documentation endpoints
│   ├── test_product_catalog.py# Automated tests for catalog loading, lookup, validation & API
│   └── test_shelf_life_service.py # Automated tests for shelf-life estimation & POST API
├── .env.example               # Template for environment configuration variables
├── .gitignore                 # Ignores virtualenv, caches, bytecode, and secret files
├── requirements.txt           # Pinned direct dependencies for reproducibility
└── README.md                  # Comprehensive service documentation and developer guide
```

---

## Environment Configuration

The `.env.example` file provides standard configuration defaults:

```dotenv
APP_NAME=SaveBite AI Service
APP_VERSION=0.1.0
APP_HOST=127.0.0.1
APP_PORT=8000
```

---

## Current Limitations & Roadmap

As of Phase 3, the grocery knowledge base, health checks, and rule-based shelf-life estimation engine are fully implemented. The following capabilities are planned for upcoming phases and are **not yet implemented**:
- **Phase 4+**: Priority scoring algorithms for multi-item kitchen urgency.
- Real-time IoT sensor anomaly detection.
- Receipt parsing via Optical Character Recognition (OCR).
- Produce freshness classification via computer vision models.
- Recipe recommendation engines based on expiring pantry ingredients.
- Predictive consumption forecasting.
