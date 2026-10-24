# SaveBite Phase 1: Secure Household & Inventory API Documentation

## 1. Overview & Architecture

SaveBite is an AI-powered grocery intelligence and food waste management platform. 

This document details the backend implementation for **Phase 1: Secure Household and Inventory Management**, built with **Node.js**, **Express**, **Supabase PostgreSQL**, **custom JWT authentication**, and **Zod validation**.

```
+-------------------------------------------------------------------------+
|                        Client / Postman / Web                          |
+------------------------------------+------------------------------------+
                                     | Bearer <Custom JWT>
                                     v
+-------------------------------------------------------------------------+
|                    Express Application Pipeline                         |
|  1. Helmet (Security Headers)                                           |
|  2. Strict CORS (Frontend URL filtering)                                |
|  3. Pino Structured Logging (with sensitive field redaction)           |
|  4. Rate Limiting (Global & Auth-specific limiters)                     |
|  5. Body Parsing (100kb payload protection)                             |
|  6. Authenticate Middleware (verify token signature & revocation)       |
|  7. RequireHousehold Middleware (derives authorized household via DB)   |
|  8. Zod Validation (Request Body, Query, and Params schemas)            |
+------------------------------------+------------------------------------+
                                     | Scoped Database Queries
                                     v
+-------------------------------------------------------------------------+
|                      Supabase PostgreSQL Database                       |
|  - public.users (standalone bcrypt auth & token versioning)             |
|  - public.households (isolated household spaces)                        |
|  - public.household_members (owner & member roles)                      |
|  - public.inventory_items (pantry & grocery items)                      |
|  - public.waste_log (food waste audit & loss valuation)                 |
|  - public.inventory_events (full lifecycle audit trail)                 |
+-------------------------------------------------------------------------+
```

### Key Security & Design Principles

1. **Custom JWT Authentication**: User identities are authenticated via bcrypt and signed JSON Web Tokens (`HS256`). Supabase Auth is **not** used. Tokens carry standard subject claims (`sub: user.id`, `tokenVersion`).
2. **Server-Derived Household Authorization**: Clients **cannot** supply a `household_id` to override authorization. The backend derives the user's active household membership directly from `public.household_members` in the database.
3. **Multi-Tenant Household Isolation**: All inventory items, waste records, and dashboard metrics are strictly filtered by `household_id = req.household.id`. Querying or mutating an item belonging to another household returns `404 Not Found` to prevent resource enumeration.
4. **Row-Level Security (RLS)**: RLS is enabled on all tables. Since the Node.js backend connects using the trusted server-side Supabase key, all database operations apply strict parameterized filters and application-level authorization.
5. **Zero-Trust Input Sanitization**: All incoming inputs (query parameters, JSON bodies, route UUIDs) are validated and coerced by strict Zod schemas before reaching controllers.
6. **Stock Integrity**: Stock changes are atomic. Consume and waste endpoints verify available stock to guarantee that quantities **never** become negative.

---

## 2. Database Migration & Schema

### Migration File
`supabase/migrations/20261024000002_create_household_and_inventory.sql`

### Manual Execution in Supabase Dashboard
1. Open your **Supabase Dashboard** -> **SQL Editor**.
2. Create a new query and paste the contents of `supabase/migrations/20261024000002_create_household_and_inventory.sql`.
3. Click **Run**.
4. The migration executes atomically:
   - Creates `public.households`, `public.household_members`, `public.inventory_items`, `public.waste_log`, and `public.inventory_events`.
   - Creates composite and performance indexes for filtering (`user_id, status`, `household_id, status`, `household_id, expiry_date`, etc.).
   - Attaches `handle_updated_at` triggers for automatic timestamp management.
   - Creates the transactional stored function `public.create_user_with_household`.
   - Enables Row-Level Security (RLS) on all tables with policies for `service_role`.
   - Executes a safe backfill script that provisions a default household and owner membership for any pre-existing users.

