# SaveBite Phase 3: Receipts, Barcode & Camera Uploads Documentation

## 1. Executive Summary & Architecture

SaveBite Phase 3 implements the backend ingestion pipeline for physical grocery receipts, product barcode lookup, and camera-based food freshness assessment.

```
+-----------------------------------------------------------------------------------+
|                                 Client Ingestion Flows                            |
|                                                                                   |
|  [Paper Receipt / PDF]             [Product Barcode]         [Item Camera Photo]  |
+-------------------+------------------------+--------------------------+-----------+
                    |                        |                          |
                    | Multipart (10MB Max)   | GET /barcodes/:code      | Multipart (10MB Max)
                    v                        v                          v
+-------------------+------------------------+--------------------------+-----------+
|                                 SaveBite Express Backend                          |
|                                                                                   |
|  - upload.js: Magic byte file signature & MIME validation (JPEG, PNG, WebP, PDF)  |
|  - Private Supabase Storage upload (household-scoped object paths)               |
|  - AI HTTP Client: POST /receipt/parse, POST /normalize, POST /freshness/analyze  |
|  - Confidence Threshold Engine (default: >= 0.85 auto-creates inventory item)     |
|  - Low-confidence confirmation & rejection workflow                               |
|  - Open Food Facts Service: normalized GTIN metadata + in-memory TTL caching     |
+-------------------+------------------------+--------------------------+-----------+
                    |                        |                          |
                    | Service Role / SQL     | Public OpenFoodFacts     | External FastAPI
                    v                        v                          v
+-------------------+-------+       +--------+---------+       +--------+---------+
|  Supabase PostgreSQL DB   |       |  Open Food Facts |       |  FastAPI AI Svc  |
|  - public.receipts        |       |  API v2 (ODbL)   |       |  /receipt/parse  |
|  - public.receipt_items   |       +------------------+       |  /normalize      |
|  - public.freshness_scans |                                  |  /freshness/anal |
|  - public.inventory_items |                                  +------------------+
+---------------------------+
```

---

## 2. Supabase Database Schema & Storage Bucket Setup