---

## 3. Inventory Lifecycle & Status Transitions

Each inventory item progresses through a strictly defined lifecycle:

```
                  +--------------------------------+
                  |  POST /inventory (or purchase) |
                  +---------------+----------------+
                                  |
                                  v
                            +------------+
          +---------------->|   active   |<----------------+
          |                 +-----+------+                 |
          | (partial consume)     |       (partial waste)  |
          +-----------------------+------------------------+
                                  |
               +------------------+------------------+
               | (stock = 0)                         | (stock = 0)
               v                                     v
       +---------------+                     +---------------+
       |   consumed    |                     |    wasted     |
       +---------------+                     +---------------+
               ^
               | (DELETE /inventory/:itemId)
               |
       +---------------+
       |   archived    |
       +---------------+
```

- **`active`**: Items currently stored in the pantry, refrigerator, or counter with `quantity > 0`.
- **`consumed`**: Items whose quantity has been fully depleted through consumption (`quantity = 0`).
- **`wasted`**: Items whose quantity has been depleted due to spoilage, expiration, or damage (`quantity = 0`). A corresponding record is written to `waste_log`.
- **`archived`**: Soft-deleted items that are hidden from active inventory and dashboard views while preserving historical events.

---

## 4. API Endpoints Reference

Base URL: `http://localhost:5000/api/v1`

All requests except `/auth/signup` and `/auth/signin` require the header:
```
Authorization: Bearer <accessToken>
```

---

### A. User Signup (With Atomic Household Provisioning)
- **Method**: `POST`
- **Path**: `/api/v1/auth/signup`
- **Description**: Registers a new user account and atomically provisions a default household (`"<Name>'s Household"`) and owner membership.
- **Request Body**:
```json
{
  "name": "Alex Gourmet",
  "email": "alex@savebite.com",
  "password": "StrongPassword123!"
}
```
- **Response (`201 Created`)**:
```json
{
  "status": "success",
  "data": {
    "user": {
      "id": "11111111-2222-3333-4444-555555555555",
      "name": "Alex Gourmet",
      "email": "alex@savebite.com",
      "role": "user",
      "createdAt": "2026-10-24T17:00:00.000Z",
      "updatedAt": "2026-10-24T17:00:00.000Z"
    },
    "household": {
      "id": "hhhhhhhh-1111-2222-3333-444444444444",
      "name": "Alex Gourmet's Household",
      "role": "owner"
    },
    "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
  }
}
```

---

### B. User Signin
- **Method**: `POST`
- **Path**: `/api/v1/auth/signin`
- **Request Body**:
```json
{
  "email": "alex@savebite.com",
  "password": "StrongPassword123!"
}
```
- **Response (`200 OK`)**:
```json
{
  "status": "success",
  "data": {
    "user": {
      "id": "11111111-2222-3333-4444-555555555555",
      "name": "Alex Gourmet",
      "email": "alex@savebite.com",
      "role": "user",
      "createdAt": "2026-10-24T17:00:00.000Z",
      "updatedAt": "2026-10-24T17:00:00.000Z"
    },
    "household": {
      "id": "hhhhhhhh-1111-2222-3333-444444444444",
      "name": "Alex Gourmet's Household",
      "role": "owner"
    },
    "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
  }
}
```

---

### C. Create Inventory Item
- **Method**: `POST`
- **Path**: `/api/v1/inventory`
- **Request Body**:
```json
{
  "name": "Organic Whole Milk",
  "category": "dairy",
  "quantity": 2,
  "unit": "l",
  "purchase_date": "2026-10-24",
  "expiry_date": "2026-10-31",
  "storage_location": "refrigerator",
  "estimated_unit_price": 3.49,
  "currency": "USD"
}
```
- **Allowed Categories**: `produce`, `dairy`, `bakery`, `meat`, `pantry`, `beverages`, `frozen`, `leftovers`, `snacks`, `other`
- **Allowed Units**: `g`, `kg`, `ml`, `l`, `piece`, `pack`, `oz`, `lb`, `can`, `bottle`, `item`, `serving`
- **Allowed Storage Locations**: `refrigerator`, `freezer`, `pantry`, `counter`, `other`
- **Response (`201 Created`)**:
```json
{
  "status": "success",
  "data": {
    "item": {
      "id": "c1111111-2222-3333-4444-555555555555",
      "household_id": "hhhhhhhh-1111-2222-3333-444444444444",
      "name": "Organic Whole Milk",
      "category": "dairy",
      "quantity": 2,
      "unit": "l",
      "purchase_date": "2026-10-24",
      "expiry_date": "2026-10-31",
      "storage_location": "refrigerator",
      "estimated_unit_price": 3.49,
      "currency": "USD",
      "status": "active",
      "is_opened": false,
      "opened_at": null,
      "created_by": "11111111-2222-3333-4444-555555555555",
      "created_at": "2026-10-24T17:05:00.000Z",
      "updated_at": "2026-10-24T17:05:00.000Z"
    }
  }
}
```

---

### D. List Inventory Items
- **Method**: `GET`
- **Path**: `/api/v1/inventory`
- **Query Parameters**:
  - `search` or `name`: Case-insensitive substring search (e.g., `?search=milk`)
  - `category`: Filter by category (e.g., `?category=dairy`)
  - `storage_location`: Filter by location (e.g., `?storage_location=refrigerator`)
  - `status`: `active` (default), `consumed`, `wasted`, `archived`, or `all`
  - `expiring_before`: Date format `YYYY-MM-DD`
  - `page`: Integer >= 1 (default: `1`)
  - `limit`: Integer between 1 and 100 (default: `20`)
  - `sort_by`: `expiry_date` (default), `name`, `created_at`, `quantity`
  - `order`: `asc` (default) or `desc`
- **Response (`200 OK`)**:
```json
{
  "status": "success",
  "data": {
    "items": [
      {
        "id": "c1111111-2222-3333-4444-555555555555",
        "household_id": "hhhhhhhh-1111-2222-3333-444444444444",
        "name": "Organic Whole Milk",
        "category": "dairy",
        "quantity": 2,
        "unit": "l",
        "purchase_date": "2026-10-24",
        "expiry_date": "2026-10-31",
        "storage_location": "refrigerator",
        "estimated_unit_price": 3.49,
        "currency": "USD",
        "status": "active",
        "is_opened": false,
        "opened_at": null,
        "created_at": "2026-10-24T17:05:00.000Z"
      }
    ],
    "pagination": {
      "page": 1,
      "limit": 20,
      "total": 1,
      "totalPages": 1
    }
  }
}
```

---

### E. Get Single Item
- **Method**: `GET`
- **Path**: `/api/v1/inventory/:itemId`
- **Response (`200 OK`)**:
```json
{
  "status": "success",
  "data": {
    "item": {
      "id": "c1111111-2222-3333-4444-555555555555",
      "name": "Organic Whole Milk",
      "quantity": 2,
      "unit": "l",
      "status": "active"
    }
  }
}
```
- **Error Response (`404 Not Found`)** if item does not exist or belongs to another household:
```json
{
  "status": "error",
  "message": "Inventory item not found",
  "error": {
    "code": "NOT_FOUND",
    "message": "Inventory item not found"
  }
}
```

---

### F. Update Inventory Item
- **Method**: `PATCH`
- **Path**: `/api/v1/inventory/:itemId`
- **Permitted Fields**: `name`, `category`, `quantity`, `unit`, `purchase_date`, `expiry_date`, `storage_location`, `estimated_unit_price`, `currency`.
- **Protected Fields**: Attempting to supply `id`, `household_id`, `created_by`, `status`, or `created_at` results in a `400 Bad Request` validation error.
- **Request Body**:
```json
{
  "quantity": 3,
  "storage_location": "refrigerator"
}
```
- **Response (`200 OK`)**:
```json
{
  "status": "success",
  "data": {
    "item": {
      "id": "c1111111-2222-3333-4444-555555555555",
      "name": "Organic Whole Milk",
      "quantity": 3,
      "storage_location": "refrigerator"
    }
  }
}
```