### Manual SQL Execution Instructions
1. Open your **Supabase Dashboard** -> **SQL Editor**.
2. Open a new query window.
3. Paste the contents of [phase3-receipts-database-schema.sql](file:///d:/SaveBite/docs/phase3-receipts-database-schema.sql).
4. Click **Run**.

### Schema Summary
- **`public.receipts`**: Records receipt uploads, file metadata, Supabase storage path, and parsing status (`uploaded`, `parsing`, `parsed`, `failed`).
- **`public.receipt_items`**: Stores parsed grocery line items, product name normalization results, parse and normalization confidence scores, overall confidence, status (`pending`, `auto_created`, `confirmed`, `rejected`), and the linked `inventory_item_id`.
- **`public.freshness_scans`**: Stores camera image reference, AI-estimated freshness score (0–100), status label (`fresh`, `use_soon`, `critical`, `expired`), scan confidence, notes, and scanner identity.
- **`public.inventory_items`**: Extended with optional `freshness_score NUMERIC(5, 2)`, `barcode TEXT`, and `receipt_line_id UUID`.
- **Row-Level Security (RLS)**: Enabled on all tables for `service_role`. Application authorization is enforced in the backend.

### Supabase Storage Bucket Setup
1. In the Supabase Dashboard, navigate to **Storage** -> **New Bucket**.
2. **Bucket name**: `receipts`
3. **Public bucket**: **NO** (Must remain **PRIVATE** to protect household grocery receipts).
4. **Allowed MIME types**: `image/jpeg, image/png, image/webp, application/pdf`
5. **Max file size**: `10MB`
6. Click **Save bucket**.

---

## 3. Environment Variables Configuration

In `backend/.env`:

```env
# Phase 3 Configuration
AI_SERVICE_URL=http://localhost:8000
SUPABASE_RECEIPTS_BUCKET=receipts
RECEIPT_MAX_FILE_SIZE_MB=10
RECEIPT_AUTO_CREATE_CONFIDENCE=0.85
AI_REQUEST_TIMEOUT_MS=15000
OPEN_FOOD_FACTS_TIMEOUT_MS=10000
```

---

## 4. API Endpoints Reference

Base URL: `http://localhost:5000/api/v1`

All requests except barcode lookup require custom JWT authentication and active household membership:
```
Authorization: Bearer <accessToken>
```

---

### A. Upload Receipt Image or PDF
- **Method**: `POST`
- **Path**: `/api/v1/receipts/upload`
- **Content-Type**: `multipart/form-data`
- **Form Field**: `file`
- **Supported Formats**: JPEG (`image/jpeg`), PNG (`image/png`), WebP (`image/webp`), PDF (`application/pdf`)
- **Validation**: Enforces binary magic bytes validation. Rejects unsupported formats with `415`, oversized files (>10MB) with `413`, missing files with `400`.
- **Storage**: Uploads to private Supabase Storage at `households/:householdId/receipts/:receiptId.:ext`.
- **Response (`201 Created`)**:
```json
{
  "status": "success",
  "data": {
    "receipt": {
      "id": "c1111111-2222-4333-8444-555555555555",
      "household_id": "hhhhhhhh-1111-2222-3333-444444444444",
      "file_name": "trader_joes_haul.jpg",
      "mime_type": "image/jpeg",
      "file_size_bytes": 1048576,
      "status": "uploaded",
      "created_at": "2026-10-24T18:00:00.000Z"
    }
  }
}
```

---

### B. Parse Receipt via AI & Auto-Create Inventory
- **Method**: `POST`
- **Path**: `/api/v1/receipts/:receiptId/parse`
- **Description**: Generates a short-lived signed URL for the receipt, invokes the AI service's `/receipt/parse` endpoint, calls `/normalize` on each line, evaluates confidence scores, auto-creates inventory items for lines meeting or exceeding `RECEIPT_AUTO_CREATE_CONFIDENCE` (0.85), and marks remaining lines as `pending`.
- **Response (`200 OK`)**:
```json
{
  "status": "success",
  "data": {
    "receipt_id": "c1111111-2222-4333-8444-555555555555",
    "status": "parsed",
    "auto_created_count": 2,
    "pending_count": 1,
    "items": [
      {
        "id": "l1111111-2222-4333-8444-555555555555",
        "raw_name": "ORG WHOLE MILK 1GAL",
        "normalized_name": "Organic Whole Milk",
        "category": "dairy",
        "quantity": 1,
        "unit": "bottle",
        "unit_price": 4.99,
        "total_price": 4.99,
        "confidence": 0.931,
        "status": "auto_created",
        "inventory_item_id": "i1111111-2222-4333-8444-555555555555"
      },
      {
        "id": "l2222222-2222-4333-8444-555555555555",
        "raw_name": "UNCL BANANAS BUNCH",
        "normalized_name": "Bananas",
        "category": "produce",
        "quantity": 2,
        "unit": "lb",
        "unit_price": 0.69,
        "total_price": 1.38,
        "confidence": 0.686,
        "status": "pending",
        "inventory_item_id": null
      }
    ]
  }
}
```

---

### C. Get Parsed Line Items
- **Method**: `GET`
- **Path**: `/api/v1/receipts/:receiptId/items`
- **Description**: Returns all parsed line items for a receipt belonging to the user's household.
- **Response (`200 OK`)**:
```json
{
  "status": "success",
  "data": {
    "receipt_id": "c1111111-2222-4333-8444-555555555555",
    "items": [...]
  }
}
```

---

### D. Confirm Low-Confidence Line Item
- **Method**: `POST`
- **Path**: `/api/v1/receipts/:receiptId/items/:lineId/confirm`
- **Description**: Allows the user to confirm a low-confidence item with optional corrections, creating the inventory item and updating the line status to `confirmed`. Rejects duplicate confirmations with `409 Conflict`.
- **Request Body**:
```json
{
  "name": "Fresh Organic Bananas",
  "category": "produce",
  "quantity": 3,
  "unit": "piece",
  "storage_location": "counter",
  "purchase_date": "2026-10-24"
}
```
- **Response (`200 OK`)**:
```json
{
  "status": "success",
  "data": {
    "line_item": {
      "id": "l2222222-2222-4333-8444-555555555555",
      "status": "confirmed",
      "inventory_item_id": "i2222222-2222-4333-8444-555555555555"
    },
    "inventory_item": {
      "id": "i2222222-2222-4333-8444-555555555555",
      "name": "Fresh Organic Bananas",
      "category": "produce",
      "quantity": 3,
      "unit": "piece",
      "storage_location": "counter",
      "status": "active"
    }
  }
}
```

---

### E. Reject Low-Confidence Line Item
- **Method**: `POST`
- **Path**: `/api/v1/receipts/:receiptId/items/:lineId/reject`
- **Description**: Rejects an unconfirmed line item (`status: 'rejected'`). Rejects already-created inventory lines with `409 Conflict`. Idempotent for repeated calls.
- **Response (`200 OK`)**:
```json
{
  "status": "success",
  "data": {
    "line_item": {
      "id": "l2222222-2222-4333-8444-555555555555",
      "status": "rejected"
    }
  }
}
```

---

### F. Barcode Lookup (Open Food Facts)
- **Method**: `GET`
- **Path**: `/api/v1/barcodes/:barcode`
- **Description**: Looks up standard retail barcodes (8–14 digits) against the official Open Food Facts API v2. Includes attribution, formats categories, and caches results in-memory with a 1-hour TTL. Does NOT automatically create an inventory item.
- **Response (`200 OK`)**:
```json
{
  "status": "success",
  "data": {
    "product": {
      "barcode": "8901030928114",
      "name": "Maggi 2-Minute Noodles",
      "brand": "Nestle",
      "categories": ["Groceries", "Noodles", "Instant noodles"],
      "ingredients_text": "Wheat flour, palm oil, salt, mineral",
      "quantity": "70 g",
      "image_url": "https://images.openfoodfacts.org/images/products/maggi.jpg",
      "verified": true,
      "attribution": "Open Food Facts (ODbL)"
    }
  }
}
```

---

### G. Camera Image Freshness Scan
- **Method**: `POST`
- **Path**: `/api/v1/inventory/:itemId/freshness-scan`
- **Content-Type**: `multipart/form-data`
- **Form Field**: `file` (JPEG, PNG, WebP only; PDF rejected with 415)
- **Description**: Verifies that the inventory item belongs to the active household, uploads the camera photo to private Supabase Storage, invokes the AI service's `/freshness/analyze` endpoint, saves the record in `public.freshness_scans`, updates `inventory_items.freshness_score`, and returns the assessment with a mandatory food safety disclaimer.
- **Response (`200 OK`)**:
```json
{
  "status": "success",
  "data": {
    "scan_id": "s1111111-2222-4333-8444-555555555555",
    "inventory_item_id": "i1111111-2222-4333-8444-555555555555",
    "freshness_score": 82.5,
    "status": "fresh",
    "confidence": 0.94,
    "notes": "Vibrant red pigmentation, firm texture, no surface molds detected.",
    "created_at": "2026-10-24T18:15:00.000Z",
    "disclaimer": "Freshness score is an AI-generated estimate and does not guarantee food safety."
  }
}
```

---

## 5. AI Service HTTP Contracts

The backend connects to an external FastAPI AI service at `AI_SERVICE_URL`:

### 1. `/receipt/parse`
- **Method**: `POST`
- **Payload**:
```json
{
  "receipt_id": "UUID",
  "image_url": "https://...signedUrl...",
  "storage_path": "households/.../receipt.jpg"
}
```
- **Expected Response**:
```json
{
  "items": [
    {
      "name": "string",
      "quantity": 1,
      "unit": "string",
      "unit_price": 4.99,
      "total_price": 4.99,
      "confidence": 0.95
    }
  ],
  "merchant_name": "string",
  "purchase_date": "YYYY-MM-DD",
  "total_amount": 10.99
}
```

### 2. `/normalize`
- **Method**: `POST`
- **Payload**:
```json
{
  "raw_name": "ORG WHOLE MILK 1GAL",
  "category_hint": null
}
```
- **Expected Response**:
```json
{
  "normalized_name": "Organic Whole Milk",
  "category": "dairy",
  "unit": "bottle",
  "storage_location": "refrigerator",
  "confidence": 0.98
}
```

### 3. `/freshness/analyze`
- **Method**: `POST`
- **Payload**:
```json
{
  "image_url": "https://...signedUrl...",
  "item_name": "Fresh Strawberries",
  "category": "produce"
}
```
- **Expected Response**:
```json
{
  "freshness_score": 82.5,
  "status": "fresh",
  "confidence": 0.94,
  "notes": "Detailed visual evaluation..."
}
```

---

## 6. Testing Guide

Run all Phase 1, Phase 2, and Phase 3 automated tests:
```bash
cd backend
npm test
```

### Test Coverage Highlights:
- **Receipts (`tests/receipts.test.js`)**: Multipart file upload, magic bytes signature checks, format rejection (415), oversized rejection (413), missing file rejection (400), Supabase storage upload failure, AI receipt parsing, product normalization, confidence-threshold auto-creation, low-confidence pending status, manual confirmation with corrections, rejection, duplicate confirmation prevention (409), household isolation.
- **Barcodes (`tests/barcode.test.js`)**: Open Food Facts metadata formatting, User-Agent compliance, in-memory caching, 404 product-not-found, 502 upstream errors, 504 timeouts, barcode format validation.
- **Freshness (`tests/freshness.test.js`)**: Camera image upload, PDF rejection, household ownership check, scan history persistence, inventory freshness score update, food safety disclaimer enforcement, timeout resilience.