---

### G. Archive / Soft-Delete Item
- **Method**: `DELETE`
- **Path**: `/api/v1/inventory/:itemId`
- **Description**: Sets item status to `archived`. Preserves all past waste and consumption logs. Archived items no longer appear in default inventory listings or dashboard counts.
- **Response (`200 OK`)**:
```json
{
  "status": "success",
  "message": "Item archived successfully"
}
```

---

### H. Consume Stock
- **Method**: `POST`
- **Path**: `/api/v1/inventory/:itemId/consume`
- **Description**: Decreases stock atomically. If stock reaches 0, transitions status to `consumed`.
- **Request Body**:
```json
{
  "quantity": 1,
  "unit": "l"
}
```
- **Response (`200 OK`)**:
```json
{
  "status": "success",
  "data": {
    "item": {
      "id": "c1111111-2222-3333-4444-555555555555",
      "name": "Organic Whole Milk",
      "quantity": 2,
      "status": "active"
    },
    "consumedQuantity": 1,
    "remainingQuantity": 2
  }
}
```
- **Error Response (`400 Bad Request`)** if requested quantity exceeds available stock:
```json
{
  "status": "error",
  "message": "Cannot consume 10 l. Only 2 l available.",
  "error": {
    "code": "INSUFFICIENT_STOCK",
    "message": "Cannot consume 10 l. Only 2 l available.",
    "details": {
      "available": 2,
      "requested": 10
    }
  }
}
```

---

### I. Log Food Waste
- **Method**: `POST`
- **Path**: `/api/v1/inventory/:itemId/waste`
- **Description**: Atomically decreases stock, transitions status to `wasted` if quantity reaches 0, and creates a `waste_log` audit record. Automatically calculates monetary loss if unit price is stored.
- **Allowed Reasons**: `expired`, `spoiled`, `damaged`, `leftover`, `other`
- **Request Body**:
```json
{
  "quantity": 1,
  "reason": "spoiled"
}
```
- **Response (`200 OK`)**:
```json
{
  "status": "success",
  "data": {
    "item": {
      "id": "c1111111-2222-3333-4444-555555555555",
      "name": "Organic Whole Milk",
      "quantity": 1,
      "status": "active"
    },
    "wasteLog": {
      "id": "w1111111-2222-3333-4444-555555555555",
      "household_id": "hhhhhhhh-1111-2222-3333-444444444444",
      "inventory_item_id": "c1111111-2222-3333-4444-555555555555",
      "item_name": "Organic Whole Milk",
      "quantity": 1,
      "unit": "l",
      "reason": "spoiled",
      "estimated_value": 3.49,
      "recorded_by": "11111111-2222-3333-4444-555555555555",
      "wasted_at": "2026-10-24T17:15:00.000Z"
    }
  }
}
```

---

### J. Mark Item Opened (Idempotent)
- **Method**: `POST`
- **Path**: `/api/v1/inventory/:itemId/open`
- **Description**: Marks item as opened and sets `opened_at` timestamp. Idempotent: repeated calls will **not** overwrite the original opening timestamp and will not alter stock.
- **Response (`200 OK`)**:
```json
{
  "status": "success",
  "data": {
    "item": {
      "id": "c1111111-2222-3333-4444-555555555555",
      "name": "Organic Whole Milk",
      "is_opened": true,
      "opened_at": "2026-10-24T17:10:00.000Z"
    }
  }
}
```

---

### K. Manual Grocery Purchase
- **Method**: `POST`
- **Path**: `/api/v1/inventory/manual-purchase`
- **Description**: Ingests grocery items directly into pantry inventory with active status. Designed for manual grocery receipt recording.
- **Request Body**:
```json
{
  "name": "Sourdough Bread",
  "category": "bakery",
  "quantity": 1,
  "unit": "piece",
  "purchase_date": "2026-10-24",
  "expiry_date": "2026-10-29",
  "storage_location": "pantry",
  "estimated_unit_price": 4.25,
  "currency": "USD"
}
```
- **Response (`201 Created`)**:
```json
{
  "status": "success",
  "data": {
    "item": {
      "id": "c2222222-2222-3333-4444-555555555555",
      "household_id": "hhhhhhhh-1111-2222-3333-444444444444",
      "name": "Sourdough Bread",
      "status": "active"
    }
  }
}
```

---

### L. Household Dashboard & Intelligence
- **Method**: `GET`
- **Path**: `/api/v1/dashboard`
- **Description**: Calculates household-scoped metrics:
  - `totalActiveItems`: Count of non-archived, non-consumed items.
  - `totalQuantity`: Sum of inventory quantities.
  - `totalEstimatedValue`: Sum of `quantity * estimated_unit_price` (excludes unpriced items).
  - `expiringSoonCount`: Items expiring within the next 7 days (`today <= expiry_date <= today + 7d`).
  - `expiredCount`: Items with `expiry_date < today`.
  - `useFirst`: Top 5 active items prioritized by earliest upcoming expiry date.
  - `wasteSummary`: Total items and monetary value wasted in the past 30 days.
- **Response (`200 OK`)**:
```json
{
  "status": "success",
  "data": {
    "summary": {
      "totalActiveItems": 8,
      "totalQuantity": 15.5,
      "totalEstimatedValue": 48.75,
      "currency": "USD",
      "expiringSoonCount": 2,
      "expiredCount": 0
    },
    "expiringSoon": [
      {
        "id": "c2222222-2222-3333-4444-555555555555",
        "name": "Sourdough Bread",
        "expiry_date": "2026-10-29",
        "quantity": 1,
        "unit": "piece"
      }
    ],
    "useFirst": [
      {
        "id": "c2222222-2222-3333-4444-555555555555",
        "name": "Sourdough Bread",
        "expiry_date": "2026-10-29",
        "quantity": 1,
        "unit": "piece"
      },
      {
        "id": "c1111111-2222-3333-4444-555555555555",
        "name": "Organic Whole Milk",
        "expiry_date": "2026-10-31",
        "quantity": 1,
        "unit": "l"
      }
    ],
    "wasteSummary": {
      "totalWastedItems": 1,
      "totalWastedValue": 3.49
    }
  }
}
```

---

## 5. Postman 12-Step Testing Sequence

To thoroughly verify all Phase 1 endpoints in Postman, execute the following requests in order:

### Environment Setup in Postman
- Create an environment variable: `baseUrl = http://localhost:5000/api/v1`
- Variable `token` (will be set automatically)
- Variable `itemId` (will be set automatically)

---

### Step 1: Sign Up / Sign In
- **POST** `{{baseUrl}}/auth/signin`
- **Body**:
```json
{
  "email": "alex@savebite.com",
  "password": "StrongPassword123!"
}
```
- **Postman Tests script**:
```javascript
pm.test("Status code is 200", () => {
    pm.response.to.have.status(200);
    const jsonData = pm.response.json();
    pm.environment.set("token", jsonData.data.accessToken);
});
```

---

### Step 2: Verify Current User & Household
- **GET** `{{baseUrl}}/auth/me`
- **Headers**: `Authorization: Bearer {{token}}`
- **Assert**: `data.user.household.id` is present and non-empty.

---

### Step 3: Create an Inventory Item
- **POST** `{{baseUrl}}/inventory`
- **Headers**: `Authorization: Bearer {{token}}`
- **Body**:
```json
{
  "name": "Greek Yogurt",
  "category": "dairy",
  "quantity": 4,
  "unit": "piece",
  "purchase_date": "2026-10-24",
  "expiry_date": "2026-10-30",
  "storage_location": "refrigerator",
  "estimated_unit_price": 1.25,
  "currency": "USD"
}
```
- **Postman Tests script**:
```javascript
pm.test("Created 201", () => {
    pm.response.to.have.status(201);
    const jsonData = pm.response.json();
    pm.environment.set("itemId", jsonData.data.item.id);
});
```

---

### Step 4: Retrieve Inventory List
- **GET** `{{baseUrl}}/inventory?category=dairy`
- **Headers**: `Authorization: Bearer {{token}}`
- **Assert**: List contains `Greek Yogurt` with `quantity = 4`.

---

### Step 5: Update the Item
- **PATCH** `{{baseUrl}}/inventory/{{itemId}}`
- **Headers**: `Authorization: Bearer {{token}}`
- **Body**:
```json
{
  "name": "Organic Greek Yogurt",
  "storage_location": "refrigerator"
}
```
- **Assert**: Item name is updated to `"Organic Greek Yogurt"`.

---

### Step 6: Mark Item Opened
- **POST** `{{baseUrl}}/inventory/{{itemId}}/open`
- **Headers**: `Authorization: Bearer {{token}}`
- **Assert**: `is_opened` is `true` and `opened_at` contains timestamp.

---

### Step 7: Consume Stock
- **POST** `{{baseUrl}}/inventory/{{itemId}}/consume`
- **Headers**: `Authorization: Bearer {{token}}`
- **Body**:
```json
{
  "quantity": 1,
  "unit": "piece"
}
```
- **Assert**: Status `200`, `quantity` becomes `3`, `status` remains `'active'`.

---

### Step 8: Log Food Waste
- **POST** `{{baseUrl}}/inventory/{{itemId}}/waste`
- **Headers**: `Authorization: Bearer {{token}}`
- **Body**:
```json
{
  "quantity": 1,
  "reason": "spoiled"
}
```
- **Assert**: Status `200`, `quantity` becomes `2`, `wasteLog.estimated_value` equals `1.25`.

---

### Step 9: Add Manual Purchase (Pantry Ingestion)
- **POST** `{{baseUrl}}/inventory/manual-purchase`
- **Headers**: `Authorization: Bearer {{token}}`
- **Body**:
```json
{
  "name": "Brown Eggs",
  "category": "dairy",
  "quantity": 12,
  "unit": "piece",
  "purchase_date": "2026-10-24",
  "expiry_date": "2026-11-15",
  "storage_location": "refrigerator",
  "estimated_unit_price": 0.35,
  "currency": "USD"
}
```
- **Assert**: Status `201`, created item has `status = 'active'`.

---

### Step 10: Retrieve Dashboard Analytics
- **GET** `{{baseUrl}}/dashboard`
- **Headers**: `Authorization: Bearer {{token}}`
- **Assert**:
  - `data.summary.totalActiveItems >= 2`
  - `data.summary.totalEstimatedValue > 0`
  - `data.wasteSummary.totalWastedItems >= 1`
  - `data.useFirst` contains `Organic Greek Yogurt` expiring soonest.

---

### Step 11: Verify Cross-Household Isolation
- Register a second user (User B) and obtain User B's token.
- Attempt to read User A's item:
  - **GET** `{{baseUrl}}/inventory/{{itemId}}`
  - **Headers**: `Authorization: Bearer <UserB_Token>`
- **Assert**: Returns `404 Not Found`. User B cannot read or tamper with User A's inventory.

---

### Step 12: Logout and Token Invalidation
- **POST** `{{baseUrl}}/auth/logout`
- **Headers**: `Authorization: Bearer {{token}}`
- **Assert**: Returns `200 OK`.
- Retrying any inventory request with `{{token}}` immediately returns `401 Unauthorized` (`"Token has been revoked"`).
